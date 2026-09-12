const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'banco.db'));
db.pragma('journal_mode = WAL'); // Melhor performance para concorrência simples

// Inicialização das tabelas
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
    ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    roteiro_id TEXT NOT NULL,
    data_passeio TEXT NOT NULL, -- formato YYYY-MM-DD
    num_pessoas INTEGER NOT NULL,
    observacoes TEXT,
    status TEXT NOT NULL CHECK (status IN ('pendente','confirmada','cancelada','concluida')),
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(roteiro_id) REFERENCES roteiros(id)
);

CREATE TABLE IF NOT EXISTS pagamentos (
    id TEXT PRIMARY KEY,
    reserva_id TEXT NOT NULL,
    metodo TEXT NOT NULL CHECK (metodo IN ('pix')),
    chave_pix_usada TEXT,
    valor_centavos INTEGER NOT NULL,
    comprovante_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('aguardando_comprovante','aguardando_confirmacao','confirmado_manual','recusado')),
    confirmado_por TEXT,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(reserva_id) REFERENCES reservas(id)
);

CREATE TABLE IF NOT EXISTS depoimentos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    reserva_id TEXT NOT NULL,
    texto TEXT,
    foto_url TEXT,
    aprovado INTEGER DEFAULT 0,
    criado_em INTEGER NOT NULL,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id),
    FOREIGN KEY(reserva_id) REFERENCES reservas(id)
);

CREATE TABLE IF NOT EXISTS clube_mar (
    id TEXT PRIMARY KEY,
    cliente_id TEXT UNIQUE NOT NULL,
    inscrito_em INTEGER NOT NULL,
    ativo INTEGER DEFAULT 1,
    FOREIGN KEY(cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS admin_usuarios (
    id TEXT PRIMARY KEY,
    usuario TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS logs_acesso (
    id TEXT PRIMARY KEY,
    cliente_id TEXT,
    acao TEXT NOT NULL,
    detalhes_json TEXT,
    criado_em INTEGER NOT NULL
);
`);

// Popula o banco com os roteiros padrão se não existirem
const roteirosCount = db.prepare('SELECT COUNT(*) as count FROM roteiros').get().count;
if (roteirosCount === 0) {
    const stmt = db.prepare('INSERT INTO roteiros (id, nome, descricao, preco_centavos, duracao_min, capacidade_max) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run('rot-1', 'Rota da Caveira', 'Passeio pelas ilhas misteriosas e praias desertas.', 15000, 240, 10);
    stmt.run('rot-2', 'Pôr do Sol Dourado', 'Navegação romântica no fim de tarde.', 12000, 120, 10);
    stmt.run('rot-3', 'Expedição Submarina (Mergulho)', 'Passeio com mergulhadores e exploração subaquática pelas belezas marinhas.', 25000, 360, 8);
    stmt.run('rot-4', 'Circuito de Base Comunitária', 'Imersão cultural com almoço regional servido no barco ou na casa de pescadores/marisqueiras locais.', 18000, 300, 10);
    stmt.run('rot-5', 'Acampamento de Sobrevivência', 'Aventura de sobrevivência com apoio de Rádio VHF/PX, painéis solares e imersão total na natureza.', 35000, 1440, 6);
    console.log('[Banco] Roteiros padrão inseridos com sucesso.');
} else {
    // Caso o banco já tenha os antigos, inserimos os novos (ignorando se der conflito na chave, embora geramos chaves novas)
    const stmt = db.prepare('INSERT OR IGNORE INTO roteiros (id, nome, descricao, preco_centavos, duracao_min, capacidade_max) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run('rot-3', 'Expedição Submarina (Mergulho)', 'Passeio com mergulhadores e exploração subaquática pelas belezas marinhas.', 25000, 360, 8);
    stmt.run('rot-4', 'Circuito de Base Comunitária', 'Imersão cultural com almoço regional servido no barco ou na casa de pescadores/marisqueiras locais.', 18000, 300, 10);
    stmt.run('rot-5', 'Acampamento de Sobrevivência', 'Aventura de sobrevivência com apoio de Rádio VHF/PX, painéis solares e imersão total na natureza.', 35000, 1440, 6);
}

module.exports = db;
