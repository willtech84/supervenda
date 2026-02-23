export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JWT_SECRET: string;
}

type AnyObj = Record<string, any>;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function bad(error: string, status = 400, extra?: AnyObj): Response {
  return json({ error, ...(extra || {}) }, status);
}

function nowISO(): string {
  return new Date().toISOString();
}

function pathParts(url: string): string[] {
  return new URL(url).pathname.split("/").filter(Boolean);
}

function rowsOf<T = AnyObj>(result: any): T[] {
  // Compatível com D1 .all() (results) e outras variações
  if (!result) return [];
  if (Array.isArray(result.results)) return result.results as T[];
  if (Array.isArray(result.rows)) return result.rows as T[];
  return [];
}

async function readJson(req: Request): Promise<AnyObj> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) return {};
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function parseJSONField<T = any>(v: any, fallback: T): T {
  try {
    if (v == null || v === "") return fallback;
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return fallback;
  }
}

/* =========================
   Crypto / token helpers
========================= */

function b64urlFromArrayBuffer(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
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
  return b64urlFromArrayBuffer(sig);
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeToken(env: Env, payload: AnyObj): Promise<string> {
  const body = b64urlFromString(JSON.stringify(payload));
  const sig = await hmacSha256(env.JWT_SECRET, body);
  return `${body}.${sig}`;
}

async function verifyToken(env: Env, token: string): Promise<AnyObj | null> {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;

  const expected = await hmacSha256(env.JWT_SECRET, body);
  if (expected !== sig) return null;

  let payload: AnyObj;
  try {
    payload = JSON.parse(fromB64url(body));
  } catch {
    return null;
  }

  if (payload.exp && Date.now() > Number(payload.exp)) return null;
  return payload;
}

async function auth(req: Request, env: Env): Promise<AnyObj | null> {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(env, m[1]);
}

/* =========================
   IDs / Counters
========================= */

async function nextId(
  env: Env,
  vendorId: string,
  kind:
    | "cliente"
    | "produto"
    | "pedido"
    | "despesa"
    | "lembrete"
    | "rota"
    | "nota"
): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM counters WHERE vendor_id=? AND kind=?"
  )
    .bind(vendorId, kind)
    .first<{ value: number }>();

  const next = (row?.value ?? 0) + 1;

  await env.DB.prepare(
    `
    INSERT INTO counters (vendor_id, kind, value)
    VALUES (?, ?, ?)
    ON CONFLICT(vendor_id, kind) DO UPDATE SET value = excluded.value
  `
  )
    .bind(vendorId, kind, next)
    .run();

  const prefixMap: Record<string, string> = {
    cliente: "CL",
    produto: "PR",
    pedido: "PD",
    despesa: "DS",
    lembrete: "LB",
    rota: "RT",
    nota: "NT",
  };

  return `${prefixMap[kind] || "ID"}-${String(next).padStart(6, "0")}`;
}

/* =========================
   Bootstrap helper
========================= */

async function getBootstrapData(env: Env, vendorId: string) {
  const [
    clientesR,
    produtosR,
    pedidosR,
    despesasR,
    lembretesR,
    notasR,
    rotasR,
  ] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
    env.DB.prepare(
      "SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC"
    )
      .bind(vendorId)
      .all(),
  ]);

  const clientes = rowsOf(clientesR).map((r: AnyObj) => ({
    ...r,
    tags: parseJSONField(r.tags, [] as string[]),
  }));

  const produtos = rowsOf(produtosR);

  const pedidos = rowsOf(pedidosR).map((r: AnyObj) => ({
    ...r,
    itens: parseJSONField(r.itens, [] as any[]),
  }));

  const despesas = rowsOf(despesasR);

  const lembretes = rowsOf(lembretesR);

  const notas = rowsOf(notasR).map((r: AnyObj) => ({
    ...r,
    fixada: !!r.fixada,
  }));

  const rotas = rowsOf(rotasR).map((r: AnyObj) => ({
    ...r,
    paradas: parseJSONField(r.paradas, [] as any[]),
  }));

  return { clientes, produtos, pedidos, despesas, lembretes, notas, rotas };
}

