-- SuperVenda Afiliados - Sprint 01
-- Aplicar somente no D1 local durante o desenvolvimento.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS afiliados_produtos (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  marca TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  produto_url TEXT NOT NULL,
  affiliate_url TEXT NOT NULL DEFAULT '',
  imagem_url TEXT NOT NULL DEFAULT '',
  preco_atual REAL NOT NULL DEFAULT 0,
  percentual_comissao REAL NOT NULL DEFAULT 0,
  comissao_estimada REAL NOT NULL DEFAULT 0,
  avaliacao REAL NOT NULL DEFAULT 0,
  quantidade_avaliacoes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'pausado', 'arquivado')),
  observacoes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  UNIQUE (vendor_id, produto_url)
);

CREATE INDEX IF NOT EXISTS idx_afiliados_produtos_vendor_updated
  ON afiliados_produtos(vendor_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_afiliados_produtos_vendor_categoria
  ON afiliados_produtos(vendor_id, categoria);

CREATE INDEX IF NOT EXISTS idx_afiliados_produtos_vendor_status
  ON afiliados_produtos(vendor_id, status);
