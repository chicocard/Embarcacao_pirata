'use strict';

/**
 * Camada fina sobre o SQLite.
 *
 * Usa better-sqlite3 quando ele esta instalado (mais rapido e mais testado).
 * Se ele nao estiver disponivel - por exemplo porque a maquina nao conseguiu
 * compilar o modulo nativo - cai para o SQLite que ja vem dentro do proprio
 * Node (node:sqlite), sem precisar compilar nada.
 *
 * Assim o sistema sobe no Oracle ARM mesmo que a compilacao falhe, em vez de
 * simplesmente nao iniciar.
 *
 * A interface exposta e a do better-sqlite3: prepare/get/all/run, exec,
 * pragma, transaction e close.
 */

const log = require('./log').fazer('SQLite');

function abrirComBetterSqlite3(caminho) {
    const Database = require('better-sqlite3');
    const db = new Database(caminho);
    db.__motor = 'better-sqlite3';
    return db;
}

function abrirComNodeSqlite(caminho) {
    const { DatabaseSync } = require('node:sqlite');
    const bruto = new DatabaseSync(caminho);

    const adaptador = {
        __motor: 'node:sqlite',
        __bruto: bruto,

        prepare(sql) {
            const stmt = bruto.prepare(sql);
            return {
                get: (...p) => stmt.get(...p),
                all: (...p) => stmt.all(...p),
                run: (...p) => {
                    const r = stmt.run(...p);
                    return {
                        changes: Number(r.changes),
                        lastInsertRowid: Number(r.lastInsertRowid)
                    };
                }
            };
        },

        exec(sql) { bruto.exec(sql); },

        pragma(texto) { bruto.exec('PRAGMA ' + texto); },

        /** Mesmo comportamento do better-sqlite3: devolve uma funcao. */
        transaction(fn) {
            return (...args) => {
                bruto.exec('BEGIN');
                try {
                    const r = fn(...args);
                    bruto.exec('COMMIT');
                    return r;
                } catch (e) {
                    try { bruto.exec('ROLLBACK'); } catch { /* ja desfeito */ }
                    throw e;
                }
            };
        },

        close() { bruto.close(); }
    };

    return adaptador;
}

function abrir(caminho) {
    try {
        const db = abrirComBetterSqlite3(caminho);
        log.info('Usando better-sqlite3.');
        return db;
    } catch (e) {
        log.aviso('better-sqlite3 indisponivel (' + e.message.split('\n')[0] + ').');
        log.aviso('Caindo para o SQLite embutido do Node (node:sqlite).');
        return abrirComNodeSqlite(caminho);
    }
}

module.exports = { abrir };
