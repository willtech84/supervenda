PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  vendor_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (vendor_id, kind)
);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  endereco TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  cpfcnpj TEXT,
  pagamentoPadrao TEXT,
  prazoDias INTEGER DEFAULT 0,
  tags TEXT,
  obs TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  marca TEXT,
  produto TEXT NOT NULL,
  modelo TEXT,
  descricao TEXT,
  categoria TEXT,
  sku TEXT,
  agregados TEXT,
  valorCompra REAL DEFAULT 0,
  valorVenda REAL DEFAULT 0,
  estoqueAtual INTEGER DEFAULT 0,
  estoqueMin INTEGER DEFAULT 0,
  local TEXT,
  status TEXT DEFAULT 'ativo',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  data TEXT,
  clienteId TEXT NOT NULL,
  clienteNome TEXT,
  urgencia TEXT,
  formaPagamento TEXT,
  prazoDias INTEGER DEFAULT 0,
  status TEXT,
  obs TEXT,
  total REAL DEFAULT 0,
  itens TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS despesas (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  data TEXT,
  categoria TEXT,
  valor REAL DEFAULT 0,
  pagamento TEXT,
  obs TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lembretes (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  tipo TEXT,
  titulo TEXT,
  data TEXT,
  texto TEXT,
  status TEXT,
  clienteId TEXT,
  clienteNome TEXT,
  segmento TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notas (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  titulo TEXT,
  texto TEXT,
  fixada INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotas (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  data TEXT,
  obs TEXT,
  paradas TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clientes_vendor ON clientes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_produtos_vendor ON produtos(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendor  ON pedidos(vendor_id);
