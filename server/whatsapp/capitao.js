'use strict';

/**
 * O painel do capitao dentro do proprio WhatsApp.
 *
 * Como o bot roda no numero pessoal do Erick, tudo que ele digita chega aqui
 * como mensagem "fromMe". Duas coisas acontecem:
 *
 *  A) Se comeca com #, e um comando (lista de reservas, aprovar, etc).
 *  B) Se e texto normal dentro da conversa de um cliente, o robo entende que
 *     o Erick assumiu o atendimento e se cala sozinho naquela conversa.
 *
 *  C) Se ele RESPONDE (citando) um aviso que o robo mandou, o texto e
 *     repassado para o cliente daquele aviso. E como responder de dentro
 *     da caixa de avisos, sem abrir a conversa do cliente.
 */

const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Capitao');
const outbox = require('./outbox');
const conversas = require('../services/conversas');
const servicoReservas = require('../services/reservas');
const servicoPagamentos = require('../services/pagamentos');
const notificador = require('../agents/notificador');
const conteudo = require('../agents/conteudo');
const rotinas = require('../agents/posvenda');
const { reais, dataBr, hojeIso, codigoCurto, jidParaTelefone, ehDataIsoValida } = require('../lib/util');

const AJUDA =
`COMANDOS DO CAPITAO

#hoje            passeios de hoje
#amanha          passeios de amanha
#agenda 15/03    passeios de um dia
#reservas        comprovantes esperando conferencia
#aprovar ABC123  confirma o pagamento e avisa o cliente
#recusar ABC123  recusa o comprovante
#bloquear 15/03 mar ruim
#liberar 15/03
#fila            situacao da fila de envio
#resumo          manda o resumo do dia agora

DENTRO DA CONVERSA DE UM CLIENTE
#bot       devolve o atendimento ao robo
#calar     o robo nunca mais responde nessa conversa
#situacao  mostra em que pe esta a conversa

OUTROS
post: baleia pulando hoje   -> gera legenda para o Instagram

Para falar com um cliente, responda (citando) o aviso que eu mandei.`;

function converterData(txt) {
    const m = String(txt || '').trim().match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    if (!m) return null;
    const dia = String(m[1]).padStart(2, '0');
    const mes = String(m[2]).padStart(2, '0');
    let ano = m[3] || String(new Date().getFullYear());
    if (ano.length === 2) ano = '20' + ano;
    const iso = `${ano}-${mes}-${dia}`;
    return ehDataIsoValida(iso) ? iso : null;
}

function listarDia(data) {
    const lista = servicoReservas.doDia(data);
    if (!lista.length) return `Nenhum passeio em ${dataBr(data)}.`;

    const pessoas = lista.reduce((s, r) => s + r.num_pessoas, 0);
    const linhas = lista.map(r =>
        `- ${r.roteiro_nome}\n  ${r.cliente_nome}, ${r.num_pessoas} pessoa(s), ${reais(r.valor_centavos)}` +
        `${r.status !== 'confirmada' ? '\n  NAO PAGO' : ''}\n  https://wa.me/${r.cliente_whatsapp}`
    ).join('\n\n');

    return `PASSEIOS DE ${dataBr(data)} (${pessoas} pessoa(s))\n\n${linhas}`;
}

function listarPendentes() {
    const lista = servicoReservas.pendentesDePagamento();
    if (!lista.length) return 'Nenhum comprovante esperando conferencia.';

    const linhas = lista.map(p =>
        `[${codigoCurto(p.reserva_id)}] ${p.nome}\n` +
        `${p.roteiro_nome}, ${dataBr(p.data_passeio)}, ${p.num_pessoas} pessoa(s)\n` +
        `Valor: ${reais(p.valor_centavos)}\n` +
        `Aprovar: #aprovar ${codigoCurto(p.reserva_id)}`
    ).join('\n\n');

    return `COMPROVANTES A CONFERIR (${lista.length})\n\n${linhas}\n\n` +
           `Veja as imagens no painel: ${config.urlPublica}/admin.html`;
}

// ---------------------------------------------------------------------------

/**
 * Trata um comando do capitao.
 * jidDaConversa: onde ele digitou (a propria conversa dele, ou a de um cliente)
 * Devolve o texto de resposta, ou null se nao for comando.
 */
