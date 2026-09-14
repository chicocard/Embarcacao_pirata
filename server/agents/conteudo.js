'use strict';

/**
 * Gerador de legenda para as redes sociais.
 *
 * O capitao manda no proprio WhatsApp:  post: baleia jubarte pulando hoje
 * e recebe de volta a legenda pronta para copiar e colar.
 *
 * (O arquivo anterior nao compilava: as crases estavam escapadas com barra
 *  invertida, o que e erro de sintaxe em JavaScript. Alem disso ele nunca era
 *  importado em lugar nenhum, entao o recurso nao existia de fato.)
 */

const config = require('../config');
const log = require('../lib/log').fazer('Conteudo');
const llm = require('./llm');

const SISTEMA = `Voce escreve legendas de Instagram para a Embarcacao Pirata, passeios de barco em Caravelas, sul da Bahia, do ${config.capitao.nome}.

Regras:
- Portugues do Brasil, no maximo 4 linhas.
- Tom de diario de bordo: humano, concreto, sem clichê de turismo e sem exagero.
- Nada de promessa de preco ou de data.
- Termine com 4 a 6 hashtags relevantes, em uma linha so.
- Devolva SO a legenda, sem aspas e sem comentario seu.`;

async function gerarLegenda(descricao) {
    return llm.perguntar(
        SISTEMA,
        `Escreva a legenda para esta foto ou video: "${descricao}"`,
        { temperatura: 0.8, maxTokens: 200 }
    );
}

/**
 * Trata a mensagem do capitao se ela comecar com "post:".
 * Devolve o texto da resposta, ou null se nao for esse comando.
 */
async function tratar(mensagem) {
    const m = String(mensagem || '').match(/^\s*post\s*:\s*(.+)$/is);
    if (!m) return null;

    const descricao = m[1].trim();
    if (descricao.length < 3) {
        return 'Me diga sobre o que e o post. Exemplo:\npost: baleia jubarte pulando perto do barco';
    }

    if (!(await llm.verificar())) {
        return 'O assistente de texto (Ollama) esta fora do ar agora. Nao consegui gerar a legenda.';
    }

    try {
        const legenda = await gerarLegenda(descricao);
        return `SUGESTAO DE LEGENDA\n\n${legenda.replace(/^["']|["']$/g, '').trim()}`;
    } catch (e) {
        log.erro('Falha ao gerar legenda: ' + e.message);
        return 'Deu problema no maquinario ao gerar a legenda. Tente de novo daqui a pouco.';
    }
}

module.exports = { tratar, gerarLegenda };
