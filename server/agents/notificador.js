'use strict';

/**
 * Avisos para o celular do capitao.
 *
 * Nada aqui envia direto: tudo passa pela fila (outbox), que garante entrega
 * mesmo se o WhatsApp estiver fora do ar na hora do evento.
 *
 * Cada aviso leva uma chave de idempotencia, entao reiniciar o servidor ou
 * repetir a chamada nao gera aviso duplicado no celular do Erick.
 */

const config = require('../config');
const outbox = require('../whatsapp/outbox');
const { telefoneParaJid, reais, dataBr, codigoCurto, jidParaTelefone } = require('../lib/util');

function jidDoCapitao() {
    return telefoneParaJid(config.capitao.whatsapp);
}

/** Envia um texto qualquer para o capitao. */
function avisarCapitao(texto, { chaveIdem = null, origemJid = null } = {}) {
    return outbox.enfileirar({
        destinoJid: jidDoCapitao(),
        texto,
        tipo: 'aviso_capitao',
        chaveIdem,
        origemJid
    });
}

/** Envia um texto para um cliente. */
function avisarCliente(telefoneOuJid, texto, chaveIdem = null) {
    const jid = String(telefoneOuJid).includes('@')
        ? telefoneOuJid
        : telefoneParaJid(telefoneOuJid);
    return outbox.enfileirar({ destinoJid: jid, texto, tipo: 'mensagem_cliente', chaveIdem });
}

// ---------------------------------------------------------------------------
// Avisos especificos
// ---------------------------------------------------------------------------

function reservaNova(reserva, clienteEhNovo) {
    const cod = codigoCurto(reserva.id);
    const linkCliente = `https://wa.me/${reserva.cliente_whatsapp}`;

    const texto =
`NOVA RESERVA  [${cod}]

Cliente: ${reserva.cliente_nome}${clienteEhNovo ? '  (cliente novo)' : ''}
WhatsApp: ${linkCliente}
Roteiro: ${reserva.roteiro_nome}
Data: ${dataBr(reserva.data_passeio)}
Pessoas: ${reserva.num_pessoas}
Valor: ${reais(reserva.valor_centavos)}

Situacao: aguardando o Pix.

Responda ESTA mensagem para falar com o cliente.
Ou toque no link acima para abrir a conversa.`;

    return avisarCapitao(texto, {
        chaveIdem: `reserva-nova-${reserva.id}`,
        origemJid: telefoneParaJid(reserva.cliente_whatsapp)
    });
}

function comprovanteRecebido(reserva, pagamento) {
    const cod = codigoCurto(reserva.id);
    const divergencia = pagamento.valor_centavos !== reserva.valor_centavos
        ? `\nATENCAO: o comprovante diz ${reais(pagamento.valor_centavos)} e a reserva e de ${reais(reserva.valor_centavos)}.`
        : '';

    const texto =
`COMPROVANTE DE PIX RECEBIDO  [${cod}]

Cliente: ${reserva.cliente_nome}
Roteiro: ${reserva.roteiro_nome}
Data: ${dataBr(reserva.data_passeio)}
Valor da reserva: ${reais(reserva.valor_centavos)}${divergencia}

Confira o comprovante no painel:
${config.urlPublica}/admin.html

Ou aprove por aqui mesmo mandando:
#aprovar ${cod}`;

    return avisarCapitao(texto, {
        chaveIdem: `comprovante-${pagamento.id}`,
        origemJid: telefoneParaJid(reserva.cliente_whatsapp)
    });
}

function pagamentoConfirmadoAoCliente(reserva) {
    const texto =
`Pagamento confirmado!

Sua reserva esta garantida:
Roteiro: ${reserva.roteiro_nome}
Data: ${dataBr(reserva.data_passeio)}
Pessoas: ${reserva.num_pessoas}
Codigo: ${codigoCurto(reserva.id)}

O que levar: protetor solar, chapeu, roupa de banho, uma muda de roupa seca e toalha.
Na vespera eu confirmo o horario e o ponto de encontro por aqui.

Nos vemos no pier!
${config.capitao.nome}`;

    return avisarCliente(reserva.cliente_whatsapp, texto, `confirmado-${reserva.id}`);
}

/** O robo topou com algo que nao deve resolver sozinho. */
function escalarParaCapitao({ jid, nomeContato, texto, motivo, historico = [] }) {
    const telefone = jidParaTelefone(jid);
    const conversa = historico.length
        ? '\n\nUltimas mensagens:\n' + historico.map(m =>
            `${m.autor === 'cliente' ? '>' : '<'} ${String(m.texto).substring(0, 160)}`).join('\n')
        : '';

    const corpo =
`ATENDIMENTO PRECISA DE VOCE

De: ${nomeContato || telefone}
WhatsApp: https://wa.me/${telefone}
Motivo: ${motivo}

Mensagem: "${String(texto).substring(0, 400)}"${conversa}

O robo ficou calado nessa conversa.
Responda ESTA mensagem e o texto vai direto para o cliente.
Quando terminar, mande #bot na conversa do cliente para o robo voltar.`;

    // uma escalada por conversa a cada 30 minutos, para nao inundar o celular
    const janela = Math.floor(Date.now() / (30 * 60 * 1000));
    return avisarCapitao(corpo, { chaveIdem: `escalada-${jid}-${janela}`, origemJid: jid });
}

function clienteNovoEscreveu({ jid, nomeContato, texto }) {
    const telefone = jidParaTelefone(jid);
    const janela = Math.floor(Date.now() / (6 * 3600 * 1000));
    const corpo =
`CONTATO NOVO NO WHATSAPP

De: ${nomeContato || telefone}
Link: https://wa.me/${telefone}
Disse: "${String(texto).substring(0, 300)}"

O robo assumiu o atendimento. Se quiser entrar, e so responder no chat dele
(o robo se cala automaticamente) ou responder ESTA mensagem.`;

    return avisarCapitao(corpo, { chaveIdem: `novo-${jid}-${janela}`, origemJid: jid });
}

/** Compatibilidade com o codigo antigo: notificar(numero, mensagem). */
function notificar(numero, mensagem) {
    return avisarCliente(numero, mensagem);
}

module.exports = {
    jidDoCapitao, avisarCapitao, avisarCliente, notificar,
    reservaNova, comprovanteRecebido, pagamentoConfirmadoAoCliente,
    escalarParaCapitao, clienteNovoEscreveu
};