async function tratarComando(jidDaConversa, texto) {
    const bruto = String(texto || '').trim();

    // "post: ..." nao comeca com #, mas tambem e comando
    const legenda = await conteudo.tratar(bruto);
    if (legenda) return legenda;

    if (!bruto.startsWith('#')) return null;

    const [comandoBruto, ...resto] = bruto.slice(1).split(/\s+/);
    const comando = comandoBruto.toLowerCase();
    const argumento = resto.join(' ').trim();

    switch (comando) {
        case 'ajuda':
        case 'help':
        case 'comandos':
            return AJUDA;

        case 'hoje':
            return listarDia(hojeIso());

        case 'amanha':
        case 'amanhã':
            return listarDia(hojeIso(1));

        case 'agenda': {
            const data = converterData(argumento);
            if (!data) return 'Use assim: #agenda 15/03';
            return listarDia(data);
        }

        case 'reservas':
        case 'pendentes':
            return listarPendentes();

        case 'aprovar': {
            if (!argumento) return 'Use assim: #aprovar ABC123';
            const reserva = servicoReservas.porCodigo(argumento);
            if (!reserva) return `Nao achei a reserva "${argumento}".`;

            const r = servicoPagamentos.aprovar(reserva.id, 'capitao (WhatsApp)');
            if (!r.ok) return r.erro;

            notificador.pagamentoConfirmadoAoCliente(r.reserva);
            return `Confirmado.\n\n${r.reserva.cliente_nome} - ${r.reserva.roteiro_nome}\n` +
                   `${dataBr(r.reserva.data_passeio)}, ${r.reserva.num_pessoas} pessoa(s)\n\n` +
                   `Ja avisei o cliente.`;
        }

        case 'recusar': {
            if (!argumento) return 'Use assim: #recusar ABC123';
            const reserva = servicoReservas.porCodigo(argumento.split(/\s+/)[0]);
            if (!reserva) return `Nao achei a reserva "${argumento}".`;

            const r = servicoPagamentos.recusar(reserva.id, 'capitao (WhatsApp)', argumento);
            if (!r.ok) return r.erro;

            notificador.avisarCliente(reserva.cliente_whatsapp,
                `Ola, ${reserva.cliente_nome}. Nao consegui identificar o seu pagamento para a ` +
                `reserva de ${dataBr(reserva.data_passeio)}. Me chame aqui que a gente resolve.`);
            return `Recusado. Avisei o cliente ${reserva.cliente_nome}.`;
        }

        case 'bloquear': {
            const partes = argumento.split(/\s+/);
            const data = converterData(partes[0]);
            if (!data) return 'Use assim: #bloquear 15/03 mar ruim';
            db.prepare(`INSERT OR REPLACE INTO bloqueios_agenda (data_passeio, motivo, criado_em)
                        VALUES (?, ?, ?)`).run(data, partes.slice(1).join(' ') || null, Date.now());
            return `Dia ${dataBr(data)} bloqueado. O site nao aceita mais reserva nessa data.`;
        }

        case 'liberar': {
            const data = converterData(argumento);
            if (!data) return 'Use assim: #liberar 15/03';
            db.prepare('DELETE FROM bloqueios_agenda WHERE data_passeio = ?').run(data);
            return `Dia ${dataBr(data)} liberado.`;
        }

        case 'fila': {
            const e = outbox.estatisticas();
            if (!e.length) return 'A fila de envio esta vazia.';
            return 'FILA DE ENVIO\n\n' + e.map(x => `${x.status}: ${x.n}`).join('\n');
        }

        case 'resumo':
            rotinas.resumoDoDiaParaCapitao();
            return 'Resumo enfileirado.';

        // ---- comandos que valem dentro da conversa de um cliente ----
        case 'bot': {
            conversas.definirModo(jidDaConversa, 'bot');
            return 'Certo, o robo voltou a atender esta conversa.';
        }

        case 'calar':
        case 'silencio':
        case 'silêncio': {
            conversas.definirModo(jidDaConversa, 'silencio');
            return 'O robo nao vai mais responder nesta conversa.';
        }

        case 'situacao':
        case 'situação':
        case 'status': {
            const c = conversas.buscar(jidDaConversa);
            if (!c) return 'Nao tenho registro desta conversa.';
            const nomes = { novo: 'ainda nao classificada', bot: 'o robo esta atendendo',
                            humano: 'voce assumiu', silencio: 'robo desligado aqui' };
            let t = `Situacao: ${nomes[c.modo] || c.modo}`;
            if (c.modo === 'humano' && c.modo_ate) {
                const min = Math.max(0, Math.round((c.modo_ate - Date.now()) / 60000));
                t += `\nO robo volta sozinho em ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}, ou mande #bot.`;
            }
            const cliente = c.cliente_id
                ? db.prepare('SELECT nome FROM clientes WHERE id = ?').get(c.cliente_id) : null;
            if (cliente) t += `\nCliente cadastrado: ${cliente.nome}`;
            return t;
        }

        default:
            return `Nao conheco o comando "#${comando}".\n\n${AJUDA}`;
    }
}

/**
 * O capitao respondeu citando um aviso -> repassa o texto ao cliente daquele aviso.
 * Devolve true se repassou.
 */
function repassarSeForResposta(idMensagemCitada, texto) {
    if (!idMensagemCitada) return false;

    const vinculo = db.prepare('SELECT destino_jid FROM relay_map WHERE wa_message_id = ?')
                      .get(idMensagemCitada);
    if (!vinculo) return false;

    const destino = vinculo.destino_jid;

    // Entrega ao cliente
    outbox.enfileirar({ destinoJid: destino, texto, tipo: 'mensagem_cliente' });
    conversas.registrarMensagem(destino, 'capitao', texto);
    conversas.registrarFalaDoCapitao(destino);

    // Confirma para o capitao, e deixa o proprio recibo tambem respondivel
    outbox.enfileirar({
        destinoJid: notificador.jidDoCapitao(),
        texto: `Entregue a ${jidParaTelefone(destino)}.\nO robo esta calado nessa conversa. Mande #bot na conversa dele para devolver.`,
        tipo: 'aviso_capitao',
        origemJid: destino
    });

    log.info(`Mensagem do capitao repassada para ${destino}`);
    return true;
}

module.exports = { tratarComando, repassarSeForResposta, AJUDA };
