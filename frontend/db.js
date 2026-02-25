// db.js - camada de acesso à API / auth / helpers
(function () {
  "use strict";

  const TOKEN_KEYS = ["sv_token", "token", "auth_token"];
  const ME_KEYS = ["sv_me"];

  function getConfig() {
    const cfg = window.APP_CONFIG || {};
    let base = (cfg.API_BASE || "").trim();

    // fallback automático para workers.dev se não vier config
    if (!base) {
      base = "https://supervenda.krasinskyekuroli.workers.dev";
    }

    // remove barra final
    base = base.replace(/\/+$/, "");

    // CORREÇÃO DO MIXED CONTENT:
    // se a página está em https, força API_BASE em https também
    if (window.location.protocol === "https:" && base.startsWith("http://")) {
      base = "https://" + base.slice("http://".length);
    }

    return { API_BASE: base };
  }

  function getToken() {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k);
      if (v) return v;
    }
    return "";
  }

  function setToken(token) {
    TOKEN_KEYS.forEach((k) => localStorage.removeItem(k));
    if (token) localStorage.setItem("sv_token", token);
  }

  function clearToken() {
    TOKEN_KEYS.forEach((k) => localStorage.removeItem(k));
  }

  function getMeLocal() {
    for (const k of ME_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        return JSON.parse(raw);
      } catch (_) {}
    }
    return null;
  }

  function setMeLocal(me) {
    if (!me) {
      ME_KEYS.forEach((k) => localStorage.removeItem(k));
      return;
    }
    localStorage.setItem("sv_me", JSON.stringify(me));
  }

  function clearMeLocal() {
    ME_KEYS.forEach((k) => localStorage.removeItem(k));
  }

  function parseMoney(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null) return 0;
    let s = String(v).trim();
    if (!s) return 0;

    // aceita "1.234,56" ou "1234.56"
    s = s.replace(/\s/g, "");
    if (s.includes(",") && s.includes(".")) {
      // assume pt-BR
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }

    const n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function money(v) {
    const n = Number(v || 0);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function safe(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function jparse(v, fallback) {
    if (v == null) return fallback;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch (_) {
      return fallback;
    }
  }

  async function readResponse(res) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      try {
        return await res.json();
      } catch (_) {
        return null;
      }
    }
    try {
      return await res.text();
    } catch (_) {
      return null;
    }
  }

  function normalizeErrorMessage(payload, status) {
    if (payload == null) return `Erro HTTP ${status}`;
    if (typeof payload === "string") return payload || `Erro HTTP ${status}`;
    return (
      payload.error ||
      payload.message ||
      payload.detail ||
      payload.msg ||
      `Erro HTTP ${status}`
    );
  }

  async function api(path, opts = {}) {
    const { API_BASE } = getConfig();
    const url = `${API_BASE}${path.startsWith("/") ? path : "/" + path}`;

    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );

    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers,
      });
    } catch (err) {
      // melhora mensagem de erro de rede
      const msg =
        err?.message?.includes("Failed to fetch")
          ? "Falha de rede/fetch. Verifique se a API está em HTTPS e acessível."
          : err?.message || "Falha de rede.";
      throw new Error(msg);
    }

    const data = await readResponse(res);

    if (!res.ok) {
      const message = normalizeErrorMessage(data, res.status);

      // limpa sessão se token inválido
      if (res.status === 401) {
        // não limpa no bootstrap público? aqui pode limpar para evitar loop
        // mas deixamos o app decidir em alguns fluxos
      }

      const err = new Error(message);
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    return data;
  }

  async function login(email, senha) {
    const r = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    });

    // compatível com backend atual: { token, email, name }
    const token = r?.token || r?.jwt || r?.access_token || "";
    if (!token) throw new Error("Login sem token retornado pela API.");

    setToken(token);

    const me = {
      email: r?.email || email,
      name: r?.name || r?.nome || "Usuário",
      id: r?.id || "",
    };
    setMeLocal(me);

    return { token, me, raw: r };
  }

  async function me() {
    // tenta endpoint /api/me
    try {
      const r = await api("/api/me");
      const payload = {
        id: r?.id || "",
        email: r?.email || "",
        name: r?.name || r?.nome || "Usuário",
      };
      setMeLocal(payload);
      return payload;
    } catch (e) {
      // fallback local se existir
      const local = getMeLocal();
      if (local) return local;
      throw e;
    }
  }

  async function bootstrap() {
    return api("/api/bootstrap");
  }

  async function logoutLocal() {
    clearToken();
    clearMeLocal();
  }

  // expõe no window
  window.DB = {
    getConfig,
    getToken,
    setToken,
    clearToken,
    getMeLocal,
    setMeLocal,
    clearMeLocal,
    api,
    login,
    me,
    bootstrap,
    logoutLocal,
    parseMoney,
    money,
    safe,
    jparse,
  };
})();