// frontend/config.js
(function () {
  const DEFAULT_API_BASE = "https://supervenda.krasinskyekuroli.workers.dev";

  function normalizeApiBase(url) {
    if (!url || typeof url !== "string") return DEFAULT_API_BASE;

    let u = url.trim();

    // remove barra final
    u = u.replace(/\/+$/, "");

    // se vier sem protocolo, força https
    if (!/^https?:\/\//i.test(u)) {
      u = "https://" + u;
    }

    // se vier http, força https (evita Mixed Content no Pages)
    u = u.replace(/^http:\/\//i, "https://");

    return u;
  }

  function getSavedApiBase() {
    const saved =
      localStorage.getItem("API_BASE") ||
      localStorage.getItem("apiBase") ||
      "";
    return normalizeApiBase(saved);
  }

  function setApiBase(url) {
    const normalized = normalizeApiBase(url);
    localStorage.setItem("API_BASE", normalized);
    localStorage.setItem("apiBase", normalized); // compatibilidade
    return normalized;
  }

  window.CONFIG = {
    API_BASE: getSavedApiBase(),
    DEFAULT_API_BASE,
    normalizeApiBase,
    getSavedApiBase,
    setApiBase,
  };
})();