/* =========================
   Main Worker
========================= */

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      // Preflight (CORS)
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const p = pathParts(req.url);

      // Só atende /api/*
      if (p[0] !== "api") {
        return bad("Not found", 404);
      }

      // /api/health
      if (p[1] === "health") {
        return json({ ok: true, ts: nowISO() });
      }

      // /api/login (POST)
      if (p[1] === "login" && req.method === "POST") {
        try {
          const body = await readJson(req);
          const email = String(body.email || "").trim().toLowerCase();
          const senha = String(body.senha || "");

          if (!email || !senha) {
            return bad("Informe email e senha.", 400);
          }

          const v = await env.DB.prepare(
            `
            SELECT id, email, name, password_salt, password_hash
            FROM vendors
            WHERE lower(email) = lower(?)
            LIMIT 1
          `
          )
            .bind(email)
            .first<{
              id: string;
              email: string;
              name: string;
              password_salt: string;
              password_hash: string;
            }>();

          if (!v) {
            return bad("Usuário não encontrado.", 401);
          }

          // Hash esperado = sha256Hex(password_salt + senha)
          const calc = await sha256Hex(String(v.password_salt || "") + senha);

          if (calc !== String(v.password_hash || "")) {
            return bad("Senha inválida.", 401);
          }

          const token = await makeToken(env, {
            sub: v.id,
            email: v.email,
            name: v.name,
            exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 dias
          });

          return json({
            token,
            vendor: { id: v.id, email: v.email, name: v.name },
          });
        } catch (e: any) {
          console.error("LOGIN_ERROR", e?.message || e, e?.stack || "");
          return bad("Erro interno", 500, {
            where: "login",
            detail: String(e?.message || e || "unknown"),
          });
        }
      }

      // Daqui para frente exige auth
      const user = await auth(req, env);
      if (!user) {
        return bad("Não autorizado.", 401);
      }

      const vendorId = String(user.sub || "");

      // /api/me
      if (p[1] === "me") {
        return json({
          id: vendorId,
          email: user.email || "",
          name: user.name || "",
        });
      }

      // /api/bootstrap
      if (p[1] === "bootstrap") {
        const data = await getBootstrapData(env, vendorId);
        return json(data);
      }

      // /api/backup (POST)
      if (p[1] === "backup" && req.method === "POST") {
        const data = await getBootstrapData(env, vendorId);
        const key = `backup/${vendorId}/${new Date()
          .toISOString()
          .slice(0, 10)}/${Date.now()}.json`;

        await env.BACKUPS.put(key, JSON.stringify(data, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });

        return json({ ok: true, key });
      }

      /* =========================
         CLIENTES
      ========================= */
      if (p[1] === "clientes") {
        if (req.method === "POST") {
          const body = await readJson(req);
          const id =
            String(body.id || "").trim() || (await nextId(env, vendorId, "cliente"));

          const createdAt = nowISO();
          const updatedAt = nowISO();
          const tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);

          await env.DB.prepare(
            `
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
          `
          )
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
            .first<AnyObj>();

          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId)
            .run();
          return json({ ok: true });
        }
      }

      /* =========================
         Demais entidades (produtos/pedidos/despesas/lembretes/notas/rotas)
      ========================= */

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
        const id =
          String(body.id || "").trim() || (await nextId(env, vendorId, kind));

        const createdAt = nowISO();
        const updatedAt = nowISO();

        if (entity === "produtos") {
          await env.DB.prepare(
            `
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
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM produtos WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "pedidos") {
          const itens = JSON.stringify(Array.isArray(body.itens) ? body.itens : []);

          await env.DB.prepare(
            `
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
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM pedidos WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first<AnyObj>();

          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (entity === "despesas") {
          await env.DB.prepare(
            `
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
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM despesas WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "lembretes") {
          await env.DB.prepare(
            `
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
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM lembretes WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first();

          return json(row);
        }

        if (entity === "notas") {
          await env.DB.prepare(
            `
            INSERT INTO notas (
              id,vendor_id,titulo,texto,fixada,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              titulo=excluded.titulo,
              texto=excluded.texto,
              fixada=excluded.fixada,
              updated_at=excluded.updated_at
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM notas WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first<AnyObj>();

          return json({ ...row, fixada: !!row?.fixada });
        }

        if (entity === "rotas") {
          const paradas = JSON.stringify(
            Array.isArray(body.paradas) ? body.paradas : []
          );

          await env.DB.prepare(
            `
            INSERT INTO rotas (
              id,vendor_id,data,obs,paradas,updated_at,created_at
            )
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data,
              obs=excluded.obs,
              paradas=excluded.paradas,
              updated_at=excluded.updated_at
          `
          )
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

          const row = await env.DB.prepare(
            "SELECT * FROM rotas WHERE id=? AND vendor_id=?"
          )
            .bind(id, vendorId)
            .first<AnyObj>();

          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }
      }

      if (tableMap[entity] && req.method === "DELETE" && p[2]) {
        const table = tableMap[entity];
        // tabela vem de mapa fixo (seguro)
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND vendor_id=?`)
          .bind(p[2], vendorId)
          .run();
        return json({ ok: true });
      }

      return bad("Not found", 404);
    } catch (e: any) {
      console.error("WORKER_FATAL", e?.message || e, e?.stack || "");
      return bad("Erro interno", 500, {
        detail: String(e?.message || e || "unknown"),
      });
    }
  },
};

export default worker;
