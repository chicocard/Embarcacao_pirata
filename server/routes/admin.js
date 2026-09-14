'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const log = require('../lib/log').fazer('Admin');
const { autenticar, exigirLogin, trocarSenha, chaveIp } = require('../middleware/auth');
const servicoReservas = require('../services/reservas');
const servicoPagamentos = require('../services/pagamentos');
const notificador = require('../agents/notificador');
const conversas = require('../services/conversas');
const outbox = require('../whatsapp/outbox');
const bot = require('../whatsapp/bot');
const llm = require('../agents/llm');
const { reais, dataBr, hojeIso, codigoCurto } = require('../lib/util');

router.post('/login', (req, res) => {
    const { usuario, senha } = req.body || {};
    const r = autenticar(usuario, senha, chaveIp(req));
    if (!r.ok) return res.status(r.status || 401).json({ erro: r.erro });
    res.json({ sucesso: true, token: r.token, usuario: r.usuario });
});

router.post('/senha', exigirLogin, (req, res) => {
    const { senha_atual, senha_nova } = req.body || {};
    const r = trocarSenha(req.admin.sub, senha_atual, senha_nova);
    if (!r.ok) return res.status(400).json({ erro: r.erro });
    res.json({ sucesso: true });
});

// --------------------------------------------------------------------------
// Daqui para baixo, tudo exige login
// --------------------------------------------------------------------------
router.use(exigirLogin);

router.get('/painel', async (req, res) => {
    const hoje = hojeIso();
    const pendentes = servicoReservas.pendentesDePagamento();
    const semComprovante = servicoReservas.semComprovante();

    const totais = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM clientes) AS clientes,
          (SELECT COUNT(*) FROM reservas WHERE status = 'confirmada') AS confirmadas,
          (SELECT COALESCE(SUM(valor_centavos),0) FROM reservas WHERE status IN ('confirmada','concluida')) AS faturado
    `).get();

    res.json({
        hoje: servicoReservas.doDia(hoje),
        amanha: servicoReservas.doDia(hojeIso(1)),
        pendentes,
        sem_comprovante: semComprovante,
        totais: {
            clientes: totais.clientes,
            confirmadas: totais.confirmadas,
            faturado_formatado: reais(totais.faturado)
        },
        sistema: {
            whatsapp: bot.estaConectado(),
            llm: await llm.verificar(),
            fila: outbox.estatisticas()
        }
    });
});

router.get('/reservas', (req, res) => {
    const status = req.query.status;
    const filtro = status ? 'WHERE r.status = ?' : '';
    const linhas = db.prepare(`
        SELECT r.id, r.data_passeio, r.num_pessoas, r.valor_centavos, r.status, r.criado_em,
               c.nome, c.whatsapp, t.nome AS roteiro_nome,
               p.status AS pagamento_status, p.comprovante_arquivo
        FROM reservas r
        JOIN clientes c ON c.id = r.cliente_id
        JOIN roteiros t ON t.id = r.roteiro_id
        LEFT JOIN pagamentos p ON p.reserva_id = r.id
        ${filtro}
        ORDER BY r.data_passeio DESC, r.criado_em DESC
        LIMIT 300`).all(...(status ? [status] : []));

    res.json(linhas.map(l => ({
        ...l,
        codigo: codigoCurto(l.id),
        valor_formatado: reais(l.valor_centavos),
        data_formatada: dataBr(l.data_passeio)
    })));
});

router.post('/reservas/:id/aprovar', (req, res) => {
    const reserva = servicoReservas.porCodigo(req.params.id);
    if (!reserva) return res.status(404).json({ erro: 'Reserva nao encontrada.' });

    const r = servicoPagamentos.aprovar(reserva.id, req.admin.usuario);
    if (!r.ok) return res.status(400).json({ erro: r.erro });

    notificador.pagamentoConfirmadoAoCliente(r.reserva);
    log.info(`${req.admin.usuario} aprovou a reserva ${codigoCurto(reserva.id)}`);
    res.json({ sucesso: true });
});

router.post('/reservas/:id/recusar', (req, res) => {
    const reserva = servicoReservas.porCodigo(req.params.id);
    if (!reserva) return res.status(404).json({ erro: 'Reserva nao encontrada.' });

    const r = servicoPagamentos.recusar(reserva.id, req.admin.usuario, (req.body || {}).motivo);
    if (!r.ok) return res.status(400).json({ erro: r.erro });

    notificador.avisarCliente(reserva.cliente_whatsapp,
        `Ola, ${reserva.cliente_nome}. Nao consegui identificar o seu pagamento para a reserva ` +
        `de ${dataBr(reserva.data_passeio)}. Me chame aqui no WhatsApp que a gente resolve.`);

    res.json({ sucesso: true });
});

// ---- conversas do WhatsApp ----
router.get('/conversas', (req, res) => {
    res.json(conversas.listarAtivas(72).map(c => ({
        jid: c.jid,
        telefone: c.telefone,
        nome: c.nome_contato,
        modo: c.modo,
        ultima_em: c.ultima_msg_cliente_em,
        link: `https://wa.me/${c.telefone}`
    })));
});

