// frontend/app.js
import { api, login, logout, bootstrap, me } from "./db.js";

/* =========================================================
   SUPERVENDA FRONTEND APP (V2.2 - CRUD completo de telas)
   Compatível com backend Cloudflare Worker / D1
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  route: location.hash.replace("#", "") || "dashboard",
  q: "",
  loading: false,
  user: null,
  data: {
    clientes: [],
    produtos: [],    // mercadorias
    rotas: [],
    despesas: [],
    lembretes: [],
    pedidos: [],
    notas: [],
    counters: {},
  },
};

const ROUTES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clientes", label: "Clientes" },
  { id: "mercadorias", label: "Mercadorias" },
  { id: "pedidos", label: "Pedidos/Vendas" },
  { id: "rotas", label: "Rotas" },
  { id: "despesas", label: "Despesas" },
  { id: "lembretes", label: "Lembretes/Campanhas" },
  { id: "anotacoes", label: "Anotações" },
];

// Mapeia nome da rota -> endpoint backend
const ENDPOINTS = {
  clientes: "/api/clientes",
  mercadorias: "/api/produtos",
  produtos: "/api/produtos",
  rotas: "/api/rotas",
  despesas: "/api/despesas",
  lembretes: "/api/lembretes",
  pedidos: "/api/pedidos",
  anotacoes: "/api/notas",
  notas: "/api/notas",
};

const TITLES = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  mercadorias: "Mercadorias",
  pedidos: "Pedidos/Vendas",
  rotas: "Rotas",
  despesas: "Despesas",
  lembretes: "Lembretes/Campanhas",
  anotacoes: "Anotações",
};

const FIELD_SCHEMAS = {
  clientes: [
    { key: "nome", label: "Nome", type: "text", required: true },
    { key: "telefone", label: "Telefone", type: "text" },
    { key: "cidade", label: "Cidade", type: "text" },
    { key: "endereco", label: "Endereço", type: "text" },
    { key: "bairro", label: "Bairro", type: "text" },
    { key: "email", label: "E-mail", type: "email" },
    { key: "obs", label: "Observações", type: "textarea" },
  ],
  mercadorias: [
    { key: "marca", label: "Marca", type: "text" },
    { key: "produto", label: "Produto", type: "text", required: true },
    { key: "modelo", label: "Modelo", type: "text" },
    { key: "categoria", label: "Categoria", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "valorCompra", label: "Valor compra", type: "money" },
    { key: "valorVenda", label: "Valor venda", type: "money" },
    { key: "estoqueAtual", label: "Estoque atual", type: "number" },
    { key: "estoqueMin", label: "Estoque mínimo", type: "number" },
    { key: "local", label: "Local", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["ativo", "inativo"] },
    { key: "descricao", label: "Descrição", type: "textarea" },
  ],
  rotas: [
    { key: "nome", label: "Nome da rota", type: "text", required: true },
    { key: "cidade", label: "Cidade", type: "text" },
    { key: "bairro", label: "Bairro", type: "text" },
    { key: "diaSemana", label: "Dia da semana", type: "text" },
    { key: "ordem", label: "Ordem", type: "number" },
    { key: "status", label: "Status", type: "select", options: ["ativo", "inativo"] },
    { key: "obs", label: "Observações", type: "textarea" },
  ],
  despesas: [
    { key: "data", label: "Data", type: "date", required: true },
    { key: "categoria", label: "Categoria", type: "text", required: true },
    { key: "descricao", label: "Descrição", type: "text", required: true },
    { key: "valor", label: "Valor", type: "money", required: true },
    { key: "formaPagamento", label: "Forma de pagamento", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["aberta", "paga", "cancelada"] },
    { key: "obs", label: "Observações", type: "textarea" },
  ],
  lembretes: [
    { key: "titulo", label: "Título", type: "text", required: true },
    { key: "data", label: "Data", type: "date" },
    { key: "hora", label: "Hora", type: "time" },
    { key: "tipo", label: "Tipo", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["pendente", "feito", "cancelado"] },
    { key: "descricao", label: "Descrição", type: "textarea" },
  ],
  pedidos: [
    { key: "data", label: "Data", type: "date", required: true },
    { key: "clienteId", label: "Cliente", type: "cliente-select" },
    { key: "clienteNome", label: "Cliente (texto)", type: "text" },
    { key: "status", label: "Status", type: "select", options: ["aberto", "negociando", "faturado", "pago", "cancelado"] },
    { key: "urgencia", label: "Urgência", type: "select", options: ["", "Baixa", "Média", "Alta"] },
    { key: "formaPagamento", label: "Forma de pagamento", type: "text" },
    { key: "prazoDias", label: "Prazo (dias)", type: "number" },
    { key: "total", label: "Total", type: "money" },
    { key: "obs", label: "Observações", type: "textarea" },
    { key: "itens", label: "Itens (JSON)", type: "textarea-json" },
  ],
  anotacoes: [
    { key: "titulo", label: "Título", type: "text", required: true },
    { key: "conteudo", label: "Conteúdo", type: "textarea", required: true },
    { key: "categoria", label: "Categoria", type: "text" },
  ],
};

/* ===========================
   Utils
=========================== */
function safe(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function jparse(v, fallback = null) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseMoney(input) {
  if (input == null) return 0;
  if (typeof input === "number") return input;
  let s = String(input).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, "");
  // aceita "1.234,56" e "1234.56"
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function uid(prefix = "tmp") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function guessId(item) {
  return item?.id || item?._id || item?.codigo || item?.uuid || null;
}

function deepClone(x) {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
}

/* ===========================
   UI Base
=========================== */
function injectBaseStyles() {
  if ($("#sv-extra-styles")) return;
  const st = document.createElement("style");
  st.id = "sv-extra-styles";
  st.textContent = `
    .sv-topbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .sv-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .sv-btn{border:1px solid rgba(255,255,255,.18);background:#0e2347;color:#fff;padding:8px 12px;border-radius:10px;cursor:pointer}
    .sv-btn:hover{filter:brightness(1.08)}
    .sv-btn.secondary{background:#0b1630}
    .sv-btn.danger{border-color:#ff5f6d;background:#2b0f16}
    .sv-btn.success{border-color:#29d17d;background:#0f2a1d}
    .sv-btn.small{padding:6px 10px;font-size:12px}
    .sv-grid{display:grid;gap:10px}
    .sv-grid.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
    .sv-grid.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
    .sv-grid.cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
    .sv-card{border:1px solid rgba(255,255,255,.08);background:rgba(18,34,70,.55);border-radius:14px;padding:12px}
    .sv-card h3{margin:0 0 8px 0}
    .sv-kpi{font-size:24px;font-weight:700}
    .sv-muted{opacity:.75;font-size:12px}
    .sv-table{width:100%;border-collapse:separate;border-spacing:0 8px}
    .sv-table th{opacity:.8;font-weight:600;font-size:12px;text-align:left;padding:6px 8px}
    .sv-table td{background:rgba(9,18,36,.85);padding:10px 8px;border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}
    .sv-table td:first-child{border-left:1px solid rgba(255,255,255,.06);border-radius:10px 0 0 10px}
    .sv-table td:last-child{border-right:1px solid rgba(255,255,255,.06);border-radius:0 10px 10px 0}
    .sv-row-actions{display:flex;gap:6px;flex-wrap:wrap}
    .sv-badge{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.15);font-size:11px}
    .sv-input,.sv-select,.sv-textarea{width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#091224;color:#fff;padding:10px}
    .sv-textarea{min-height:100px;resize:vertical}
    .sv-label{display:block;font-size:12px;opacity:.85;margin-bottom:6px}
    .sv-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .sv-form-grid .full{grid-column:1/-1}
    .sv-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px}
    .sv-modal{width:min(980px,96vw);max-height:92vh;overflow:auto;background:#081126;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:14px;color:#fff}
    .sv-modal-header{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px}
    .sv-modal-footer{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px}
    .sv-toast-wrap{position:fixed;right:14px;bottom:14px;display:grid;gap:8px;z-index:10001}
    .sv-toast{padding:10px 12px;border-radius:10px;background:#0d1f43;border:1px solid rgba(255,255,255,.1);color:#fff;min-width:240px;box-shadow:0 6px 20px rgba(0,0,0,.3)}
    .sv-toast.error{background:#301018;border-color:#ff7f90}
    .sv-toast.ok{background:#0d2c1b;border-color:#37d787}
    .sv-overlay-loading{position:fixed;inset:0;background:rgba(0,0,0,.28);display:none;align-items:center;justify-content:center;z-index:10000}
    .sv-overlay-loading.show{display:flex}
    .sv-loader-box{background:#081126;border:1px solid rgba(255,255,255,.12);padding:14px 16px;border-radius:12px}
    .sv-menu{position:relative}
    .sv-dropdown{position:absolute;right:0;top:40px;min-width:200px;background:#081126;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:8px;display:none;z-index:10002}
    .sv-dropdown.show{display:block}
    .sv-dropdown button{width:100%;text-align:left;background:transparent;border:none;color:#fff;padding:8px 10px;border-radius:8px;cursor:pointer}
    .sv-dropdown button:hover{background:rgba(255,255,255,.06)}
    .sv-inline-note{font-size:12px;opacity:.85;margin-top:6px}
    .sv-empty{opacity:.7;padding:12px;border:1px dashed rgba(255,255,255,.12);border-radius:10px}
    .sv-json-help{font-size:12px;opacity:.75}
    @media (max-width: 900px){
      .sv-grid.cols-2,.sv-grid.cols-3,.sv-grid.cols-4,.sv-form-grid{grid-template-columns:1fr}
      .sv-modal{width:96vw}
    }
  `;
  document.head.appendChild(st);
}

function ensureShell() {
  injectBaseStyles();

  let root = $("#sv-app-root");
  if (root) return root;

  // Tenta reaproveitar layout já existente
  const mainArea =
    $("#app") ||
    $("#view") ||
    document.querySelector("main") ||
    document.body;

  root = document.createElement("div");
  root.id = "sv-app-root";
  mainArea.appendChild(root);

  const toastWrap = document.createElement("div");
  toastWrap.className = "sv-toast-wrap";
  toastWrap.id = "sv-toast-wrap";
  document.body.appendChild(toastWrap);

  const overlay = document.createElement("div");
  overlay.className = "sv-overlay-loading";
  overlay.id = "sv-loading";
  overlay.innerHTML = `<div class="sv-loader-box">Carregando...</div>`;
  document.body.appendChild(overlay);

  return root;
}

function showLoading(msg = "Carregando...") {
  const box = $("#sv-loading");
  if (!box) return;
  $(".sv-loader-box", box).textContent = msg;
  box.classList.add("show");
  state.loading = true;
}

function hideLoading() {
  const box = $("#sv-loading");
  if (!box) return;
  box.classList.remove("show");
  state.loading = false;
}

function toast(message, type = "ok", timeout = 3500) {
  const wrap = $("#sv-toast-wrap");
  if (!wrap) return alert(message);
  const el = document.createElement("div");
  el.className = `sv-toast ${type === "error" ? "error" : "ok"}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(4px)";
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

function confirmAsync(message) {
  return Promise.resolve(window.confirm(message));
}

function openModal(title, contentHtml, { width = "980px" } = {}) {
  const bd = document.createElement("div");
  bd.className = "sv-modal-backdrop";
  bd.innerHTML = `
    <div class="sv-modal" style="width:min(${width},96vw)">
      <div class="sv-modal-header">
        <h3 style="margin:0">${safe(title)}</h3>
        <button class="sv-btn small secondary" data-close>X Fechar</button>
      </div>
      <div class="sv-modal-body">${contentHtml}</div>
    </div>
  `;
  document.body.appendChild(bd);

  const apiModal = {
    el: bd,
    box: $(".sv-modal", bd),
    close() {
      bd.remove();
      document.removeEventListener("keydown", onEsc);
    },
  };

  bd.addEventListener("click", (e) => {
    if (e.target === bd) apiModal.close();
  });
  $$("[data-close]", bd).forEach((b) => (b.onclick = () => apiModal.close()));

  function onEsc(e) {
    if (e.key === "Escape") apiModal.close();
  }
  document.addEventListener("keydown", onEsc);

  return apiModal;
}

/* ===========================
   Auth / Session
=========================== */
function getSavedUser() {
  return jparse(localStorage.getItem("usuario"), null);
}

function setSavedUser(user) {
  if (user) localStorage.setItem("usuario", JSON.stringify(user));
  else localStorage.removeItem("usuario");
}

async function ensureAuth() {
  // Se já há token, tenta obter dados
  try {
    const u = await me();
    state.user = u || getSavedUser() || { nome: "Vendedor" };
    setSavedUser(state.user);
    return true;
  } catch {
    // Sem token válido -> login modal
    return openLoginModal();
  }
}

function openLoginModal() {
  return new Promise((resolve) => {
    const modal = openModal(
      "Entrar",
      `
      <div class="sv-form-grid">
        <div class="full">
          <div class="sv-muted">Use o vendedor já criado no D1 (ex.: <b>vendedor@exemplo.com</b>).</div>
        </div>
        <div>
          <label class="sv-label">E-mail</label>
          <input id="sv_login_email" class="sv-input" type="email" placeholder="vendedor@exemplo.com" />
        </div>
        <div>
          <label class="sv-label">Senha</label>
          <input id="sv_login_senha" class="sv-input" type="password" placeholder="••••••" />
        </div>
      </div>
      <div class="sv-modal-footer">
        <button id="sv_login_cancel" class="sv-btn secondary">Cancelar</button>
        <button id="sv_login_submit" class="sv-btn success">Entrar</button>
      </div>
      `
    );

    $("#sv_login_cancel", modal.box).onclick = () => {
      modal.close();
      resolve(false);
    };

    $("#sv_login_submit", modal.box).onclick = async () => {
      const email = $("#sv_login_email", modal.box).value.trim();
      const senha = $("#sv_login_senha", modal.box).value.trim();
      if (!email || !senha) {
        toast("Informe e-mail e senha.", "error");
        return;
      }
      try {
        showLoading("Entrando...");
        const r = await login(email, senha);
        state.user = { email, ...(r || {}) };
        setSavedUser(state.user);
        modal.close();
        toast("Login realizado com sucesso.");
        resolve(true);
      } catch (err) {
        toast(err.message || "Falha no login.", "error", 5000);
      } finally {
        hideLoading();
      }
    };
  });
}

async function doLogout() {
  try {
    await logout();
  } catch {}
  state.user = null;
  setSavedUser(null);
  toast("Sessão encerrada.");
  const ok = await openLoginModal();
  if (ok) {
    await refreshAll();
    render();
  }
}

async function doTrocarUsuario() {
  try {
    await logout();
  } catch {}
  state.user = null;
  setSavedUser(null);
  const ok = await openLoginModal();
  if (ok) {
    await refreshAll();
    render();
  }
}

/* ===========================
   Data Layer / Backend
=========================== */
function normalizeBootstrapData(raw) {
  const out = {
    clientes: [],
    produtos: [],
    rotas: [],
    despesas: [],
    lembretes: [],
    pedidos: [],
    notas: [],
    counters: {},
  };

  if (!raw) return out;

  // backend pode retornar direto ou dentro de data
  const base = raw.data && isObj(raw.data) ? raw.data : raw;

  out.clientes = Array.isArray(base.clientes) ? base.clientes : [];
  out.produtos = Array.isArray(base.produtos) ? base.produtos : [];
  out.rotas = Array.isArray(base.rotas) ? base.rotas : [];
  out.despesas = Array.isArray(base.despesas) ? base.despesas : [];
  out.lembretes = Array.isArray(base.lembretes) ? base.lembretes : [];
  out.pedidos = Array.isArray(base.pedidos) ? base.pedidos : [];
  out.notas = Array.isArray(base.notas) ? base.notas : [];
  out.counters = isObj(base.counters) ? base.counters : {};

  return out;
}

async function refreshAll() {
  showLoading("Carregando dados...");
  try {
    const raw = await bootstrap();
    state.data = normalizeBootstrapData(raw);
  } catch (err) {
    // fallback: tenta carregar endpoints separados
    console.warn("bootstrap falhou, tentando endpoints separados:", err);
    const keys = ["clientes", "mercadorias", "rotas", "despesas", "lembretes", "pedidos", "anotacoes"];
    await Promise.all(
      keys.map(async (k) => {
        try {
          const list = await fetchList(k);
          assignList(k, list);
        } catch (e) {
          console.warn("falha ao carregar", k, e);
          assignList(k, []);
        }
      })
    );
  } finally {
    hideLoading();
  }
}

function routeToDataKey(route) {
  if (route === "mercadorias") return "produtos";
  if (route === "anotacoes") return "notas";
  return route;
}

function assignList(route, arr) {
  const k = routeToDataKey(route);
  state.data[k] = Array.isArray(arr) ? arr : [];
}

function getList(route) {
  return state.data[routeToDataKey(route)] || [];
}

function endpointByRoute(route) {
  return ENDPOINTS[route] || `/${route}`;
}

async function fetchList(route) {
  const endpoint = endpointByRoute(route);
  const res = await api(endpoint);
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.rows)) return res.rows;
  // alguns endpoints podem responder objeto único
  return [];
}

async function saveEntity(route, payload) {
  const endpoint = endpointByRoute(route);
  return api(endpoint, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function deleteEntity(route, id) {
  const endpoint = endpointByRoute(route);
  return api(`${endpoint}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

function upsertInState(route, saved) {
  const list = getList(route);
  const id = guessId(saved);
  if (!id) {
    list.unshift(saved);
    assignList(route, list);
    return;
  }
  const idx = list.findIndex((x) => String(guessId(x)) === String(id));
  if (idx >= 0) list[idx] = { ...list[idx], ...saved };
  else list.unshift(saved);
  assignList(route, [...list]);
}

function removeFromState(route, id) {
  assignList(
    route,
    getList(route).filter((x) => String(guessId(x)) !== String(id))
  );
}

/* ===========================
   Render Helpers
=========================== */
function pageShell({ title, subtitle = "", actionsHtml = "", bodyHtml = "" }) {
  return `
    <div class="sv-topbar">
      <div>
        <div class="sv-muted">Você está em:</div>
        <h2 style="margin:0">${safe(title)}</h2>
        ${subtitle ? `<div class="sv-inline-note">${safe(subtitle)}</div>` : ""}
      </div>
      <div class="sv-actions">${actionsHtml}</div>
    </div>
    <div style="height:10px"></div>
    ${bodyHtml}
  `;
}

function searchBarValue() {
  return state.q || "";
}

function userMenuHtml() {
  const nome = state.user?.nome || state.user?.name || state.user?.email || "Usuário";
  return `
    <div class="sv-menu">
      <button id="sv_user_btn" class="sv-btn secondary">👤 ${safe(nome)}</button>
      <div id="sv_user_dd" class="sv-dropdown">
        <button id="sv_user_me">Conta: ${safe(state.user?.email || "-")}</button>
        <button id="sv_user_trocar">Trocar usuário</button>
        <button id="sv_user_sair">Sair</button>
      </div>
    </div>
  `;
}

function globalTopActionsHtml() {
  return `
    <input id="sv_q" class="sv-input" style="width:280px;max-width:100%" placeholder="Buscar (cliente, produto...)" value="${safe(searchBarValue())}" />
    <button id="sv_backup_btn" class="sv-btn">💾 Backup</button>
    <button id="sv_refresh_btn" class="sv-btn secondary">↻ Atualizar</button>
    <button id="sv_print_btn" class="sv-btn secondary">🖨️ Imprimir</button>
    ${userMenuHtml()}
  `;
}

function bindGlobalActions() {
  const q = $("#sv_q");
  if (q) {
    q.oninput = () => {
      state.q = q.value.trim().toLowerCase();
      render();
    };
  }

  const backupBtn = $("#sv_backup_btn");
  if (backupBtn) backupBtn.onclick = downloadBackupJSON;

  const refreshBtn = $("#sv_refresh_btn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      try {
        showLoading("Atualizando...");
        await refreshAll();
        render();
        toast("Dados atualizados.");
      } catch (e) {
        toast(e.message || "Falha ao atualizar.", "error");
      } finally {
        hideLoading();
      }
    };
  }

  const printBtn = $("#sv_print_btn");
  if (printBtn) printBtn.onclick = () => window.print();

  const userBtn = $("#sv_user_btn");
  const dd = $("#sv_user_dd");
  if (userBtn && dd) {
    userBtn.onclick = (e) => {
      e.stopPropagation();
      dd.classList.toggle("show");
    };
    document.addEventListener("click", (e) => {
      if (!dd.contains(e.target) && e.target !== userBtn) dd.classList.remove("show");
    });
  }

  const btTrocar = $("#sv_user_trocar");
  const btSair = $("#sv_user_sair");
  if (btTrocar) btTrocar.onclick = doTrocarUsuario;
  if (btSair) btSair.onclick = doLogout;
}

