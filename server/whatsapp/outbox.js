'use strict';

/**
 * Fila duravel de envio.
 *
 * Nada e enviado direto pelo WhatsApp: tudo entra nesta fila, gravada no
 * SQLite. Um drenador roda a cada poucos segundos e tenta enviar.
 *
 * Motivo: o Baileys cai. A internet do Oracle oscila. O servidor reinicia.
 * Sem fila, um aviso de reserva nova se perde e o Erick nunca fica sabendo.
 * Com fila, o aviso fica gravado e sai assim que a conexao voltar.
 */

const db = require('../db');
const log = require('../lib/log').fazer('Fila');
const { textoSeguroMultilinha } = require('../lib/util');

const INTERVALO_MS = 4000;
const MAX_TENTATIVAS = 8;
const PAUSA_ENTRE_ENVIOS_MS = 1200;   // evita parecer disparo em massa

let enviarFn = null;
let temporizador = null;
let drenando = false;

function registrarEnviador(fn) { enviarFn = fn; }

/**
 * Enfileira uma mensagem.
 * chaveIdem: se informada, garante que a mesma mensagem nao entre duas vezes
 *            (ex.: 'reserva-nova-<id>'). Reinicio do servidor nao duplica aviso.
 */
function enfileirar({ destinoJid, texto, tipo = 'notificacao', chaveIdem = null, responderA = null, origemJid = null }) {
    const limpo = textoSeguroMultilinha(texto, 3500);
    if (!destinoJid || !limpo) return null;

    try {
        const r = db.prepare(`
            INSERT INTO fila_envio
                (destino_jid, texto, tipo, chave_idem, responder_a, origem_jid, proxima_tentativa_em, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(destinoJid, limpo, tipo, chaveIdem, responderA, origemJid, Date.now(), Date.now());
        agendarDrenagem(200);
        return r.lastInsertRowid;
    } catch (e) {
        if (String(e.message).includes('UNIQUE')) {
            log.info(`Mensagem ja enfileirada antes (${chaveIdem}), ignorando duplicata.`);
            return null;
        }
        log.erro('Falha ao enfileirar:', e.message);
        return null;
    }
}

function pendentes(limite = 10) {
    return db.prepare(`SELECT * FROM fila_envio
                       WHERE status = 'pendente' AND proxima_tentativa_em <= ?
                       ORDER BY id LIMIT ?`).all(Date.now(), limite);
}

// Espera crescente: 5s, 15s, 45s, 2min, 7min, 20min, 1h, 3h
function esperaBackoff(tentativa) {
    return Math.min(5000 * Math.pow(3, tentativa), 3 * 3600 * 1000);
}

async function drenar() {
    if (drenando) return;
    drenando = true;
    try {
        if (!enviarFn) return;

        const lote = pendentes();
        for (const item of lote) {
            try {
                const resultado = await enviarFn(item.destino_jid, item.texto, item.responder_a);
                const waId = resultado && resultado.key ? resultado.key.id : null;

                db.prepare(`UPDATE fila_envio
                            SET status = 'enviado', enviado_em = ?, wa_message_id = ?
                            WHERE id = ?`).run(Date.now(), waId, item.id);

                // Guarda o vinculo aviso -> conversa, para o capitao poder
                // responder CITANDO o aviso e o texto chegar no cliente.
                if (waId && item.origem_jid) {
                    db.prepare(`INSERT OR REPLACE INTO relay_map (wa_message_id, destino_jid, criado_em)
                                VALUES (?, ?, ?)`).run(waId, item.origem_jid, Date.now());
                }

                log.info(`Enviado #${item.id} -> ${item.destino_jid}`);
                await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
            } catch (e) {
                const tentativas = item.tentativas + 1;
                const desistir = tentativas >= MAX_TENTATIVAS;
                db.prepare(`UPDATE fila_envio
                            SET tentativas = ?, ultimo_erro = ?, status = ?, proxima_tentativa_em = ?
                            WHERE id = ?`)
                  .run(tentativas, String(e.message).substring(0, 300),
                       desistir ? 'falhou' : 'pendente',
                       Date.now() + esperaBackoff(tentativas), item.id);

                if (desistir) log.erro(`Desisti da mensagem #${item.id}: ${e.message}`);
                else log.aviso(`Falha no envio #${item.id} (tentativa ${tentativas}): ${e.message}`);
                break;   // conexao provavelmente caiu: para o lote e tenta depois
            }
        }
    } finally {
        drenando = false;
    }
}

function agendarDrenagem(atrasoMs = INTERVALO_MS) {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
        await drenar();
        agendarDrenagem();
    }, atrasoMs);
}

function iniciar() {
    const presos = db.prepare(`SELECT COUNT(*) AS n FROM fila_envio WHERE status = 'pendente'`).get().n;
    if (presos > 0) log.info(`${presos} mensagem(ns) pendente(s) da execucao anterior serao enviadas.`);
    agendarDrenagem(1500);
}

function parar() { clearTimeout(temporizador); }

function estatisticas() {
    return db.prepare(`SELECT status, COUNT(*) AS n FROM fila_envio GROUP BY status`).all();
}

module.exports = {
    registrarEnviador, enfileirar, iniciar, parar, drenar, estatisticas
};
