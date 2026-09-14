'use strict';

/**
 * Troca a senha do painel pela linha de comando, sem precisar da senha antiga.
 * Serve para quando o Erick esquecer a senha.
 *
 * Uso:  node ferramentas/trocar-senha.js erick "a nova senha bem comprida"
 *   ou: docker compose exec app node ferramentas/trocar-senha.js erick "senha nova"
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../server/db');

const usuario = process.argv[2];
const senha = process.argv[3];

if (!usuario || !senha) {
    console.error('Uso: node ferramentas/trocar-senha.js <usuario> "<senha nova>"');
    process.exit(1);
}
if (senha.length < 12) {
    console.error('A senha precisa ter pelo menos 12 caracteres.');
    process.exit(1);
}

const hash = bcrypt.hashSync(senha, 12);
const existente = db.prepare('SELECT id FROM admin_usuarios WHERE usuario = ?').get(usuario);

if (existente) {
    db.prepare('UPDATE admin_usuarios SET senha_hash = ? WHERE id = ?').run(hash, existente.id);
    console.log(`Senha do usuario "${usuario}" trocada.`);
} else {
    db.prepare('INSERT INTO admin_usuarios (id, usuario, senha_hash, criado_em) VALUES (?,?,?,?)')
      .run(crypto.randomUUID(), usuario, hash, Date.now());
    console.log(`Usuario "${usuario}" criado.`);
}
