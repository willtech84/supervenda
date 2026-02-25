// db.js
(function () {
  const C = window.CONFIG;

  function getToken() {
    return localStorage.getItem(C.STORAGE_KEYS.TOKEN) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(C.STORAGE_KEYS.TOKEN, token);
    else localStorage.removeItem(C.STORAGE_KEYS.TOKEN);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(C.STORAGE_KEYS.USER) || "null");
    } catch {
      return null;
    }
  }

  function setUser(user) {
    if (user) localStorage.setItem(C.STORAGE_KEYS.USER, JSON.stringify(user));
    else localStorage.removeItem(C.STORAGE_KEYS.USER);
  }

  function clearSession() {
    setToken("");
    setUser(null);
  }

  function joinUrl(base, path) {
    return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
  }

  async function parseResponse(res) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }

    try {
      const text = await res.text();
      return text ? { raw: text } : null;
    } catch {
      return null;
    }
  }

  function extractErrorMessage(data, fallback) {
    if (!data) return fallback;
    if (typeof data === "string") return data;
    if (data.error && data.detail) return `${data.error}: ${data.detail}`;
    if (data.error) return String(data.error);
    if (data.message) return String(data.message);
    if (data.detail) return String(data.detail);
    return fallback;
  }

  async function request(path, opts = {}) {
    const url = joinUrl(C.API_BASE, path);

    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { ...opts, headers });
    } catch (err) {
      const e = new Error("Falha de conexão com a API.");
      e.code = "NETWORK";
      e.detail = err?.message || String(err);
      throw e;
    }

    const data = await parseResponse(res);

    if (!res.ok) {
      const e = new Error(extractErrorMessage(data, `Erro HTTP ${res.status}`));
      e.status = res.status;
      e.data = data;
      throw e;
    }

    return data;
  }

  // tenta vários endpoints (fallback)
  async function requestAny(paths, opts = {}) {
    let lastErr = null;

    for (const p of paths) {
      try {
        const data = await request(p, opts);
        return { data, path: p };
      } catch (err) {
        lastErr = err;
        // se for 404, tenta próximo endpoint
        if (err?.status === 404) continue;
        // outros erros param (401/500 etc)
        throw err;
      }
    }

    throw lastErr || new Error("Rota não encontrada.");
  }

  // ---------- Auth ----------
  async function login(email, senha) {
    const data = await request(C.ENDPOINTS.login, {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });

    // suporta formatos diferentes do backend
    const token = data?.token || data?.access_token || data?.jwt || "";
    const user =
      data?.user || {
        email: data?.email || email,
        name: data?.name || "Usuário",
      };

    if (!token) {
      throw new Error("Login retornou sem token.");
    }

    setToken(token);
    setUser(user);
    return { token, user, raw: data };
  }

  async function me() {
    return await request(C.ENDPOINTS.me, { method: "GET" });
  }

  async function bootstrap() {
    return await request(C.ENDPOINTS.bootstrap, { method: "GET" });
  }

  // ---------- Backup ----------
  async function backup() {
    // tenta endpoint de backup; se não existir, faz backup local via múltiplas listas
    try {
      const data = await request(C.ENDPOINTS.backup, { method: "GET" });
      return { mode: "remote", data };
    } catch (err) {
      if (err?.status && err.status !== 404) throw err;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      apiBase: C.API_BASE,
      user: getUser(),
      data: {},
    };

    const resources = [
      "clientes",
      "mercadorias",
      "rotas",
      "despesas",
      "lembretes",
      "pedidos",
    ];

    for (const r of resources) {
      try {
        payload.data[r] = await list(r);
      } catch (e) {
        payload.data[r] = { _error: e.message || "Falha ao exportar" };
      }
    }

    return { mode: "local", data: payload };
  }

  // ---------- CRUD ----------
  const resourceMap = {
    clientes: [C.ENDPOINTS.clientes],
    mercadorias: [C.ENDPOINTS.mercadorias, C.ENDPOINTS.produtos], // fallback
    rotas: [C.ENDPOINTS.rotas],
    despesas: [C.ENDPOINTS.despesas],
    lembretes: [C.ENDPOINTS.lembretes],
    pedidos: [C.ENDPOINTS.pedidos],
  };

  function getResourcePaths(resource) {
    const paths = resourceMap[resource];
    if (!paths) throw new Error(`Recurso inválido: ${resource}`);
    return paths.filter(Boolean);
  }

  async function list(resource) {
    const { data } = await requestAny(getResourcePaths(resource), { method: "GET" });

    // backend pode retornar array direto ou objeto com items/data
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }

  async function create(resource, payload) {
    const { data } = await requestAny(getResourcePaths(resource), {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return data;
  }

  async function update(resource, id, payload) {
    const paths = getResourcePaths(resource).map((p) => `${p}/${encodeURIComponent(id)}`);
    const { data } = await requestAny(paths, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return data;
  }

  async function remove(resource, id) {
    const paths = getResourcePaths(resource).map((p) => `${p}/${encodeURIComponent(id)}`);
    const { data } = await requestAny(paths, { method: "DELETE" });
    return data;
  }

  window.DB = {
    // sessão
    getToken,
    setToken,
    getUser,
    setUser,
    clearSession,

    // auth
    login,
    me,
    bootstrap,

    // CRUD
    list,
    create,
    update,
    remove,

    // backup
    backup,

    // baixo nível (útil p/ debug)
    request,
  };
})();