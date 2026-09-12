const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const multer = require('multer');
const path = require('path');

// Configuração do multer para upload de comprovantes (salvo na pasta public/uploads)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../../public/uploads/'))
    },
    filename: function (req, file, cb) {
        cb(null, 'comprovante_' + Date.now() + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

router.post('/upload', upload.single('comprovante'), (req, res) => {
    const { reserva_id, valor_centavos } = req.body;
    
    if (!req.file || !reserva_id || !valor_centavos) {
        return res.status(400).json({ error: 'Faltam dados ou arquivo do comprovante.' });
    }

    try {
        const url_arquivo = '/uploads/' + req.file.filename;
        const pagamento_id = crypto.randomUUID();
        const criado_em = Date.now();

        // Inserir registro de pagamento e atualizar status da reserva
        const transaction = db.transaction(() => {
            db.prepare(`
                INSERT INTO pagamentos (id, reserva_id, metodo, valor_centavos, comprovante_url, status, criado_em)
                VALUES (?, ?, 'pix', ?, ?, 'aguardando_confirmacao', ?)
            `).run(pagamento_id, reserva_id, valor_centavos, url_arquivo, criado_em);

            db.prepare(`
                UPDATE reservas SET status = 'pendente' WHERE id = ?
            `).run(reserva_id); // Pode mudar para aguardando_pagamento se houvesse no schema
        });
        
        transaction();

        // Notificar o admin
        require('../agents/notificador').notificar(
            process.env.ERICK_WHATSAPP,
            `💰 *Novo Comprovante de Pagamento!*\n\nReserva: ${reserva_id}\nValor: R$ ${(valor_centavos/100).toFixed(2)}\n\nAcesse o painel para confirmar.`
        );

        res.json({ sucesso: true, mensagem: 'Comprovante recebido com sucesso' });
    } catch (err) {
        console.error('Erro ao salvar comprovante:', err);
        res.status(500).json({ error: 'Erro interno' });
    }
});

module.exports = router;
