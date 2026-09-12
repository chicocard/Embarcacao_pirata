const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { generatePix } = require('@dicascripto/pix-qrcode-generator');

router.post('/', async (req, res) => {
    const { nome, whatsapp, roteiro_id, data_passeio, num_pessoas } = req.body;

    try {
        // Validação básica
        if (!nome || !whatsapp || !roteiro_id || !data_passeio || !num_pessoas) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Buscar Roteiro para pegar o preço
        const roteiro = db.prepare('SELECT * FROM roteiros WHERE id = ?').get(roteiro_id);
        if (!roteiro) {
            return res.status(404).json({ error: 'Roteiro não encontrado' });
        }

        const cliente_id = crypto.randomUUID();
        const reserva_id = crypto.randomUUID();
        const criado_em = Date.now();
        const valor_total = roteiro.preco_centavos * num_pessoas;

        // Inserir Cliente e Reserva numa transação
        const transaction = db.transaction(() => {
            db.prepare(`
                INSERT INTO clientes (id, nome, whatsapp, criado_em)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(whatsapp) DO UPDATE SET nome=excluded.nome
            `).run(cliente_id, nome, whatsapp, criado_em);

            const dbCliente = db.prepare('SELECT id FROM clientes WHERE whatsapp = ?').get(whatsapp);

            db.prepare(`
                INSERT INTO reservas (id, cliente_id, roteiro_id, data_passeio, num_pessoas, status, criado_em)
                VALUES (?, ?, ?, ?, ?, 'pendente', ?)
            `).run(reserva_id, dbCliente.id, roteiro_id, data_passeio, num_pessoas, criado_em);
        });

        transaction();

        // Gerar PIX
        const pixPayload = generatePix({
            key: process.env.PIX_KEY,
            name: process.env.PIX_NOME,
            city: process.env.PIX_CIDADE,
            amount: valor_total / 100, // biblioteca exige em reais
            transactionId: reserva_id.substring(0, 15) // id curto
        });

        // O notificador deve ser chamado aqui (assincronamente)
        require('../agents/notificador').notificar(
            process.env.ERICK_WHATSAPP,
            `🏴‍☠️ *Nova Reserva!*\n\nDe: ${nome}\nRoteiro: ${roteiro.nome}\nData: ${data_passeio}\nPessoas: ${num_pessoas}\n\nAguardando pagamento Pix.`
        );

        res.json({
            sucesso: true,
            reserva_id,
            pixPayload: pixPayload.payload,
            pixBase64: pixPayload.base64,
            valor_total
        });
    } catch (err) {
        console.error('Erro ao criar reserva:', err);
        res.status(500).json({ error: 'Erro interno ao processar a reserva' });
    }
});

module.exports = router;
