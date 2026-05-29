export interface Env {
  DB: D1Database;
  BACKUPS?: R2Bucket;
  DOCS?: R2Bucket;
  JWT_SECRET: string;
  ANTHROPIC_API_KEY?: string;
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

        // Registrar log de login
        try {
          const logId = "LG-" + String(Date.now()).slice(-8);
          await env.DB.prepare(
            `INSERT INTO logs (id,vendor_id,user_id,user_name,acao,recurso,detalhe,created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(logId, v.id, v.id, v.name, "login", "sistema", `Login de ${v.email}`, nowISO()).run();
        } catch {}

        // Carregar permissões do usuário
        let permissions: Record<string,any> = {};
        try {
          const vFull = await env.DB.prepare("SELECT permissions FROM vendors WHERE id=?").bind(v.id).first<any>();
          permissions = JSON.parse(vFull?.permissions || "{}");
        } catch {}

        return json({ token, user: {...user, permissions}, vendor: {...user, permissions} });
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

      // Resolver o vendor_id efetivo: vendedores usam o owner_id do admin que os criou
      // Assim todos compartilham o mesmo banco de dados (clientes, pedidos, etc.)
      let effectiveVendorId = vendorId;
      if (claim.role !== "admin") {
        try {
          const vRow = await env.DB.prepare(
            "SELECT owner_id FROM vendors WHERE id=?"
          ).bind(vendorId).first<any>();
          if (vRow?.owner_id) effectiveVendorId = vRow.owner_id;
        } catch { /* coluna pode não existir ainda, usar próprio id */ }
      }

      // Me
      if (p[1] === "me" && req.method === "GET") {
        const v = await env.DB.prepare(
          "SELECT id,email,name,role,active,created_at FROM vendors WHERE id=?"
        ).bind(vendorId).first<any>();
        if (!v) return bad("Usuário não encontrado.", 404);
        // Buscar permissions separadamente (pode não existir se migração não foi rodada)
        let permissions: Record<string,any> = {};
        try {
          const vp = await env.DB.prepare("SELECT permissions FROM vendors WHERE id=?").bind(vendorId).first<any>();
          if (vp?.permissions) permissions = JSON.parse(vp.permissions);
        } catch { /* coluna não existe ainda, ignorar */ }
        return json({ user: { ...v, permissions } });
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

          // Novo vendedor herda o owner_id do admin que o criou (ou é o próprio dono se admin)
          await env.DB.prepare(
            `INSERT INTO vendors (id,email,name,password_salt,password_hash,role,active,owner_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).bind(id, email, name, salt, hash, role, active, vendorId, nowISO()).run();

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

          // Salvar permissões customizadas (só se não for admin)
          if (body.permissions !== undefined) {
            updates.push("permissions=?");
            binds.push(JSON.stringify(body.permissions || {}));
          }

          if (updates.length === 0) return bad("Nenhum campo para atualizar.", 400);
          binds.push(p[2]);

          await env.DB.prepare(
            `UPDATE vendors SET ${updates.join(",")} WHERE id=?`
          ).bind(...binds).run();

          const row = await env.DB.prepare(
            "SELECT id,email,name,role,active,created_at,permissions FROM vendors WHERE id=?"
          ).bind(p[2]).first<any>();
          let permissions: Record<string,any> = {};
          try { permissions = JSON.parse((row as any)?.permissions || "{}"); } catch {}
          return json({ ...(row || {}), permissions });
        }
      }

      /** =================== LOGS (admin) =================== **/
      if (p[1] === "logs") {
        if (claim.role !== "admin") return bad("Acesso restrito.", 403);

        // GET lista de logs com filtro opcional por user_id
        if (req.method === "GET" && !p[2]) {
          const url = new URL(req.url);
          const userId = url.searchParams.get("user_id") || "";
          const limit = Math.min(Number(url.searchParams.get("limit") || "200"), 500);
          const rows = userId
            ? await env.DB.prepare(
                "SELECT * FROM logs WHERE vendor_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?"
              ).bind(vendorId, userId, limit).all<any>()
            : await env.DB.prepare(
                "SELECT * FROM logs WHERE vendor_id=? ORDER BY created_at DESC LIMIT ?"
              ).bind(vendorId, limit).all<any>();
          return json(rows.results || []);
        }
      }

      // Helper: registrar log de atividade (fire-and-forget)
      async function logAtividade(acao: string, recurso: string, detalhe: string) {
        try {
          const user = await env.DB.prepare("SELECT name FROM vendors WHERE id=?").bind(vendorId).first<any>();
          const logId = "LG-" + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2,5);
          await env.DB.prepare(
            `INSERT INTO logs (id,vendor_id,user_id,user_name,acao,recurso,detalhe,created_at)
             VALUES (?,?,?,?,?,?,?,?)`
          ).bind(logId, effectiveVendorId, vendorId, user?.name || vendorId, acao, recurso, detalhe.slice(0,300), nowISO()).run();
        } catch {}
      }

      // Helper: checar permissão do usuário - NUNCA bloqueia por erro técnico
      async function temPermissao(recurso: string, acao: string): Promise<boolean> {
        try {
          if (claim.role === "admin") return true; // admin sempre passa
          let v: any = null;
          try {
            // Buscar permissões do usuário logado (vendorId original, não effectiveVendorId)
            v = await env.DB.prepare("SELECT permissions,role FROM vendors WHERE id=?").bind(vendorId).first<any>();
          } catch {
            return true; // coluna pode não existir → liberar
          }
          if (!v) return true;
          if (v.role === "admin") return true;
          if (!v.permissions || v.permissions === "{}") return true;
          const perms = JSON.parse(v.permissions);
          if (!perms || Object.keys(perms).length === 0) return true;
          const recursoPerms = perms[recurso];
          if (recursoPerms === undefined) return true;
          if (recursoPerms === false) return false;
          if (typeof recursoPerms === "object" && recursoPerms !== null) {
            return recursoPerms[acao] !== false;
          }
          return true;
        } catch {
          return true;
        }
      }

      /** =================== CLIENTES =================== **/
      if (p[1] === "clientes") {
        if (!await temPermissao("clientes","ver")) return bad("Sem permissão para acessar clientes.", 403);

        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM clientes WHERE vendor_id=? ORDER BY nome ASC"
          ).bind(effectiveVendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, tags: parseJSONField(r.tags, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);

          // Calcular histórico do cliente
          const pedidos = await env.DB.prepare(
            "SELECT id,data,total,status,formaPagamento,urgencia FROM pedidos WHERE clienteId=? AND vendor_id=? ORDER BY created_at DESC"
          ).bind(p[2], effectiveVendorId).all<any>();

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
          if (!await temPermissao("clientes","criar")) return bad("Sem permissão para criar clientes.", 403);
          const body = await readJson<any>(req);
          const nome = String(body.nome || "").trim();
          if (!nome) return bad("Nome é obrigatório.", 400);

          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "cliente"));
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
            id, effectiveVendorId, nome,
            body.telefone || "", body.email || "", body.endereco || "", body.numero || "",
            body.bairro || "", body.cidade || "", body.uf || "", body.cep || "",
            body.cpfcnpj || "", body.pagamentoPadrao || "",
            Number(body.prazoDias || 0), tags, body.obs || "",
            nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM clientes WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first<any>();
          await logAtividade("criar", "clientes", `Cliente ${nome} (${id})`);
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        if (req.method === "PUT" && p[2]) {
          if (!await temPermissao("clientes","editar")) return bad("Sem permissão para editar clientes.", 403);
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
            .bind(p[2], effectiveVendorId).first<any>();
          await logAtividade("editar", "clientes", `Cliente ${body.nome||""} (${p[2]})`);
          return json({ ...row, tags: parseJSONField(row?.tags, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          if (!await temPermissao("clientes","excluir")) return bad("Sem permissão para excluir clientes.", 403);
          await env.DB.prepare("DELETE FROM clientes WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          await logAtividade("excluir", "clientes", `Cliente ${p[2]} excluído`);
          return json({ ok: true });
        }
      }

      /** =================== PRODUTOS / MERCADORIAS =================== **/
      if (p[1] === "produtos" || p[1] === "mercadorias") {
        if (!await temPermissao("mercadorias","ver")) return bad("Sem permissão para acessar mercadorias.", 403);
        const table = "produtos";

        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            `SELECT * FROM ${table} WHERE vendor_id=? ORDER BY produto ASC`
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "produto"));
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
            id, effectiveVendorId,
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
            .bind(id, effectiveVendorId).first();
          return json(row);
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const nomeProduto = body.produto || body.nome || "";

          // Suporte a ajuste por porcentagem
          if (body._ajuste_pct !== undefined) {
            const pct = Number(body._ajuste_pct);
            const current = await env.DB.prepare(`SELECT valorVenda FROM ${table} WHERE id=? AND vendor_id=?`)
              .bind(p[2], effectiveVendorId).first<{ valorVenda: number }>();
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
            .bind(p[2], effectiveVendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND vendor_id=?`)
            .bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== PEDIDOS =================== **/
      if (p[1] === "pedidos") {
        if (!await temPermissao("pedidos","ver")) return bad("Sem permissão para acessar pedidos.", 403);
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM pedidos WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, itens: parseJSONField(r.itens, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, itens: parseJSONField(row.itens, []) });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "pedido"));
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
            id, effectiveVendorId, body.data || "", body.clienteId || "", body.clienteNome || "",
            body.urgencia || "Normal", body.formaPagamento || "",
            Number(body.prazoDias || 0), body.status || "Aberto", body.obs || "",
            Number(body.total || 0), itens, nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first<any>();
          await logAtividade("criar", "pedidos", `Pedido ${id} - Cliente: ${body.clienteNome||""} - Total: R$${body.total||0}`);
          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (req.method === "PUT" && p[2]) {
          if (!await temPermissao("pedidos","editar")) return bad("Sem permissão para editar pedidos.", 403);
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
            .bind(p[2], effectiveVendorId).first<any>();
          await logAtividade("editar", "pedidos", `Pedido ${p[2]} - Status: ${body.status||""} - Total: R$${body.total||0}`);
          return json({ ...row, itens: parseJSONField(row?.itens, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          if (!await temPermissao("pedidos","excluir")) return bad("Sem permissão para excluir pedidos.", 403);
          await env.DB.prepare("DELETE FROM pedidos WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          await logAtividade("excluir", "pedidos", `Pedido ${p[2]} excluído`);
          return json({ ok: true });
        }
      }

      /** =================== DESPESAS =================== **/
      if (p[1] === "despesas") {
        if (!await temPermissao("despesas","ver")) return bad("Sem permissão para acessar despesas.", 403);
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM despesas WHERE vendor_id=? ORDER BY data DESC, created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "despesa"));

          await env.DB.prepare(
            `INSERT INTO despesas (id,vendor_id,data,categoria,valor,pagamento,obs,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              data=excluded.data, categoria=excluded.categoria, valor=excluded.valor,
              pagamento=excluded.pagamento, obs=excluded.obs, updated_at=excluded.updated_at`
          ).bind(id, effectiveVendorId, body.data || "", body.categoria || "",
            Number(body.valor || 0), body.pagamento || "", body.obs || "",
            nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM despesas WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first();
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
            .bind(p[2], effectiveVendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM despesas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== LEMBRETES =================== **/
      if (p[1] === "lembretes") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM lembretes WHERE vendor_id=? ORDER BY data ASC, created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json(row);
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "lembrete"));

          await env.DB.prepare(
            `INSERT INTO lembretes
              (id,vendor_id,tipo,titulo,data,texto,status,clienteId,clienteNome,segmento,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              tipo=excluded.tipo, titulo=excluded.titulo, data=excluded.data, texto=excluded.texto,
              status=excluded.status, clienteId=excluded.clienteId, clienteNome=excluded.clienteNome,
              segmento=excluded.segmento, updated_at=excluded.updated_at`
          ).bind(
            id, effectiveVendorId, body.tipo || "", body.titulo || "", body.data || "",
            body.texto || "", body.status || "Pendente",
            body.clienteId || "", body.clienteNome || "", body.segmento || "",
            nowISO(), nowISO()
          ).run();

          const row = await env.DB.prepare("SELECT * FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first();
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
            .bind(p[2], effectiveVendorId).first();
          return json(row);
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM lembretes WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== ROTAS =================== **/
      if (p[1] === "rotas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM rotas WHERE vendor_id=? ORDER BY data DESC"
          ).bind(effectiveVendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, paradas: parseJSONField(r.paradas, []) })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, paradas: parseJSONField(row.paradas, []) });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "rota"));
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `INSERT INTO rotas (id,vendor_id,nome,data,obs,paradas,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              nome=excluded.nome, data=excluded.data, obs=excluded.obs, paradas=excluded.paradas, updated_at=excluded.updated_at`
          ).bind(id, effectiveVendorId, body.nome||"", body.data || "", body.obs || "", paradas, nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first<any>();
          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const paradas = JSON.stringify(body.paradas || []);

          await env.DB.prepare(
            `UPDATE rotas SET nome=?,data=?,obs=?,paradas=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(body.nome||"", body.data || "", body.obs || "", paradas, nowISO(), p[2], effectiveVendorId).run();

          const row = await env.DB.prepare("SELECT * FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          return json({ ...row, paradas: parseJSONField(row?.paradas, []) });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM rotas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== NOTAS =================== **/
      if (p[1] === "notas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM notas WHERE vendor_id=? ORDER BY fixada DESC, updated_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json((rows.results || []).map((r: any) => ({ ...r, fixada: !!r.fixada })));
        }

        if (req.method === "GET" && p[2]) {
          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!row) return bad("Não encontrado.", 404);
          return json({ ...row, fixada: !!row.fixada });
        }

        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || (await nextId(env, effectiveVendorId, "nota"));

          await env.DB.prepare(
            `INSERT INTO notas (id,vendor_id,titulo,texto,fixada,updated_at,created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              titulo=excluded.titulo, texto=excluded.texto, fixada=excluded.fixada, updated_at=excluded.updated_at`
          ).bind(id, effectiveVendorId, body.titulo || "", body.texto || "",
            body.fixada ? 1 : 0, nowISO(), nowISO()).run();

          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(id, effectiveVendorId).first<any>();
          return json({ ...row, fixada: !!row?.fixada });
        }

        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);

          await env.DB.prepare(
            `UPDATE notas SET titulo=?,texto=?,fixada=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(body.titulo || "", body.texto || "", body.fixada ? 1 : 0, nowISO(), p[2], effectiveVendorId).run();

          const row = await env.DB.prepare("SELECT * FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          return json({ ...row, fixada: !!row?.fixada });
        }

        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM notas WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== MANUAIS =================== **/
      if (p[1] === "manuais") {

        // GET lista de manuais
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM manuais WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }

        // GET download/stream de um manual (retorna URL assinada ou stream)
        if (req.method === "GET" && p[2] === "download" && p[3]) {
          const manual = await env.DB.prepare(
            "SELECT * FROM manuais WHERE id=? AND vendor_id=?"
          ).bind(p[3], effectiveVendorId).first<any>();
          if (!manual) return bad("Manual não encontrado.", 404);

          if (!env.BACKUPS) return bad("Armazenamento R2 não configurado.", 503);

          const obj = await env.BACKUPS.get(manual.r2key);
          if (!obj) return bad("Arquivo não encontrado no storage.", 404);

          const headers = new Headers();
          headers.set("Content-Type", "application/pdf");
          headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(manual.nome_arquivo)}"`);
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("Cache-Control", "private, max-age=3600");

          return new Response(obj.body, { status: 200, headers });
        }

        // POST upload de novo manual (multipart/form-data)
        if (req.method === "POST" && !p[2]) {
          if (!env.BACKUPS) return bad("R2 não configurado. Adicione o binding BACKUPS.", 503);

          const ct = req.headers.get("content-type") || "";
          if (!ct.includes("multipart/form-data")) return bad("Envie como multipart/form-data.", 400);

          let formData: FormData;
          try { formData = await req.formData(); }
          catch (e: any) { return bad("Erro ao ler formulário: " + (e?.message || ""), 400); }

          const file = formData.get("arquivo") as File | null;
          const nome = String(formData.get("nome") || "").trim();
          const descricao = String(formData.get("descricao") || "").trim();
          const tags = String(formData.get("tags") || "").trim();
          const categoria = String(formData.get("categoria") || "").trim();

          if (!file) return bad("Arquivo PDF obrigatório.", 400);
          if (file.type && !file.type.includes("pdf") && !file.name?.toLowerCase().endsWith(".pdf")) {
            return bad("Apenas arquivos PDF são aceitos.", 400);
          }
          const maxSize = 20 * 1024 * 1024; // 20MB
          if (file.size > maxSize) return bad("Arquivo muito grande (máx. 20MB).", 400);

          const id = "MN-" + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2,5).toUpperCase();
          const nomeArquivo = file.name || nome || `manual-${id}.pdf`;
          const r2key = `manuais/${vendorId}/${id}/${nomeArquivo}`;

          const arrayBuffer = await file.arrayBuffer();
          await env.BACKUPS.put(r2key, arrayBuffer, {
            httpMetadata: { contentType: "application/pdf" },
            customMetadata: { vendorId: effectiveVendorId, nome, tags, categoria },
          });

          await env.DB.prepare(
            `INSERT INTO manuais (id,vendor_id,nome,nome_arquivo,descricao,tags,categoria,r2key,tamanho,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(id, effectiveVendorId,
            nome || nomeArquivo,
            nomeArquivo, descricao, tags, categoria,
            r2key, file.size, nowISO()
          ).run();

          await logAtividade("criar", "manuais", `Manual "${nome||nomeArquivo}" (${(file.size/1024).toFixed(0)}KB)`);

          const row = await env.DB.prepare("SELECT * FROM manuais WHERE id=?").bind(id).first<any>();
          return json(row || { id, nome, nome_arquivo: nomeArquivo, r2key });
        }

        // PUT atualizar metadados do manual
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          await env.DB.prepare(
            `UPDATE manuais SET nome=?,descricao=?,tags=?,categoria=? WHERE id=? AND vendor_id=?`
          ).bind(
            body.nome || "", body.descricao || "", body.tags || "", body.categoria || "",
            p[2], vendorId
          ).run();
          const row = await env.DB.prepare("SELECT * FROM manuais WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).first<any>();
          return json(row || {});
        }

        // DELETE excluir manual
        if (req.method === "DELETE" && p[2]) {
          const manual = await env.DB.prepare(
            "SELECT * FROM manuais WHERE id=? AND vendor_id=?"
          ).bind(p[2], effectiveVendorId).first<any>();
          if (!manual) return bad("Não encontrado.", 404);

          if (env.BACKUPS && manual.r2key) {
            try { await env.BACKUPS.delete(manual.r2key); } catch {}
          }
          await env.DB.prepare("DELETE FROM manuais WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          await logAtividade("excluir", "manuais", `Manual "${manual.nome}" excluído`);
          return json({ ok: true });
        }
      }

      /** =================== DOCS / BIBLIOTECA =================== **/
      if (p[1] === "docs") {

        // GET /api/docs — listar documentos (com busca opcional ?q=)
        if (req.method === "GET" && !p[2]) {
          const url = new URL(req.url);
          const q = (url.searchParams.get("q") || "").trim().toLowerCase();
          const rows = q
            ? await env.DB.prepare(
                `SELECT * FROM docs WHERE vendor_id=?
                 AND (LOWER(nome) LIKE ? OR LOWER(descricao) LIKE ? OR LOWER(palavras_chave) LIKE ?)
                 ORDER BY created_at DESC`
              ).bind(effectiveVendorId, `%${q}%`, `%${q}%`, `%${q}%`).all<any>()
            : await env.DB.prepare(
                "SELECT * FROM docs WHERE vendor_id=? ORDER BY created_at DESC"
              ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }

        // GET /api/docs/:id/download — gerar URL assinada ou stream do PDF
        if (req.method === "GET" && p[2] && p[3] === "download") {
          const doc = await env.DB.prepare("SELECT * FROM docs WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!doc) return bad("Documento não encontrado.", 404);

          if (!env.DOCS) return bad("Bucket de documentos não configurado.", 503);
          const obj = await env.DOCS.get(doc.r2_key);
          if (!obj) return bad("Arquivo não encontrado no storage.", 404);

          const headers = new Headers();
          headers.set("Content-Type", "application/pdf");
          headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(doc.nome_arquivo)}"`);
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("Cache-Control", "private, max-age=3600");
          return new Response(obj.body, { status: 200, headers });
        }

        // POST /api/docs — upload de PDF (multipart/form-data)
        if (req.method === "POST") {
          if (!env.DOCS) return bad("Bucket de documentos não configurado. Crie o bucket 'supervenda-docs' no R2.", 503);

          const ct = req.headers.get("content-type") || "";
          if (!ct.includes("multipart/form-data")) return bad("Envie o arquivo como multipart/form-data.", 400);

          let formData: FormData;
          try { formData = await req.formData(); }
          catch { return bad("Falha ao ler o formulário.", 400); }

          const file = formData.get("arquivo") as File | null;
          if (!file) return bad("Campo 'arquivo' obrigatório.", 400);
          if (file.size > 30 * 1024 * 1024) return bad("Arquivo muito grande. Máximo: 30 MB.", 400);

          const nome       = String(formData.get("nome") || file.name).trim();
          const descricao  = String(formData.get("descricao") || "").trim();
          const palavras   = String(formData.get("palavras_chave") || "").trim().toLowerCase();
          const categoria  = String(formData.get("categoria") || "Geral").trim();

          const id = "DC-" + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2, 5);
          const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
          const r2Key = `docs/${vendorId}/${id}.${ext}`;

          const bytes = await file.arrayBuffer();
          await env.DOCS.put(r2Key, bytes, {
            httpMetadata: { contentType: file.type || "application/pdf" },
            customMetadata: { vendorId: effectiveVendorId, docId: id, nome },
          });

          await env.DB.prepare(
            `INSERT INTO docs (id,vendor_id,nome,nome_arquivo,descricao,palavras_chave,categoria,r2_key,tamanho,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(id, effectiveVendorId, nome, file.name, descricao, palavras, categoria,
                 r2Key, file.size, nowISO(), nowISO()).run();

          await logAtividade("criar", "docs", `Upload: ${nome} (${(file.size/1024).toFixed(0)} KB)`);
          const row = await env.DB.prepare("SELECT * FROM docs WHERE id=?").bind(id).first<any>();
          return json(row, 201);
        }

        // PUT /api/docs/:id — atualizar metadados
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          await env.DB.prepare(
            `UPDATE docs SET nome=?,descricao=?,palavras_chave=?,categoria=?,updated_at=? WHERE id=? AND vendor_id=?`
          ).bind(
            String(body.nome||"").trim(), String(body.descricao||"").trim(),
            String(body.palavras_chave||"").trim().toLowerCase(),
            String(body.categoria||"Geral").trim(),
            nowISO(), p[2], vendorId
          ).run();
          const row = await env.DB.prepare("SELECT * FROM docs WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).first<any>();
          return json(row || {});
        }

        // DELETE /api/docs/:id
        if (req.method === "DELETE" && p[2]) {
          const doc = await env.DB.prepare("SELECT * FROM docs WHERE id=? AND vendor_id=?")
            .bind(p[2], effectiveVendorId).first<any>();
          if (!doc) return bad("Não encontrado.", 404);
          if (env.DOCS && doc.r2_key) {
            try { await env.DOCS.delete(doc.r2_key); } catch {}
          }
          await env.DB.prepare("DELETE FROM docs WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          await logAtividade("excluir", "docs", `Doc excluído: ${doc.nome}`);
          return json({ ok: true });
        }
      }

      /** =================== VISION / OCR via Claude =================== **/
      if (p[1] === "vision" && req.method === "POST") {
        if (!env.ANTHROPIC_API_KEY) {
          return bad("ANTHROPIC_API_KEY não configurada no Worker. Adicione como secret no Cloudflare Dashboard.", 503);
        }

        const body = await readJson<{ image: string; media_type?: string; prompt?: string }>(req);
        if (!body.image) return bad("Campo 'image' (base64) obrigatório.", 400);

        const mediaType = body.media_type || "image/jpeg";
        const prompt = body.prompt ||
          `Analise esta imagem (nota fiscal, orçamento, lista de estoque ou tabela de preços) e extraia todos os produtos visíveis.
Para cada produto retorne um JSON array com: nome, codigo, marca, valor_compra, valor_venda, estoque, categoria.
Use 0 para numéricos não visíveis e "" para strings não visíveis.
Infira valor_venda do preço unitário. Se houver quantidade, use como estoque.
Responda APENAS com o JSON array, sem explicações, sem markdown, sem backticks.
Exemplo: [{"nome":"CHAVE FENDA 5MM","codigo":"CF5","marca":"TRAMONTINA","valor_compra":0,"valor_venda":12.90,"estoque":10,"categoria":"FERRAMENTAS"}]`;

        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 2048,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: body.image } },
                { type: "text", text: prompt }
              ]
            }]
          })
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          return bad("Erro na API Claude: " + errText.slice(0, 200), aiResp.status);
        }

        const aiData = await aiResp.json() as any;
        const text = aiData?.content?.[0]?.text || "";
        return json({ text });
      }

      /** =================== CARTOES =================== **/
      if (p[1] === "cartoes") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM cartoes WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || ("CN-" + String(Date.now()).slice(-8));
          await env.DB.prepare(
            `INSERT INTO cartoes (id,vendor_id,nome,cargo,empresa,telefone,email,endereco,obs,foto,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               nome=excluded.nome,cargo=excluded.cargo,empresa=excluded.empresa,
               telefone=excluded.telefone,email=excluded.email,endereco=excluded.endereco,
               obs=excluded.obs,foto=excluded.foto`
          ).bind(id, effectiveVendorId,
            body.nome||"", body.cargo||"", body.empresa||"",
            body.telefone||"", body.email||"", body.endereco||"",
            body.obs||"", body.foto||"", nowISO()
          ).run();
          const row = await env.DB.prepare("SELECT * FROM cartoes WHERE id=?").bind(id).first<any>();
          return json(row || { id });
        }
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          await env.DB.prepare(
            `UPDATE cartoes SET nome=?,cargo=?,empresa=?,telefone=?,email=?,endereco=?,obs=?,foto=?
             WHERE id=? AND vendor_id=?`
          ).bind(body.nome||"", body.cargo||"", body.empresa||"",
            body.telefone||"", body.email||"", body.endereco||"",
            body.obs||"", body.foto||"", p[2], effectiveVendorId
          ).run();
          const row = await env.DB.prepare("SELECT * FROM cartoes WHERE id=?").bind(p[2]).first<any>();
          return json(row || {});
        }
        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM cartoes WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== VISITAS =================== **/
      if (p[1] === "visitas") {
        if (req.method === "GET" && !p[2]) {
          const rows = await env.DB.prepare(
            "SELECT * FROM visitas WHERE vendor_id=? ORDER BY data DESC, created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = String(body.id || "").trim() || ("VS-" + String(Date.now()).slice(-8));
          await env.DB.prepare(
            `INSERT INTO visitas (id,vendor_id,nome,telefone,endereco,cidade,data,resultado,acao,obs,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               nome=excluded.nome,telefone=excluded.telefone,endereco=excluded.endereco,
               cidade=excluded.cidade,data=excluded.data,resultado=excluded.resultado,
               acao=excluded.acao,obs=excluded.obs`
          ).bind(id, effectiveVendorId,
            body.nome||"", body.telefone||"", body.endereco||"",
            body.cidade||"", body.data||"", body.resultado||"",
            body.acao||"", body.obs||"", nowISO()
          ).run();
          const row = await env.DB.prepare("SELECT * FROM visitas WHERE id=?").bind(id).first<any>();
          return json(row || { id });
        }
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          await env.DB.prepare(
            `UPDATE visitas SET nome=?,telefone=?,endereco=?,cidade=?,data=?,resultado=?,acao=?,obs=?
             WHERE id=? AND vendor_id=?`
          ).bind(body.nome||"", body.telefone||"", body.endereco||"",
            body.cidade||"", body.data||"", body.resultado||"",
            body.acao||"", body.obs||"", p[2], effectiveVendorId
          ).run();
          const row = await env.DB.prepare("SELECT * FROM visitas WHERE id=?").bind(p[2]).first<any>();
          return json(row || {});
        }
        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM visitas WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      /** =================== CONTROLE DE ESTOQUE =================== **/

      // Tabelas de estoque (ex: "Estoque Ferramentas", "Estoque Elétrico")
      if (p[1] === "estoque-tabelas") {
        if (req.method === "GET") {
          const rows = await env.DB.prepare(
            "SELECT * FROM estoque_tabelas WHERE vendor_id=? ORDER BY created_at DESC"
          ).bind(effectiveVendorId).all<any>();
          return json(rows.results || []);
        }
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = "ET-" + String(Date.now()).slice(-8);
          await env.DB.prepare(
            `INSERT INTO estoque_tabelas (id,vendor_id,titulo,descricao,created_at)
             VALUES (?,?,?,?,?)`
          ).bind(id, effectiveVendorId, body.titulo||"Nova Tabela", body.descricao||"", nowISO()).run();
          await logAtividade("criar","estoque",`Tabela "${body.titulo||"Nova Tabela"}"`);
          return json({ id, titulo: body.titulo||"Nova Tabela" });
        }
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          await env.DB.prepare(
            "UPDATE estoque_tabelas SET titulo=?,descricao=? WHERE id=? AND vendor_id=?"
          ).bind(body.titulo||"", body.descricao||"", p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM estoque_tabelas WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          await env.DB.prepare("DELETE FROM estoque_itens WHERE tabela_id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      // Itens de uma tabela de estoque
      if (p[1] === "estoque-itens") {
        if (req.method === "GET") {
          const url2 = new URL(req.url);
          const tabelaId = url2.searchParams.get("tabela_id") || "";
          const rows = await env.DB.prepare(
            "SELECT * FROM estoque_itens WHERE vendor_id=? AND tabela_id=? ORDER BY ordem ASC, created_at ASC"
          ).bind(effectiveVendorId, tabelaId).all<any>();
          return json(rows.results || []);
        }
        if (req.method === "POST") {
          const body = await readJson<any>(req);
          const id = "EI-" + String(Date.now()).slice(-8) + Math.random().toString(36).slice(2,5).toUpperCase();
          await env.DB.prepare(
            `INSERT INTO estoque_itens (id,vendor_id,tabela_id,codigo,produto,quantidade,quantidade_min,valor_unit,unidade,obs,bloqueado,bloqueado_por,bloqueado_motivo,ordem,updated_at,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            id, effectiveVendorId, body.tabela_id||"",
            body.codigo||"", body.produto||"",
            Number(body.quantidade||0), Number(body.quantidade_min||0),
            Number(body.valor_unit||0),
            body.unidade||"UN", body.obs||"",
            0, "", "", Number(body.ordem||0),
            nowISO(), nowISO()
          ).run();
          return json({ id });
        }
        if (req.method === "PUT" && p[2]) {
          const body = await readJson<any>(req);
          const item = await env.DB.prepare("SELECT * FROM estoque_itens WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).first<any>();
          if (!item) return bad("Item não encontrado.", 404);

          const vendorRow = await env.DB.prepare("SELECT name FROM vendors WHERE id=?").bind(vendorId).first<any>();
          const nomeUsuario = vendorRow?.name || vendorId;

          // Se mudou bloqueio, registrar quem bloqueou
          let bloqueado = item.bloqueado;
          let bloqueadoPor = item.bloqueado_por || "";
          let bloqueadoMotivo = item.bloqueado_motivo || "";

          if (body.bloqueado !== undefined) {
            bloqueado = body.bloqueado ? 1 : 0;
            bloqueadoPor = body.bloqueado ? nomeUsuario : "";
            bloqueadoMotivo = body.bloqueado ? (body.bloqueado_motivo||"") : "";
          }

          await env.DB.prepare(
            `UPDATE estoque_itens SET
              codigo=?,produto=?,quantidade=?,quantidade_min=?,valor_unit=?,unidade=?,obs=?,
              bloqueado=?,bloqueado_por=?,bloqueado_motivo=?,ordem=?,updated_at=?
             WHERE id=? AND vendor_id=?`
          ).bind(
            body.codigo||item.codigo, body.produto||item.produto,
            Number(body.quantidade??item.quantidade), Number(body.quantidade_min??item.quantidade_min),
            Number(body.valor_unit??item.valor_unit??0),
            body.unidade||item.unidade, body.obs??item.obs,
            bloqueado, bloqueadoPor, bloqueadoMotivo,
            Number(body.ordem||item.ordem), nowISO(),
            p[2], effectiveVendorId
          ).run();

          // Log de bloqueio
          if (body.bloqueado !== undefined) {
            const acao = body.bloqueado ? "bloqueou" : "desbloqueou";
            await logAtividade("editar","estoque",`${nomeUsuario} ${acao} "${item.produto}" ${body.bloqueado_motivo?`— ${body.bloqueado_motivo}`:""}`);
          }

          return json({ ok: true });
        }
        if (req.method === "DELETE" && p[2]) {
          await env.DB.prepare("DELETE FROM estoque_itens WHERE id=? AND vendor_id=?").bind(p[2], effectiveVendorId).run();
          return json({ ok: true });
        }
      }

      return bad("Not found", 404);
    } catch (e: any) {
      return bad("Erro interno", 500, e?.message || String(e));
    }
  },
};
