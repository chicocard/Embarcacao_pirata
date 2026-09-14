'use strict';
require('dotenv').config();

function exigir(nome, alternativas = []) {
    for (const chave of [nome, ...alternativas]) {
        const v = process.env[chave];
        if (v && String(v).trim() !== '') return String(v).trim();
    }
    return null;
}

function bool(valor, padrao = false) {
    if (valor === undefined || valor === null || valor === '') return padrao;
    return ['1', 'true', 'sim', 'yes', 'on'].includes(String(valor).toLowerCase());
}

function inteiro(valor, padrao) {
    const n = parseInt(valor, 10);
    return Number.isFinite(n) ? n : padrao;
}

// Aceita "+55 (73) 99999-9999" e devolve "5573999999999"
function normalizarTelefone(bruto) {
    if (!bruto) return null;
    let so = String(bruto).replace(/\D/g, '');
    if (!so) return null;
    if (so.length <= 11) so = '55' + so;       // sem DDI -> assume Brasil
    return so;
}

const AMBIENTE = process.env.NODE_ENV || 'development';
const PRODUCAO = AMBIENTE === 'production';

const config = {
    ambiente: AMBIENTE,
    producao: PRODUCAO,
    porta: inteiro(process.env.PORT, 3000),
    urlPublica: exigir('URL_PUBLICA') || `http://localhost:${inteiro(process.env.PORT, 3000)}`,

    pix: {
        chave: exigir('PIX_KEY'),
        nome: exigir('PIX_NOME') || 'Embarcacao Pirata',
        cidade: exigir('PIX_CIDADE') || 'CARAVELAS'
    },

    capitao: {
        // aceita o nome antigo ERICK_WHATSAPP para nao quebrar instalacoes existentes
        whatsapp: normalizarTelefone(exigir('CAPITAO_WHATSAPP', ['ERICK_WHATSAPP'])),
        nome: exigir('CAPITAO_NOME') || 'Capitao Erick'
    },

    admin: {
        usuario: exigir('ADMIN_USER') || 'capitao',
        // usada UMA unica vez, para criar o usuario no primeiro login
        senhaInicial: exigir('ADMIN_PASSWORD'),
        jwtSecret: exigir('JWT_SECRET'),
        jwtHoras: inteiro(process.env.JWT_HORAS, 8)
    },

    ollama: {
        url: (exigir('OLLAMA_URL') || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
        modelo: exigir('OLLAMA_MODEL') || 'qwen2.5:3b-instruct-q4_K_M',
        // teto de tokens gerados: segura o tempo de resposta em CPU
        maxTokens: inteiro(process.env.OLLAMA_MAX_TOKENS, 220),
        temperatura: parseFloat(process.env.OLLAMA_TEMPERATURA || '0.4'),
        timeoutMs: inteiro(process.env.OLLAMA_TIMEOUT_MS, 90000),
        ativo: bool(process.env.OLLAMA_ATIVO, true)
    },

    whatsapp: {
        ativo: bool(process.env.WHATSAPP_ATIVO, true),
        // o bot roda no numero PESSOAL do capitao: por padrao so responde sozinho
        // em conversas que comprovadamente sao do negocio
        modoPadrao: exigir('BOT_MODO_PADRAO') || 'palavra_chave', // palavra_chave | sempre | nunca
        minutosHandoff: inteiro(process.env.BOT_MINUTOS_HANDOFF, 720),
        maxRespostasHora: inteiro(process.env.BOT_MAX_RESPOSTAS_HORA, 12),
        numerosBloqueados: (exigir('BOT_NUMEROS_BLOQUEADOS') || '')
            .split(',').map(normalizarTelefone).filter(Boolean)
    },

    upload: {
        maxBytes: inteiro(process.env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024),
        tiposAceitos: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    },

    corsOrigens: (exigir('CORS_ORIGENS') || '').split(',').map(s => s.trim()).filter(Boolean)
};

// ---- Validacoes que falham cedo, em vez de falhar em producao as 2h da manha ----
const erros = [];
if (!config.pix.chave) erros.push('PIX_KEY nao esta definida no .env');
if (!config.capitao.whatsapp) erros.push('CAPITAO_WHATSAPP nao esta definida no .env');
if (!config.admin.jwtSecret || config.admin.jwtSecret.length < 32) {
    erros.push('JWT_SECRET ausente ou curta demais (minimo 32 caracteres). Gere com: openssl rand -hex 32');
}
if (config.admin.jwtSecret && ['secret', 'super_secret_jwt_key', 'changeme'].includes(config.admin.jwtSecret)) {
    erros.push('JWT_SECRET esta com o valor de exemplo. Troque por um valor aleatorio.');
}
if (config.producao && config.admin.senhaInicial && config.admin.senhaInicial.length < 12) {
    erros.push('ADMIN_PASSWORD com menos de 12 caracteres nao serve em producao.');
}

if (erros.length) {
    console.error('');
    console.error('========== CONFIGURACAO INVALIDA ==========');
    erros.forEach(e => console.error('  x ' + e));
    console.error('Corrija o arquivo .env e rode de novo.');
    console.error('==========================================');
    console.error('');
    process.exit(1);
}

module.exports = config;
