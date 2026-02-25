// frontend/db.js

function getToken() {
  return localStorage.getItem("token") || "";
}

function setToken(token) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

function getApiBase() {
  // lê sempre o valor atual normalizado do CONFIG/localStorage
  if (window.CONFIG?.getSavedApiBase) return window.CONFIG.getSavedApiBase();

  let raw =
    localStorage.getItem("API_BASE") ||
    localStorage.getItem("apiBase") ||
    "https://supervenda.krasinskyekuroli.workers.dev";

  raw = String(raw).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  raw = raw.replace(/^http:\/\//i, "https://");
  return raw;
}

export async function api(path, opts = {}) {
  const base = getApiBase();
  const url = `${base}${path}`;

  const headers = Object.assign(
    { "Content-Type": "application/json" },
    opts.headers || {}
  );

  const t = getToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;

  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (err) {
    // erro de rede / mixed content / dns / cors
    throw new Error(
      `Falha na conexão com a API (${url}). Verifique se a URL da API está em HTTPS e se o Worker está no ar.`
    );
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  let data = null;
  if (ct.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    const txt = await res.text().catch(() => "");
    data = txt ? { error: txt } : {};
  }

  if (!res.ok) {
    const msg =
      (data && (data.detail || data.error || data.message)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export async function login(email, senha) {
  const r = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, senha }),
  });

  if (r?.token) setToken(r.token);
  return r;
}

export async function me() {
  return api("/api/me");
}

export async function bootstrap() {
  return api("/api/bootstrap");
}

export async function logout() {
  setToken("");
  localStorage.removeItem("usuario");
}
