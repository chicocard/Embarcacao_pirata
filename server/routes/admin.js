const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Rota de Login
router.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    // Hardcoded inicialização do admin se não existir
    const adminExistente = db.prepare('SELECT * FROM admin_usuarios WHERE usuario = ?').get(usuario);
    
    if (!adminExistente) {
        if (usuario === process.env.ADMIN_USER && senha === process.env.ADMIN_PASSWORD) {
            const hash = bcrypt.hashSync(senha, 10);
            db.prepare('INSERT INTO admin_usuarios (id, usuario, senha_hash, criado_em) VALUES (?, ?, ?, ?)').run(
                'admin-1', usuario, hash, Date.now()
            );
            const token = jwt.sign({ user: usuario }, JWT_SECRET, { expiresIn: '8h' });
            return res.json({ sucesso: true, token });
        }
        return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (bcrypt.compareSync(senha, adminExistente.senha_hash)) {
        const token = jwt.sign({ user: usuario }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ sucesso: true, token });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

// Middleware de Autenticação
const auth = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Não autorizado' });
    
    jwt.verify(token.split(' ')[1], JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = decoded.user;
        next();
    });
};

// Obter Reservas pendentes
router.get('/reservas/pendentes', auth, (req, res) => {
    const pendentes = db.prepare(`
        SELECT r.id as reserva_id, r.data_passeio, r.num_pessoas, p.id as pagamento_id, p.valor_centavos, p.comprovante_url, c.nome, c.whatsapp
        FROM reservas r
        JOIN pagamentos p ON p.reserva_id = r.id
        JOIN clientes c ON c.id = r.cliente_id
        WHERE p.status = 'aguardando_confirmacao'
    `).all();
    res.json(pendentes);
});

// Aprovar Pagamento
router.post('/reservas/:reserva_id/aprovar', auth, (req, res) => {
    const { reserva_id } = req.params;
    
    try {
        db.transaction(() => {
            db.prepare("UPDATE pagamentos SET status = 'confirmado_manual', confirmado_por = ? WHERE reserva_id = ?").run(req.user, reserva_id);
            db.prepare("UPDATE reservas SET status = 'confirmada' WHERE id = ?").run(reserva_id);
        })();

        // Notificar Cliente da Confirmação do Passeio
        const { whatsapp } = db.prepare(`
            SELECT c.whatsapp FROM reservas r 
            JOIN clientes c ON r.cliente_id = c.id 
            WHERE r.id = ?`).get(reserva_id);
            
        require('../agents/notificador').notificar(
            whatsapp,
            `⚓ Ahoy! Seu pagamento foi confirmado pelo Capitão Erick!\n\nSua reserva (\${reserva_id}) está garantida. Nos vemos no píer!`
        );

        res.json({ sucesso: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao aprovar' });
    }
});

module.exports = router;
