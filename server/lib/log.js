'use strict';

function carimbo() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function fazer(area) {
    return {
        info: (...a) => console.log(`[${carimbo()}] [${area}]`, ...a),
        aviso: (...a) => console.warn(`[${carimbo()}] [${area}] AVISO:`, ...a),
        erro: (...a) => console.error(`[${carimbo()}] [${area}] ERRO:`, ...a)
    };
}

module.exports = { fazer };
