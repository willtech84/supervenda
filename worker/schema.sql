PRAGMA foreign_keys = ON;

-- Vendors (vendedores/usuários)
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
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
  telefone TEXT NOT NULL DEFAULT '',
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
  clienteId TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_despesas_vendor  ON despesas(vendor_id);
CREATE INDEX IF NOT EXISTS idx_lembretes_vendor ON lembretes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rotas_vendor ON rotas(vendor_id);

-- Índices compostos para sync incremental (WHERE vendor_id=? AND updated_at > ?)
-- sem eles, o índice simples em vendor_id não evita escanear todas as linhas do vendor
CREATE INDEX IF NOT EXISTS idx_clientes_vendor_updated   ON clientes(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_produtos_vendor_updated   ON produtos(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendor_updated    ON pedidos(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_despesas_vendor_updated   ON despesas(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_lembretes_vendor_updated  ON lembretes(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_rotas_vendor_updated      ON rotas(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notas_vendor ON notas(vendor_id);
