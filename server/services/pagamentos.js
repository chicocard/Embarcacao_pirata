'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const servicoReservas = require('./reservas');

/**
 * Registra o comprovante enviado pelo cliente.
 * O VALOR VEM DA RESERVA, nao do formulario: o navegador do cliente nao
 * decide quanto ele pagou.
 */
function registrarComprovante(codigoOuId, arquivo, mime) {
    // Aceita tanto o id completo quanto o codigo curto de 6 caracteres,
    // que e o que o cliente ve na tela e digita de volta.
    const reserva = servicoReservas.porCodigo(codigoOuId);
    if (!reserva) return { ok: false, erro: 'Reserva nao encontrada. Confira o codigo.' };
    if (reserva.status === 'cancelada') return { ok: false, erro: 'Essa reserva foi cancelada.' };

    const jaTem = db.prepare(
        `SELECT id FROM pagamentos WHERE reserva_id = ? AND status IN ('aguardando_confirmacao','confirmado_manual')`
    ).get(reserva.id);
    if (jaTem) return { ok: false, erro: 'Ja recebemos um comprovante para essa reserva.' };

    const pagamentoId = crypto.randomUUID();
    db.prepare(`
        INSERT INTO pagamentos
            (id, reserva_id, metodo, chave_pix_usada, valor_centavos,
             comprovante_arquivo, comprovante_mime, status, criado_em)
        VALUES (?, ?, 'pix', ?, ?, ?, ?, 'aguardando_confirmacao', ?)
    `).run(pagamentoId, reserva.id, config.pix.chave, reserva.valor_centavos,
           arquivo, mime, Date.now());

    const pagamento = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pagamentoId);
    return { ok: true, pagamento, reserva };
}

function aprovar(reservaId, porQuem) {
    const reserva = servicoReservas.detalhar(reservaId);
    if (!reserva) return { ok: false, erro: 'Reserva nao encontrada.' };
    if (reserva.status === 'confirmada') return { ok: false, erro: 'Essa reserva ja estava confirmada.' };

    db.transaction(() => {
        db.prepare(`UPDATE pagamentos SET status = 'confirmado_manual', confirmado_por = ?
                    WHERE reserva_id = ? AND status = 'aguardando_confirmacao'`).run(porQuem, reservaId);
        db.prepare(`UPDATE reservas SET status = 'confirmada' WHERE id = ?`).run(reservaId);
        db.prepare(`INSERT INTO logs_acesso (cliente_id, acao, detalhes_json, criado_em)
                    VALUES (?, 'pagamento_aprovado', ?, ?)`)
          .run(reserva.cliente_id, JSON.stringify({ reservaId, porQuem }), Date.now());
    })();

    return { ok: true, reserva: servicoReservas.detalhar(reservaId) };
}

function recusar(reservaId, porQuem, motivo) {
    const reserva = servicoReservas.detalhar(reservaId);
    if (!reserva) return { ok: false, erro: 'Reserva nao encontrada.' };

    db.transaction(() => {
        db.prepare(`UPDATE pagamentos SET status = 'recusado', confirmado_por = ?
                    WHERE reserva_id = ? AND status = 'aguardando_confirmacao'`).run(porQuem, reservaId);
        db.prepare(`UPDATE reservas SET status = 'cancelada' WHERE id = ?`).run(reservaId);
        db.prepare(`INSERT INTO logs_acesso (cliente_id, acao, detalhes_json, criado_em)
                    VALUES (?, 'pagamento_recusado', ?, ?)`)
          .run(reserva.cliente_id, JSON.stringify({ reservaId, porQuem, motivo }), Date.now());
    })();

    return { ok: true, reserva: servicoReservas.detalhar(reservaId) };
}

function porArquivo(nomeArquivo) {
    return db.prepare('SELECT * FROM pagamentos WHERE comprovante_arquivo = ?').get(nomeArquivo) || null;
}

module.exports = { registrarComprovante, aprovar, recusar, porArquivo };