function mountSidebarBindings() {
  // tenta conectar com seu menu lateral já existente
  ROUTES.forEach((r) => {
    const candidates = [
      `[data-route="${r.id}"]`,
      `[href="#${r.id}"]`,
      `#menu_${r.id}`,
      `#${r.id}`,
    ];
    for (const c of candidates) {
      const el = document.querySelector(c);
      if (el) {
        el.onclick = (ev) => {
          ev.preventDefault?.();
          navigate(r.id);
        };
      }
    }
  });

  window.addEventListener("hashchange", () => {
    const h = location.hash.replace("#", "") || "dashboard";
    state.route = h;
    render();
  });
}

function navigate(route) {
  state.route = route;
  location.hash = route;
  render();
}

/* ===========================
   Dashboard
=========================== */
function renderDashboard(root) {
  const clientes = getList("clientes");
  const produtos = getList("mercadorias");
  const pedidos = getList("pedidos");
  const despesas = getList("despesas");

  const totalEstoque = produtos.reduce((acc, p) => acc + Number(p.estoqueAtual || 0), 0);
  const valorEstoque = produtos.reduce(
    (acc, p) => acc + Number(p.estoqueAtual || 0) * Number(p.valorCompra || 0),
    0
  );
  const totalVendas = pedidos.reduce((acc, p) => acc + Number(p.total || 0), 0);
  const totalDespesas = despesas.reduce((acc, d) => acc + Number(d.valor || 0), 0);

  root.innerHTML = pageShell({
    title: "Dashboard",
    actionsHtml: globalTopActionsHtml(),
    bodyHtml: `
      <div class="sv-grid cols-4">
        <div class="sv-card"><div class="sv-muted">Clientes</div><div class="sv-kpi">${clientes.length}</div></div>
        <div class="sv-card"><div class="sv-muted">Mercadorias</div><div class="sv-kpi">${produtos.length}</div></div>
        <div class="sv-card"><div class="sv-muted">Pedidos</div><div class="sv-kpi">${pedidos.length}</div></div>
        <div class="sv-card"><div class="sv-muted">Despesas</div><div class="sv-kpi">${despesas.length}</div></div>
      </div>
      <div style="height:10px"></div>
      <div class="sv-grid cols-2">
        <div class="sv-card">
          <h3>Resumo financeiro</h3>
          <div class="sv-grid cols-2">
            <div><div class="sv-muted">Total em pedidos</div><div>${money(totalVendas)}</div></div>
            <div><div class="sv-muted">Total despesas</div><div>${money(totalDespesas)}</div></div>
            <div><div class="sv-muted">Estoque (qtd)</div><div>${totalEstoque}</div></div>
            <div><div class="sv-muted">Valor em estoque (compra)</div><div>${money(valorEstoque)}</div></div>
          </div>
        </div>
        <div class="sv-card">
          <h3>Ações rápidas</h3>
          <div class="sv-actions">
            <button class="sv-btn" data-go="clientes">+ Cliente</button>
            <button class="sv-btn" data-go="mercadorias">+ Mercadoria</button>
            <button class="sv-btn" data-go="pedidos">+ Pedido</button>
            <button class="sv-btn" data-go="despesas">+ Despesa</button>
            <button class="sv-btn" data-go="rotas">+ Rota</button>
            <button class="sv-btn" data-go="lembretes">+ Lembrete</button>
          </div>
          <div class="sv-inline-note">Use o botão "Novo" em cada módulo para cadastro completo.</div>
        </div>
      </div>
    `,
  });

  bindGlobalActions();
  $$("[data-go]", root).forEach((b) => {
    b.onclick = () => {
      const r = b.dataset.go;
      navigate(r);
      setTimeout(() => {
        const btn = $("#sv_new_btn");
        if (btn) btn.click();
      }, 0);
    };
  });
}

