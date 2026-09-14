'use strict';

/**
 * Cliente do Ollama (LLM local).
 *
 * Detalhes que importam para rodar em CPU no Oracle ARM:
 *  - keep_alive: mantem o modelo na memoria entre as perguntas. Sem isso o
 *    Ollama descarrega o modelo depois de 5 minutos e a primeira resposta
 *    seguinte demora 20-40 segundos so para recarregar.
 *  - num_predict: teto de tokens gerados. Resposta curta = resposta rapida.
 *  - num_ctx: janela pequena. Contexto grande custa caro em CPU.
 *  - timeout com AbortController: sem isso uma requisicao travada segura o
 *    processo para sempre.
 */

const config = require('../config');
const log = require('../lib/log').fazer('LLM');

const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m';
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '2048', 10);

let disponivel = null;
let ultimaChecagem = 0;

async function requisitar(caminho, corpo, timeoutMs) {
    const controlador = new AbortController();
    const t = setTimeout(() => controlador.abort(), timeoutMs || config.ollama.timeoutMs);
    try {
        const resposta = await fetch(config.ollama.url + caminho, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
            signal: controlador.signal
        });
        if (!resposta.ok) {
            const detalhe = await resposta.text().catch(() => '');
            throw new Error(`Ollama respondeu ${resposta.status}: ${detalhe.substring(0, 200)}`);
        }
        return await resposta.json();
    } finally {
        clearTimeout(t);
    }
}

/** Conversa com historico. mensagens = [{role, content}] */
async function conversar(mensagens, opcoes = {}) {
    if (!config.ollama.ativo) throw new Error('LLM desligado por configuracao');

    const inicio = Date.now();
    const json = await requisitar('/api/chat', {
        model: opcoes.modelo || config.ollama.modelo,
        messages: mensagens,
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: {
            temperature: opcoes.temperatura !== undefined ? opcoes.temperatura : config.ollama.temperatura,
            num_predict: opcoes.maxTokens || config.ollama.maxTokens,
            num_ctx: NUM_CTX,
            top_p: 0.9,
            repeat_penalty: 1.1,
            stop: ['\nCliente:', '\nCapitao:', '<|im_end|>']
        }
    }, opcoes.timeoutMs);

    const texto = json && json.message ? String(json.message.content || '').trim() : '';
    log.info(`resposta em ${((Date.now() - inicio) / 1000).toFixed(1)}s, ${texto.length} caracteres`);
    return texto;
}

/** Pergunta simples, sem historico. */
async function perguntar(sistema, usuario, opcoes = {}) {
    return conversar([
        { role: 'system', content: sistema },
        { role: 'user', content: usuario }
    ], opcoes);
}

/** O Ollama esta no ar e o modelo esta baixado? Resultado fica em cache por 60s. */
async function verificar(forcar = false) {
    if (!forcar && disponivel !== null && Date.now() - ultimaChecagem < 60000) return disponivel;
    ultimaChecagem = Date.now();

    if (!config.ollama.ativo) { disponivel = false; return false; }

    try {
        const controlador = new AbortController();
        const t = setTimeout(() => controlador.abort(), 5000);
        const r = await fetch(config.ollama.url + '/api/tags', { signal: controlador.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error('status ' + r.status);

        const dados = await r.json();
        const modelos = (dados.models || []).map(m => m.name);
        const alvo = config.ollama.modelo;
        const temOModelo = modelos.some(m => m === alvo || m.split(':')[0] === alvo.split(':')[0]);

        if (!temOModelo) {
            log.aviso(`O modelo "${alvo}" nao esta baixado. Rode: ollama pull ${alvo}`);
            log.aviso('Modelos disponiveis: ' + (modelos.join(', ') || 'nenhum'));
            disponivel = false;
        } else {
            disponivel = true;
        }
    } catch (e) {
        log.aviso(`Ollama inacessivel em ${config.ollama.url}: ${e.message}`);
        disponivel = false;
    }
    return disponivel;
}

/**
 * Carrega o modelo na memoria ao subir o servidor, para o primeiro cliente
 * do dia nao pagar o custo do carregamento.
 */
async function aquecer() {
    if (!(await verificar())) return false;
    try {
        log.info(`Aquecendo o modelo ${config.ollama.modelo}...`);
        const inicio = Date.now();
        await conversar([{ role: 'user', content: 'oi' }], { maxTokens: 8, timeoutMs: 180000 });
        log.info(`Modelo pronto em ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
        return true;
    } catch (e) {
        log.aviso('Nao consegui aquecer o modelo: ' + e.message);
        return false;
    }
}

module.exports = { conversar, perguntar, verificar, aquecer };
