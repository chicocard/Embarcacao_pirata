'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const log = require('../lib/log').fazer('Reservas');
const pix = require('../lib/pix');
const servicoReservas = require('../services/reservas');
const notificador = require('../agents/notificador');
const conversas = require('../services/conversas');
const { reais, codigoCurto, telefoneParaJid } = require('../lib/util');

/** Lista publica de roteiros: o front-end monta o formulario a partir daqui. */
router.get('/roteiros', (req, res) => {
    const lista = servicoReservas.listarRoteiros().map(r => ({
        id: r.id,
        nome: r.nome,
        descricao: r.descricao,
        preco_centavos: r.preco_centavos,
        preco_formatado: reais(r.preco_centavos),
        duracao_min: r.duracao_min,
        capacidade_max: r.capacidade_max,
        foto_url: r.foto_url
    }));
    res.json(lista);
});

/** Vagas de um roteiro numa data. */
router.get('/disponibilidade', (req, res) => {
    const { roteiro_id, data } = req.query;
    if (!roteiro_id || !data) return res.status(400).json({ erro: 'Informe roteiro_id e data.' });
    if (servicoReservas.dataBloqueada(data)) {
        return res.json({ vagas: 0, bloqueada: true });
    }
    res.json({ vagas: servicoReservas.vagasRestantes(roteiro_id, data), bloqueada: false });
});

/** Cria a reserva e devolve o Pix. */
router.post('/', async (req, res) => {
    try {
        const validacao = servicoReservas.validarPedido(req.body || {});
        if (!validacao.ok) return res.status(400).json({ erro: validacao.erro });

        const dados = validacao.dados;
        const { reservaId, cliente } = servicoReservas.criar(dados);
        const reserva = servicoReservas.detalhar(reservaId);

        const { payload, imagem } = await pix.gerar({
            chave: config.pix.chave,
            nome: config.pix.nome,
            cidade: config.pix.cidade,
            valor: dados.valor_centavos / 100,
            txid: codigoCurto(reservaId)
        });

        // Avisa o capitao no celular (entra na fila; nao trava a resposta ao cliente)
        notificador.reservaNova(reserva, cliente.novo);

        // Deixa a conversa do cliente pronta para o robo atender
        conversas.vincularCliente(telefoneParaJid(dados.whatsapp), cliente.id, dados.nome);

        log.info(`Reserva ${codigoCurto(reservaId)} criada: ${dados.nome}, ${reais(dados.valor_centavos)}`);

        res.json({
            sucesso: true,
            reserva_id: reservaId,
            codigo: codigoCurto(reservaId),
            valor_centavos: dados.valor_centavos,
            valor_formatado: reais(dados.valor_centavos),
            roteiro: dados.roteiro.nome,
            data_passeio: dados.data_passeio,
            num_pessoas: dados.num_pessoas,
            pix_payload: payload,
            pix_imagem: imagem
        });
    } catch (e) {
        log.erro('Falha ao criar reserva:', e.message);
        res.status(500).json({ erro: 'Nao consegui registrar a reserva. Tente de novo em instantes.' });
    }
});

/** Consulta do cliente pelo codigo curto. */
router.get('/:codigo/situacao', (req, res) => {
    const reserva = servicoReservas.porCodigo(req.params.codigo);
    if (!reserva) return res.status(404).json({ erro: 'Reserva nao encontrada.' });

    const nomes = {
        aguardando_pagamento: 'Aguardando o pagamento',
        pendente: 'Aguardando conferencia do capitao',
        confirmada: 'Confirmada',
        cancelada: 'Cancelada',
        concluida: 'Concluida'
    };

    res.json({
        codigo: codigoCurto(reserva.id),
        roteiro: reserva.roteiro_nome,
        data_passeio: reserva.data_passeio,
        num_pessoas: reserva.num_pessoas,
        valor_formatado: reais(reserva.valor_centavos),
        situacao: nomes[reserva.status] || reserva.status
    });
});

module.exports = router;