/* ===========================
   Generic CRUD Screens
=========================== */
function filterItems(route, items) {
  const q = state.q;
  if (!q) return items;
  return items.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
}

function getDisplayColumns(route, items) {
  // colunas preferidas por módulo
  const prefs = {
    clientes: ["id", "nome", "telefone", "cidade"],
    mercadorias: ["id", "produto", "marca", "modelo", "valorVenda", "estoqueAtual", "status"],
    pedidos: ["id", "data", "clienteNome", "status", "formaPagamento", "total"],
    rotas: ["id", "nome", "cidade", "bairro", "diaSemana", "ordem", "status"],
    despesas: ["id", "data", "categoria", "descricao", "valor", "status"],
    lembretes: ["id", "data", "hora", "titulo", "tipo", "status"],
    anotacoes: ["id", "titulo", "categoria"],
  };

  const chosen = prefs[route] || [];
  const sample = items[0] || {};
  const keys = Object.keys(sample);
  const cols = chosen.filter((k) => k in sample);

  // Garante algumas colunas se lista vazia
  if (!items.length && chosen.length) return chosen;

  if (!cols.length) {
    return keys.slice(0, 8);
  }

  return cols;
}

function formatCellValue(route, key, value, row) {
  if (value == null) return "";
  if (key === "valor" || key === "valorCompra" || key === "valorVenda" || key === "total") {
    return money(value);
  }
  if (key === "data") return fmtDate(value);
  if (key === "itens") {
    const arr = jparse(value, Array.isArray(value) ? value : []);
    return Array.isArray(arr) ? `${arr.length} item(ns)` : safe(String(value));
  }
  if (typeof value === "object") return safe(JSON.stringify(value));
  return safe(String(value));
}

