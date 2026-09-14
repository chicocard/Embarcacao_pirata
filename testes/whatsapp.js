'use strict';

/**
 * Teste do miolo do WhatsApp, sem conexao real.
 *
 * Simula mensagens chegando (as do cliente e as que o proprio Erick digita)
 * e confere se o robo fala quando deve e se cala quando deve.
 *
 * Uso:  node testes/whatsapp.js
 */

process.env.WHATSAPP_ATIVO = 'false';
process.env.OLLAMA_ATIVO = 'false';

const db = require('../server/db');
const config = require('../server/config');
const roteador = require('../server/whatsapp/router');
const conversas = require('../server/services/conversas');
const { telefoneParaJid } = require('../server/lib/util');

let passou = 0, falhou = 0;
function ok(nome, cond, detalhe) {
    if (cond) { passou++; console.log('  OK    ' + nome); }
    else { falhou++; console.log('  FALHA ' + nome + (detalhe ? '  -> ' + detalhe : '')); }
}

const JID_CAPITAO = telefoneParaJid(config.capitao.whatsapp);
const CLIENTE = telefoneParaJid('73988887777');
const AMIGO = telefoneParaJid('31977776666');
const GRUPO = '120363000000000000@g.us';

function limparFila() { db.prepare('DELETE FROM fila_envio').run(); }

function fila(destino) {
    return db.prepare('SELECT texto, tipo FROM fila_envio WHERE destino_jid = ? ORDER BY id')
             .all(destino);
}

function msg({ jid, texto, deMim = false, id = null, citando = null, nome = null }) {
    const m = { key: { remoteJid: jid, fromMe: deMim, id: id || 'ID' + Math.random().toString(36).slice(2) },
                pushName: nome, message: {} };
    if (citando) {
        m.message.extendedTextMessage = { text: texto, contextInfo: { stanzaId: citando } };
    } else {
        m.message.conversation = texto;
    }
    return m;
}

