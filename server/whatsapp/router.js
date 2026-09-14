'use strict';

/**
 * Roteador de mensagens do WhatsApp.
 *
 * Este arquivo decide QUEM falou e O QUE fazer. Nada mais.
 *
 * Atencao a um detalhe que costuma dar dor de cabeca: como o bot esta ligado
 * ao numero PESSOAL do capitao, toda mensagem que o proprio bot envia volta
 * aqui marcada como "fromMe". Se nao filtrarmos, o bot conversa consigo mesmo
 * em laco infinito. O filtro e o id da mensagem: tudo que saiu pela nossa fila
 * fica registrado, entao reconhecemos o que e nosso.
 */

const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Roteador');
const outbox = require('./outbox');
const capitao = require('./capitao');
const conversas = require('../services/conversas');
const atendimento = require('../agents/atendimento');
const notificador = require('../agents/notificador');
const { ehGrupoOuCanal, telefoneParaJid, textoSeguroMultilinha, jidParaTelefone } = require('../lib/util');

const JID_CAPITAO = telefoneParaJid(config.capitao.whatsapp);

/** Extrai o texto de qualquer um dos formatos de mensagem do WhatsApp. */
function extrairTexto(msg) {
    const m = msg.message;
    if (!m) return null;
    return m.conversation
        || (m.extendedTextMessage && m.extendedTextMessage.text)
        || (m.imageMessage && m.imageMessage.caption)
        || (m.videoMessage && m.videoMessage.caption)
        || (m.documentMessage && m.documentMessage.caption)
        || (m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText)
        || (m.listResponseMessage && m.listResponseMessage.title)
        || null;
}

/** Id da mensagem que esta sendo citada (resposta), se houver. */
function extrairCitacao(msg) {
    const m = msg.message;
    if (!m) return null;
    const ctx = (m.extendedTextMessage && m.extendedTextMessage.contextInfo)
             || (m.imageMessage && m.imageMessage.contextInfo)
             || null;
    return ctx && ctx.stanzaId ? ctx.stanzaId : null;
}

/** A mensagem saiu da nossa propria fila? */
function foiOProprioBot(idMensagem) {
    if (!idMensagem) return false;
    return !!db.prepare('SELECT 1 FROM fila_envio WHERE wa_message_id = ?').get(idMensagem);
}

function temMidia(msg) {
    const m = msg.message || {};
    return !!(m.imageMessage || m.videoMessage || m.documentMessage || m.audioMessage);
}

// ---------------------------------------------------------------------------

async function tratarMensagemDoCapitao(jid, texto, idCitado) {
    // 1. Respondeu citando um aviso? Repassa ao cliente daquele aviso.
    if (idCitado && capitao.repassarSeForResposta(idCitado, texto)) return;

    // 2. E um comando?
    const resposta = await capitao.tratarComando(jid, texto);
    if (resposta) {
        outbox.enfileirar({ destinoJid: jid, texto: resposta, tipo: 'resposta_capitao' });
        return;
    }

    // 3. Texto normal na conversa de um cliente: o capitao assumiu.
    if (jid !== JID_CAPITAO) {
        const antes = conversas.buscar(jid);
        conversas.registrarMensagem(jid, 'capitao', texto);
        conversas.registrarFalaDoCapitao(jid);

        if (!antes || antes.modo !== 'humano') {
            const horas = Math.round(config.whatsapp.minutosHandoff / 60);
            outbox.enfileirar({
                destinoJid: JID_CAPITAO,
                texto: `Voce assumiu a conversa com ${jidParaTelefone(jid)}. ` +
                       `O robo fica calado por ${horas}h ali. Mande #bot naquela conversa para devolver.`,
                tipo: 'aviso_capitao'
            });
            log.info(`Capitao assumiu a conversa ${jid}`);
        }
    }
}

async function tratarMensagemDeCliente(jid, texto, nomeContato) {
    conversas.garantir(jid, nomeContato);
    conversas.registrarMensagem(jid, 'cliente', texto);

    const decisao = conversas.decidir(jid, texto);

    if (decisao.acao === 'ignorar') {
        log.info(`Ignorando ${jid}: ${decisao.motivo}`);
        return;
    }

    if (decisao.acao === 'escalar') {
        notificador.escalarParaCapitao({
            jid, nomeContato, texto,
            motivo: decisao.motivo,
            historico: conversas.historico(jid, 6)
        });
        outbox.enfileirar({
            destinoJid: jid,
            texto: 'Vou chamar o capitao para falar com voce. Ele responde por aqui mesmo, assim que puder.',
            tipo: 'mensagem_cliente'
        });
        conversas.definirModo(jid, 'humano', config.whatsapp.minutosHandoff);
        return;
    }

    // Primeira vez que esse contato escreve: avisa o capitao, mas o robo atende.
    const conversa = conversas.buscar(jid);
    const ehPrimeira = conversa && !conversa.ultima_msg_bot_em;
    if (ehPrimeira) notificador.clienteNovoEscreveu({ jid, nomeContato, texto });

    const resultado = await atendimento.responder(jid, texto);

    if (resultado.escalar) {
        notificador.escalarParaCapitao({
            jid, nomeContato, texto,
            motivo: resultado.motivo,
            historico: conversas.historico(jid, 6)
        });
        outbox.enfileirar({
            destinoJid: jid,
            texto: 'Essa eu prefiro que o proprio capitao responda. Ja avisei ele, aguarde um instante.',
            tipo: 'mensagem_cliente'
        });
        conversas.definirModo(jid, 'humano', 120);
        return;
    }

    outbox.enfileirar({ destinoJid: jid, texto: resultado.texto, tipo: 'mensagem_cliente' });
    conversas.registrarMensagem(jid, 'bot', resultado.texto);
    conversas.contarResposta(jid);
}

// ---------------------------------------------------------------------------

async function receber(msg) {
    const jid = msg.key && msg.key.remoteJid;
    if (!jid || ehGrupoOuCanal(jid)) return;          // nunca responde em grupo
    if (msg.key.id && foiOProprioBot(msg.key.id)) return;   // eco do proprio bot

    const bruto = extrairTexto(msg);

    // Midia sem legenda vinda de cliente: avisa o capitao, nao tenta interpretar
    if (!bruto) {
        if (!msg.key.fromMe && temMidia(msg)) {
            const c = conversas.buscar(jid);
            if (c && (c.modo === 'bot' || c.modo === 'humano')) {
                notificador.avisarCapitao(
                    `${jidParaTelefone(jid)} mandou uma foto/audio/arquivo no WhatsApp.\n` +
                    `https://wa.me/${jidParaTelefone(jid)}`,
                    { chaveIdem: `midia-${msg.key.id}`, origemJid: jid }
                );
            }
        }
        return;
    }

    const texto = textoSeguroMultilinha(bruto, 1500);
    if (!texto) return;

    const idCitado = extrairCitacao(msg);

    if (msg.key.fromMe) {
        await tratarMensagemDoCapitao(jid, texto, idCitado);
    } else {
        await tratarMensagemDeCliente(jid, texto, msg.pushName || null);
    }
}

module.exports = { receber, JID_CAPITAO, extrairTexto, extrairCitacao };
