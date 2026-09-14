'use strict';

const RE_CONTROLE = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

function normalizarTelefone(bruto) {
    if (!bruto) return null;
    let so = String(bruto).replace(/\D/g, '');
    if (!so) return null;
    if (so.length <= 11) so = '55' + so;
    if (so.length < 12 || so.length > 13) return null;
    return so;
}

function telefoneParaJid(telefone) {
    return `${normalizarTelefone(telefone)}@s.whatsapp.net`;
}

function jidParaTelefone(jid) {
    if (!jid) return null;
    return String(jid).split('@')[0].split(':')[0];
}

function ehGrupoOuCanal(jid) {
    if (typeof jid !== 'string') return true;
    return jid.endsWith('@g.us') || jid.endsWith('@broadcast') ||
           jid.includes('newsletter') || jid.endsWith('@lid');
}

// Formatacao feita na mao de proposito: o Intl do Node usa espaco nao-separavel
// entre "R$" e o numero, o que gera caractere estranho no WhatsApp e quebra
// qualquer comparacao de texto.
function reais(centavos) {
    const n = Math.round(Number(centavos) || 0);
    const negativo = n < 0;
    const abs = Math.abs(n);
    const inteiros = String(Math.floor(abs / 100));
    const cents = String(abs % 100).padStart(2, '0');
    const comPontos = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${negativo ? '-' : ''}R$ ${comPontos},${cents}`;
}

function dataBr(iso) {
    if (!iso) return '-';
    const [a, m, d] = String(iso).split('-');
    return d && m && a ? `${d}/${m}/${a}` : String(iso);
}

// Data de hoje em Brasilia (UTC-3), no formato YYYY-MM-DD
function hojeIso(deslocamentoDias = 0) {
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    agora.setUTCDate(agora.getUTCDate() + deslocamentoDias);
    return agora.toISOString().split('T')[0];
}

function ehDataIsoValida(s) {
    return typeof s === 'string' &&
           /^\d{4}-\d{2}-\d{2}$/.test(s) &&
           !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
}

function codigoCurto(uuid) {
    return String(uuid).replace(/-/g, '').substring(0, 6).toUpperCase();
}

// Remove caracteres de controle e limita o tamanho
function textoSeguro(s, max = 2000) {
    if (typeof s !== 'string') return '';
    return s.replace(RE_CONTROLE, ' ').replace(/\s+/g, ' ').trim().substring(0, max);
}

// Igual ao acima, mas preserva quebras de linha (para mensagens do WhatsApp)
function textoSeguroMultilinha(s, max = 4000) {
    if (typeof s !== 'string') return '';
    return s.split('\n')
        .map(l => l.replace(RE_CONTROLE, ' ').replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, max);
}

function dormir(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = {
    normalizarTelefone, telefoneParaJid, jidParaTelefone, ehGrupoOuCanal,
    reais, dataBr, hojeIso, ehDataIsoValida, codigoCurto,
    textoSeguro, textoSeguroMultilinha, dormir
};
