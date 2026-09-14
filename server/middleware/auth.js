'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Auth');

const CUSTO_BCRYPT = 12;

// Contador simples de tentativas por IP, na memoria do processo.
const tentativas = new Map();
const JANELA_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;

function chaveIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'desconhecido';
}

function registrarFalha(ip) {
    const agora = Date.now();
    const atual = tentativas.get(ip) || { n: 0, desde: agora };
    if (agora - atual.desde > JANELA_MS) { atual.n = 0; atual.desde = agora; }
    atual.n += 1;
    tentativas.set(ip, atual);
}

function bloqueado(ip) {
    const atual = tentativas.get(ip);
    if (!atual) return false;
    if (Date.now() - atual.desde > JANELA_MS) { tentativas.delete(ip); return false; }
    return atual.n >= MAX_TENTATIVAS;
}

function limparFalhas(ip) { tentativas.delete(ip); }

/**
 * Cria o usuario administrador no primeiro uso, a partir do .env.
 * Depois de criado, a senha do .env deixa de ser consultada: quem manda e
 * o hash no banco. Isso permite apagar ADMIN_PASSWORD do .env depois.
 */
function garantirAdministrador() {
    const existe = db.prepare('SELECT 1 FROM admin_usuarios LIMIT 1').get();
    if (existe) return;

    if (!config.admin.senhaInicial) {
        log.aviso('Nenhum administrador cadastrado e ADMIN_PASSWORD nao esta no .env.');
        log.aviso('Defina ADMIN_PASSWORD, suba o sistema uma vez e depois apague a linha.');
        return;
    }

    const hash = bcrypt.hashSync(config.admin.senhaInicial, CUSTO_BCRYPT);
    db.prepare('INSERT INTO admin_usuarios (id, usuario, senha_hash, criado_em) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), config.admin.usuario, hash, Date.now());

    log.info(`Administrador "${config.admin.usuario}" criado.`);
    log.info('Agora voce pode APAGAR a linha ADMIN_PASSWORD do .env.');
}

function autenticar(usuario, senha, ip) {
    if (bloqueado(ip)) {
        return { ok: false, erro: 'Muitas tentativas. Espere 15 minutos.', status: 429 };
    }

    const linha = db.prepare('SELECT * FROM admin_usuarios WHERE usuario = ?').get(String(usuario || ''));

    // Compara sempre, mesmo sem usuario, para nao revelar pelo tempo de resposta
    // se o nome existe ou nao.
    const hashFalso = '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const confere = bcrypt.compareSync(String(senha || ''), linha ? linha.senha_hash : hashFalso);

    if (!linha || !confere) {
        registrarFalha(ip);
        log.aviso(`Login negado para "${usuario}" de ${ip}`);
        return { ok: false, erro: 'Usuario ou senha invalidos.', status: 401 };
    }

    limparFalhas(ip);
    const token = jwt.sign({ sub: linha.id, usuario: linha.usuario }, config.admin.jwtSecret, {
        expiresIn: `${config.admin.jwtHoras}h`,
        issuer: 'embarcacao-pirata'
    });
    return { ok: true, token, usuario: linha.usuario };
}

/** Middleware: exige um token valido no cabecalho Authorization. */
function exigirLogin(req, res, next) {
    const cabecalho = req.headers.authorization || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
    if (!token) return res.status(401).json({ erro: 'Faca login para continuar.' });

    try {
        req.admin = jwt.verify(token, config.admin.jwtSecret, { issuer: 'embarcacao-pirata' });
        next();
    } catch {
        res.status(401).json({ erro: 'Sessao expirada. Faca login de novo.' });
    }
}

function trocarSenha(usuarioId, senhaAtual, senhaNova) {
    const linha = db.prepare('SELECT * FROM admin_usuarios WHERE id = ?').get(usuarioId);
    if (!linha) return { ok: false, erro: 'Usuario nao encontrado.' };
    if (!bcrypt.compareSync(String(senhaAtual || ''), linha.senha_hash)) {
        return { ok: false, erro: 'Senha atual incorreta.' };
    }
    if (String(senhaNova || '').length < 12) {
        return { ok: false, erro: 'A senha nova precisa ter pelo menos 12 caracteres.' };
    }
    db.prepare('UPDATE admin_usuarios SET senha_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(senhaNova, CUSTO_BCRYPT), usuarioId);
    return { ok: true };
}

module.exports = { garantirAdministrador, autenticar, exigirLogin, trocarSenha, chaveIp };
