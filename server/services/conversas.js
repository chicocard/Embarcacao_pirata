'use strict';

/**
 * Estado de cada conversa de WhatsApp.
 *
 * Como o bot roda no numero PESSOAL do capitao, o padrao e prudente:
 * ele NAO responde sozinho para qualquer um que mandar mensagem.
 *
 * modo:
 *   novo     -> ainda nao decidido (conversa desconhecida)
 *   bot      -> o robo responde automaticamente
 *   humano   -> o capitao assumiu; o robo fica calado ate modo_ate
 *   silencio -> o robo nunca responde nessa conversa (familia, amigos)
 */

const db = require('../db');
const config = require('../config');
const { jidParaTelefone } = require('../lib/util');

const UMA_HORA = 3600 * 1000;

// Palavras que indicam que a conversa e sobre o negocio
const PALAVRAS_NEGOCIO = [
    'passeio', 'passeios', 'lancha', 'barco', 'embarcacao', 'embarcação', 'pirata',
    'reserva', 'reservar', 'agendar', 'agendamento', 'disponivel', 'disponível',
    'roteiro', 'mergulho', 'mergulhar', 'preco', 'preço', 'valor', 'quanto custa',
    'quanto fica', 'pix', 'pagamento', 'comprovante', 'sair de barco', 'ilha',
    'abrolhos', 'baleia', 'pesca', 'pescaria', 'por do sol', 'pôr do sol',
    'acampamento', 'expedicao', 'expedição', 'capitao erick', 'capitão erick'
];

// Assuntos que o robo NAO deve tratar sozinho: chama o capitao na hora
const GATILHOS_ESCALADA = [
    'desconto', 'abatimento', 'negociar', 'parcelar', 'nota fiscal', 'recibo',
    'cancelar', 'cancelamento', 'reembolso', 'estorno', 'devolver o dinheiro',
    'devolucao', 'devolução', 'reclamacao', 'reclamação', 'processo', 'procon',
    'acidente', 'machuc', 'emergencia', 'emergência', 'socorro',
    'falar com o erick', 'falar com erick', 'falar com o capitao', 'falar com uma pessoa',
    'falar com humano', 'atendente', 'e um robo', 'é um robô', 'e um rob', 'voce e um bot'
];

function agora() { return Date.now(); }

function buscar(jid) {
    return db.prepare('SELECT * FROM conversas WHERE jid = ?').get(jid) || null;
}

