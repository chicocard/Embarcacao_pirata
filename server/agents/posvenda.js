'use strict';

/**
 * Tarefas de horario fixo.
 *
 *  - Lembrete na vespera do passeio (cliente).
 *  - Resumo do dia para o capitao, de manha.
 *  - Pedido de depoimento dois dias depois do passeio.
 *  - Cobranca de reserva que ficou sem comprovante.
 *
 * (No arquivo anterior os textos usavam \${variavel} com barra invertida.
 *  O cliente receberia literalmente "Ahoy, ${passeio.nome}".)
 */

const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Rotinas');
const notificador = require('./notificador');
const servicoReservas = require('../services/reservas');
const { hojeIso, dataBr, reais, codigoCurto } = require('../lib/util');

const FUSO = { timezone: 'America/Bahia' };

// ---------------------------------------------------------------------------

function lembreteDaVespera() {
    const amanha = hojeIso(1);
    const lista = db.prepare(`
        SELECT r.id, r.num_pessoas, r.data_passeio, c.nome, c.whatsapp, t.nome AS roteiro
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        WHERE r.data_passeio = ? AND r.status = 'confirmada'`).all(amanha);

    for (const p of lista) {
        notificador.avisarCliente(p.whatsapp,
`Ola, ${p.nome}! Amanha e o dia do nosso passeio.

Roteiro: ${p.roteiro}
Data: ${dataBr(p.data_passeio)}
Pessoas: ${p.num_pessoas}

Leve protetor solar, chapeu, roupa de banho, uma muda de roupa seca e toalha.
Se voce costuma enjoar, tome o remedio antes de embarcar.

Qualquer duvida e so responder aqui.
${config.capitao.nome}`,
            `lembrete-${p.id}`);
    }
    if (lista.length) log.info(`${lista.length} lembrete(s) de vespera enfileirado(s).`);
}

function resumoDoDiaParaCapitao() {
    const hoje = hojeIso();
    const doDia = servicoReservas.doDia(hoje);
    const semPagar = servicoReservas.semComprovante();
    const aConferir = servicoReservas.pendentesDePagamento();

    let texto = `BOM DIA, CAPITAO. ${dataBr(hoje)}\n\n`;

    if (doDia.length === 0) {
        texto += 'Nenhum passeio marcado para hoje.\n';
    } else {
        const pessoas = doDia.reduce((s, r) => s + r.num_pessoas, 0);
        texto += `PASSEIOS DE HOJE (${pessoas} pessoa(s)):\n`;
        doDia.forEach(r => {
            texto += `- ${r.roteiro_nome}: ${r.cliente_nome}, ${r.num_pessoas} pessoa(s)` +
                     `${r.status !== 'confirmada' ? '  [NAO PAGO]' : ''}\n`;
        });
    }

    if (aConferir.length) texto += `\n${aConferir.length} comprovante(s) esperando sua conferencia.\n`;
    if (semPagar.length) texto += `${semPagar.length} reserva(s) sem comprovante.\n`;

    texto += `\nPainel: ${config.urlPublica}/admin.html`;

    notificador.avisarCapitao(texto, { chaveIdem: `resumo-${hoje}` });
}

function pedirDepoimento() {
    const doisDiasAtras = hojeIso(-2);
    const lista = db.prepare(`
        SELECT r.id, c.nome, c.whatsapp
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        WHERE r.data_passeio = ? AND r.status = 'confirmada'`).all(doisDiasAtras);

    for (const p of lista) {
        notificador.avisarCliente(p.whatsapp,
`Ola, ${p.nome}! Espero que tenha gostado do passeio.

Posso te pedir um favor? Me manda aqui uma frase sobre o que voce achou, ou uma
foto bacana que voce tirou. Vou adorar colocar no diario de bordo do site.

Obrigado por embarcar com a gente.
${config.capitao.nome}`,
            `depoimento-${p.id}`);

        db.prepare("UPDATE reservas SET status = 'concluida' WHERE id = ?").run(p.id);
    }
    if (lista.length) log.info(`${lista.length} pedido(s) de depoimento enfileirado(s).`);
}

function cobrarComprovante() {
    const limite = Date.now() - 24 * 3600 * 1000;
    const lista = db.prepare(`
        SELECT r.id, r.valor_centavos, r.data_passeio, c.nome, c.whatsapp, t.nome AS roteiro
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        LEFT JOIN pagamentos p ON p.reserva_id = r.id
        WHERE r.status = 'aguardando_pagamento'
          AND p.id IS NULL
          AND r.criado_em < ?
          AND r.data_passeio >= ?`).all(limite, hojeIso());

    for (const r of lista) {
        notificador.avisarCliente(r.whatsapp,
`Ola, ${r.nome}! Sua reserva ainda esta sem o comprovante do Pix.

Roteiro: ${r.roteiro}
Data: ${dataBr(r.data_passeio)}
Valor: ${reais(r.valor_centavos)}
Codigo: ${codigoCurto(r.id)}

O lugar so fica garantido depois do pagamento. Se ja pagou, e so mandar o
comprovante em ${config.urlPublica}
Se mudou de ideia, me avise por aqui que eu libero a vaga.`,
            `cobranca-${r.id}`);
    }
    if (lista.length) log.info(`${lista.length} cobranca(s) de comprovante enfileirada(s).`);
}

function limparRelayAntigo() {
    const r = db.prepare('DELETE FROM relay_map WHERE criado_em < ?')
                .run(Date.now() - 30 * 24 * 3600 * 1000);
    const f = db.prepare("DELETE FROM fila_envio WHERE status = 'enviado' AND enviado_em < ?")
                .run(Date.now() - 60 * 24 * 3600 * 1000);
    if (r.changes || f.changes) log.info(`Limpeza: ${r.changes} vinculos e ${f.changes} itens de fila antigos.`);
}

function iniciar() {
    cron.schedule('0 7 * * *',  resumoDoDiaParaCapitao, FUSO);
    cron.schedule('0 18 * * *', lembreteDaVespera,      FUSO);
    cron.schedule('0 10 * * *', pedirDepoimento,        FUSO);
    cron.schedule('0 11 * * *', cobrarComprovante,      FUSO);
    cron.schedule('30 3 * * *', limparRelayAntigo,      FUSO);
    log.info('Rotinas agendadas (fuso America/Bahia).');
}

module.exports = {
    iniciar, lembreteDaVespera, resumoDoDiaParaCapitao,
    pedirDepoimento, cobrarComprovante
};
