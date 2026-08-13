-- Rastreia exclusões para permitir sync incremental no app
-- (sem isso, o client nunca saberia que um item sumiu ao buscar só "o que mudou")
CREATE TABLE IF NOT EXISTS exclusoes (
  vendor_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  item_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exclusoes_vendor ON exclusoes(vendor_id, resource, deleted_at);
