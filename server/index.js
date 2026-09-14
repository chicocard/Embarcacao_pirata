'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const log = require('./lib/log').fazer('Servidor');
const db = require('./db');
const { garantirAdministrador } = require('./middleware/auth');

const bot = require('./whatsapp/bot');
const roteador = require('./whatsapp/router');
const outbox = require('./whatsapp/outbox');
const llm = require('./agents/llm');
const rotinas = require('./agents/posvenda');

const app = express();
app.set('trust proxy', 1);          // atras do Caddy/nginx

// ---------------------------------------------------------------------------
// Seguranca
// ---------------------------------------------------------------------------
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// CORS: por padrao so o proprio dominio. Libere outros em CORS_ORIGENS.
app.use(cors({
    origin: config.corsOrigens.length ? config.corsOrigens : false,
    credentials: false
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

const limiteGeral = rateLimit({
    windowMs: 60 * 1000, max: 120,
    standardHeaders: true, legacyHeaders: false,
    message: { erro: 'Muitas requisicoes. Espere um minuto.' }
});
const limiteEscrita = rateLimit({
    windowMs: 10 * 60 * 1000, max: 12,
    standardHeaders: true, legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Espere alguns minutos.' }
});

app.use('/api/', limiteGeral);
app.use('/api/reservas', (req, res, next) => (req.method === 'POST' ? limiteEscrita(req, res, next) : next()));
app.use('/api/pagamentos/upload', limiteEscrita);
app.use('/api/admin/login', limiteEscrita);

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
app.use('/api/reservas', require('./routes/reservas'));
app.use('/api/pagamentos', require('./routes/pagamentos'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/saude', async (req, res) => {
    res.json({
        ok: true,
        versao: require('../package.json').version,
        whatsapp: bot.estaConectado(),
        llm: await llm.verificar(),
        fila: outbox.estatisticas(),
        hora: new Date().toISOString()
    });
});

// Arquivos do site. A pasta public NAO recebe mais upload de ninguem.
app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: config.producao ? '1h' : 0,
    dotfiles: 'ignore'
}));

app.use((req, res) => res.status(404).json({ erro: 'Endereco nao encontrado.' }));

app.use((erro, req, res, next) => {
    log.erro(erro.message);
    res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
});

// ---------------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------------
async function iniciar() {
    garantirAdministrador();

    const servidor = app.listen(config.porta, '0.0.0.0', () => {
        log.info(`Site no ar em ${config.urlPublica}`);
        log.info(`Painel do capitao: ${config.urlPublica}/admin.html`);
    });

    outbox.iniciar();
    rotinas.iniciar();

    // WhatsApp e LLM sobem em paralelo e NAO derrubam o site se falharem.
    bot.registrarReceptor(roteador.receber);
    bot.conectar().catch(e => log.erro('WhatsApp nao subiu: ' + e.message));
    llm.aquecer().catch(() => {});

    const encerrar = (sinal) => {
        log.info(`Recebi ${sinal}, encerrando com calma...`);
        outbox.parar();
        servidor.close(() => {
            try { db.close(); } catch { /* ja fechado */ }
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 8000).unref();
    };
    process.on('SIGTERM', () => encerrar('SIGTERM'));
    process.on('SIGINT', () => encerrar('SIGINT'));

    process.on('unhandledRejection', (motivo) => log.erro('Promessa rejeitada sem tratamento:', motivo));
    process.on('uncaughtException', (e) => log.erro('Excecao nao tratada:', e.message));
}

iniciar();

module.exports = app;