(async () => {
    console.log('Teste do fluxo de WhatsApp\n');

    // Comeca do zero
    db.prepare('DELETE FROM conversas').run();
    db.prepare('DELETE FROM mensagens').run();
    db.prepare('DELETE FROM relay_map').run();
    limparFila();

    // ---------------------------------------------------------------
    console.log('1. Protecoes de um numero pessoal');

    await roteador.receber(msg({ jid: GRUPO, texto: 'quanto custa o passeio?' }));
    ok('nunca responde em grupo', fila(GRUPO).length === 0);

    await roteador.receber(msg({ jid: AMIGO, texto: 'e ai, vamos jogar bola sabado?' }));
    ok('nao responde a conversa pessoal', fila(AMIGO).length === 0);
    ok('conversa pessoal fica sem classificacao',
       (conversas.buscar(AMIGO) || {}).modo === 'novo');

    // ---------------------------------------------------------------
    console.log('\n2. Cliente falando de negocio');
    limparFila();

    await roteador.receber(msg({ jid: CLIENTE, texto: 'oi, quanto custa o passeio de lancha?',
                                 nome: 'Maria' }));
    const respostas = fila(CLIENTE);
    ok('responde a pergunta de preco', respostas.length >= 1);
    ok('a resposta traz valores reais',
       respostas.some(r => r.texto.includes('R$')), JSON.stringify(respostas[0]));
    ok('conversa entra no modo bot', (conversas.buscar(CLIENTE) || {}).modo === 'bot');
    ok('capitao foi avisado do contato novo',
       fila(JID_CAPITAO).some(m => m.texto.includes('CONTATO NOVO')));

    // ---------------------------------------------------------------
    console.log('\n3. Assunto delicado vai para o capitao');
    limparFila();
    db.prepare("UPDATE conversas SET modo = 'bot', modo_ate = NULL WHERE jid = ?").run(CLIENTE);

    await roteador.receber(msg({ jid: CLIENTE, texto: 'da pra fazer um desconto?' }));
    ok('robo nao negocia desconto sozinho',
       fila(JID_CAPITAO).some(m => m.texto.includes('ATENDIMENTO PRECISA DE VOCE')));
    ok('cliente recebe aviso de que o capitao vem',
       fila(CLIENTE).some(m => m.texto.toLowerCase().includes('capitao')));
    ok('conversa passa para atendimento humano',
       (conversas.buscar(CLIENTE) || {}).modo === 'humano');

    // ---------------------------------------------------------------
    console.log('\n4. Erick digita na conversa do cliente');
    limparFila();
    db.prepare("UPDATE conversas SET modo = 'bot', modo_ate = NULL WHERE jid = ?").run(CLIENTE);

    await roteador.receber(msg({ jid: CLIENTE, deMim: true,
                                 texto: 'Oi Maria, aqui e o Erick. Consigo sim no dia 20.' }));
    ok('robo se cala sozinho quando o Erick escreve',
       (conversas.buscar(CLIENTE) || {}).modo === 'humano');
    ok('Erick recebe o aviso de que assumiu',
       fila(JID_CAPITAO).some(m => m.texto.includes('Voce assumiu a conversa')));

    limparFila();
    await roteador.receber(msg({ jid: CLIENTE, texto: 'que bom! e o que eu levo?' }));
    ok('robo fica quieto enquanto o Erick atende', fila(CLIENTE).length === 0);

    // ---------------------------------------------------------------
    console.log('\n5. Devolvendo o atendimento ao robo');
    limparFila();

    await roteador.receber(msg({ jid: CLIENTE, deMim: true, texto: '#bot' }));
    ok('#bot devolve a conversa', (conversas.buscar(CLIENTE) || {}).modo === 'bot');

    limparFila();
    await roteador.receber(msg({ jid: CLIENTE, texto: 'o que eu levo no passeio?' }));
    ok('robo volta a responder', fila(CLIENTE).length >= 1);

    // ---------------------------------------------------------------
    console.log('\n6. Responder citando o aviso');
    limparFila();

    // simula um aviso ja entregue, vinculado a conversa do cliente
    db.prepare('INSERT OR REPLACE INTO relay_map (wa_message_id, destino_jid, criado_em) VALUES (?,?,?)')
      .run('AVISO123', CLIENTE, Date.now());

    await roteador.receber(msg({ jid: JID_CAPITAO, deMim: true, citando: 'AVISO123',
                                 texto: 'Maria, pode vir as 8h no pier.' }));

    ok('o texto chega ao cliente',
       fila(CLIENTE).some(m => m.texto.includes('pier')));
    ok('robo se cala nessa conversa', (conversas.buscar(CLIENTE) || {}).modo === 'humano');
    ok('Erick recebe o recibo de entrega',
       fila(JID_CAPITAO).some(m => m.texto.includes('Entregue a')));

    // ---------------------------------------------------------------
    console.log('\n7. Comandos do capitao');
    limparFila();

    await roteador.receber(msg({ jid: JID_CAPITAO, deMim: true, texto: '#ajuda' }));
    ok('#ajuda responde', fila(JID_CAPITAO).some(m => m.texto.includes('COMANDOS DO CAPITAO')));

    limparFila();
    await roteador.receber(msg({ jid: JID_CAPITAO, deMim: true, texto: '#hoje' }));
    ok('#hoje responde', fila(JID_CAPITAO).length >= 1);

    limparFila();
    await roteador.receber(msg({ jid: JID_CAPITAO, deMim: true, texto: '#bloquear 25/12 natal' }));
    ok('#bloquear grava a data',
       !!db.prepare('SELECT 1 FROM bloqueios_agenda WHERE data_passeio LIKE ?').get('%-12-25'));

    limparFila();
    await roteador.receber(msg({ jid: JID_CAPITAO, deMim: true, texto: '#liberar 25/12' }));
    ok('#liberar apaga a data',
       !db.prepare('SELECT 1 FROM bloqueios_agenda WHERE data_passeio LIKE ?').get('%-12-25'));

    limparFila();
    await roteador.receber(msg({ jid: CLIENTE, deMim: true, texto: '#calar' }));
    ok('#calar silencia a conversa', (conversas.buscar(CLIENTE) || {}).modo === 'silencio');

    limparFila();
    await roteador.receber(msg({ jid: CLIENTE, texto: 'quanto custa o mergulho?' }));
    ok('robo respeita o silencio', fila(CLIENTE).length === 0);

    // ---------------------------------------------------------------
    console.log('\n8. Nao conversa consigo mesmo');
    limparFila();

    db.prepare(`INSERT INTO fila_envio (destino_jid, texto, tipo, proxima_tentativa_em,
                criado_em, status, wa_message_id) VALUES (?,?,?,?,?,'enviado',?)`)
      .run(CLIENTE, 'mensagem que o bot enviou', 'mensagem_cliente', Date.now(), Date.now(), 'ECO1');

    await roteador.receber(msg({ jid: CLIENTE, deMim: true, id: 'ECO1',
                                 texto: 'mensagem que o bot enviou' }));
    ok('reconhece o proprio eco e ignora',
       (conversas.buscar(CLIENTE) || {}).modo === 'silencio');   // nao virou "humano"

    console.log(`\n=======================================`);
    console.log(`  ${passou} passaram, ${falhou} falharam`);
    console.log(`=======================================`);
    process.exit(falhou ? 1 : 0);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
