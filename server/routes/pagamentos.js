'use strict';

/**
 * Recebimento do comprovante de Pix.
 *
 * O que mudou em relacao a versao anterior, e por que:
 *
 *  1. O arquivo NAO vai mais para public/uploads/. Ia para uma pasta servida
 *     estaticamente: qualquer pessoa podia subir um .html com script e ele
 *     seria servido no dominio do site. Agora vai para data/comprovantes/,
 *     fora da pasta publica, e so sai de la por uma rota autenticada.
 *  2. Tipo e tamanho sao conferidos (imagem ou PDF, ate 5 MB), e o nome do
 *     arquivo e gerado por nos: nada vindo do navegador entra no caminho.
 *  3. O VALOR nao vem mais do formulario. Vem da reserva, no banco. Antes
 *     dava para forjar um pagamento de R$ 1,00 numa reserva de R$ 2.500.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const config = require('../config');
const log = require('../lib/log').fazer('Pagamentos');
const servicoPagamentos = require('../services/pagamentos');
const servicoReservas = require('../services/reservas');
const notificador = require('../agents/notificador');
const { exigirLogin } = require('../middleware/auth');

const PASTA = process.env.COMPROVANTES_DIR ||
              path.join(process.env.DATA_DIR || path.join(__dirname, '../../data'), 'comprovantes');
if (!fs.existsSync(PASTA)) fs.mkdirSync(PASTA, { recursive: true });

const EXTENSOES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, PASTA),
        filename: (req, file, cb) => {
            // nome gerado por nos: o navegador nao escolhe caminho nem extensao
            cb(null, crypto.randomUUID() + (EXTENSOES[file.mimetype] || '.bin'));
        }
    }),
    limits: { fileSize: config.upload.maxBytes, files: 1, fields: 5 },
    fileFilter: (req, file, cb) => {
        if (!config.upload.tiposAceitos.includes(file.mimetype)) {
            return cb(new Error('Envie uma foto (JPG, PNG ou WEBP) ou um PDF.'));
        }
        cb(null, true);
    }
});

function apagar(nome) {
    try { fs.unlinkSync(path.join(PASTA, nome)); } catch { /* ja nao existe */ }
}

router.post('/upload', (req, res) => {
    upload.single('comprovante')(req, res, (erroUpload) => {
        if (erroUpload) {
            const msg = erroUpload.code === 'LIMIT_FILE_SIZE'
                ? `Arquivo grande demais. O limite e ${Math.round(config.upload.maxBytes / 1024 / 1024)} MB.`
                : erroUpload.message;
            return res.status(400).json({ erro: msg });
        }

        if (!req.file) return res.status(400).json({ erro: 'Anexe o comprovante.' });

        const reservaId = String((req.body && req.body.reserva_id) || '').trim();
        if (!reservaId) {
            apagar(req.file.filename);
            return res.status(400).json({ erro: 'Reserva nao informada.' });
        }

        const r = servicoPagamentos.registrarComprovante(reservaId, req.file.filename, req.file.mimetype);
        if (!r.ok) {
            apagar(req.file.filename);
            return res.status(400).json({ erro: r.erro });
        }

        notificador.comprovanteRecebido(r.reserva, r.pagamento);
        log.info(`Comprovante recebido da reserva ${reservaId}`);

        res.json({
            sucesso: true,
            mensagem: 'Comprovante recebido. O capitao vai conferir e te avisar no WhatsApp.'
        });
    });
});

/** Download do comprovante: SO para o capitao logado. */
router.get('/comprovante/:arquivo', exigirLogin, (req, res) => {
    const nome = path.basename(String(req.params.arquivo));      // barra travessia de diretorio
    const pagamento = servicoPagamentos.porArquivo(nome);
    if (!pagamento) return res.status(404).json({ erro: 'Comprovante nao encontrado.' });

    const caminho = path.join(PASTA, nome);
    if (!fs.existsSync(caminho)) return res.status(404).json({ erro: 'Arquivo nao esta mais no servidor.' });

    res.setHeader('Content-Type', pagamento.comprovante_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(caminho);
});

module.exports = router;
module.exports.PASTA_COMPROVANTES = PASTA;