function garantir(jid, nomeContato) {
    const existente = buscar(jid);
    if (existente) {
        if (nomeContato && !existente.nome_contato) {
            db.prepare('UPDATE conversas SET nome_contato = ?, atualizado_em = ? WHERE jid = ?')
              .run(nomeContato, agora(), jid);
            existente.nome_contato = nomeContato;
        }
        return existente;
    }

    const telefone = jidParaTelefone(jid);
    const cliente = db.prepare('SELECT id, nome FROM clientes WHERE whatsapp = ?').get(telefone);

    db.prepare(`
        INSERT INTO conversas (jid, telefone, nome_contato, cliente_id, modo, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(jid, telefone, nomeContato || (cliente ? cliente.nome : null),
           cliente ? cliente.id : null,
           cliente ? 'bot' : 'novo',   // quem veio do formulario do site ja entra no bot
           agora(), agora());

    return buscar(jid);
}

function definirModo(jid, modo, minutos = null) {
    const ate = minutos ? agora() + minutos * 60 * 1000 : null;
    db.prepare('UPDATE conversas SET modo = ?, modo_ate = ?, atualizado_em = ? WHERE jid = ?')
      .run(modo, ate, agora(), jid);
}

/** Vincula a conversa a um cliente cadastrado (chamado quando nasce uma reserva). */
function vincularCliente(jid, clienteId, nome) {
    garantir(jid, nome);
    db.prepare(`UPDATE conversas
                SET cliente_id = ?, nome_contato = COALESCE(nome_contato, ?),
                    modo = CASE WHEN modo = 'novo' THEN 'bot' ELSE modo END,
                    atualizado_em = ?
                WHERE jid = ?`).run(clienteId, nome, agora(), jid);
}

/** O capitao digitou algo no chat -> o robo se cala automaticamente. */
function registrarFalaDoCapitao(jid) {
    garantir(jid);
    const ate = agora() + config.whatsapp.minutosHandoff * 60 * 1000;
    db.prepare(`UPDATE conversas
                SET modo = 'humano', modo_ate = ?, ultima_msg_capitao_em = ?, atualizado_em = ?
                WHERE jid = ?`).run(ate, agora(), agora(), jid);
}

function registrarMensagem(jid, autor, texto, waMessageId = null) {
    db.prepare(`INSERT INTO mensagens (jid, autor, texto, wa_message_id, criado_em)
                VALUES (?, ?, ?, ?, ?)`).run(jid, autor, texto, waMessageId, agora());

    const campo = autor === 'cliente' ? 'ultima_msg_cliente_em'
                : autor === 'bot' ? 'ultima_msg_bot_em'
                : autor === 'capitao' ? 'ultima_msg_capitao_em' : null;
    if (campo) {
        db.prepare(`UPDATE conversas SET ${campo} = ?, atualizado_em = ? WHERE jid = ?`)
          .run(agora(), agora(), jid);
    }
}

function historico(jid, limite = 8) {
    return db.prepare(`SELECT autor, texto FROM mensagens
                       WHERE jid = ? AND autor IN ('cliente','bot','capitao')
                       ORDER BY criado_em DESC LIMIT ?`)
             .all(jid, limite).reverse();
}

function contem(texto, lista) {
    const t = String(texto || '').toLowerCase();
    return lista.some(p => t.includes(p));
}

function pareceAssuntoDoNegocio(texto) {
    return contem(texto, PALAVRAS_NEGOCIO);
}

function precisaDeHumano(texto) {
    return contem(texto, GATILHOS_ESCALADA);
}

/** Controle de vazao: no maximo N respostas automaticas por conversa por hora. */
function podeResponderAgora(jid) {
    const c = buscar(jid);
    if (!c) return true;
    const inicioJanela = c.janela_hora || 0;
    if (agora() - inicioJanela > UMA_HORA) {
        db.prepare('UPDATE conversas SET janela_hora = ?, respostas_bot_hora = 0 WHERE jid = ?')
          .run(agora(), jid);
        return true;
    }
    return c.respostas_bot_hora < config.whatsapp.maxRespostasHora;
}

function contarResposta(jid) {
    db.prepare('UPDATE conversas SET respostas_bot_hora = respostas_bot_hora + 1 WHERE jid = ?')
      .run(jid);
}

/**
 * Decide o que fazer com uma mensagem recebida de um cliente.
 * Devolve { acao: 'responder' | 'ignorar' | 'escalar', motivo }
 */
function decidir(jid, texto) {
    const telefone = jidParaTelefone(jid);
    if (config.whatsapp.numerosBloqueados.includes(telefone)) {
        return { acao: 'ignorar', motivo: 'numero na lista de bloqueio' };
    }
    if (config.whatsapp.modoPadrao === 'nunca') {
        return { acao: 'ignorar', motivo: 'bot desligado por configuracao' };
    }

    const c = garantir(jid);

    // Assunto delicado: chama o capitao sempre, qualquer que seja o modo
    if (precisaDeHumano(texto)) return { acao: 'escalar', motivo: 'assunto exige atendimento humano' };

    if (c.modo === 'silencio') return { acao: 'ignorar', motivo: 'conversa em silencio permanente' };

    if (c.modo === 'humano') {
        if (c.modo_ate && agora() > c.modo_ate) {
            definirModo(jid, 'bot');             // expirou: o robo volta
        } else {
            return { acao: 'ignorar', motivo: 'capitao esta atendendo' };
        }
    }

    if (c.modo === 'novo') {
        if (config.whatsapp.modoPadrao === 'sempre' || pareceAssuntoDoNegocio(texto)) {
            definirModo(jid, 'bot');
        } else {
            // Desconhecido falando de outro assunto: nao e cliente. O robo nao se mete.
            return { acao: 'ignorar', motivo: 'conversa nao identificada como do negocio' };
        }
    }

    if (!podeResponderAgora(jid)) {
        return { acao: 'escalar', motivo: 'limite de respostas automaticas atingido' };
    }

    return { acao: 'responder', motivo: 'ok' };
}

function listarAtivas(horas = 48) {
    const desde = agora() - horas * 3600 * 1000;
    return db.prepare(`SELECT * FROM conversas
                       WHERE ultima_msg_cliente_em > ?
                       ORDER BY ultima_msg_cliente_em DESC`).all(desde);
}

module.exports = {
    buscar, garantir, definirModo, vincularCliente, registrarFalaDoCapitao,
    registrarMensagem, historico, decidir, contarResposta, listarAtivas,
    pareceAssuntoDoNegocio, precisaDeHumano,
    PALAVRAS_NEGOCIO, GATILHOS_ESCALADA
};
