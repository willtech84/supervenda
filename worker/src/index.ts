export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JWT_SECRET: string;
}

type JsonRecord = Record<string, any>;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function bad(error: string, status = 400): Response {
  return json({ error }, status);
}

function nowISO(): string {
  return new Date().toISOString();
}

function parts(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean);
}

async function readJson(req: Request): Promise<JsonRecord> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {};
  try {
    return (await req.json()) as JsonRecord;
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

/* =========================
   Auth / Token (HMAC simple JWT-like)
   ========================= */

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
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function hmac(secret: string, msg: string): Promise<string> {
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

type TokenPayload = {
  sub: string;
  email: string;
  name: string;
  exp?: number;
};

async function makeToken(env: Env, payload: TokenPayload): Promise<string> {
  const body = b64urlFromString(JSON.stringify(payload));
  const sig = await hmac(env.JWT_SECRET, body);
  return `${body}.${sig}`;
}

async function verifyToken(env: Env, token: string): Promise<TokenPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(env.JWT_SECRET, body);
  if (sig !== expected) return null;

  try {
    const payload = JSON.parse(fromB64url(body)) as TokenPayload;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function auth(req: Request, env: Env): Promise<TokenPayload | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(env, m[1]);
}

/* =========================
   Helpers
   ========================= */

async function nextId(
  env: Env,
  vendorId: string,
  kind: "cliente" | "produto" | "pedido" | "despesa" | "lembrete" | "rota" | "nota"
): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM counters WHERE vendor_id=? AND kind=?"
  )
    .bind(vendorId, kind)
    .first<{ value: number }>();

  const next = (row?.value ?? 0) + 1;

  await env.DB.prepare(`
    INSERT INTO counters (vendor_id, kind, value)
    VALUES (?, ?, ?)
    ON CONFLICT(vendor_id, kind) DO UPDATE SET value = excluded.value
  `)
    .bind(vendorId, kind, next)
    .run();

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

async function bootstrapData(env: Env, vendorId: string) {
  const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] =
    await Promise.all([
      env.DB.prepare("SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
      env.DB.prepare("SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC")
        .bind(vendorId)
        .all(),
    ]);

  return {
    clientes: (clientes.results || []).map((r: any) => ({
      ...r,
      tags: parseJSONField<string[]>(r.tags, []),
    })),
    produtos: produtos.results || [],
    pedidos: (pedidos.results || []).map((r: any) => ({
      ...r,
      itens: parseJSONField<any[]>(r.itens, []),
    })),
    despesas: despesas.results || [],
    lembretes: lembretes.results || [],
    notas: (notas.results || []).map((r: any) => ({
      ...r,
      fixada: !!r.fixada,
    })),
    rotas: (rotas.results || []).map((r: any) => ({
      ...r,
      paradas: parseJSONField<any[]>(r.paradas, []),
    })),
  };
}

/* =========================
   Worker
   ========================= */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const p = parts(req.url);

      // Tudo é /api/...
      if (p[0] !== "api") return bad("Not found", 404);

      // /api/health
      if (p[1] === "health") {
        return json({ ok: true, ts: nowISO() });
      }

      // /api/login (sem auth)
      if (p[1] === "login" && req.method === "POST") {
        const body = await readJson(req);
        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        if (!email || !senha) {
          return bad("Informe email e senha.", 400);
        }

        const vendor = await env.DB.prepare(`
          SELECT id, email, name, password_salt, password_hash
          FROM vendors
          WHERE email = ?
          LIMIT 1
        `)
          .bind(email)
          .first<{
            id: string;
            email: string;
            name: string;
            password_salt: string;
            password_hash: string;
          }>();

        if (!vendor) return bad("Usuário não encontrado.", 401);

        const calc = await sha256Hex(vendor.password_salt + senha);
        if (calc !== vendor.password_hash) {
          return bad("Senha inválida.", 401);
        }

        const token = await makeToken(env, {
          sub: String(vendor.id),
          email: vendor.email,
          name: vendor.name,
          exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 dias
        });

        return json({
          token,
          vendor: {
            id: vendor.id,
            email: vendor.email,
            name: vendor.name,
          },
        });
      }

      // Demais rotas exigem auth
      const user = await auth(req, env);
      if (!user) return bad("Não autorizado.", 401);

      const vendorId = String(user.sub);

      // /api/me
      if (p[1] === "me") {
        return json({ id: vendorId, email: user.email, name: user.name });
      }

      // /api/bootstrap
      if (p[1] === "bootstrap") {
        const data = await bootstrapData(env, vendorId);
        return json(data);
      }

      // /api/backup
      if (p[1] === "backup" && req.method === "POST") {
        const data = await bootstrapData(env, vendorId);
        const key = `backup/${vendorId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;

        await env.BACKUPS.put(key, JSON.stringify(data, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });

        return json({ ok: true, key });
      }

      // /api/clientes
      if (p[1] === "clientes") {
        if (req.method === "POST") {
          const body = await readJson(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "cliente"));
          const createdAt = nowISO();
          const updatedAt = nowISO();
          const tags = JSON.stringify(body.tags || []);

          await env.DB.prepare(`
            INSERT INTO clientes (
              id,vendor_id,nome,telefone,endereco,numero,bairro,cidade,uf,cep,cpfcnpj,
              pagamentoPadrao,prazoDias,tags,obs,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          `)
            .bind(
              id,
              vendorId,
              body.nome || "",
              body.telefone || "",
              body.endereco || "",
              body.numero || "",
              body.bairro || "",
              body.cidade || "",
              body.uf || "",
              body.cep || "",
              body.cpfcnpj || "",
              body.pagamentoPadrao || "",
              Number(body.prazoDias || 0),
              tags,
              body.obs || "",
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare(
            "SELECT * FROM clientes WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first<any>();

          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId)
            .run();
          return json({ ok: true });
        }

        return bad("Método não suportado para clientes.", 405);
      }

      // Entidades genéricas
      const entity = p[1];
      const tableMap: Record<string, string> = {
        produtos: "produtos",
        pedidos: "pedidos",
        despesas: "despesas",
        lembretes: "lembretes",
        notas: "notas",
        rotas: "rotas",
      };

      if (tableMap[entity] && req.method === "POST") {
        const body = await readJson(req);

        const kindMap: Record<string, any> = {
          produtos: "produto",
          pedidos: "pedido",
          despesas: "despesa",
          lembretes: "lembrete",
          notas: "nota",
          rotas: "rota",
        };

        const kind = kindMap[entity];
        const id = String(body.id || "").trim() || (await nextId(env, vendorId, kind));
        const createdAt = nowISO();
        const updatedAt = nowISO();

        if (entity === "produtos") {
          await env.DB.prepare(`
            INSERT INTO produtos (
              id,vendor_id,marca,produto,modelo,descricao,categoria,sku,agregados,
              valorCompra,valorVenda,estoqueAtual,estoqueMin,local,status,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          `)
            .bind(
              id,
              vendorId,
              body.marca || "",
              body.produto || "",
              body.modelo || "",
              body.descricao || "",
              body.categoria || "",
              body.sku || "",
              body.agregados || "",
              Number(body.valorCompra || 0),
              Number(body.valorVenda || 0),
              Number(body.estoqueAtual || 0),
              Number(body.estoqueMin || 0),
              body.local || "",
              body.status || "ativo",
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM produtos WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "pedidos") {
          const itens = JSON.stringify(body.itens || []);

          await env.DB.prepare(`
            INSERT INTO pedidos (
              id,vendor_id,data,clienteId,clienteNome,urgencia,formaPagamento,prazoDias,
              status,obs,total,itens,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          `)
            .bind(
              id,
              vendorId,
              body.data || "",
              body.clienteId || "",
              body.clienteNome || "",
              body.urgencia || "",
              body.formaPagamento || "",
              Number(body.prazoDias || 0),
              body.status || "",
              body.obs || "",
              Number(body.total || 0),
              itens,
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first<any>();

          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (entity === "despesas") {
          await env.DB.prepare(`
            INSERT INTO despesas (
              id,vendor_id,data,categoria,valor,pagamento,obs,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data,
              categoria=excluded.categoria,
              valor=excluded.valor,
              pagamento=excluded.pagamento,
              obs=excluded.obs,
              updated_at=excluded.updated_at
          `)
            .bind(
              id,
              vendorId,
              body.data || "",
              body.categoria || "",
              Number(body.valor || 0),
              body.pagamento || "",
              body.obs || "",
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "lembretes") {
          await env.DB.prepare(`
            INSERT INTO lembretes (
              id,vendor_id,tipo,titulo,data,texto,status,clienteId,clienteNome,segmento,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
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
          `)
            .bind(
              id,
              vendorId,
              body.tipo || "",
              body.titulo || "",
              body.data || "",
              body.texto || "",
              body.status || "pendente",
              body.clienteId || "",
              body.clienteNome || "",
              body.segmento || "",
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "notas") {
          await env.DB.prepare(`
            INSERT INTO notas (
              id,vendor_id,titulo,texto,fixada,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              titulo=excluded.titulo,
              texto=excluded.texto,
              fixada=excluded.fixada,
              updated_at=excluded.updated_at
          `)
            .bind(
              id,
              vendorId,
              body.titulo || "",
              body.texto || "",
              body.fixada ? 1 : 0,
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first<any>();

          return json({ ...row, fixada: !!row?.fixada });
        }

        if (entity === "rotas") {
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(`
            INSERT INTO rotas (
              id,vendor_id,data,obs,paradas,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data,
              obs=excluded.obs,
              paradas=excluded.paradas,
              updated_at=excluded.updated_at
          `)
            .bind(
              id,
              vendorId,
              body.data || "",
              body.obs || "",
              paradas,
              updatedAt,
              createdAt
            )
            .run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId)
            .first<any>();

          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }
      }

      // DELETE genérico
      if (tableMap[entity] && req.method === "DELETE" && p[2]) {
        // whitelist de tabela evita injection
        const table = tableMap[entity];
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND vendor_id=?`)
          .bind(p[2], vendorId)
          .run();
        return json({ ok: true });
      }

      return bad("Not found", 404);
    } catch (e: any) {
      return json(
        {
          error: "Erro interno.",
          detail: String(e?.message || e),
        },
        500
      );
    }
  },
};
