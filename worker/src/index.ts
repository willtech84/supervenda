export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  BACKUPS?: R2Bucket;
}

type JsonValue = any;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function withCors(headers?: HeadersInit) {
  return { ...CORS_HEADERS, ...(headers || {}) };
}

function json(data: JsonValue, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors({
      "content-type": "application/json; charset=utf-8",
      ...(headers || {}),
    }),
  });
}

function text(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, { status, headers: withCors(headers) });
}

function bad(error: string, status = 400) {
  return json({ error }, status);
}

function nowISO() {
  return new Date().toISOString();
}

function parts(url: string) {
  return new URL(url).pathname.split("/").filter(Boolean);
}

async function readJson(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) return {};
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** base64url helpers */
function b64url(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlStr(s: string) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function hmac(secret: string, msg: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return b64url(sig);
}

async function sha256Hex(s: string) {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeToken(env: Env, payload: any) {
  const body = b64urlStr(JSON.stringify(payload));
  const sig = await hmac(env.JWT_SECRET, body);
  return `${body}.${sig}`;
}

async function verifyToken(env: Env, token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const exp = await hmac(env.JWT_SECRET, body);
  if (exp !== sig) return null;

  let payload: any;
  try {
    payload = JSON.parse(fromB64url(body));
  } catch {
    return null;
  }
  if (payload?.exp && Date.now() > payload.exp) return null;
  return payload;
}

async function auth(req: Request, env: Env) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(env, m[1]);
}

function parseJSONField<T>(v: any, fallback: T): T {
  try {
    if (!v) return fallback;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function nextId(env: Env, vendorId: string, kind: string) {
  const row = await env.DB.prepare(
    "SELECT value FROM counters WHERE vendor_id=? AND kind=?"
  )
    .bind(vendorId, kind)
    .first<{ value: number }>();

  const next = (row?.value ?? 0) + 1;

  await env.DB.prepare(
    `INSERT INTO counters (vendor_id, kind, value)
     VALUES (?,?,?)
     ON CONFLICT(vendor_id,kind) DO UPDATE SET value=excluded.value`
  )
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
    vendor: "VD",
  };

  return `${prefix[kind] || "ID"}-${String(next).padStart(6, "0")}`;
}

function pickApiPath(p: string[]) {
  // esperados:
  // /api/health
  // /api/login
  // /api/bootstrap
  // /api/me
  // /api/clientes/:id?
  // /api/produtos/:id?
  // ...
  if (p[0] !== "api") return null;
  return p.slice(1);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: withCors() });
      }

      const p = parts(req.url);
      const api = pickApiPath(p);

      // Root ou qualquer coisa fora de /api
      if (!api) {
        return json({ error: "Not found" }, 404);
      }

      // /api/health
      if (api[0] === "health") {
        return json({ ok: true, ts: nowISO() });
      }

      // /api/login (sem auth)
      if (api[0] === "login" && req.method === "POST") {
        const body: any = await readJson(req);
        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        if (!email || !senha) return bad("Informe email e senha.", 400);

        const v = await env.DB.prepare(
          "SELECT id,email,name,password_salt,password_hash FROM vendors WHERE email=?"
        )
          .bind(email)
          .first<any>();

        if (!v) return bad("Usuário não encontrado.", 401);

        const calc = await sha256Hex(String(v.password_salt) + senha);
        if (calc !== String(v.password_hash)) return bad("Senha inválida.", 401);

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
      }

      // Tudo abaixo precisa de auth
      const user = await auth(req, env);
      if (!user) return bad("Não autorizado.", 401);

      const vendorId = String(user.sub);

      // /api/me
      if (api[0] === "me") {
        return json({ id: vendorId, email: user.email, name: user.name });
      }

      // /api/bootstrap
      if (api[0] === "bootstrap") {
        const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] =
          await Promise.all([
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

        return json({
          clientes: (clientes.results || []).map((r: any) => ({
            ...r,
            tags: parseJSONField(r.tags, []),
          })),
          produtos: produtos.results || [],
          pedidos: (pedidos.results || []).map((r: any) => ({
            ...r,
            itens: parseJSONField(r.itens, []),
          })),
          despesas: despesas.results || [],
          lembretes: lembretes.results || [],
          notas: (notas.results || []).map((r: any) => ({
            ...r,
            fixada: !!r.fixada,
          })),
          rotas: (rotas.results || []).map((r: any) => ({
            ...r,
            paradas: parseJSONField(r.paradas, []),
          })),
        });
      }

      // /api/backup (opcional R2)
      if (api[0] === "backup" && req.method === "POST") {
        if (!env.BACKUPS) return bad("BACKUPS (R2) não configurado.", 500);

        // chama o bootstrap com o MESMO Authorization
        const bootstrapReq = new Request(new URL("/api/bootstrap", req.url), {
          headers: req.headers,
        });
        const data = await (await this.fetch(bootstrapReq, env)).json();

        const key = `backup/${vendorId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
        await env.BACKUPS.put(key, JSON.stringify(data, null, 2), {
          httpMetadata: { contentType: "application/json" },
        });

        return json({ ok: true, key });
      }

      // ===== CRUD =====

      // /api/clientes
      if (api[0] === "clientes") {
        // UPSERT
        if (req.method === "POST") {
          const body: any = await readJson(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "cliente"));
          const createdAt = nowISO();
          const updatedAt = nowISO();
          const tags = JSON.stringify(body.tags || []);

          await env.DB.prepare(
            `
            INSERT INTO clientes
              (id,vendor_id,nome,telefone,endereco,numero,bairro,cidade,uf,cep,cpfcnpj,pagamentoPadrao,prazoDias,tags,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome, telefone=excluded.telefone, endereco=excluded.endereco, numero=excluded.numero, bairro=excluded.bairro,
              cidade=excluded.cidade, uf=excluded.uf, cep=excluded.cep, cpfcnpj=excluded.cpfcnpj, pagamentoPadrao=excluded.pagamentoPadrao,
              prazoDias=excluded.prazoDias, tags=excluded.tags, obs=excluded.obs, updated_at=excluded.updated_at
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
            .first<any>();

          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        // DELETE /api/clientes/:id
        if (req.method === "DELETE" && api[1]) {
          await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
            .bind(api[1], vendorId)
            .run();
          return json({ ok: true });
        }
      }

      // Mapa genérico para tabelas
      const entity = api[0];
      const map: Record<string, string> = {
        produtos: "produtos",
        pedidos: "pedidos",
        despesas: "despesas",
        lembretes: "lembretes",
        notas: "notas",
        rotas: "rotas",
      };

      if (map[entity] && req.method === "POST") {
        const body: any = await readJson(req);
        const kindMap: Record<string, string> = {
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
          await env.DB.prepare(
            `
            INSERT INTO produtos
              (id,vendor_id,marca,produto,modelo,descricao,categoria,sku,agregados,valorCompra,valorVenda,estoqueAtual,estoqueMin,local,status,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              marca=excluded.marca, produto=excluded.produto, modelo=excluded.modelo, descricao=excluded.descricao, categoria=excluded.categoria,
              sku=excluded.sku, agregados=excluded.agregados, valorCompra=excluded.valorCompra, valorVenda=excluded.valorVenda,
              estoqueAtual=excluded.estoqueAtual, estoqueMin=excluded.estoqueMin, local=excluded.local, status=excluded.status, updated_at=excluded.updated_at
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
            .first<any>();

          return json(row);
        }

        if (entity === "pedidos") {
          const itens = JSON.stringify(body.itens || []);

          await env.DB.prepare(
            `
            INSERT INTO pedidos
              (id,vendor_id,data,clienteId,clienteNome,urgencia,formaPagamento,prazoDias,status,obs,total,itens,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, clienteId=excluded.clienteId, clienteNome=excluded.clienteNome, urgencia=excluded.urgencia, formaPagamento=excluded.formaPagamento,
              prazoDias=excluded.prazoDias, status=excluded.status, obs=excluded.obs, total=excluded.total, itens=excluded.itens, updated_at=excluded.updated_at
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
            .first<any>();

          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (entity === "despesas") {
          await env.DB.prepare(
            `
            INSERT INTO despesas
              (id,vendor_id,data,categoria,valor,pagamento,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, categoria=excluded.categoria, valor=excluded.valor, pagamento=excluded.pagamento, obs=excluded.obs, updated_at=excluded.updated_at
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
            .first<any>();

          return json(row);
        }

        if (entity === "lembretes") {
          await env.DB.prepare(
            `
            INSERT INTO lembretes
              (id,vendor_id,tipo,titulo,data,texto,status,clienteId,clienteNome,segmento,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              tipo=excluded.tipo, titulo=excluded.titulo, data=excluded.data, texto=excluded.texto, status=excluded.status,
              clienteId=excluded.clienteId, clienteNome=excluded.clienteNome, segmento=excluded.segmento, updated_at=excluded.updated_at
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
            .first<any>();

          return json(row);
        }

        if (entity === "notas") {
          await env.DB.prepare(
            `
            INSERT INTO notas
              (id,vendor_id,titulo,texto,fixada,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              titulo=excluded.titulo, texto=excluded.texto, fixada=excluded.fixada, updated_at=excluded.updated_at
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
            .first<any>();

          return json({ ...row, fixada: !!row.fixada });
        }

        if (entity === "rotas") {
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `
            INSERT INTO rotas
              (id,vendor_id,data,obs,paradas,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, obs=excluded.obs, paradas=excluded.paradas, updated_at=excluded.updated_at
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
            .first<any>();

          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        return bad("Not found", 404);
      }

      // DELETE /api/<entity>/:id
      if (map[entity] && req.method === "DELETE" && api[1]) {
        // tabela está no map[entity]
        await env.DB.prepare(
          `DELETE FROM ${map[entity]} WHERE id=? AND vendor_id=?`
        )
          .bind(api[1], vendorId)
          .run();

        return json({ ok: true });
      }

      return bad("Not found", 404);
    } catch (e: any) {
      // garante CORS no 500 também
      return json({ error: "Erro interno", detail: String(e?.message || e) }, 500);
    }
  },
};
