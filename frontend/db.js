(function () {
  const C = window.CONFIG || {};
  const ENDPOINTS = (C && C.ENDPOINTS) || {};
  const KEYS = (C && C.STORAGE_KEYS) || {
    TOKEN: "supervenda_token",
    USER: "supervenda_user",
    API_BASE: "supervenda_api_base",
  };

  function getToken() {
    return localStorage.getItem(KEYS.TOKEN) || "";
  }

  function setToken(token) {
    if (token) localStorage.setItem(KEYS.TOKEN, token);
    else localStorage.removeItem(KEYS.TOKEN);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.USER) || "null");
    } catch {
      return null;
    }
  }

  function setUser(user) {
    if (user) localStorage.setItem(KEYS.USER, JSON.stringify(user));
    else localStorage.removeItem(KEYS.USER);
  }

  function clearSession() {
    setToken("");
    setUser(null);
  }

  function apiBase() {
    const runtimeBase =
      (window.CONFIG && window.CONFIG.API_BASE) ||
      localStorage.getItem(KEYS.API_BASE) ||
      "";
    return String(runtimeBase).replace(/\/+$/, "");
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

  function errMsg(data, fallback) {
    if (!data) return fallback;
    if (typeof data === "string") return data;
    if (data.error && data.detail) return `${data.error}: ${data.detail}`;
    if (data.error) return String(data.error);
    if (data.message) return String(data.message);
    return fallback;
  }

  async function request(path, opts = {}) {
    const url = joinUrl(apiBase(), path);
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { ...opts, headers });
    } catch (e) {
      const err = new Error("Falha de conexão com a API.");
      err.code = "NETWORK";
      err.detail = e?.message || String(e);
      throw err;
    }

    const data = await parseResponse(res);
    if (!res.ok) {
      const err = new Error(errMsg(data, `Erro HTTP ${res.status}`));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function requestAny(paths, opts = {}) {
    let lastErr = null;
    for (const p of paths) {
      try {
        const data = await request(p, opts);
        return { data, path: p };
      } catch (e) {
        lastErr = e;
        if (e && e.status === 404) continue;
        throw e;
      }
    }
    throw lastErr || new Error("Rota não encontrada.");
  }

  // ---------------- Auth ----------------
  async function login(email, senha) {
    const data = await request(ENDPOINTS.login || "/api/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });

    const token = data?.token || data?.access_token || data?.jwt || "";
    const user = data?.user || null;

    if (!token) throw new Error("Login retornou sem token.");

    setToken(token);
    if (user) setUser(user);
    return data;
  }

  async function register(payload) {
    return await request(ENDPOINTS.register || "/api/register", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function me() {
    const data = await request(ENDPOINTS.me || "/api/me", { method: "GET" });
    if (data?.user) setUser(data.user);
    return data;
  }

  async function bootstrap() {
    return await request(ENDPOINTS.bootstrap || "/api/bootstrap", { method: "GET" });
  }

  async function health() {
    return await request(ENDPOINTS.health || "/api/health", { method: "GET" });
  }

  // ---------------- Users (admin) ----------------
  async function listUsers() {
    return await request(ENDPOINTS.users || "/api/users", { method: "GET" });
  }

  async function createUser(payload) {
    return await request(ENDPOINTS.users || "/api/users", {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  async function updateUser(id, payload) {
    return await request(`${ENDPOINTS.users || "/api/users"}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload || {}),
    });
  }

  // ---------------- Backup ----------------
  async function backup() {
    try {
      const data = await request(ENDPOINTS.backup || "/api/backup", { method: "GET" });
      return { mode: "remote", data };
    } catch (err) {
      if (err?.status && err.status !== 404) throw err;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      apiBase: apiBase(),
      user: getUser(),
      data: {},
    };

    const resources = ["clientes", "mercadorias", "pedidos", "rotas", "despesas", "lembretes"];
    for (const r of resources) {
      try {
        payload.data[r] = await list(r);
      } catch (e) {
        payload.data[r] = { _error: e.message || "Falha ao exportar" };
      }
    }

    return { mode: "local", data: payload };
  }

  // ---------------- CRUD genérico ----------------
  const resourcePaths = {
    clientes: [ENDPOINTS.clientes || "/api/clientes"],
    mercadorias: [
      ENDPOINTS.mercadorias || "/api/mercadorias",
      ENDPOINTS.produtos || "/api/produtos",
    ],
    produtos: [ENDPOINTS.produtos || "/api/produtos"],
    pedidos: [ENDPOINTS.pedidos || "/api/pedidos"],
    rotas: [ENDPOINTS.rotas || "/api/rotas"],
    despesas: [ENDPOINTS.despesas || "/api/despesas"],
    lembretes: [ENDPOINTS.lembretes || "/api/lembretes"],
    notas: [ENDPOINTS.notas || "/api/notas"],
  };

  function getResourcePaths(resource) {
    const paths = resourcePaths[resource];
    if (!paths) throw new Error(`Recurso inválido: ${resource}`);
    return paths.filter(Boolean);
  }

  async function list(resource) {
    const { data } = await requestAny(getResourcePaths(resource), { method: "GET" });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }

  async function create(resource, payload) {
    const { data } = await requestAny(getResourcePaths(resource), {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
    return data;
  }

  async function update(resource, id, payload) {
    const paths = getResourcePaths(resource).map(
      (p) => `${p}/${encodeURIComponent(id)}`
    );
    const { data } = await requestAny(paths, {
      method: "PUT",
      body: JSON.stringify(payload || {}),
    });
    return data;
  }

  async function remove(resource, id) {
    const paths = getResourcePaths(resource).map(
      (p) => `${p}/${encodeURIComponent(id)}`
    );
    const { data } = await requestAny(paths, { method: "DELETE" });
    return data;
  }

  window.DB = {
    getToken,
    setToken,
    getUser,
    setUser,
    clearSession,

    request,
    health,
    login,
    register,
    me,
    bootstrap,

    listUsers,
    createUser,
    updateUser,

    list,
    create,
    update,
    remove,

    backup,
  };
})();