'use strict';

/**
 * Regras de negocio das reservas.
 * Tudo que envolve dinheiro e agenda e decidido AQUI, no servidor.
 * O navegador do cliente nunca manda preco nem valor: ele so manda
 * quem e, qual roteiro, que dia e quantas pessoas.
 */

const crypto = require('crypto');
const db = require('../db');
const { normalizarTelefone, ehDataIsoValida, hojeIso } = require('../lib/util');

const MAX_PESSOAS_ABSOLUTO = 20;

function listarRoteiros(somenteAtivos = true) {
    return db.prepare(`SELECT * FROM roteiros ${somenteAtivos ? 'WHERE ativo = 1' : ''} ORDER BY preco_centavos`).all();
}

function buscarRoteiro(id) {
    return db.prepare('SELECT * FROM roteiros WHERE id = ? AND ativo = 1').get(id) || null;
}

function dataBloqueada(data) {
    return !!db.prepare('SELECT 1 FROM bloqueios_agenda WHERE data_passeio = ?').get(data);
}

/** Quantos lugares ja estao comprometidos nesse roteiro nesse dia. */
function lugaresOcupados(roteiroId, data) {
    const r = db.prepare(`SELECT COALESCE(SUM(num_pessoas), 0) AS total
                          FROM reservas
                          WHERE roteiro_id = ? AND data_passeio = ?
                            AND status IN ('pendente','aguardando_pagamento','confirmada')`)
                .get(roteiroId, data);
    return r.total;
}

function vagasRestantes(roteiroId, data) {
    const roteiro = buscarRoteiro(roteiroId);
    if (!roteiro) return 0;
    const capacidade = roteiro.capacidade_max || MAX_PESSOAS_ABSOLUTO;
    return Math.max(0, capacidade - lugaresOcupados(roteiroId, data));
}

/**
 * Valida um pedido de reserva. Devolve { ok, erro, dados }.
 * Nunca confia em nada que veio do formulario alem dos quatro campos.
 */
function validarPedido({ nome, whatsapp, roteiro_id, data_passeio, num_pessoas }) {
    const nomeLimpo = String(nome || '').trim().replace(/\s+/g, ' ');
    if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
        return { ok: false, erro: 'Informe um nome entre 2 e 80 caracteres.' };
    }

    const fone = normalizarTelefone(whatsapp);
    if (!fone) {
        return { ok: false, erro: 'WhatsApp invalido. Use DDD + numero, por exemplo 73 99999-9999.' };
    }

    const roteiro = buscarRoteiro(roteiro_id);
    if (!roteiro) return { ok: false, erro: 'Roteiro nao encontrado ou indisponivel.' };

    if (!ehDataIsoValida(data_passeio)) {
        return { ok: false, erro: 'Data invalida.' };
    }
    if (data_passeio < hojeIso(1)) {
        return { ok: false, erro: 'A data do passeio precisa ser a partir de amanha.' };
    }
    if (data_passeio > hojeIso(365)) {
        return { ok: false, erro: 'So aceitamos reservas com ate um ano de antecedencia.' };
    }
    if (dataBloqueada(data_passeio)) {
        return { ok: false, erro: 'Essa data esta bloqueada na agenda. Escolha outro dia.' };
    }

    const pessoas = parseInt(num_pessoas, 10);
    if (!Number.isFinite(pessoas) || pessoas < 1 || pessoas > MAX_PESSOAS_ABSOLUTO) {
        return { ok: false, erro: 'Numero de pessoas invalido.' };
    }

    const vagas = vagasRestantes(roteiro.id, data_passeio);
    if (pessoas > vagas) {
        return {
            ok: false,
            erro: vagas === 0
                ? `O roteiro "${roteiro.nome}" ja esta lotado nessa data. Escolha outro dia.`
                : `So restam ${vagas} lugar(es) no roteiro "${roteiro.nome}" nessa data.`
        };
    }

    return {
        ok: true,
        dados: {
            nome: nomeLimpo,
            whatsapp: fone,
            roteiro,
            data_passeio,
            num_pessoas: pessoas,
            // O PRECO VEM DO BANCO. Nunca do navegador.
            valor_centavos: roteiro.preco_centavos * pessoas
        }
    };
}

