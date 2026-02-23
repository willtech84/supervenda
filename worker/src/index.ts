export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JWT_SECRET: string;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function json(data: JsonValue | Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function bad(error: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error, ...(extra || {}) }, status);
}

function nowISO(): string {
  return new Date().toISOString();
}

function parts(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean);
}

async function readJson(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return {};
  try {
    return (await req.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

function parseJSONField<T>(v: unknown, fallback: T): T {
  try {
    if (typeof v !== "string" || !v) return fallback;
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function b64urlFromBytes(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlFromString(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s: string): string {
  let v = s.replace(/-/g, "+").replace(/_/g, "/");
  while (v.length % 4) v += "=";
  return atob(v);
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64urlFromBytes(sig);
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeToken(env: Env, payload: Record<string, any>): Promise<string> {
  if (!env.JWT_SECRET || !String(env.JWT_SECRET).trim()) {
    throw new Error("JWT_SECRET não configurado");
  }
  const body = b64urlFromString(JSON.stringify(payload));
  const sig = await hmacSha256(String(env.JWT_SECRET), body);
  return `${body}.${sig}`;
}

async function verifyToken(env: Env, token: string): Promise<any | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  if (!env.JWT_SECRET || !String(env.JWT_SECRET).trim()) return null;

  const expected = await hmacSha256(String(env.JWT_SECRET), body);
  if (expected !== sig) return null;

  try {
    const payload = JSON.parse(fromB64url(body));
    if (payload?.exp && Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function auth(req: Request, env: Env): Promise<any | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(env, m[1]);
}

async function nextId(
  env: Env,
  vendorId: string,
  kind: "cliente" | "produto" | "pedido" | "despesa" | "lembrete" | "rota" | "nota"
): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM counters WHERE vendor_id=? AND kind=?"
  ).bind(vendorId, kind).first<{ value: number }>();

  const next = (row?.value ?? 0) + 1;

  await env.DB.prepare(`
    INSERT INTO counters (vendor_id, kind, value)
    VALUES (?, ?, ?)
    ON CONFLICT(vendor_id, kind) DO UPDATE SET value = excluded.value
  `).bind(vendorId, kind, next).run();

  const prefix: Record<string, string> = {
    cliente: "CL",
    produto: "PR",
    pedido: "PD",
    despesa: "DS",
    lembrete: "LB",
    rota: "RT",
    nota: "NT",
  };

  return `${prefix[kind] ?? "ID"}-${String(next).padStart(6, "0")}`;
}

async function handleApi(req: Request, env: Env): Promise<Response> {
  const p = parts(req.url);

  // /api/...
  if (p[0] !== "api") return bad("Not found", 404);

  // Health (público)
  if (p[1] === "health") {
    return json({ ok: true, ts: nowISO() });
  }

  // Login (público)
  if (p[1] === "login" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const senha = String(body.senha ?? "");

      if (!email || !senha) {
        return bad("Informe email e senha.", 400);
      }

      const v = await env.DB.prepare(
        "SELECT id, email, name, password_salt, password_hash FROM vendors WHERE lower(email)=?"
      ).bind(email).first<{
        id: string;
        email: string;
        name: string;
        password_salt: string;
        password_hash: string;
      }>();

      if (!v) return bad("Usuário não encontrado.", 401);

      const salt = String(v.password_salt ?? "");
      const hash = String(v.password_hash ?? "");

      if (!salt || !hash) {
        return bad("Credenciais inválidas (registro incompleto).", 401);
      }

      // padrão usado no seu backend anterior: sha256Hex(salt + senha)
      const calc = await sha256Hex(`${salt}${senha}`);
      if (calc !== hash) return bad("Senha inválida.", 401);

      const token = await makeToken(env, {
        sub: String(v.id),
        email: String(v.email),
        name: String(v.name ?? ""),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
      });

      return json({
        token,
        vendor: {
          id: v.id,
          email: v.email,
          name: v.name,
        },
      });
    } catch (e: any) {
      return bad("Erro interno", 500, { detail: String(e?.message || e) });
    }
  }

  // Demais rotas exigem auth
  const user = await auth(req, env);
  if (!user) return bad("Não autorizado.", 401);

  const vendorId = String(user.sub ?? "");

  if (!vendorId) return bad("Token inválido.", 401);

  if (p[1] === "me") {
    return json({
      id: vendorId,
      email: String(user.email ?? ""),
      name: String(user.name ?? ""),
    });
  }

  if (p[1] === "bootstrap") {
    const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] = await Promise.all([
      env.DB.prepare("SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
    ]);

    return json({
      clientes: (clientes.results || []).map((r: any) => ({ ...r, tags: parseJSONField(r.tags, []) })),
      produtos: produtos.results || [],
      pedidos: (pedidos.results || []).map((r: any) => ({ ...r, itens: parseJSONField(r.itens, []) })),
      despesas: despesas.results || [],
      lembretes: lembretes.results || [],
      notas: (notas.results || []).map((r: any) => ({ ...r, fixada: !!r.fixada })),
      rotas: (rotas.results || []).map((r: any) => ({ ...r, paradas: parseJSONField(r.paradas, []) })),
    });
  }

  if (p[1] === "backup" && req.method === "POST") {
    const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] = await Promise.all([
      env.DB.prepare("SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
      env.DB.prepare("SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all<any>(),
    ]);

    const data = {
      clientes: (clientes.results || []).map((r: any) => ({ ...r, tags: parseJSONField(r.tags, []) })),
      produtos: produtos.results || [],
      pedidos: (pedidos.results || []).map((r: any) => ({ ...r, itens: parseJSONField(r.itens, []) })),
      despesas: despesas.results || [],
      lembretes: lembretes.results || [],
      notas: (notas.results || []).map((r: any) => ({ ...r, fixada: !!r.fixada })),
      rotas: (rotas.results || []).map((r: any) => ({ ...r, paradas: parseJSONField(r.paradas, []) })),
      generated_at: nowISO(),
      vendor_id: vendorId,
    };

    const key = `backup/${vendorId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
    await env.BACKUPS.put(key, JSON.stringify(data, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return json({ ok: true, key });
  }

  // Clientes (CRUD)
  if (p[1] === "clientes") {
    if (req.method === "POST") {
      const body = await readJson(req);
      const id = String(body.id ?? "").trim() || (await nextId(env, vendorId, "cliente"));
      const createdAt = nowISO();
      const updatedAt = nowISO();
      const tags = JSON.stringify(body.tags || []);

      await env.DB.prepare(`
        INSERT INTO clientes (
          id,vendor_id,nome,telefone,endereco,numero,bairro,cidade,uf,cep,cpfcnpj,pagamentoPadrao,prazoDias,tags,obs,updated_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          nome=excluded.nome,
          telefone=excluded.telefone,
          endereco=excluded.endereco,
          numero=excluded.numero,
          bairro=excluded.bairro,
          cidade=excluded.cidade,
          uf=excluded.uf,
          cep=excluded.cep,
          cpfcnpj=excluded.cpfcnpj,
          pagamentoPadrao=excluded.pagamentoPadrao,
          prazoDias=excluded.prazoDias,
          tags=excluded.tags,
          obs=excluded.obs,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.nome || ""),
        String(body.telefone || ""),
        String(body.endereco || ""),
        String(body.numero || ""),
        String(body.bairro || ""),
        String(body.cidade || ""),
        String(body.uf || ""),
        String(body.cep || ""),
        String(body.cpfcnpj || ""),
        String(body.pagamentoPadrao || ""),
        Number(body.prazoDias || 0),
        tags,
        String(body.obs || ""),
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();

      return json({ ...row, tags: parseJSONField(row?.tags, []) });
    }

    if (req.method === "DELETE" && p[2]) {
      await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
        .bind(String(p[2]), vendorId)
        .run();
      return json({ ok: true });
    }
  }

  // Outras entidades
  const entity = p[1];
  const map: Record<string, string> = {
    produtos: "produtos",
    pedidos: "pedidos",
    despesas: "despesas",
    lembretes: "lembretes",
    notas: "notas",
    rotas: "rotas",
  };

  if (map[entity] && req.method === "POST") {
    const body = await readJson(req);

    const kindMap: Record<string, "produto" | "pedido" | "despesa" | "lembrete" | "nota" | "rota"> = {
      produtos: "produto",
      pedidos: "pedido",
      despesas: "despesa",
      lembretes: "lembrete",
      notas: "nota",
      rotas: "rota",
    };

    const id = String(body.id ?? "").trim() || (await nextId(env, vendorId, kindMap[entity]));
    const createdAt = nowISO();
    const updatedAt = nowISO();

    if (entity === "produtos") {
      await env.DB.prepare(`
        INSERT INTO produtos (
          id,vendor_id,marca,produto,modelo,descricao,categoria,sku,agregados,valorCompra,valorVenda,estoqueAtual,estoqueMin,local,status,updated_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          marca=excluded.marca,
          produto=excluded.produto,
          modelo=excluded.modelo,
          descricao=excluded.descricao,
          categoria=excluded.categoria,
          sku=excluded.sku,
          agregados=excluded.agregados,
          valorCompra=excluded.valorCompra,
          valorVenda=excluded.valorVenda,
          estoqueAtual=excluded.estoqueAtual,
          estoqueMin=excluded.estoqueMin,
          local=excluded.local,
          status=excluded.status,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.marca || ""),
        String(body.produto || ""),
        String(body.modelo || ""),
        String(body.descricao || ""),
        String(body.categoria || ""),
        String(body.sku || ""),
        String(body.agregados || ""),
        Number(body.valorCompra || 0),
        Number(body.valorVenda || 0),
        Number(body.estoqueAtual || 0),
        Number(body.estoqueMin || 0),
        String(body.local || ""),
        String(body.status || "ativo"),
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM produtos WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();
      return json(row || {});
    }

    if (entity === "pedidos") {
      const itens = JSON.stringify(body.itens || []);

      await env.DB.prepare(`
        INSERT INTO pedidos (
          id,vendor_id,data,clienteId,clienteNome,urgencia,formaPagamento,prazoDias,status,obs,total,itens,updated_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          data=excluded.data,
          clienteId=excluded.clienteId,
          clienteNome=excluded.clienteNome,
          urgencia=excluded.urgencia,
          formaPagamento=excluded.formaPagamento,
          prazoDias=excluded.prazoDias,
          status=excluded.status,
          obs=excluded.obs,
          total=excluded.total,
          itens=excluded.itens,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.data || ""),
        String(body.clienteId || ""),
        String(body.clienteNome || ""),
        String(body.urgencia || ""),
        String(body.formaPagamento || ""),
        Number(body.prazoDias || 0),
        String(body.status || ""),
        String(body.obs || ""),
        Number(body.total || 0),
        itens,
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();
      return json({ ...row, itens: parseJSONField(row?.itens, []) });
    }

    if (entity === "despesas") {
      await env.DB.prepare(`
        INSERT INTO despesas (id,vendor_id,data,categoria,valor,pagamento,obs,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          data=excluded.data,
          categoria=excluded.categoria,
          valor=excluded.valor,
          pagamento=excluded.pagamento,
          obs=excluded.obs,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.data || ""),
        String(body.categoria || ""),
        Number(body.valor || 0),
        String(body.pagamento || ""),
        String(body.obs || ""),
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();
      return json(row || {});
    }

    if (entity === "lembretes") {
      await env.DB.prepare(`
        INSERT INTO lembretes (
          id,vendor_id,tipo,titulo,data,texto,status,clienteId,clienteNome,segmento,updated_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          tipo=excluded.tipo,
          titulo=excluded.titulo,
          data=excluded.data,
          texto=excluded.texto,
          status=excluded.status,
          clienteId=excluded.clienteId,
          clienteNome=excluded.clienteNome,
          segmento=excluded.segmento,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.tipo || ""),
        String(body.titulo || ""),
        String(body.data || ""),
        String(body.texto || ""),
        String(body.status || "pendente"),
        String(body.clienteId || ""),
        String(body.clienteNome || ""),
        String(body.segmento || ""),
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();
      return json(row || {});
    }

    if (entity === "notas") {
      await env.DB.prepare(`
        INSERT INTO notas (id,vendor_id,titulo,texto,fixada,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          titulo=excluded.titulo,
          texto=excluded.texto,
          fixada=excluded.fixada,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.titulo || ""),
        String(body.texto || ""),
        body.fixada ? 1 : 0,
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();

      return json({ ...row, fixada: !!row?.fixada });
    }

    if (entity === "rotas") {
      const paradas = JSON.stringify(body.paradas || []);

      await env.DB.prepare(`
        INSERT INTO rotas (id,vendor_id,data,obs,paradas,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          data=excluded.data,
          obs=excluded.obs,
          paradas=excluded.paradas,
          updated_at=excluded.updated_at
      `).bind(
        id,
        vendorId,
        String(body.data || ""),
        String(body.obs || ""),
        paradas,
        updatedAt,
        createdAt
      ).run();

      const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
        .bind(id, vendorId)
        .first<any>();

      return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
    }
  }

  if (map[entity] && req.method === "DELETE" && p[2]) {
    // tabela vem de mapa fixo (sem risco de injection)
    const table = map[entity];
    await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND vendor_id=?`)
      .bind(String(p[2]), vendorId)
      .run();
    return json({ ok: true });
  }

  return bad("Not found", 404);
}

const worker: ExportedHandler<Env> = {
  async fetch(req, env) {
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      return await handleApi(req, env);
    } catch (e: any) {
      // garante CORS até no erro 500
      return bad("Erro interno", 500, {
        detail: String(e?.message || e),
      });
    }
  },
};

export default worker;
