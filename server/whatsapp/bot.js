'use strict';

/**
 * Conexao com o WhatsApp via Baileys.
 *
 * Responsabilidades (so estas):
 *  - abrir e manter a conexao, com reconexao e espera crescente
 *  - mostrar o QR Code no terminal
 *  - entregar as mensagens recebidas ao roteador
 *  - expor um enviador para a fila
 *
 * A logica de o que responder NAO mora aqui.
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');
const log = require('../lib/log').fazer('WhatsApp');
const outbox = require('./outbox');

let sock = null;
let conectado = false;
let tentativasReconexao = 0;
let aoReceber = null;

const PASTA_AUTH = process.env.WA_AUTH_DIR || path.join(__dirname, 'auth_info_baileys');

function registrarReceptor(fn) { aoReceber = fn; }
function estaConectado() { return conectado; }
function getSocket() { return sock; }

async function enviarTexto(jid, texto, responderA = null) {
    if (!sock || !conectado) throw new Error('WhatsApp desconectado');
    const opcoes = {};
    if (responderA) {
        // responde citando uma mensagem especifica
        opcoes.quoted = { key: { remoteJid: jid, id: responderA, fromMe: false }, message: {} };
    }
    return sock.sendMessage(jid, { text: texto }, opcoes);
}

async function conectar() {
    if (!config.whatsapp.ativo) {
        log.aviso('WHATSAPP_ATIVO=false: rodando sem WhatsApp (util para testar o site).');
        return null;
    }

    const baileys = require('@whiskeysockets/baileys');
    const makeWASocket = baileys.makeWASocket || baileys.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
    const pino = require('pino');
    const qrcode = require('qrcode-terminal');

    if (!fs.existsSync(PASTA_AUTH)) fs.mkdirSync(PASTA_AUTH, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(PASTA_AUTH);

    let version;
    try {
        ({ version } = await fetchLatestBaileysVersion());
    } catch {
        version = undefined;   // segue com a versao embutida na biblioteca
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Embarcacao Pirata', 'Chrome', '2.0.0'],
        markOnlineOnConnect: false,       // nao rouba as notificacoes do celular do Erick
        syncFullHistory: false,
        generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            log.info('Leia este QR Code no WhatsApp do celular (Aparelhos conectados):');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            conectado = true;
            tentativasReconexao = 0;
            log.info('Conectado ao WhatsApp.');
            outbox.drenar();
        }

        if (connection === 'close') {
            conectado = false;
            const codigo = lastDisconnect && lastDisconnect.error &&
                           lastDisconnect.error.output && lastDisconnect.error.output.statusCode;

            if (codigo === DisconnectReason.loggedOut) {
                log.erro('Sessao encerrada no celular. Apague a pasta ' + PASTA_AUTH +
                         ' e leia o QR Code de novo.');
                return;
            }

            tentativasReconexao += 1;
            const espera = Math.min(3000 * Math.pow(2, tentativasReconexao - 1), 5 * 60 * 1000);
            log.aviso(`Conexao caiu (codigo ${codigo}). Reconectando em ${Math.round(espera / 1000)}s.`);
            setTimeout(() => conectar().catch(e => log.erro('Reconexao falhou:', e.message)), espera);
        }
    });

    sock.ev.on('messages.upsert', async (evento) => {
        if (evento.type !== 'notify') return;          // ignora sincronizacao de historico
        for (const msg of evento.messages) {
            try {
                if (aoReceber) await aoReceber(msg, sock);
            } catch (e) {
                log.erro('Falha ao processar mensagem:', e.message);
            }
        }
    });

    outbox.registrarEnviador(enviarTexto);
    return sock;
}

module.exports = { conectar, getSocket, estaConectado, enviarTexto, registrarReceptor, PASTA_AUTH };
