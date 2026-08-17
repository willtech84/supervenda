-- Sem esses índices compostos, "WHERE vendor_id=? AND updated_at > ?" ainda
-- escaneia TODAS as linhas do vendor (o índice em vendor_id sozinho não ajuda
-- a pular linhas não alteradas) — por isso o "rows_read" não caiu mesmo com
-- o sync incremental. Com o índice composto, o D1 vai direto pro intervalo
-- de linhas alteradas, sem escanear o resto.
CREATE INDEX IF NOT EXISTS idx_clientes_vendor_updated   ON clientes(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_produtos_vendor_updated   ON produtos(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_pedidos_vendor_updated    ON pedidos(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_despesas_vendor_updated   ON despesas(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_lembretes_vendor_updated  ON lembretes(vendor_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_rotas_vendor_updated      ON rotas(vendor_id, updated_at);
