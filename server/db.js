'use strict';

const sqlite = require('./lib/sqlite');
const path = require('path');
const fs = require('fs');
const log = require('./lib/log').fazer('Banco');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = sqlite.abrir(path.join(dataDir, 'banco.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ---------------------------------------------------------------------------
// Esquema. Tudo com IF NOT EXISTS: rodar de novo nunca apaga nada.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    whatsapp TEXT UNIQUE NOT NULL,
    email TEXT,
    aceitou_clube INTEGER DEFAULT 0,
    criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roteiros (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    descricao TEXT,
    preco_centavos INTEGER NOT NULL,
    duracao_min INTEGER,
    capacidade_max INTEGER,
    foto_url TEXT,
    ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    roteiro_id TEXT NOT NULL,
    data_passeio TEXT NOT NULL,
    num_pessoas INTEGER NOT NULL,
    valor_centavos INTEGER NOT NULL DEFAULT 0,
    observacoes TEXT,
    status TEXT NOT NULL CHECK (status IN
        ('pendente','aguardando_pagamento','confirmada','cancelada','concluida')),
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(roteiro_id) REFERENCES roteiros(id)
);
CREATE INDEX IF NOT EXISTS idx_reservas_data ON reservas(data_passeio, status);
CREATE INDEX IF NOT EXISTS idx_reservas_cliente ON reservas(cliente_id);

CREATE TABLE IF NOT EXISTS pagamentos (
    id TEXT PRIMARY KEY,
    reserva_id TEXT NOT NULL,
    metodo TEXT NOT NULL CHECK (metodo IN ('pix')),
    chave_pix_usada TEXT,
    valor_centavos INTEGER NOT NULL,
    comprovante_arquivo TEXT,
    comprovante_mime TEXT,
    status TEXT NOT NULL CHECK (status IN
        ('aguardando_comprovante','aguardando_confirmacao','confirmado_manual','recusado')),
    confirmado_por TEXT,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(reserva_id) REFERENCES reservas(id)
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_status ON pagamentos(status);

CREATE TABLE IF NOT EXISTS depoimentos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    reserva_id TEXT,
    texto TEXT,
    foto_url TEXT,
    aprovado INTEGER DEFAULT 0,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS admin_usuarios (
    id TEXT PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_acesso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id TEXT,
    acao TEXT NOT NULL,
    detalhes_json TEXT,
    criado_em INTEGER NOT NULL
);

-- ------------------------------------------------------------------
-- NOVAS TABELAS
-- ------------------------------------------------------------------

-- Fila durável de mensagens a enviar. Se o WhatsApp cair ou o servidor
-- reiniciar, nada se perde: a fila é drenada quando a conexão voltar.
CREATE TABLE IF NOT EXISTS fila_envio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destino_jid TEXT NOT NULL,
    texto TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'notificacao',
    chave_idem TEXT UNIQUE,
    responder_a TEXT,
    origem_jid TEXT,
    tentativas INTEGER NOT NULL DEFAULT 0,
    proxima_tentativa_em INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','enviado','falhou')),
    ultimo_erro TEXT,
    criado_em INTEGER NOT NULL,
    enviado_em INTEGER,
    wa_message_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_fila_pendente
    ON fila_envio(status, proxima_tentativa_em);

-- Estado de cada conversa de WhatsApp: quem está no comando, o bot ou o Erick.
CREATE TABLE IF NOT EXISTS conversas (
    jid TEXT PRIMARY KEY,
    telefone TEXT,
    nome_contato TEXT,
    cliente_id TEXT,
    modo TEXT NOT NULL DEFAULT 'novo'
        CHECK (modo IN ('novo','bot','humano','silencio')),
    modo_ate INTEGER,
    ultima_msg_cliente_em INTEGER,
    ultima_msg_bot_em INTEGER,
    ultima_msg_capitao_em INTEGER,
    respostas_bot_hora INTEGER NOT NULL DEFAULT 0,
    janela_hora INTEGER,
    escalada_em INTEGER,
    criado_em INTEGER NOT NULL,
    atualizado_em INTEGER NOT NULL
);

-- Histórico das conversas (também é a memória curta do LLM).
CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT NOT NULL,
    autor TEXT NOT NULL CHECK (autor IN ('cliente','bot','capitao','sistema')),
    texto TEXT NOT NULL,
    wa_message_id TEXT,
    criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mensagens_jid ON mensagens(jid, criado_em);

-- Mapa: mensagem que o bot mandou para o Erick -> conversa de origem.
-- É o que permite ao Erick responder CITANDO o aviso e o texto chegar no cliente.
CREATE TABLE IF NOT EXISTS relay_map (
    wa_message_id TEXT PRIMARY KEY,
    destino_jid TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);

-- Base de conhecimento que alimenta o LLM (perguntas frequentes editáveis).
CREATE TABLE IF NOT EXISTS conhecimento (
    id TEXT PRIMARY KEY,
    pergunta TEXT NOT NULL,
    resposta TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL DEFAULT 100
);

-- Bloqueio de datas (manutenção, mar ruim, compromisso do capitão).
CREATE TABLE IF NOT EXISTS bloqueios_agenda (
    data_passeio TEXT PRIMARY KEY,
    motivo TEXT,
    criado_em INTEGER NOT NULL
);
`);

// ---------------------------------------------------------------------------
// Migrações leves para bancos que já existem (instalação anterior)
// ---------------------------------------------------------------------------
function colunas(tabela) {
    return db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
}

function garantirColuna(tabela, coluna, definicao) {
    if (!colunas(tabela).includes(coluna)) {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
        log.info(`Migração: coluna ${tabela}.${coluna} adicionada.`);
    }
}

garantirColuna('reservas', 'valor_centavos', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('fila_envio', 'origem_jid', 'TEXT');
garantirColuna('roteiros', 'foto_url', 'TEXT');
garantirColuna('pagamentos', 'comprovante_arquivo', 'TEXT');
garantirColuna('pagamentos', 'comprovante_mime', 'TEXT');

// Banco antigo guardava o caminho público em comprovante_url: preserva o dado.
if (colunas('pagamentos').includes('comprovante_url')) {
    db.exec(`UPDATE pagamentos
             SET comprovante_arquivo = replace(comprovante_url, '/uploads/', '')
             WHERE comprovante_arquivo IS NULL AND comprovante_url IS NOT NULL`);
}

// ---------------------------------------------------------------------------
// Dados iniciais
// ---------------------------------------------------------------------------
const ROTEIROS_PADRAO = [
    ['rot-1', 'Rota da Caveira',
     'Passeio pelas ilhas e praias desertas da costa de Caravelas, com parada para banho.',
     15000, 240, 10],
    ['rot-2', 'Pôr do Sol Dourado',
     'Navegação no fim de tarde, quando o mar fica calmo e a luz vira ouro.',
     12000, 120, 10],
    ['rot-3', 'Expedição Submarina (Mergulho)',
     'Mergulho acompanhado de profissionais, explorando os recifes e a vida marinha da região.',
     25000, 360, 8],
    ['rot-4', 'Circuito de Base Comunitária',
     'Imersão cultural com almoço regional servido a bordo ou na casa de pescadores e marisqueiras da comunidade.',
     18000, 300, 10],
    ['rot-5', 'Acampamento de Sobrevivência',
     'Aventura de dois dias em base remota, com energia solar, rádio VHF e PX, e imersão total na natureza.',
     35000, 1440, 6]
];

const insRoteiro = db.prepare(`
    INSERT OR IGNORE INTO roteiros
        (id, nome, descricao, preco_centavos, duracao_min, capacidade_max)
    VALUES (?, ?, ?, ?, ?, ?)`);
db.transaction(() => ROTEIROS_PADRAO.forEach(r => insRoteiro.run(...r)))();

const CONHECIMENTO_PADRAO = [
    ['kb-local', 'Onde fica e ponto de encontro',
     'Saímos de Caravelas, no sul da Bahia. O ponto exato de encontro e o horário são combinados por aqui depois que a reserva é confirmada.', 10],
    ['kb-pagamento', 'Como pagar',
     'O pagamento é por Pix. Você faz a reserva pelo site, o sistema gera o QR Code na hora, você paga e envia o comprovante na mesma página. O capitão confere e você recebe a confirmação por aqui.', 20],
    ['kb-levar', 'O que levar',
     'Protetor solar, chapéu ou boné, roupa de banho, uma muda de roupa seca, toalha, remédio de enjoo se você costuma enjoar, e dinheiro trocado para consumo local. Água e colete salva-vidas são por nossa conta.', 30],
    ['kb-criancas', 'Crianças',
     'Crianças são bem-vindas acompanhadas dos responsáveis. Temos colete salva-vidas infantil. Para bebês de colo, fale com o capitão antes de reservar.', 40],
    ['kb-chuva', 'Chuva e mar ruim',
     'Segurança em primeiro lugar: se o mar não estiver bom, o passeio é remarcado sem custo, ou o valor é devolvido. Quem decide é o capitão, na véspera ou na hora.', 50],
    ['kb-cancelamento', 'Cancelamento',
     'Cancelando com mais de 48 horas de antecedência, devolvemos o valor integral. Com menos de 48 horas, o capitão avalia caso a caso.', 60],
    ['kb-mergulho', 'Mergulho',
     'A Expedição Submarina acompanha mergulhadores profissionais. Não precisa ter certificação para o mergulho batismal, mas avise se é a sua primeira vez.', 70],
    ['kb-abrolhos', 'Abrolhos',
     'Caravelas é a porta de entrada do Parque Nacional Marinho dos Abrolhos. A travessia até o arquipélago é longa e depende de autorização e de condições de mar: fale com o capitão para saber o que é possível na data que você quer.', 80]
];

const insKb = db.prepare(`
    INSERT OR IGNORE INTO conhecimento (id, pergunta, resposta, ordem)
    VALUES (?, ?, ?, ?)`);
db.transaction(() => CONHECIMENTO_PADRAO.forEach(k => insKb.run(...k)))();

log.info(`Banco pronto em ${path.join(dataDir, 'banco.db')}`);

module.exports = db;
