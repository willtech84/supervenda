// config.js
(function () {
  const saved = localStorage.getItem("supervenda_api_base") || "";

  function normalizeApiBase(url) {
    let u = (url || "").trim();

    // fallback padrão
    if (!u) {
      u = "https://supervenda.krasinskyekuroli.workers.dev";
    }

    // se vier sem protocolo, força https
    if (!/^https?:\/\//i.test(u)) {
      u = "https://" + u.replace(/^\/+/, "");
    }

    // remove barra final
    u = u.replace(/\/+$/, "");

    return u;
  }

  const API_BASE = normalizeApiBase(saved);

  window.CONFIG = {
    APP_NAME: "Vendas Externas Pro",
    API_BASE,
    STORAGE_KEYS: {
      TOKEN: "supervenda_token",
      USER: "supervenda_user",
      API_BASE: "supervenda_api_base",
    },
    ENDPOINTS: {
      health: "/api/health",
      login: "/api/login",
      me: "/api/me",
      bootstrap: "/api/bootstrap",

      clientes: "/api/clientes",
      mercadorias: "/api/mercadorias", // se backend usar /produtos, o db.js já tenta fallback
      produtos: "/api/produtos",
      rotas: "/api/rotas",
      despesas: "/api/despesas",
      lembretes: "/api/lembretes",
      pedidos: "/api/pedidos",

      backup: "/api/backup",
    },
  };

  window.setApiBase = function setApiBase(newBase) {
    const normalized = normalizeApiBase(newBase);
    localStorage.setItem(window.CONFIG.STORAGE_KEYS.API_BASE, normalized);
    window.location.reload();
  };
})();