router.get('/conversas/:jid/mensagens', (req, res) => {
    const linhas = db.prepare(`SELECT autor, texto, criado_em FROM mensagens
                               WHERE jid = ? ORDER BY criado_em DESC LIMIT 60`)
                     .all(req.params.jid).reverse();
    res.json(linhas);
});

router.post('/conversas/:jid/modo', (req, res) => {
    const modo = String((req.body || {}).modo || '');
    if (!['bot', 'humano', 'silencio'].includes(modo)) {
        return res.status(400).json({ erro: 'Modo invalido.' });
    }
    conversas.definirModo(req.params.jid, modo, modo === 'humano' ? config.whatsapp.minutosHandoff : null);
    res.json({ sucesso: true });
});

router.post('/conversas/:jid/enviar', (req, res) => {
    const texto = String((req.body || {}).texto || '').trim();
    if (!texto) return res.status(400).json({ erro: 'Escreva a mensagem.' });

    outbox.enfileirar({ destinoJid: req.params.jid, texto, tipo: 'mensagem_cliente' });
    conversas.registrarMensagem(req.params.jid, 'capitao', texto);
    conversas.registrarFalaDoCapitao(req.params.jid);
    res.json({ sucesso: true });
});

// ---- agenda ----
router.get('/bloqueios', (req, res) => {
    res.json(db.prepare('SELECT * FROM bloqueios_agenda ORDER BY data_passeio').all());
});

router.post('/bloqueios', (req, res) => {
    const { data, motivo } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
        return res.status(400).json({ erro: 'Data invalida.' });
    }
    db.prepare(`INSERT OR REPLACE INTO bloqueios_agenda (data_passeio, motivo, criado_em)
                VALUES (?, ?, ?)`).run(data, motivo || null, Date.now());
    res.json({ sucesso: true });
});

router.delete('/bloqueios/:data', (req, res) => {
    db.prepare('DELETE FROM bloqueios_agenda WHERE data_passeio = ?').run(req.params.data);
    res.json({ sucesso: true });
});

// ---- roteiros e base de conhecimento ----
router.get('/roteiros', (req, res) => res.json(servicoReservas.listarRoteiros(false)));

router.put('/roteiros/:id', (req, res) => {
    const { nome, descricao, preco_centavos, duracao_min, capacidade_max, foto_url, ativo } = req.body || {};
    const preco = parseInt(preco_centavos, 10);
    if (!nome || !Number.isFinite(preco) || preco < 0) {
        return res.status(400).json({ erro: 'Nome e preco sao obrigatorios.' });
    }
    // So aceita caminho relativo ou https: evita colar javascript: ou http inseguro
    const foto = String(foto_url || '').trim();
    const fotoValida = !foto || /^(https:\/\/|\/)[^\s"'<>]+$/.test(foto) ? (foto || null) : null;

    db.prepare(`UPDATE roteiros
                SET nome = ?, descricao = ?, preco_centavos = ?, duracao_min = ?,
                    capacidade_max = ?, foto_url = ?, ativo = ?
                WHERE id = ?`)
      .run(nome, descricao || null, preco, parseInt(duracao_min, 10) || null,
           parseInt(capacidade_max, 10) || null, fotoValida, ativo ? 1 : 0, req.params.id);
    res.json({ sucesso: true });
});

router.get('/conhecimento', (req, res) => {
    res.json(db.prepare('SELECT * FROM conhecimento ORDER BY ordem').all());
});

router.put('/conhecimento/:id', (req, res) => {
    const { pergunta, resposta, ativo } = req.body || {};
    if (!pergunta || !resposta) return res.status(400).json({ erro: 'Preencha pergunta e resposta.' });
    db.prepare(`INSERT INTO conhecimento (id, pergunta, resposta, ativo, ordem)
                VALUES (?, ?, ?, ?, 100)
                ON CONFLICT(id) DO UPDATE SET pergunta = excluded.pergunta,
                                              resposta = excluded.resposta,
                                              ativo = excluded.ativo`)
      .run(req.params.id, pergunta, resposta, ativo === false ? 0 : 1);
    res.json({ sucesso: true });
});

module.exports = router;
