'use strict';

/**
 * Atendimento automatico no WhatsApp.
 *
 * Tres camadas, nesta ordem:
 *   1. Respostas diretas (preco, roteiros, disponibilidade) montadas a partir
 *      do BANCO. Sao exatas, instantaneas e nao dependem do LLM.
 *   2. LLM local, com a base de conhecimento no prompt, para o resto.
 *   3. Verificacao da resposta do LLM antes de mandar: se ele inventou um
 *      preco ou prometeu algo que nao pode, a resposta e descartada e a
 *      conversa vai para o capitao.
 *
 * O modelo e pequeno (3B). Nao se confia nele para numero, data nem promessa.
 */

const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Atendimento');
const llm = require('./llm');
const conversas = require('../services/conversas');
const servicoReservas = require('../services/reservas');
const { reais, dataBr, hojeIso } = require('../lib/util');

// ---------------------------------------------------------------------------
// Contexto do negocio, montado do banco
// ---------------------------------------------------------------------------

function textoDosRoteiros() {
    return servicoReservas.listarRoteiros().map(r => {
        const horas = r.duracao_min >= 1440
            ? `${Math.round(r.duracao_min / 1440)} dia(s)`
            : `${Math.round(r.duracao_min / 60)}h`;
        return `- ${r.nome}: ${reais(r.preco_centavos)} por pessoa, duracao ${horas}, ate ${r.capacidade_max} pessoas. ${r.descricao}`;
    }).join('\n');
}

function textoDoConhecimento() {
    return db.prepare('SELECT pergunta, resposta FROM conhecimento WHERE ativo = 1 ORDER BY ordem')
             .all().map(k => `- ${k.pergunta}: ${k.resposta}`).join('\n');
}

function precosPermitidos() {
    const valores = new Set();
    servicoReservas.listarRoteiros().forEach(r => {
        for (let n = 1; n <= (r.capacidade_max || 10); n++) {
            valores.add(r.preco_centavos * n / 100);
        }
    });
    return valores;
}

function montarPromptSistema() {
    return `Voce e o assistente do WhatsApp da Embarcacao Pirata, passeios de barco em Caravelas, sul da Bahia, do ${config.capitao.nome}.

REGRAS QUE VOCE NUNCA QUEBRA:
1. Responda em portugues do Brasil, no maximo 4 linhas curtas. WhatsApp, nao e-mail.
2. Use SOMENTE as informacoes da lista abaixo. Se a resposta nao estiver ali, diga
   que vai chamar o capitao e pare. Nao invente preco, horario, data, distancia
   nem nome de lugar.
3. Nunca prometa desconto, nunca negocie valor, nunca confirme pagamento,
   nunca garanta data. Isso e so o capitao quem faz.
4. Nunca diga que voce e uma inteligencia artificial nem que e um robo, e tambem
   nunca finja ser o proprio capitao. Voce e "o assistente do capitao".
5. Para fechar uma reserva, mande sempre a pessoa para o site: ${config.urlPublica}
6. Tom: simpatico, direto, sem exagero pirata. Sem emoji em excesso, no maximo um.

ROTEIROS E PRECOS (unicos valores que voce pode citar):
${textoDosRoteiros()}

INFORMACOES DA CASA:
${textoDoConhecimento()}

Data de hoje: ${dataBr(hojeIso())}.`;
}

// ---------------------------------------------------------------------------
// Camada 1: respostas exatas, sem LLM
// ---------------------------------------------------------------------------

function contemAlguma(texto, palavras) {
    const t = texto.toLowerCase();
    return palavras.some(p => t.includes(p));
}

function respostaDireta(texto) {
    const t = texto.toLowerCase().trim();

    if (/^(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|eai|opa)[!.? ]*$/.test(t)) {
        return `Ola! Aqui e o assistente do ${config.capitao.nome}, da Embarcacao Pirata, em Caravelas.\nPosso te falar dos roteiros, precos e datas. O que voce quer saber?`;
    }

    if (contemAlguma(t, ['preco', 'preço', 'valor', 'quanto custa', 'quanto fica', 'quanto e', 'tabela'])) {
        const linhas = servicoReservas.listarRoteiros()
            .map(r => `${r.nome}: ${reais(r.preco_centavos)} por pessoa`).join('\n');
        return `Nossos roteiros:\n\n${linhas}\n\nPara reservar: ${config.urlPublica}`;
    }

    if (contemAlguma(t, ['roteiro', 'passeios', 'opcoes', 'opções', 'que passeio', 'quais passeio'])) {
        const linhas = servicoReservas.listarRoteiros()
            .map(r => `${r.nome} - ${r.descricao}`).join('\n\n');
        return `${linhas}\n\nPrecos e reserva em: ${config.urlPublica}`;
    }

    if (contemAlguma(t, ['o que levar', 'que levar', 'o que preciso levar', 'levar o que'])) {
        const kb = db.prepare("SELECT resposta FROM conhecimento WHERE id = 'kb-levar'").get();
        if (kb) return kb.resposta;
    }

    if (contemAlguma(t, ['como reservo', 'como reservar', 'quero reservar', 'fazer reserva', 'como agendo'])) {
        return `E pelo site: ${config.urlPublica}\nVoce escolhe o roteiro e a data, o sistema gera o Pix na hora, voce paga e manda o comprovante ali mesmo. O capitao confirma e te aviso por aqui.`;
    }

    return null;
}

