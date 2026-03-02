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

/** -------------------- backup helper -------------------- **/
async function buildBackupPayload(env: Env) {
  const tables = ["vendors", "clientes", "produtos", "pedidos", "despesas", "lembretes", "rotas", "notas"];
  const payload: Record<string, any> = { exportedAt: nowISO(), tables: {} };

  for (const t of tables) {
    try {
      const rows = await env.DB.prepare(`SELECT * FROM ${t}`).all<any>();
      payload.tables[t] = rows.results || [];
    } catch (e: any) {
      payload.tables[t] = { _error: e?.message || "Falha" };
    }
  }
  return payload;
}

async function saveBackupToR2(env: Env) {
  if (!env.BACKUPS) return false;
  try {
    const payload = await buildBackupPayload(env);
    const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const key = `backup-${date}.json`;
    await env.BACKUPS.put(key, JSON.stringify(payload), {
      httpMetadata: { contentType: "application/json" },
    });
    // Manter só os 30 backups mais recentes
    const list = await env.BACKUPS.list();
    const keys = (list.objects || []).map((o: any) => o.key).sort();
    if (keys.length > 30) {
      for (const k of keys.slice(0, keys.length - 30)) {
        await env.BACKUPS.delete(k);
      }
    }
    return key;
  } catch (e: any) {
    console.error("Backup R2 falhou:", e?.message);
    return false;
  }
}

