const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// Inicialização do Servidor
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do front-end
app.use(express.static(path.join(__dirname, '../public')));

// Importar rotas
const reservasRoutes = require('./routes/reservas');
const pagamentosRoutes = require('./routes/pagamentos');
const adminRoutes = require('./routes/admin');

app.use('/api/reservas', reservasRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api/admin', adminRoutes);

// Inicializar WhatsApp Bot e Agentes
const { connectToWhatsApp } = require('./whatsapp/bot');
const { iniciarAtendimento } = require('./agents/atendimento');
const { initPosVenda } = require('./agents/posvenda');

connectToWhatsApp().then(() => {
    iniciarAtendimento();
    initPosVenda();
}).catch(err => console.error("Erro ao iniciar WhatsApp:", err));

app.listen(PORT, () => {
    console.log(`[Embarcação Pirata] Servidor rodando na porta ${PORT}`);
});