function renderCrudList(root, route) {
  const title = TITLES[route] || route;
  const all = getList(route);
  const items = filterItems(route, all);
  const cols = getDisplayColumns(route, all);

  let subtitle = `Total: ${items.length}`;
  if (route === "pedidos") {
    const soma = items.reduce((a, p) => a + Number(p.total || 0), 0);
    subtitle += ` • Soma: ${money(soma)}`;
  }
  if (route === "despesas") {
    const soma = items.reduce((a, d) => a + Number(d.valor || 0), 0);
    subtitle += ` • Soma: ${money(soma)}`;
  }

  root.innerHTML = pageShell({
    title,
    subtitle,
    actionsHtml: `
      ${globalTopActionsHtml()}
      <button id="sv_new_btn" class="sv-btn success">+ Novo ${safe(title.slice(0, -1) || "item")}</button>
    `,
    bodyHtml: `
      <div class="sv-card">
        ${
          items.length
            ? `
        <div style="overflow:auto">
          <table class="sv-table">
            <thead>
              <tr>
                ${cols.map((c) => `<th>${safe(c)}</th>`).join("")}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map((row) => {
                  const id = guessId(row) || "";
                  return `
                    <tr>
                      ${cols.map((c) => `<td>${formatCellValue(route, c, row[c], row)}</td>`).join("")}
                      <td>
                        <div class="sv-row-actions">
                          <button class="sv-btn small" data-edit="${safe(id)}">Editar</button>
                          <button class="sv-btn small danger" data-del="${safe(id)}">Excluir</button>
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>`
            : `<div class="sv-empty">Nenhum registro encontrado.</div>`
        }
      </div>
    `,
  });

  bindGlobalActions();

  const newBtn = $("#sv_new_btn", root);
  if (newBtn) newBtn.onclick = () => openEntityForm(route);

  $$("[data-edit]", root).forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.edit;
      openEntityForm(route, id);
    };
  });

  $$("[data-del]", root).forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.del;
      if (!id) return;
      const ok = await confirmAsync("Excluir este registro?");
      if (!ok) return;
      try {
        showLoading("Excluindo...");
        await deleteEntity(route, id);
        removeFromState(route, id);
        render();
        toast("Excluído com sucesso.");
      } catch (err) {
        toast(err.message || "Erro ao excluir.", "error", 5000);
      } finally {
        hideLoading();
      }
    };
  });
}

function buildFieldInput(field, value) {
  const id = `fld_${field.key}_${Math.random().toString(36).slice(2, 7)}`;
  const v = value ?? "";

  let html = `<div class="${field.full ? "full" : ""}">
    <label class="sv-label" for="${id}">${safe(field.label)}${field.required ? " *" : ""}</label>`;

  if (field.type === "textarea") {
    html += `<textarea id="${id}" class="sv-textarea" data-key="${safe(field.key)}">${safe(v)}</textarea>`;
  } else if (field.type === "textarea-json") {
    let txt = "";
    try {
      txt = Array.isArray(v) ? JSON.stringify(v, null, 2) : (typeof v === "string" ? v : JSON.stringify(v || [], null, 2));
    } catch {
      txt = "[]";
    }
    html += `<textarea id="${id}" class="sv-textarea" data-key="${safe(field.key)}">${safe(txt)}</textarea>
      <div class="sv-json-help">Formato esperado: JSON array. Ex.: [{"descricao":"Produto X","qtd":1,"valorUnit":10}]</div>`;
  } else if (field.type === "select") {
    const opts = field.options || [];
    html += `<select id="${id}" class="sv-select" data-key="${safe(field.key)}">
      ${opts.map((o) => `<option value="${safe(o)}" ${String(o) === String(v) ? "selected" : ""}>${safe(o || "(vazio)")}</option>`).join("")}
    </select>`;
  } else if (field.type === "cliente-select") {
    const clientes = getList("clientes");
    html += `<select id="${id}" class="sv-select" data-key="${safe(field.key)}">
      <option value="">(selecionar)</option>
      ${clientes
        .map((c) => {
          const cid = guessId(c) || "";
          const label = `${c.nome || ""}${c.telefone ? " (" + c.telefone + ")" : ""}`;
          return `<option value="${safe(cid)}" ${String(cid) === String(v || "") ? "selected" : ""}>${safe(label || cid)}</option>`;
        })
        .join("")}
    </select>`;
  } else {
    let type = "text";
    if (field.type === "number") type = "number";
    if (field.type === "date") type = "date";
    if (field.type === "time") type = "time";
    if (field.type === "email") type = "email";
    if (field.type === "money") type = "text";

    const displayValue =
      field.type === "money" && v !== ""
        ? String(Number(v || 0)).replace(".", ",")
        : field.type === "date"
        ? fmtDate(v)
        : v;

    html += `<input id="${id}" class="sv-input" data-key="${safe(field.key)}" type="${type}" value="${safe(displayValue)}" ${
      field.type === "number" ? 'step="any"' : ""
    } />`;
  }

  html += `</div>`;
  return html;
}

function parseFieldValue(field, raw, modalRoot) {
  if (field.type === "money") return parseMoney(raw);
  if (field.type === "number") return raw === "" ? 0 : Number(raw);
  if (field.type === "textarea-json") {
    const parsed = jparse(raw, null);
    if (parsed == null) throw new Error(`JSON inválido no campo "${field.label}"`);
    return parsed;
  }
  if (field.type === "cliente-select") {
    const val = String(raw || "");
    // Preenche clienteNome automaticamente se achar
    const cliente = getList("clientes").find((c) => String(guessId(c)) === val);
    const clienteNomeInput = $('[data-key="clienteNome"]', modalRoot);
    if (clienteNomeInput && cliente && !clienteNomeInput.value.trim()) {
      clienteNomeInput.value = cliente.nome || "";
    }
    return val;
  }
  return raw;
}

function collectFormValues(route, modal) {
  const schema = FIELD_SCHEMAS[route] || [];
  const payload = {};
  for (const field of schema) {
    const input = $(`[data-key="${field.key}"]`, modal.box);
    if (!input) continue;
    const raw = input.value;
    if (field.required && !String(raw || "").trim()) {
      throw new Error(`Campo obrigatório: ${field.label}`);
    }
    payload[field.key] = parseFieldValue(field, raw, modal.box);
  }
  return payload;
}

function openEntityForm(route, id = null) {
  const title = TITLES[route] || route;
  const list = getList(route);
  const found = id ? list.find((x) => String(guessId(x)) === String(id)) : null;
  const item = found ? deepClone(found) : {};

  // defaults
  if (route === "despesas" && !item.data) item.data = new Date().toISOString().slice(0, 10);
  if (route === "pedidos" && !item.data) item.data = new Date().toISOString().slice(0, 10);
  if (route === "mercadorias" && !item.status) item.status = "ativo";
  if (route === "rotas" && !item.status) item.status = "ativo";
  if (route === "lembretes" && !item.status) item.status = "pendente";
  if (route === "despesas" && !item.status) item.status = "aberta";
  if (route === "pedidos" && !item.status) item.status = "aberto";
  if (route === "pedidos" && !item.itens) item.itens = [];

  const schema = FIELD_SCHEMAS[route] || [];
  const fieldsHtml = schema.map((f) => buildFieldInput(f, item[f.key])).join("");

  const modal = openModal(
    `${id ? "Editar" : "Novo"} ${title.slice(0, -1) || "registro"}`,
    `
      <div class="sv-form-grid">
        ${
          id
            ? `<div><label class="sv-label">ID</label><input class="sv-input" value="${safe(id)}" disabled /></div>`
            : ""
        }
        ${fieldsHtml}
      </div>
      <div class="sv-modal-footer">
        <button class="sv-btn secondary" data-close>Cancelar</button>
        <button id="sv_form_save" class="sv-btn success">Salvar</button>
      </div>
    `,
    { width: route === "pedidos" ? "1100px" : "900px" }
  );

  $("#sv_form_save", modal.box).onclick = async () => {
    try {
      const payload = collectFormValues(route, modal);

      // mantém id para update se backend usar POST upsert
      if (id) payload.id = id;

      // ajustes específicos
      if (route === "pedidos") {
        // se clienteId selecionado e clienteNome vazio, preenche
        if (payload.clienteId && !payload.clienteNome) {
          const c = getList("clientes").find((x) => String(guessId(x)) === String(payload.clienteId));
          if (c) payload.clienteNome = c.nome || "";
        }

        // recalcular total se itens válidos e total vazio/0
        if ((!payload.total || Number(payload.total) === 0) && Array.isArray(payload.itens)) {
          payload.total = payload.itens.reduce(
            (acc, it) => acc + Number(it.qtd || 0) * Number(it.valorUnit || 0),
            0
          );
        }
      }

      showLoading("Salvando...");
      const saved = await saveEntity(route, payload);
      const normalized = isObj(saved) ? saved : payload;
      upsertInState(route, normalized);
      modal.close();
      render();
      toast("Registro salvo com sucesso.");
    } catch (err) {
      toast(err.message || "Erro ao salvar.", "error", 5000);
    } finally {
      hideLoading();
    }
  };
}

/* ===========================
   Backup
=========================== */
function downloadBackupJSON() {
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      user: state.user || null,
      data: state.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `supervenda-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toast("Backup JSON gerado.");
  } catch (err) {
    toast("Falha ao gerar backup.", "error");
    console.error(err);
  }
}

/* ===========================
   App Render
=========================== */
function render() {
  const root = ensureShell();
  const route = state.route || "dashboard";

  // Highlight em menu lateral existente (se houver)
  ROUTES.forEach((r) => {
    const els = [
      document.querySelector(`[data-route="${r.id}"]`),
      document.querySelector(`a[href="#${r.id}"]`),
      document.getElementById(`menu_${r.id}`),
    ].filter(Boolean);
    els.forEach((el) => {
      el.classList.toggle("active", r.id === route);
    });
  });

  if (route === "dashboard") {
    renderDashboard(root);
    return;
  }

  const crudRoutes = ["clientes", "mercadorias", "pedidos", "rotas", "despesas", "lembretes", "anotacoes"];
  if (crudRoutes.includes(route)) {
    renderCrudList(root, route);
    return;
  }

  root.innerHTML = pageShell({
    title: TITLES[route] || route,
    actionsHtml: globalTopActionsHtml(),
    bodyHtml: `<div class="sv-card"><div class="sv-empty">Tela em preparação.</div></div>`,
  });
  bindGlobalActions();
}

/* ===========================
   Bootstrap App
=========================== */
async function start() {
  ensureShell();
  mountSidebarBindings();

  try {
    showLoading("Validando sessão...");
    const ok = await ensureAuth();
    if (!ok) {
      hideLoading();
      return;
    }

    await refreshAll();

    // Corrige hash inicial
    if (!state.route) state.route = "dashboard";
    if (!location.hash) location.hash = `#${state.route}`;

    render();
  } catch (err) {
    console.error(err);
    toast(err.message || "Erro ao iniciar o app.", "error", 6000);
    const root = ensureShell();
    root.innerHTML = pageShell({
      title: "Erro",
      bodyHtml: `
        <div class="sv-card">
          <div class="sv-empty">Falha ao carregar aplicação: ${safe(err.message || "erro desconhecido")}</div>
          <div style="height:10px"></div>
          <button id="sv_retry" class="sv-btn">Tentar novamente</button>
        </div>
      `,
    });
    bindGlobalActions();
    const bt = $("#sv_retry");
    if (bt) bt.onclick = start;
  } finally {
    hideLoading();
  }
}

document.addEventListener("DOMContentLoaded", start);

/* ===========================
   DICAS IMPORTANTES (comentário)
   1) Se aparecer "Mixed Content", o problema está no db.js/config.js
      chamando API por HTTP. Deve usar HTTPS.
   2) Exemplo correto de API base:
      https://supervenda.krasinskyekuroli.workers.dev
   3) O secret no Cloudflare deve ser JWT_SECRET (igual ao código backend).
=========================== */