/** -------------------- main worker -------------------- **/
export default {
  // Agendamento diário às 03:00 UTC
  async scheduled(_event: any, env: Env, _ctx: any) {
    await saveBackupToR2(env);
  },

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
          "SELECT id,email,name,role,password_salt,password_hash,active FROM vendors WHERE email=?"
        )
          .bind(email)
          .first<{
            id: string;
            email: string;
            name: string;
            role: string;
            active: number;
            password_salt: string;
            password_hash: string;
          }>();

        if (!v) return bad("Credenciais inválidas.", 401);
        if (!Number(v.active)) return bad("Usuário desativado.", 403);

        const hash = await sha256Hex(v.password_salt + senha);
        if (hash !== v.password_hash) return bad("Credenciais inválidas.", 401);

        const user = { id: v.id, email: v.email, name: v.name, role: v.role || "seller" };
        const token = await makeToken(env, {
          sub: v.id,
          email: v.email,
          name: v.name,
          role: v.role || "seller",
          exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });

        return json({ token, user, vendor: user });
      }

      // Registro — primeiro usuário admin
      if (p[1] === "register" && req.method === "POST") {
        const count = await env.DB.prepare("SELECT COUNT(*) as c FROM vendors").first<{ c: number }>();
        if ((count?.c ?? 0) > 0) return bad("Registro público desabilitado.", 403);

        const body = await readJson<{ name?: string; email?: string; senha?: string }>(req);
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const senha = String(body.senha || "");

        if (!name || !email || !senha) return bad("Preencha todos os campos.", 400);
        if (senha.length < 6) return bad("Senha deve ter ao menos 6 caracteres.", 400);

        const salt = crypto.randomUUID().replace(/-/g, "");
        const hash = await sha256Hex(salt + senha);
        const id = "VD-" + String(Date.now()).slice(-6);

        await env.DB.prepare(
          `INSERT INTO vendors (id,email,name,password_salt,password_hash,role,active,created_at)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(id, email, name, salt, hash, "admin", 1, nowISO()).run();

        const token = await makeToken(env, {
          sub: id, email, name,
          role: "admin",
          exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });

        const user = { id, email, name, role: "admin" };
        return json({ token, user, vendor: user });
      }

      // Autenticação obrigatória a partir daqui
      const claim = await auth(req, env);
      if (!claim) return bad("Não autorizado.", 401);
      const vendorId = claim.sub;

      // Me
      if (p[1] === "me" && req.method === "GET") {
        const v = await env.DB.prepare(
          "SELECT id,email,name,role,active,created_at FROM vendors WHERE id=?"
        ).bind(vendorId).first<any>();
        if (!v) return bad("Usuário não encontrado.", 404);
        return json({ user: v });
      }

      /** =================== BACKUP =================== **/
      if (p[1] === "backup") {
        if (req.method === "GET") {
          const payload = await buildBackupPayload(env);
          const r2key = await saveBackupToR2(env);
          return json({ ...payload, r2key: r2key || null });
        }
        // Lista backups do R2
        if (req.method === "GET" && p[2] === "list") {
          if (!env.BACKUPS) return json({ backups: [] });
          const list = await env.BACKUPS.list();
          return json({ backups: (list.objects || []).map((o: any) => ({ key: o.key, size: o.size, uploaded: o.uploaded })) });
        }
      }

      /** =================== USERS (admin) =================== **/
      if (p[1] === "users") {
        if (claim.role !== "admin") return bad("Acesso restrito ao administrador.", 403);

        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT id,email,name,role,active,created_at FROM vendors ORDER BY created_at ASC"
          ).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const name = String(body.name || "").trim();
          const email = String(body.email || "").trim().toLowerCase();
          const senha = String(body.password || body.senha || "");
          const role = body.role === "admin" ? "admin" : "seller";
          const active = body.active !== undefined ? Number(body.active) : 1;

          if (!name || !email || !senha) return bad("name, email e senha são obrigatórios.", 400);

          const exists = await env.DB.prepare("SELECT id FROM vendors WHERE email=?").bind(email).first();
          if (exists) return bad("E-mail já cadastrado.", 409);

          const salt = crypto.randomUUID().replace(/-/g, "");
          const hash = await sha256Hex(salt + senha);
          const id = await nextId(env, vendorId, "user");

          await env.DB.prepare(
            `INSERT INTO vendors (id,email,name,password_salt,password_hash,role,active,created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(id, email, name, salt, hash, role, active, nowISO()).run();

          return json({ id, email, name, role, active });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const updates: string[] = [];
          const binds: any[] = [];

          if (body.name !== undefined)   { updates.push("name=?");   binds.push(String(body.name).trim()); }
          if (body.email !== undefined)  { updates.push("email=?");  binds.push(String(body.email).trim().toLowerCase()); }
          if (body.role !== undefined)   { updates.push("role=?");   binds.push(body.role === "admin" ? "admin" : "seller"); }
          if (body.active !== undefined) { updates.push("active=?"); binds.push(Number(body.active)); }

          if (body.password || body.senha) {
            const pw = String(body.password || body.senha || "");
            const salt = crypto.randomUUID().replace(/-/g, "");
            const hash = await sha256Hex(salt + pw);
            updates.push("password_salt=?", "password_hash=?");
            binds.push(salt, hash);
          }

          if (updates.length === 0) return bad("Nenhum campo para atualizar.", 400);
          binds.push(p[2]);

          await env.DB.prepare(
            `UPDATE vendors SET ${updates.join(",")} WHERE id=?`
          ).bind(...binds).run();

          const row = await env.DB.prepare(
            "SELECT id,email,name,role,active,created_at FROM vendors WHERE id=?"
          ).bind(p[2]).first<any>();
          return json(row || {});
        }
      }

      /** =================== CLIENTES =================== **/
      if (p[1] === "clientes") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM clientes WHERE vendor_id=? ORDER BY nome ASC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, tags: parseJSONField(r.tags, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);

          // Calcular histórico do cliente
          const pedidos = await env.DB.prepare(
            "SELECT id,data,total,status,formaPagamento,urgencia FROM pedidos WHERE clienteId=? AND vendor_id=? ORDER BY created_at DESC"
          ).bind(p[2], vendorId).all<any>();

          const totalGasto = (pedidos.results || []).reduce((acc: number, p: any) => acc + Number(p.total || 0), 0);
          const pedidosAbertos = (pedidos.results || []).filter((p: any) =>
            !p.status || ["pendente","aberto","em andamento"].includes(String(p.status).toLowerCase())
          ).length;

          return json({
            ...row,
            tags: parseJSONField(row.tags, []),
            _historico: {
              totalPedidos: pedidos.results?.length || 0,
              totalGasto,
              pedidosAbertos,
              ultimosPedidos: (pedidos.results || []).slice(0, 5),
            }
          });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const nome = String(body.nome || "").trim();
          if (!nome) return bad("Nome é obrigatório.", 400);

          const id = String(body.id || "").trim() || (await nextId(env, vendorId, "cliente"));
          const tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);

          await env.DB.prepare(
            `INSERT INTO clientes
              (id,vendor_id,nome,telefone,email,endereco,numero,bairro,cidade,uf,cep,cpfcnpj,pagamentoPadrao,prazoDias,tags,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome, telefone=excluded.telefone, email=excluded.email,
              endereco=excluded.endereco, numero=excluded.numero, bairro=excluded.bairro,
              cidade=excluded.cidade, uf=excluded.uf, cep=excluded.cep, cpfcnpj=excluded.cpfcnpj,
              pagamentoPadrao=excluded.pagamentoPadrao, prazoDias=excluded.prazoDias,
              tags=excluded.tags, obs=excluded.obs, updated_at=excluded.updated_at`
          ).bind(
            id, vendorId, nome,
            body.telefone || "", body.email || "", body.endereco || "", body.numero || "",
            body.bairro || "", body.cidade || "", body.uf || "", body.cep || "",
            body.cpfcnpj || "", body.pagamentoPadrao || "",
            Number(body.prazoDias || 0), tags, body.obs || "",
            nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);

          await env.DB.prepare(
            `UPDATE clientes SET
              nome=?,telefone=?,email=?,endereco=?,numero=?,bairro=?,cidade=?,uf=?,cep=?,
              cpfcnpj=?,pagamentoPadrao=?,prazoDias=?,tags=?,obs=?,updated_at=?
            WHERE id=? AND vendor_id=?`
          ).bind(
            body.nome || "", body.telefone || "", body.email || "",
            body.endereco || "", body.numero || "",
            body.bairro || "", body.cidade || "", body.uf || "", body.cep || "",
            body.cpfcnpj || "", body.pagamentoPadrao || "",
            Number(body.prazoDias || 0), tags, body.obs || "",
            nowISO(), p[2], vendorId
          ).run();

          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

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
            `SELECT * FROM ${table} WHERE vendor_id=? ORDER BY produto ASC`
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

          // Suporte a ajuste por porcentagem
          if (body._ajuste_pct !== undefined) {
            const pct = Number(body._ajuste_pct);
            const current = await env.DB.prepare(`SELECT valorVenda FROM ${table} WHERE id=? AND vendor_id=?`)
              .bind(p[2], vendorId).first<{ valorVenda: number }>();
            if (current) {
              const novoValor = current.valorVenda * (1 + pct / 100);
              body.valorVenda = Math.round(novoValor * 100) / 100;
            }
          }

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
            body.urgencia || "Normal", body.formaPagamento || "",
            Number(body.prazoDias || 0), body.status || "Aberto", body.obs || "",
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
            body.urgencia || "Normal", body.formaPagamento || "",
            Number(body.prazoDias || 0), body.status || "Aberto", body.obs || "",
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
            "SELECT * FROM despesas WHERE vendor_id=? ORDER BY data DESC, created_at DESC"
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
            "SELECT * FROM lembretes WHERE vendor_id=? ORDER BY data ASC, created_at DESC"
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
            body.texto || "", body.status || "Pendente",
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
            body.status || "Pendente", body.clienteId || "", body.clienteNome || "",
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
            "SELECT * FROM rotas WHERE vendor_id=? ORDER BY data DESC"
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
            `INSERT INTO rotas (id,vendor_id,nome,data,obs,paradas,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome, data=excluded.data, obs=excluded.obs, paradas=excluded.paradas, updated_at=excluded.updated_at`
          ).bind(id, vendorId, body.nome||"", body.data || "", body.obs || "", paradas, nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(id, vendorId).first<any>();
          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `UPDATE rotas SET nome=?,data=?,obs=?,paradas=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(body.nome||"", body.data || "", body.obs || "", paradas, nowISO(), p[2], vendorId).run();

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
            "SELECT * FROM notas WHERE vendor_id=? ORDER BY fixada DESC, updated_at DESC"
          ).bind(vendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, fixada: !!r.fixada })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], vendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, fixada: !!row.fixada });
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
