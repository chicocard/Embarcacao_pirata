'use strict';

/**
 * Gerador de Pix Copia e Cola (BR Code / EMV-QRCPS-MPM do Banco Central).
 *
 * Feito aqui, sem biblioteca de terceiros, de proposito: e um formato simples,
 * publico e estavel, e isso tira do caminho de um pagamento uma dependencia
 * externa que pode sumir do npm ou mudar de comportamento numa atualizacao.
 *
 * Especificacao: Manual do BR Code, Banco Central do Brasil.
 */

// Remove acentos e qualquer coisa fora do ASCII imprimivel
function ascii(texto, max) {
    const semAcento = String(texto || '')
        .normalize('NFD')
        .replace(new RegExp('[\u0300-\u036f]', 'g'), '')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    return max ? semAcento.substring(0, max) : semAcento;
}

/** Monta um campo EMV: id + tamanho com 2 digitos + valor */
function campo(id, valor) {
    const v = String(valor);
    return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

/** CRC16-CCITT (polinomio 0x1021, valor inicial 0xFFFF) */
function crc16(texto) {
    let crc = 0xFFFF;
    for (let i = 0; i < texto.length; i++) {
        crc ^= texto.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera o texto do Pix Copia e Cola.
 * @param {string} chave      chave Pix (CPF/CNPJ, telefone, e-mail ou aleatoria)
 * @param {string} nome       nome do recebedor (ate 25 caracteres)
 * @param {string} cidade     cidade do recebedor (ate 15 caracteres)
 * @param {number} valor      valor em reais (ex.: 150.00). 0 ou null = valor livre
 * @param {string} txid       identificador (ate 25 caracteres alfanumericos)
 */
function gerarPayload({ chave, nome, cidade, valor, txid }) {
    if (!chave) throw new Error('Chave Pix nao informada');

    const idTransacao = ascii(txid || '***').replace(/[^A-Z0-9]/g, '').substring(0, 25) || '***';

    const contaComerciante =
        campo('00', 'BR.GOV.BCB.PIX') +
        campo('01', String(chave).trim());

    const dadosAdicionais = campo('05', idTransacao);

    let payload =
        campo('00', '01') +                                   // versao do formato
        campo('01', '12') +                                   // uso unico
        campo('26', contaComerciante) +                       // conta do recebedor
        campo('52', '0000') +                                 // categoria do comerciante
        campo('53', '986');                                   // moeda: real

    if (valor && Number(valor) > 0) {
        payload += campo('54', Number(valor).toFixed(2));
    }

    payload +=
        campo('58', 'BR') +
        campo('59', ascii(nome, 25) || 'RECEBEDOR') +
        campo('60', ascii(cidade, 15) || 'BRASIL') +
        campo('62', dadosAdicionais);

    payload += '6304';                                        // campo do CRC
    return payload + crc16(payload);
}

/** Gera o mesmo payload e tambem a imagem do QR Code (data URL). */
async function gerar(opcoes) {
    const payload = gerarPayload(opcoes);
    let imagem = null;
    try {
        const QRCode = require('qrcode');
        imagem = await QRCode.toDataURL(payload, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320,
            color: { dark: '#1b1b1b', light: '#ffffff' }
        });
    } catch (e) {
        // sem a biblioteca, o cliente ainda tem o copia e cola
        imagem = null;
    }
    return { payload, imagem };
}

module.exports = { gerar, gerarPayload, crc16, ascii };