/** Cria cliente (ou reaproveita) + reserva, numa transacao so. */
function criar(dados) {
    const reservaId = crypto.randomUUID();
    const agora = Date.now();

    const transacao = db.transaction(() => {
        let cliente = db.prepare('SELECT * FROM clientes WHERE whatsapp = ?').get(dados.whatsapp);
        if (!cliente) {
            const clienteId = crypto.randomUUID();
            db.prepare(`INSERT INTO clientes (id, nome, whatsapp, criado_em) VALUES (?, ?, ?, ?)`)
              .run(clienteId, dados.nome, dados.whatsapp, agora);
            cliente = { id: clienteId, nome: dados.nome, whatsapp: dados.whatsapp, novo: true };
        } else {
            db.prepare('UPDATE clientes SET nome = ? WHERE id = ?').run(dados.nome, cliente.id);
            cliente.novo = false;
        }

        db.prepare(`INSERT INTO reservas
            (id, cliente_id, roteiro_id, data_passeio, num_pessoas, valor_centavos, status, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, 'aguardando_pagamento', ?)`)
          .run(reservaId, cliente.id, dados.roteiro.id, dados.data_passeio,
               dados.num_pessoas, dados.valor_centavos, agora);

        db.prepare(`INSERT INTO logs_acesso (cliente_id, acao, detalhes_json, criado_em)
                    VALUES (?, 'reserva_criada', ?, ?)`)
          .run(cliente.id, JSON.stringify({ reservaId, roteiro: dados.roteiro.id }), agora);

        return cliente;
    });

    const cliente = transacao();
    return { reservaId, cliente };
}

function detalhar(reservaId) {
    return db.prepare(`
        SELECT r.*, c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp,
               t.nome AS roteiro_nome, t.duracao_min
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        WHERE r.id = ?`).get(reservaId) || null;
}

/** Aceita o id completo ou o codigo curto de 6 caracteres que vai nos avisos. */
function porCodigo(codigo) {
    const limpo = String(codigo || '').trim().toUpperCase();
    if (limpo.length >= 32) return detalhar(limpo.toLowerCase());
    const linha = db.prepare(`
        SELECT id FROM reservas
        WHERE UPPER(SUBSTR(REPLACE(id,'-',''), 1, 6)) = ?
        ORDER BY criado_em DESC LIMIT 1`).get(limpo);
    return linha ? detalhar(linha.id) : null;
}

function doDia(data) {
    return db.prepare(`
        SELECT r.id, r.data_passeio, r.num_pessoas, r.status, r.valor_centavos,
               c.nome AS cliente_nome, c.whatsapp AS cliente_whatsapp, t.nome AS roteiro_nome
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        WHERE r.data_passeio = ? AND r.status IN ('confirmada','aguardando_pagamento','pendente')
        ORDER BY t.nome`).all(data);
}

function pendentesDePagamento() {
    return db.prepare(`
        SELECT r.id AS reserva_id, r.data_passeio, r.num_pessoas, r.status AS reserva_status,
               r.valor_centavos AS reserva_valor,
               p.id AS pagamento_id, p.valor_centavos, p.comprovante_arquivo, p.criado_em AS pago_em,
               c.nome, c.whatsapp, t.nome AS roteiro_nome
        FROM reservas r
        JOIN pagamentos p ON p.reserva_id = r.id
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        WHERE p.status = 'aguardando_confirmacao'
        ORDER BY p.criado_em DESC`).all();
}

function semComprovante() {
    return db.prepare(`
        SELECT r.id AS reserva_id, r.data_passeio, r.num_pessoas, r.valor_centavos,
               c.nome, c.whatsapp, t.nome AS roteiro_nome, r.criado_em
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        LEFT JOIN pagamentos p ON p.reserva_id = r.id
        WHERE r.status = 'aguardando_pagamento' AND p.id IS NULL
        ORDER BY r.criado_em DESC`).all();
}

module.exports = {
    listarRoteiros, buscarRoteiro, validarPedido, criar, detalhar, porCodigo,
    doDia, pendentesDePagamento, semComprovante, vagasRestantes, dataBloqueada
};
