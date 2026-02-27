export interface Env {
  DB: D1Database;
  BACKUPS?: R2Bucket;
  JWT_SECRET: string;
}

/** -------------------- CORS + helpers -------------------- **/
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization",
};

function withCors(res: Response) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function json(data: unknown, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    })
  );
}

function bad(error: string, status = 400, detail?: unknown) {
  return json(detail !== undefined ? { error, detail } : { error }, status);
}

function nowISO() {
  return new Date().toISOString();
}

function parts(url: string) {
  return new URL(url).pathname.split("/").filter(Boolean);
}

async function readJson<T = any>(req: Request): Promise<T> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return {} as T;
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** -------------------- crypto / token -------------------- **/
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

type TokenPayload = {
  sub: string;
  email: string;
  name: string;
  role: string;
  exp: number;
};

async function makeToken(env: Env, payload: TokenPayload) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET não configurado");
  const body = b64urlStr(JSON.stringify(payload));
  const sig = await hmac(env.JWT_SECRET, body);
  return `${body}.${sig}`;
}

async function verifyToken(
  env: Env,
  token: string
): Promise<TokenPayload | null> {
  if (!env.JWT_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expSig = await hmac(env.JWT_SECRET, body);
  if (expSig !== sig) return null;
  const payload = JSON.parse(fromB64url(body)) as TokenPayload;
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

async function auth(req: Request, env: Env) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyToken(env, m[1]);
}

/** -------------------- ids / parsing -------------------- **/
function parseJSONField<T>(v: unknown, fallback: T): T {
  try {
    if (typeof v !== "string" || !v) return fallback;
    return JSON.parse(v) as T;
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
    user: "US",
  };

  return `${prefix[kind] || "ID"}-${String(next).padStart(6, "0")}`;
}

/** -------------------- main worker -------------------- **/
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

      const p = parts(req.url);

      if (p[0] !== "api") return bad("Not found", 404);

      // Health público
      if (p[1] === "health") {
        return json({ ok: true, ts: nowISO() });
      }

      // Login público
      if (p[1] === "login" && req.method === "POST") {
        const body = await readJson<{ email?: string; senha?: string }>(req);
        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        if (!email || !senha) return bad("Informe email e senha.", 400);

        const v = await env.DB.prepare(
          "SELECT id,email,name,role,password_salt,password_hash FROM vendors WHERE email=? AND active=1"
        )
          .bind(email)
          .first<{
            id: string;
            email: string;
            name: string;
            role: string;
            password_salt: string;
            password_hash: string;
          }>();

        if (!v) return bad("Usuário não encontrado ou inativo.", 401);

        const calc = await sha256Hex(String(v.password_salt || "") + senha);
        if (calc !== v.password_hash) return bad("Senha inválida.", 401);

        const token = await makeToken(env, {
          sub: v.id,
          email: v.email,
          name: v.name,
          role: v.role || "seller",
          exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        });

        const user = { id: v.id, email: v.email, name: v.name, role: v.role || "seller" };
        return json({ token, user, vendor: user });
      }

      // Register público (cria o primeiro admin se não houver nenhum)
      if (p[1] === "register" && req.method === "POST") {
        const body = await readJson<{
          email?: string;
          senha?: string;
          name?: string;
          adminSecret?: string;
        }>(req);

        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");
        const name = String(body.name || "").trim();

        if (!email || !senha || !name) return bad("Informe nome, email e senha.", 400);

        // Verifica se já existe algum vendor (se sim, exige adminSecret)
        const count = await env.DB.prepare("SELECT COUNT(*) as cnt FROM vendors")
          .first<{ cnt: number }>();

        if ((count?.cnt ?? 0) > 0) {
          // Para registrar mais usuários é preciso estar logado como admin
          return bad("Registro público desabilitado. Use o painel de admin.", 403);
        }

        // Primeiro usuário vira admin
        const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const hash = await sha256Hex(salt + senha);
        const id = `VD-000001`;

        await env.DB.prepare(
          `INSERT INTO vendors (id,email,name,role,password_salt,password_hash,active,created_at)
           VALUES (?,?,?,?,?,?,1,?)`
        )
          .bind(id, email, name, "admin", salt, hash, nowISO())
          .run();

        // Inicializa contador
        await env.DB.prepare(
          `INSERT OR IGNORE INTO counters (vendor_id, kind, value) VALUES (?,?,?)`
        ).bind("system", "user", 1).run();

        const token = await makeToken(env, {
          sub: id,
          email,
          name,
          role: "admin",
          exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        });

        const user = { id, email, name, role: "admin" };
        return json({ token, user, vendor: user });
      }

      // A partir daqui exige token
      const user = await auth(req, env);
      if (!user) return bad("Não autorizado.", 401);

      const vendorId = String(user.sub);

      // Me
      if (p[1] === "me") {
        const v = await env.DB.prepare(
          "SELECT id,email,name,role FROM vendors WHERE id=?"
        ).bind(vendorId).first<any>();

        const userData = v
          ? { id: v.id, email: v.email, name: v.name, role: v.role || "seller" }
          : { id: vendorId, email: user.email, name: user.name, role: user.role || "seller" };

        return json({ user: userData, ...userData });
      }

      // =================== USERS (admin only) ===================
      if (p[1] === "users") {
        if (user.role !== "admin") return bad("Acesso negado.", 403);

        // Listar usuários
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT id,email,name,role,active,created_at FROM vendors ORDER BY created_at"
          ).all<any>();
          return json(rows.results || []);
        }

        // Criar usuário
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const email = String(body.email || "").trim().toLowerCase();
          const senha = String(body.password || body.senha || "");
          const name = String(body.name || "").trim();
          const role = String(body.role || "seller");
          const active = body.active !== undefined ? Number(body.active) : 1;

          if (!email || !senha || !name) return bad("Informe nome, email e senha.", 400);

          const existing = await env.DB.prepare(
            "SELECT id FROM vendors WHERE email=?"
          ).bind(email).first<any>();
          if (existing) return bad("E-mail já cadastrado.", 409);

          const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const hash = await sha256Hex(salt + senha);

          // Gera próximo ID
          const countRow = await env.DB.prepare("SELECT COUNT(*) as cnt FROM vendors").first<{ cnt: number }>();
          const nextNum = (countRow?.cnt ?? 0) + 1;
          const id = `VD-${String(nextNum).padStart(6, "0")}`;

          await env.DB.prepare(
            `INSERT INTO vendors (id,email,name,role,password_salt,password_hash,active,created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(id, email, name, role, salt, hash, active, nowISO()).run();

          return json({ id, email, name, role, active });
        }

        // Atualizar usuário
        if ((req.method === "PUT" || req.method === "PATCH") && p[2]) {
          const body = await readJson<any>(req);
          const targetId = p[2];

          const existing = await env.DB.prepare(
            "SELECT id,email,name,role,active FROM vendors WHERE id=?"
          ).bind(targetId).first<any>();
          if (!existing) return bad("Usuário não encontrado.", 404);

          const name = String(body.name || existing.name || "").trim();
          const role = String(body.role || existing.role || "seller");
          const active = body.active !== undefined ? Number(body.active) : existing.active;

          if (body.password || body.senha) {
            const senha = String(body.password || body.senha || "");
            const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            const hash = await sha256Hex(salt + senha);

            await env.DB.prepare(
              `UPDATE vendors SET name=?,role=?,active=?,password_salt=?,password_hash=? WHERE id=?`
            ).bind(name, role, active, salt, hash, targetId).run();
          } else {
            await env.DB.prepare(
              `UPDATE vendors SET name=?,role=?,active=? WHERE id=?`
            ).bind(name, role, active, targetId).run();
          }

          return json({ id: targetId, name, role, active });
        }

        return bad("Método não suportado.", 405);
      }

      // Bootstrap
      if (p[1] === "bootstrap") {
        const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] =
          await Promise.all([
            env.DB.prepare("SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
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

      // Backup
      if (p[1] === "backup") {
        const [clientes, produtos, pedidos, despesas, lembretes, notas, rotas] =
          await Promise.all([
            env.DB.prepare("SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM produtos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM notas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
            env.DB.prepare("SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC").bind(vendorId).all(),
          ]);

        const data = {
          exportedAt: nowISO(),
          vendorId,
          clientes: clientes.results || [],
          produtos: produtos.results || [],
          pedidos: pedidos.results || [],
          despesas: despesas.results || [],
          lembretes: lembretes.results || [],
          notas: notas.results || [],
          rotas: rotas.results || [],
        };

        if (env.BACKUPS) {
          const key = `backup/${vendorId}/${nowISO().slice(0, 10)}/${Date.now()}.json`;
          await env.BACKUPS.put(key, JSON.stringify(data, null, 2), {
            httpMetadata: { contentType: "application/json" },
          });
          return json({ ok: true, key, data });
        }

        return json(data);
      }

      /** =================== CLIENTES =================== **/
      if (p[1] === "clientes") {
        // GET list
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM clientes WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, tags: parseJSONField(r.tags, []) })));
        }

        // GET single
        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare(
            "SELECT * FROM clientes WHERE id=? AND vendor_id=?"
          ).bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, tags: parseJSONField(row.tags, []) });
        }

        // POST (criar)
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "cliente"));
          const tags = JSON.stringify(body.tags || []);

          await env.DB.prepare(
            `INSERT INTO clientes
              (id,vendor_id,nome,telefone,endereco,numero,bairro,cidade,uf,cep,cpfcnpj,pagamentoPadrao,prazoDias,tags,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome, telefone=excluded.telefone, endereco=excluded.endereco,
              numero=excluded.numero, bairro=excluded.bairro, cidade=excluded.cidade,
              uf=excluded.uf, cep=excluded.cep, cpfcnpj=excluded.cpfcnpj,
              pagamentoPadrao=excluded.pagamentoPadrao, prazoDias=excluded.prazoDias,
              tags=excluded.tags, obs=excluded.obs, updated_at=excluded.updated_at`
          ).bind(
            id, vendorId,
            body.nome || "", body.telefone || "", body.endereco || "",
            body.numero || "", body.bairro || "", body.cidade || "",
            body.uf || "", body.cep || "", body.cpfcnpj || "",
            body.pagamentoPadrao || "", Number(body.prazoDias || 0),
            tags, body.obs || "", nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        // PUT (atualizar)
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const tags = JSON.stringify(body.tags || []);

          await env.DB.prepare(
            `UPDATE clientes SET
              nome=?,telefone=?,endereco=?,numero=?,bairro=?,cidade=?,uf=?,cep=?,
              cpfcnpj=?,pagamentoPadrao=?,prazoDias=?,tags=?,obs=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.nome || "", body.telefone || "", body.endereco || "",
            body.numero || "", body.bairro || "", body.cidade || "",
            body.uf || "", body.cep || "", body.cpfcnpj || "",
            body.pagamentoPadrao || "", Number(body.prazoDias || 0),
            tags, body.obs || "", nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        // DELETE
        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== PRODUTOS / MERCADORIAS =================== **/
      if (p[1] === "produtos" || p[1] === "mercadorias") {
        const table = "produtos";

        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            `SELECT * FROM ${table} WHERE vendor_id=? ORDER BY created_at DESC`
          ).bind(vendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "produto"));

          // Aceita tanto nome (frontend) quanto produto (schema)
          const nomeProduto = body.produto || body.nome || "";

          await env.DB.prepare(
            `INSERT INTO ${table}
              (id,vendor_id,marca,produto,modelo,descricao,categoria,sku,agregados,valorCompra,valorVenda,estoqueAtual,estoqueMin,local,status,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              marca=excluded.marca, produto=excluded.produto, modelo=excluded.modelo,
              descricao=excluded.descricao, categoria=excluded.categoria, sku=excluded.sku,
              agregados=excluded.agregados, valorCompra=excluded.valorCompra, valorVenda=excluded.valorVenda,
              estoqueAtual=excluded.estoqueAtual, estoqueMin=excluded.estoqueMin,
              local=excluded.local, status=excluded.status, updated_at=excluded.updated_at`
          ).bind(
            id, vendorId,
            body.marca || "", nomeProduto,
            body.modelo || "", body.descricao || "", body.categoria || "",
            body.sku || body.codigo || "",
            body.agregados || "",
            Number(body.valorCompra ?? body.valor_compra ?? 0),
            Number(body.valorVenda ?? body.valor_venda ?? 0),
            Number(body.estoqueAtual ?? body.estoque ?? 0),
            Number(body.estoqueMin ?? 0),
            body.local || "", body.status || "ativo",
            nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(id, vendorId).first();
          return json(row);
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const nomeProduto = body.produto || body.nome || "";

          await env.DB.prepare(
            `UPDATE ${table} SET
              marca=?,produto=?,modelo=?,descricao=?,categoria=?,sku=?,agregados=?,
              valorCompra=?,valorVenda=?,estoqueAtual=?,estoqueMin=?,local=?,status=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.marca || "", nomeProduto, body.modelo || "", body.descricao || "",
            body.categoria || "", body.sku || body.codigo || "", body.agregados || "",
            Number(body.valorCompra ?? body.valor_compra ?? 0),
            Number(body.valorVenda ?? body.valor_venda ?? 0),
            Number(body.estoqueAtual ?? body.estoque ?? 0),
            Number(body.estoqueMin ?? 0),
            body.local || "", body.status || "ativo",
            nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(p[2], vendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== PEDIDOS =================== **/
      if (p[1] === "pedidos") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, itens: parseJSONField(r.itens, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, itens: parseJSONField(row.itens, []) });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "pedido"));
          const itens = JSON.stringify(body.itens || []);

          await env.DB.prepare(
            `INSERT INTO pedidos
              (id,vendor_id,data,clienteId,clienteNome,urgencia,formaPagamento,prazoDias,status,obs,total,itens,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, clienteId=excluded.clienteId, clienteNome=excluded.clienteNome,
              urgencia=excluded.urgencia, formaPagamento=excluded.formaPagamento,
              prazoDias=excluded.prazoDias, status=excluded.status, obs=excluded.obs,
              total=excluded.total, itens=excluded.itens, updated_at=excluded.updated_at`
          ).bind(
            id, vendorId, body.data || "", body.clienteId || "", body.clienteNome || "",
            body.urgencia || "", body.formaPagamento || "",
            Number(body.prazoDias || 0), body.status || "", body.obs || "",
            Number(body.total || 0), itens, nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const itens = JSON.stringify(body.itens || []);

          await env.DB.prepare(
            `UPDATE pedidos SET
              data=?,clienteId=?,clienteNome=?,urgencia=?,formaPagamento=?,prazoDias=?,
              status=?,obs=?,total=?,itens=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.data || "", body.clienteId || "", body.clienteNome || "",
            body.urgencia || "", body.formaPagamento || "",
            Number(body.prazoDias || 0), body.status || "", body.obs || "",
            Number(body.total || 0), itens, nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== DESPESAS =================== **/
      if (p[1] === "despesas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM despesas WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(vendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "despesa"));

          await env.DB.prepare(
            `INSERT INTO despesas (id,vendor_id,data,categoria,valor,pagamento,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, categoria=excluded.categoria, valor=excluded.valor,
              pagamento=excluded.pagamento, obs=excluded.obs, updated_at=excluded.updated_at`
          ).bind(id, vendorId, body.data || "", body.categoria || "",
            Number(body.valor || 0), body.pagamento || "", body.obs || "",
            nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first();
          return json(row);
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);

          await env.DB.prepare(
            `UPDATE despesas SET data=?,categoria=?,valor=?,pagamento=?,obs=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.data || "", body.categoria || "", Number(body.valor || 0),
            body.pagamento || "", body.obs || "", nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM despesas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== LEMBRETES =================== **/
      if (p[1] === "lembretes") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM lembretes WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(vendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "lembrete"));

          await env.DB.prepare(
            `INSERT INTO lembretes
              (id,vendor_id,tipo,titulo,data,texto,status,clienteId,clienteNome,segmento,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              tipo=excluded.tipo, titulo=excluded.titulo, data=excluded.data, texto=excluded.texto,
              status=excluded.status, clienteId=excluded.clienteId, clienteNome=excluded.clienteNome,
              segmento=excluded.segmento, updated_at=excluded.updated_at`
          ).bind(
            id, vendorId, body.tipo || "", body.titulo || "", body.data || "",
            body.texto || "", body.status || "pendente",
            body.clienteId || "", body.clienteNome || "", body.segmento || "",
            nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first();
          return json(row);
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);

          await env.DB.prepare(
            `UPDATE lembretes SET
              tipo=?,titulo=?,data=?,texto=?,status=?,clienteId=?,clienteNome=?,segmento=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.tipo || "", body.titulo || "", body.data || "", body.texto || "",
            body.status || "pendente", body.clienteId || "", body.clienteNome || "",
            body.segmento || "", nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== ROTAS =================== **/
      if (p[1] === "rotas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM rotas WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, paradas: parseJSONField(r.paradas, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, paradas: parseJSONField(row.paradas, []) });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "rota"));
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `INSERT INTO rotas (id,vendor_id,data,obs,paradas,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, obs=excluded.obs, paradas=excluded.paradas, updated_at=excluded.updated_at`
          ).bind(id, vendorId, body.data || "", body.obs || "", paradas, nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `UPDATE rotas SET data=?,obs=?,paradas=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(body.data || "", body.obs || "", paradas, nowISO(), p[2], vendorId).run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== NOTAS =================== **/
      if (p[1] === "notas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM notas WHERE vendor_id=? ORDER BY fixada DESC, created_at DESC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, fixada: !!r.fixada })));
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "nota"));

          await env.DB.prepare(
            `INSERT INTO notas (id,vendor_id,titulo,texto,fixada,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              titulo=excluded.titulo, texto=excluded.texto, fixada=excluded.fixada, updated_at=excluded.updated_at`
          ).bind(id, vendorId, body.titulo || "", body.texto || "",
            body.fixada ? 1 : 0, nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, fixada: !!row?.fixada });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);

          await env.DB.prepare(
            `UPDATE notas SET titulo=?,texto=?,fixada=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(body.titulo || "", body.texto || "", body.fixada ? 1 : 0, nowISO(), p[2], vendorId).run();

          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          return json({ ...row, fixada: !!row?.fixada });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).run();
          return json({ ok: true });
        }
      }

      return bad("Not found", 404);
    } catch (e: any) {
      return bad("Erro interno", 500, e?.message || String(e));
    }
  },
};