/** Pergunta sobre um dia especifico: responde com a agenda real. */
function respostaDeDisponibilidade(texto) {
    const m = texto.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (!m) return null;
    if (!contemAlguma(texto, ['tem', 'disponi', 'vaga', 'livre', 'dia', 'data', 'consegue', 'pode'])) return null;

    const dia = String(m[1]).padStart(2, '0');
    const mes = String(m[2]).padStart(2, '0');
    let ano = m[3] ? String(m[3]) : String(new Date().getFullYear());
    if (ano.length === 2) ano = '20' + ano;
    const data = `${ano}-${mes}-${dia}`;

    if (Number(mes) > 12 || Number(dia) > 31) return null;
    if (data < hojeIso()) return `Essa data ja passou. Me diga outro dia que eu confiro a agenda.`;

    if (servicoReservas.dataBloqueada(data)) {
        return `Dia ${dataBr(data)} a agenda esta fechada. Me diga outra data que eu confiro.`;
    }

    const linhas = servicoReservas.listarRoteiros().map(r => {
        const vagas = servicoReservas.vagasRestantes(r.id, data);
        return `${r.nome}: ${vagas > 0 ? vagas + ' lugar(es)' : 'lotado'}`;
    });

    return `Agenda de ${dataBr(data)}:\n\n${linhas.join('\n')}\n\nPara garantir: ${config.urlPublica}`;
}

// ---------------------------------------------------------------------------
// Camada 3: verificacao da resposta do LLM
// ---------------------------------------------------------------------------

const FRASES_PROIBIDAS = [
    'sou uma inteligencia artificial', 'sou uma inteligência artificial',
    'sou um assistente virtual', 'como modelo de linguagem', 'sou uma ia',
    'posso te dar um desconto', 'faco um desconto', 'faço um desconto',
    'garanto a data', 'esta confirmado', 'está confirmado', 'pagamento confirmado'
];

function extrairValores(texto) {
    const achados = [];
    const re = /r\$\s*([\d.]+(?:,\d{2})?)/gi;
    let m;
    while ((m = re.exec(texto)) !== null) {
        const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
        if (Number.isFinite(n)) achados.push(n);
    }
    return achados;
}

/** Devolve null se a resposta esta boa, ou o motivo da recusa. */
function verificarResposta(resposta) {
    if (!resposta || resposta.trim().length < 2) return 'resposta vazia do modelo';
    if (resposta.length > 900) return 'resposta longa demais';

    const baixa = resposta.toLowerCase();
    for (const frase of FRASES_PROIBIDAS) {
        if (baixa.includes(frase)) return `o modelo escreveu algo proibido ("${frase}")`;
    }

    const permitidos = precosPermitidos();
    for (const valor of extrairValores(resposta)) {
        if (!permitidos.has(valor)) return `o modelo citou um valor que nao existe na tabela (R$ ${valor})`;
    }

    return null;
}

function limpar(resposta) {
    return String(resposta)
        .replace(/^["']|["']$/g, '')
        .replace(/^(assistente|resposta|bot)\s*:\s*/i, '')
        .trim();
}

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------

/**
 * Gera uma resposta para a mensagem do cliente.
 * Devolve { texto } quando ha resposta, ou { escalar, motivo } quando o
 * capitao precisa entrar.
 */
async function responder(jid, textoCliente) {
    const direta = respostaDireta(textoCliente) || respostaDeDisponibilidade(textoCliente);
    if (direta) {
        log.info('resposta direta (sem LLM)');
        return { texto: direta };
    }

    if (!(await llm.verificar())) {
        return { escalar: true, motivo: 'o assistente automatico esta fora do ar' };
    }

    const historico = conversas.historico(jid, 6).map(m => ({
        role: m.autor === 'cliente' ? 'user' : 'assistant',
        content: m.texto
    }));

    let bruta;
    try {
        bruta = await llm.conversar([
            { role: 'system', content: montarPromptSistema() },
            ...historico,
            { role: 'user', content: textoCliente }
        ]);
    } catch (e) {
        log.aviso('LLM falhou: ' + e.message);
        return { escalar: true, motivo: 'falha tecnica no assistente automatico' };
    }

    const resposta = limpar(bruta);
    const problema = verificarResposta(resposta);
    if (problema) {
        log.aviso(`Resposta recusada: ${problema}. Texto: ${resposta.substring(0, 160)}`);
        return { escalar: true, motivo: problema };
    }

    return { texto: resposta };
}

module.exports = {
    responder, montarPromptSistema, verificarResposta,
    respostaDireta, respostaDeDisponibilidade
};
