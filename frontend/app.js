// app.js - UI principal Supervenda (frontend puro JS)
(function () {
  "use strict";

  const {
    api,
    login,
    me,
    bootstrap,
    logoutLocal,
    getToken,
    getMeLocal,
    money,
    parseMoney,
    safe,
    jparse,
  } = window.DB;

  const state = {
    loading: false,
    me: null,
    counters: {},
    clientes: [],
    produtos: [],
    pedidos: [],
    rotas: [],
    despesas: [],
    lembretes: [],
    notas: [],
    route: "dashboard",
    q: "",
  };

  const routes = [
    { id: "dashboard", label: "Dashboard" },
    { id: "clientes", label: "Clientes" },
    { id: "mercadorias", label: "Mercadorias" },
    { id: "pedidos", label: "Pedidos/Vendas" },
    { id: "rotas", label: "Rotas" },
    { id: "despesas", label: "Despesas" },
    { id: "lembretes", label: "Lembretes/Campanhas" },
    { id: "notas", label: "Anotações" },
  ];

  // ---------- helpers DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function ensureAppShell() {
    // tenta reaproveitar HTML existente
    let app = $("#sv-app");
    if (app) return app;

    // Se a página já tem elementos do layout antigo, usamos eles
    // Caso contrário, montamos uma base mínima
    app = document.createElement("div");
    app.id = "sv-app";
    app.innerHTML = `
      <div class="sv-layout" style="display:grid;grid-template-columns:220px 1fr;min-height:100vh;background:#050b1a;color:#eaf2ff;">
        <aside style="border-right:1px solid rgba(255,255,255,.08);padding:14px;">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Vendas Externas Pro</div>
          <div style="opacity:.7;font-size:12px;margin-bottom:12px;">Cloudflare (Login por vendedor)</div>
          <div class="nav" style="display:grid;gap:8px;"></div>
          <div style="margin-top:16px;font-size:12px;opacity:.65;">Dados salvos na nuvem (D1) + backup local JSON</div>
        </aside>
        <main style="padding:14px 16px;">
          <div class="topbar" style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;">
            <div id="sv-breadcrumb" style="font-size:12px;opacity:.8;">Você está em: <b>Dashboard</b></div>
            <input id="q" placeholder="Buscar (cliente, produto...)" style="height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#08122a;color:#fff;padding:0 12px;outline:none;">
            <button id="btn-print" class="btn">Imprimir</button>
          </div>
          <div id="sv-top-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 12px 0;"></div>
          <div id="view"></div>
        </main>
      </div>
    `;
    document.body.innerHTML = "";
    document.body.appendChild(app);

    // estilo mínimo se styles.css falhar
    const css = document.createElement("style");
    css.textContent = `
      .btn{height:38px;border-radius:12px;border:1px solid #1d8f6a;background:transparent;color:#fff;padding:0 12px;cursor:pointer}
      .btn:hover{filter:brightness(1.1)}
      .btn-danger{border-color:#d04a4a}
      .btn-muted{border-color:rgba(255,255,255,.16)}
      .card{background:#0a1632;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:12px}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
      .field{display:grid;gap:6px;margin-bottom:10px}
      .field label{font-size:12px;opacity:.8}
      .field input,.field select,.field textarea{
        background:#08122a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;
        padding:10px;outline:none;width:100%;box-sizing:border-box;
      }
      .field textarea{min-height:90px;resize:vertical}
      .table{width:100%;border-collapse:separate;border-spacing:0 8px;margin-top:10px}
      .table th{font-size:12px;text-align:left;opacity:.75;padding:0 8px}
      .table td{background:#0a1632;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);padding:10px 8px;vertical-align:top}
      .table td:first-child{border-left:1px solid rgba(255,255,255,.08);border-top-left-radius:12px;border-bottom-left-radius:12px}
      .table td:last-child{border-right:1px solid rgba(255,255,255,.08);border-top-right-radius:12px;border-bottom-right-radius:12px}
      .pill{display:inline-block;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:3px 8px;font-size:12px;opacity:.9}
      .nav button{height:34px;border-radius:10px;background:#08122a;color:#fff;border:1px solid rgba(255,255,255,.08);text-align:left;padding:0 10px;cursor:pointer}
      .nav button.active{border-color:#19c37d;box-shadow:inset 0 0 0 1px #19c37d}
      .modal-backdrop{position:fixed;inset:0;background:rgba(2,5,12,.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .modal{background:#091327;border:1px solid rgba(255,255,255,.12);border-radius:16px;max-height:90vh;overflow:auto;padding:14px;width:min(900px,100%)}
      .toast-wrap{position:fixed;right:12px;bottom:12px;display:grid;gap:8px;z-index:10000}
      .toast{background:#0a1632;border:1px solid rgba(255,255,255,.12);color:#fff;padding:10px 12px;border-radius:12px;min-width:220px}
      .toast.ok{border-color:#1bb978}
      .toast.err{border-color:#d04a4a}
      .loading-bar{height:3px;background:linear-gradient(90deg,#19c37d,#2ea8ff);position:fixed;top:0;left:0;width:100%;z-index:10001;animation:svpulse 1s linear infinite}
      @keyframes svpulse{0%{opacity:.25}50%{opacity:1}100%{opacity:.25}}
      .login-wrap{max-width:460px;margin:40px auto}
      .muted{opacity:.72;font-size:12px}
      .right{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .badge-warn{color:#ffd166}
    `;
    document.head.appendChild(css);

    return app;
  }

  function ensureToastWrap() {
    let w = $("#sv-toast-wrap");
    if (!w) {
      w = document.createElement("div");
      w.id = "sv-toast-wrap";
      w.className = "toast-wrap";
      document.body.appendChild(w);
    }
    return w;
  }

  function toast(msg, type = "ok", ms = 2600) {
    const w = ensureToastWrap();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    w.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function setLoading(on) {
    state.loading = !!on;
    let bar = $("#sv-loading");
    if (on) {
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "sv-loading";
        bar.className = "loading-bar";
        document.body.appendChild(bar);
      }
    } else {
      if (bar) bar.remove();
    }
  }

  async function withLoading(fn, errMsg = "Erro na operação") {
    setLoading(true);
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      alert(e?.message || errMsg);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  function setRoute(route) {
    state.route = route;
    location.hash = `#${route}`;
    render();
  }

  function getHashRoute() {
    const h = (location.hash || "#dashboard").replace(/^#/, "").trim();
    return routes.some((r) => r.id === h) ? h : "dashboard";
  }

  function updateNavActive() {
    $$(".nav button").forEach((b) => {
      b.classList.toggle("active", b.dataset.route === state.route);
    });
    const bc = $("#sv-breadcrumb");
    if (bc) {
      const label = routes.find((r) => r.id === state.route)?.label || state.route;
      bc.innerHTML = `Você está em: <b>${safe(label)}</b>`;
    }
  }

  function card(html) {
    const d = document.createElement("div");
    d.className = "card";
    d.innerHTML = html;
    return d;
  }

  function promptConfirm(msg) {
    return Promise.resolve(confirm(msg));
  }

  function openModal(title, bodyHtml, width = "min(900px,100%)") {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="width:${width}">
        <div class="inline" style="justify-content:space-between;margin-bottom:10px;">
          <div style="font-weight:700;font-size:18px;">${safe(title)}</div>
          <button class="btn btn-muted" id="sv_modal_x">Fechar</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const box = $(".modal", backdrop);

    function close() {
      backdrop.remove();
    }
    $("#sv_modal_x", backdrop).onclick = close;
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    return { backdrop, box, close };
  }

  function exportJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function parseDateInputToIso(v) {
    return v ? `${v}T00:00:00.000Z` : "";
  }

  function onlyDate(v) {
    return String(v || "").slice(0, 10);
  }

  function textContains(row, q, fields) {
    if (!q) return true;
    const s = fields.map((f) => row?.[f] ?? "").join(" ").toLowerCase();
    return s.includes(q);
  }

  function upsertLocal(key, saved) {
    if (!state[key]) state[key] = [];
    const idx = state[key].findIndex((x) => x.id === saved.id);
    if (idx >= 0) state[key][idx] = saved;
    else state[key].unshift(saved);
  }

  function removeLocal(key, id) {
    state[key] = (state[key] || []).filter((x) => x.id !== id);
  }

  // ---------- auth ----------
  async function ensureAuth() {
    const token = getToken();
    if (!token) {
      renderLogin();
      throw new Error("Sem sessão");
    }
    try {
      state.me = await me();
    } catch (e) {
      console.warn("Falha em /api/me, usando local", e);
      state.me = getMeLocal();
      if (!state.me) {
        await logout(false, false);
        renderLogin();
        throw e;
      }
    }
  }

  async function doLogin(email, senha) {
    await withLoading(async () => {
      const r = await login(email, senha);
      state.me = r.me;
      await refreshState();
      render();
      toast("Login realizado");
    }, "Falha no login");
  }

  async function logout(showMsg = true, reload = true) {
    await logoutLocal();
    state.me = null;
    state.clientes = [];
    state.produtos = [];
    state.pedidos = [];
    state.rotas = [];
    state.despesas = [];
    state.lembretes = [];
    state.notas = [];
    if (showMsg) toast("Sessão encerrada", "ok");
    if (reload) {
      location.hash = "#dashboard";
      renderLogin();
    }
  }

  function renderLogin() {
    ensureAppShell();
    const view = $("#view");
    if (!view) return;
    $("#sv-top-actions").innerHTML = "";
    $(".nav").innerHTML = ""; // sem menu quando não logado
    $("#sv-breadcrumb").innerHTML = `Você está em: <b>Login</b>`;
    updateNavActive();

    const cfgBase = (window.APP_CONFIG?.API_BASE || "").trim() || "https://supervenda.krasinskyekuroli.workers.dev";

    view.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "login-wrap";
    wrap.innerHTML = `
      <div class="card">
        <div style="font-size:26px;font-weight:800;margin-bottom:6px;">Entrar</div>
        <div class="muted" style="margin-bottom:12px;">API: <span id="login_api_label">${safe(cfgBase)}</span></div>

        <div class="field">
          <label>E-mail</label>
          <input id="lg_email" type="email" placeholder="vendedor@exemplo.com" value="vendedor@exemplo.com">
        </div>
        <div class="field">
          <label>Senha</label>
          <input id="lg_senha" type="password" placeholder="******" value="123456">
        </div>

        <div class="inline">
          <button id="lg_btn" class="btn">Entrar</button>
          <button id="lg_api_btn" class="btn btn-muted">Trocar URL da API</button>
        </div>

        <div class="muted" style="margin-top:12px;">
          O primeiro vendedor é criado via CLI / seed do backend.
        </div>
      </div>
    `;
    view.appendChild(wrap);

    $("#lg_btn").onclick = async () => {
      const email = $("#lg_email").value.trim();
      const senha = $("#lg_senha").value;
      if (!email || !senha) return alert("Informe e-mail e senha.");
      await doLogin(email, senha);
    };

    $("#lg_senha").addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#lg_btn").click();
      }
    });

    $("#lg_api_btn").onclick = () => {
      const atual = (window.APP_CONFIG?.API_BASE || "").trim();
      const novo = prompt("Informe a URL da API (workers.dev) - use HTTPS", atual || "https://supervenda.krasinskyekuroli.workers.dev");
      if (!novo) return;
      const v = novo.trim().replace(/\/+$/, "");
      if (!window.APP_CONFIG) window.APP_CONFIG = {};
      window.APP_CONFIG.API_BASE = v;
      $("#login_api_label").textContent = v;
      toast("URL da API atualizada (sessão atual)");
    };
  }

  // ---------- bootstrap ----------
  async function refreshState() {
    await withLoading(async () => {
      const b = await bootstrap();

      // compatível com diferentes formatos de bootstrap
      const d = b?.data || b || {};

      state.counters = d.counters || {};
      state.clientes = Array.isArray(d.clientes) ? d.clientes : [];
      state.produtos = Array.isArray(d.produtos) ? d.produtos : (Array.isArray(d.mercadorias) ? d.mercadorias : []);
      state.pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
      state.rotas = Array.isArray(d.rotas) ? d.rotas : [];
      state.despesas = Array.isArray(d.despesas) ? d.despesas : [];
      state.lembretes = Array.isArray(d.lembretes) ? d.lembretes : [];
      state.notas = Array.isArray(d.notas) ? d.notas : [];
      state.me = d.me || state.me || getMeLocal() || null;
    }, "Falha ao carregar dados");
  }

  // ---------- top actions ----------
  function renderTopActions() {
    const root = $("#sv-top-actions");
    if (!root) return;

    const nome = state.me?.name || state.me?.nome || state.me?.email || "Usuário";
    root.innerHTML = `
      <span class="pill">Usuário: ${safe(nome)}</span>
      <button id="sv_backup_btn" class="btn btn-muted">Backup</button>
      <button id="sv_restore_btn" class="btn btn-muted">Restaurar</button>
      <input id="sv_restore_input" type="file" accept=".json,application/json" style="display:none">
      <button id="sv_refresh_btn" class="btn btn-muted">Recarregar</button>
      <button id="sv_trocar_btn" class="btn btn-muted">Trocar usuário</button>
      <button id="sv_sair_btn" class="btn btn-danger">Sair</button>
    `;

    $("#sv_refresh_btn").onclick = async () => {
      await refreshState();
      render();
      toast("Atualizado");
    };

    $("#sv_backup_btn").onclick = async () => {
      await handleBackup();
    };

    $("#sv_restore_btn").onclick = () => $("#sv_restore_input").click();

    $("#sv_restore_input").onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) handleRestoreLocal(f);
      e.target.value = "";
    };

    $("#sv_trocar_btn").onclick = async () => {
      await logout(false, false);
      renderLogin();
      alert("Sessão encerrada. Faça login com outro usuário.");
    };

    $("#sv_sair_btn").onclick = async () => {
      if (!(await promptConfirm("Deseja sair da conta?"))) return;
      await logout(true, false);
      renderLogin();
    };
  }

  async function tryApiBackup() {
    try {
      const data = await api("/api/backup");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      exportJsonFile(`supervenda-backup-api-${stamp}.json`, data);
      toast("Backup da API baixado");
      return true;
    } catch (_) {
      return false;
    }
  }

  function downloadBackupLocal() {
    const payload = {
      exportedAt: new Date().toISOString(),
      apiBase: window.APP_CONFIG?.API_BASE || "",
      me: state.me,
      data: {
        clientes: state.clientes || [],
        produtos: state.produtos || [],
        pedidos: state.pedidos || [],
        rotas: state.rotas || [],
        despesas: state.despesas || [],
        lembretes: state.lembretes || [],
        notas: state.notas || [],
        counters: state.counters || {},
      },
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    exportJsonFile(`supervenda-backup-${stamp}.json`, payload);
    toast("Backup local baixado");
  }

  async function handleBackup() {
    setLoading(true);
    try {
      const ok = await tryApiBackup();
      if (!ok) downloadBackupLocal();
    } finally {
      setLoading(false);
    }
  }

  function handleRestoreLocal(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setLoading(true);
        const parsed = JSON.parse(reader.result);
        const d = parsed?.data || parsed || {};

        const keys = ["clientes", "produtos", "pedidos", "rotas", "despesas", "lembretes", "notas"];
        for (const k of keys) if (Array.isArray(d[k])) state[k] = d[k];

        render();
        toast("Backup carregado localmente");

        // sincronização melhor esforço
        const map = {
          clientes: "/api/clientes",
          produtos: "/api/produtos",
          pedidos: "/api/pedidos",
          rotas: "/api/rotas",
          despesas: "/api/despesas",
          lembretes: "/api/lembretes",
          notas: "/api/notas",
        };
        for (const [k, endpoint] of Object.entries(map)) {
          if (!Array.isArray(state[k])) continue;
          for (const item of state[k]) {
            try {
              await api(endpoint, { method: "POST", body: JSON.stringify(item) });
            } catch (e) {
              console.warn("Falha sincronizando", k, item?.id, e);
            }
          }
        }

        await refreshState();
        render();
        toast("Restauração concluída");
      } catch (e) {
        console.error(e);
        alert("Arquivo de backup inválido.");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }

  // ---------- render raiz ----------
  function render() {
    ensureAppShell();

    state.route = getHashRoute();
    state.q = ($("#q")?.value || "").trim().toLowerCase();

    // monta nav sempre
    const nav = $(".nav");
    nav.innerHTML = "";
    routes.forEach((r) => {
      const b = document.createElement("button");
      b.textContent = r.label;
      b.dataset.route = r.id;
      b.onclick = () => setRoute(r.id);
      nav.appendChild(b);
    });
    updateNavActive();

    // top actions somente logado
    if (getToken()) renderTopActions();
    else $("#sv-top-actions").innerHTML = "";

    const view = $("#view");
    view.innerHTML = "";

    if (!getToken()) {
      renderLogin();
      return;
    }

    switch (state.route) {
      case "dashboard":
        return renderDashboard(view, state.q);
      case "clientes":
        return renderClientes(view, state.q);
      case "mercadorias":
        return renderMercadorias(view, state.q);
      case "pedidos":
        return renderPedidos(view, state.q);
      case "rotas":
        return renderRotas(view, state.q);
      case "despesas":
        return renderDespesas(view, state.q);
      case "lembretes":
        return renderLembretes(view, state.q);
      case "notas":
        return renderNotas(view, state.q);
      default:
        view.appendChild(card("Tela não encontrada."));
    }
  }

  // ---------- dashboard ----------
  function renderDashboard(view) {
    const cards = [
      ["Clientes", state.clientes.length],
      ["Mercadorias", state.produtos.length],
      ["Pedidos", state.pedidos.length],
      ["Rotas", state.rotas.length],
      ["Despesas", state.despesas.length],
      ["Lembretes", state.lembretes.length],
      ["Anotações", state.notas.length],
    ];

    const totalPedidos = (state.pedidos || []).reduce((acc, p) => acc + Number(p.total || 0), 0);
    const totalDespesas = (state.despesas || []).reduce((acc, d) => acc + Number(d.valor || 0), 0);

    view.appendChild(card(`
      <div style="font-size:26px;font-weight:800;margin-bottom:8px;">Dashboard</div>
      <div class="grid3">
        ${cards.map(([t, n]) => `
          <div class="card" style="padding:10px;">
            <div class="muted">${safe(t)}</div>
            <div style="font-size:24px;font-weight:800;">${n}</div>
          </div>
        `).join("")}
      </div>
      <div class="grid2" style="margin-top:12px;">
        <div class="card" style="padding:10px;">
          <div class="muted">Total em pedidos</div>
          <div style="font-size:22px;font-weight:800;">${money(totalPedidos)}</div>
        </div>
        <div class="card" style="padding:10px;">
          <div class="muted">Total em despesas</div>
          <div style="font-size:22px;font-weight:800;">${money(totalDespesas)}</div>
        </div>
      </div>
      <div style="margin-top:12px;" class="muted">
        Use o menu lateral para cadastrar e gerenciar dados.
      </div>
    `));
  }

  // ---------- clientes ----------
  function renderClientes(view, q) {
    const items = (state.clientes || []).filter((c) =>
      textContains(c, q, ["id", "nome", "telefone", "cidade", "endereco", "obs"])
    );

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Clientes</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="cl_new" class="btn">+ Novo cliente</button>
          <button id="cl_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(c => `
          <tr>
            <td>${safe(c.id || "")}</td>
            <td>
              <div style="font-weight:700">${safe(c.nome || "")}</div>
              <div class="muted">${safe(c.endereco || c.logradouro || "")}</div>
            </td>
            <td>${safe(c.telefone || "")}</td>
            <td>${safe(c.cidade || "")}${c.uf ? "/" + safe(c.uf) : ""}</td>
            <td class="right">
              <button class="btn btn-muted" data-edit="${safe(c.id)}">Editar</button>
              <button class="btn btn-danger" data-del="${safe(c.id)}">Excluir</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#cl_new").onclick = () => openClienteForm();
    $("#cl_refresh").onclick = async () => {
      await refreshState();
      render();
      toast("Atualizado");
    };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openClienteForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir cliente?")) return;
      await withLoading(async () => {
        await api(`/api/clientes/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("clientes", b.dataset.del);
        render();
        toast("Cliente excluído");
      });
    }));
  }

  function openClienteForm(id = null) {
    const c = id ? (state.clientes || []).find((x) => x.id === id) : null;

    const modal = openModal("Cliente", `
      <div class="grid2">
        <div class="field"><label>ID</label><input id="cl_id" value="${safe(c?.id || "")}" disabled></div>
        <div class="field"><label>Nome *</label><input id="cl_nome" value="${safe(c?.nome || "")}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Telefone</label><input id="cl_tel" value="${safe(c?.telefone || "")}"></div>
        <div class="field"><label>Cidade</label><input id="cl_cidade" value="${safe(c?.cidade || "")}"></div>
        <div class="field"><label>UF</label><input id="cl_uf" maxlength="2" value="${safe(c?.uf || "")}"></div>
      </div>
      <div class="field"><label>Endereço</label><input id="cl_end" value="${safe(c?.endereco || c?.logradouro || "")}"></div>
      <div class="field"><label>Observações</label><textarea id="cl_obs">${safe(c?.obs || "")}</textarea></div>
      <div class="right">
        <button id="cl_cancel" class="btn btn-muted">Fechar</button>
        <button id="cl_save" class="btn">Salvar</button>
      </div>
    `);

    $("#cl_cancel", modal.box).onclick = () => modal.close();
    $("#cl_save", modal.box).onclick = async () => {
      const payload = {
        id: c?.id || null,
        nome: $("#cl_nome", modal.box).value.trim(),
        telefone: $("#cl_tel", modal.box).value.trim(),
        cidade: $("#cl_cidade", modal.box).value.trim(),
        uf: $("#cl_uf", modal.box).value.trim().toUpperCase(),
        endereco: $("#cl_end", modal.box).value.trim(),
        obs: $("#cl_obs", modal.box).value.trim(),
      };
      if (!payload.nome) return alert("Informe o nome do cliente.");

      await withLoading(async () => {
        const saved = await api("/api/clientes", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("clientes", saved);
        modal.close();
        render();
        toast("Cliente salvo");
      });
    };
  }

  // ---------- mercadorias ----------
  function renderMercadorias(view, q) {
    const items = (state.produtos || []).filter((p) =>
      textContains(p, q, ["id", "marca", "produto", "modelo", "categoria", "sku", "descricao"])
    );

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Mercadorias</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="pd_new" class="btn">+ Nova mercadoria</button>
          <button id="pd_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th><th>Produto</th><th>Categoria</th><th>Compra</th><th>Venda</th><th>Estoque</th><th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(p => `
          <tr>
            <td>${safe(p.id || "")}</td>
            <td>
              <div style="font-weight:700">${safe([p.marca,p.produto,p.modelo].filter(Boolean).join(" "))}</div>
              <div class="muted">${safe(p.sku || "")}</div>
            </td>
            <td>${safe(p.categoria || "")}</td>
            <td>${money(p.valorCompra || 0)}</td>
            <td>${money(p.valorVenda || 0)}</td>
            <td>
              <div>${Number(p.estoqueAtual || 0)}</div>
              <div class="muted">min ${Number(p.estoqueMin || 0)}</div>
            </td>
            <td class="right">
              <button class="btn btn-muted" data-edit="${safe(p.id)}">Editar</button>
              <button class="btn btn-danger" data-del="${safe(p.id)}">Excluir</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#pd_new").onclick = () => openMercadoriaForm();
    $("#pd_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openMercadoriaForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir mercadoria?")) return;
      await withLoading(async () => {
        await api(`/api/produtos/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("produtos", b.dataset.del);
        render();
        toast("Mercadoria excluída");
      });
    }));
  }

  function openMercadoriaForm(id = null) {
    const p = id ? (state.produtos || []).find((x) => x.id === id) : null;
    const modal = openModal("Mercadoria", `
      <div class="grid3">
        <div class="field"><label>ID</label><input id="m_id" value="${safe(p?.id || "")}" disabled></div>
        <div class="field"><label>Marca</label><input id="m_marca" value="${safe(p?.marca || "")}"></div>
        <div class="field"><label>Produto *</label><input id="m_produto" value="${safe(p?.produto || "")}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Modelo</label><input id="m_modelo" value="${safe(p?.modelo || "")}"></div>
        <div class="field"><label>Categoria</label><input id="m_categoria" value="${safe(p?.categoria || "")}"></div>
        <div class="field"><label>SKU</label><input id="m_sku" value="${safe(p?.sku || "")}"></div>
      </div>
      <div class="field"><label>Descrição</label><textarea id="m_desc">${safe(p?.descricao || "")}</textarea></div>
      <div class="grid3">
        <div class="field"><label>Valor compra</label><input id="m_vcompra" value="${safe(p?.valorCompra ?? "")}" placeholder="0,00"></div>
        <div class="field"><label>Valor venda</label><input id="m_vvenda" value="${safe(p?.valorVenda ?? "")}" placeholder="0,00"></div>
        <div class="field"><label>Status</label>
          <select id="m_status">
            ${["ativo","inativo"].map(s => `<option value="${s}" ${String(p?.status||"ativo")===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid3">
        <div class="field"><label>Estoque atual</label><input id="m_estq" type="number" step="1" value="${safe(p?.estoqueAtual ?? 0)}"></div>
        <div class="field"><label>Estoque mínimo</label><input id="m_estqmin" type="number" step="1" value="${safe(p?.estoqueMin ?? 0)}"></div>
        <div class="field"><label>Local</label><input id="m_local" value="${safe(p?.local || "")}"></div>
      </div>
      <div class="field"><label>Agregados</label><input id="m_agreg" value="${safe(p?.agregados || "")}" placeholder="JSON/string opcional"></div>
      <div class="right">
        <button id="m_close" class="btn btn-muted">Fechar</button>
        <button id="m_save" class="btn">Salvar</button>
      </div>
    `, "min(980px,100%)");

    $("#m_close", modal.box).onclick = () => modal.close();
    $("#m_save", modal.box).onclick = async () => {
      const payload = {
        id: p?.id || null,
        marca: $("#m_marca", modal.box).value.trim(),
        produto: $("#m_produto", modal.box).value.trim(),
        modelo: $("#m_modelo", modal.box).value.trim(),
        descricao: $("#m_desc", modal.box).value.trim(),
        categoria: $("#m_categoria", modal.box).value.trim(),
        sku: $("#m_sku", modal.box).value.trim(),
        agregados: $("#m_agreg", modal.box).value.trim(),
        valorCompra: parseMoney($("#m_vcompra", modal.box).value),
        valorVenda: parseMoney($("#m_vvenda", modal.box).value),
        estoqueAtual: Number($("#m_estq", modal.box).value || 0),
        estoqueMin: Number($("#m_estqmin", modal.box).value || 0),
        local: $("#m_local", modal.box).value.trim(),
        status: $("#m_status", modal.box).value || "ativo",
      };
      if (!payload.produto) return alert("Informe o nome do produto.");

      await withLoading(async () => {
        const saved = await api("/api/produtos", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("produtos", saved);
        modal.close();
        render();
        toast("Mercadoria salva");
      });
    };
  }

  // ---------- pedidos ----------
  function normalizePedidoItens(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((it) => ({
      produtoId: (it.produtoId || "").toString(),
      descricao: (it.descricao || it.nome || "").toString(),
      qtd: Number(it.qtd ?? it.quantidade ?? 0),
      valorUnit: Number(it.valorUnit ?? it.valor ?? it.preco ?? 0),
    }));
  }

  function renderPedidos(view, q) {
    const items = (state.pedidos || []).filter((p) =>
      textContains(p, q, ["id", "clienteNome", "clienteId", "status", "formaPagamento", "obs"])
    );

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Pedidos / Vendas</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="pe_new" class="btn">+ Novo pedido</button>
          <button id="pe_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th><th>Data</th><th>Cliente</th><th>Status</th><th>Total</th><th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(p => `
          <tr>
            <td>${safe(p.id || "")}</td>
            <td>${safe(onlyDate(p.data || ""))}</td>
            <td>
              <div style="font-weight:700">${safe(p.clienteNome || "")}</div>
              <div class="muted">${safe(p.clienteId || "")}</div>
            </td>
            <td>${safe(p.status || "")}</td>
            <td>${money(p.total || 0)}</td>
            <td class="right">
              <button class="btn btn-muted" data-edit="${safe(p.id)}">Editar</button>
              <button class="btn btn-danger" data-del="${safe(p.id)}">Excluir</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#pe_new").onclick = () => openPedidoForm();
    $("#pe_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openPedidoForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir pedido?")) return;
      await withLoading(async () => {
        await api(`/api/pedidos/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("pedidos", b.dataset.del);
        render();
        toast("Pedido excluído");
      });
    }));
  }

  function openPedidoForm(id = null) {
    const p = id ? (state.pedidos || []).find((x) => x.id === id) : null;
    const clientes = state.clientes || [];
    const produtos = state.produtos || [];
    const itensUI = normalizePedidoItens(jparse(p?.itens, p?.itens || []));

    const modal = openModal("Pedido / Venda", `
      <div class="grid3">
        <div class="field"><label>ID</label><input id="pe_id" value="${safe(p?.id || "")}" disabled></div>
        <div class="field"><label>Data</label><input id="pe_data" type="date" value="${safe(onlyDate(p?.data || new Date().toISOString()))}"></div>
        <div class="field"><label>Status</label>
          <select id="pe_status">
            ${["aberto","negociando","faturado","pago","cancelado"].map(s => `<option value="${s}" ${String(p?.status || "aberto")===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="grid3">
        <div class="field">
          <label>Cliente *</label>
          <select id="pe_cliente">
            <option value="">Selecione...</option>
            ${clientes.map(c => `<option value="${safe(c.id)}" ${(p?.clienteId===c.id)?"selected":""}>${safe(c.nome || c.id)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Forma de pagamento</label><input id="pe_fp" value="${safe(p?.formaPagamento || "")}"></div>
        <div class="field"><label>Prazo (dias)</label><input id="pe_prazo" type="number" step="1" value="${safe(p?.prazoDias ?? 0)}"></div>
      </div>

      <div class="field"><label>Observações</label><textarea id="pe_obs">${safe(p?.obs || "")}</textarea></div>

      <div class="card" style="margin-top:10px;padding:10px;">
        <div class="inline" style="justify-content:space-between;">
          <div style="font-weight:700;">Itens do pedido</div>
          <div class="right">
            <button id="pe_add_manual" class="btn btn-muted">+ Item manual</button>
            <button id="pe_add_prod" class="btn btn-muted">+ Da mercadoria</button>
          </div>
        </div>
        <div id="pe_itens_wrap" style="margin-top:10px;"></div>
        <div id="pe_alerta_estoque" class="badge-warn" style="margin-top:8px;"></div>
        <div style="margin-top:10px;font-weight:800;">Total: <span id="pe_total_txt">${money(p?.total || 0)}</span></div>
      </div>

      <div class="inline" style="margin-top:10px;">
        <label><input id="pe_baixa_estoque" type="checkbox"> Baixar estoque ao salvar</label>
        <label><input id="pe_bloq_neg" type="checkbox" checked> Bloquear estoque negativo</label>
      </div>

      <div class="right" style="margin-top:12px;">
        <button id="pe_close" class="btn btn-muted">Fechar</button>
        <button id="pe_save" class="btn">Salvar pedido</button>
      </div>
    `, "min(1100px,100%)");

    const itensWrap = $("#pe_itens_wrap", modal.box);
    const alertaEl = $("#pe_alerta_estoque", modal.box);

    function fmtProd(p) {
      return [p.marca, p.produto, p.modelo].filter(Boolean).join(" ").trim() || p.id || "Produto";
    }

    function calcTotal() {
      return itensUI.reduce((acc, it) => acc + Number(it.qtd || 0) * Number(it.valorUnit || 0), 0);
    }

    function mapQtdPorProduto(itens) {
      const m = new Map();
      (itens || []).forEach((it) => {
        const pid = (it.produtoId || "").trim();
        if (!pid) return;
        m.set(pid, (m.get(pid) || 0) + Number(it.qtd || 0));
      });
      return m;
    }

    function getStockIssues(originais, atuais) {
      const before = mapQtdPorProduto(normalizePedidoItens(originais));
      const after = mapQtdPorProduto(normalizePedidoItens(atuais));
      const pmap = new Map((state.produtos || []).map((x) => [x.id, x]));
      const ids = new Set([...before.keys(), ...after.keys()]);
      const out = [];
      for (const id of ids) {
        const delta = Number(after.get(id) || 0) - Number(before.get(id) || 0);
        if (delta <= 0) continue;
        const prod = pmap.get(id);
        if (!prod) continue;
        const atual = Number(prod.estoqueAtual || 0);
        if (atual - delta < 0) {
          out.push(`${fmtProd(prod)} (${id}) precisa ${delta} e tem ${atual}. Faltam ${Math.abs(atual - delta)}.`);
        }
      }
      return out;
    }

    function renderItens() {
      if (!itensUI.length) {
        itensWrap.innerHTML = `<div class="muted">Nenhum item adicionado.</div>`;
      } else {
        itensWrap.innerHTML = `
          <table class="table">
            <thead>
              <tr>
                <th>Produto</th><th>Descrição</th><th>Qtd</th><th>Valor unit.</th><th>Subtotal</th><th>Estoque</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${itensUI.map((it, idx) => {
                const prod = produtos.find((p) => p.id === it.produtoId);
                const est = prod ? Number(prod.estoqueAtual || 0) : null;
                const qtd = Number(it.qtd || 0);
                const insuf = prod && qtd > est;
                return `
                  <tr>
                    <td>
                      <select class="pe_item_prod" data-idx="${idx}">
                        <option value="">(manual)</option>
                        ${produtos.map(p => `<option value="${safe(p.id)}" ${p.id===it.produtoId?"selected":""}>${safe(fmtProd(p))}</option>`).join("")}
                      </select>
                    </td>
                    <td><input class="pe_item_desc" data-idx="${idx}" value="${safe(it.descricao || "")}"></td>
                    <td><input class="pe_item_qtd" data-idx="${idx}" type="number" step="1" value="${safe(it.qtd ?? 1)}"></td>
                    <td><input class="pe_item_v" data-idx="${idx}" value="${safe(it.valorUnit ?? 0)}"></td>
                    <td>${money(Number(it.qtd || 0) * Number(it.valorUnit || 0))}</td>
                    <td>${prod ? `<span ${insuf ? 'class="badge-warn"' : ""}>${est}</span>` : "-"}</td>
                    <td class="right">
                      <button class="btn btn-muted" data-dup="${idx}">Duplicar</button>
                      <button class="btn btn-danger" data-rem="${idx}">Remover</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `;
      }

      $("#pe_total_txt", modal.box).textContent = money(calcTotal());

      const issues = getStockIssues(normalizePedidoItens(jparse(p?.itens, p?.itens || [])), itensUI);
      alertaEl.innerHTML = issues.length ? issues.map(x => `⚠️ ${safe(x)}`).join("<br>") : "";

      $$(".pe_item_prod", itensWrap).forEach((el) => {
        el.onchange = () => {
          const idx = Number(el.dataset.idx);
          const prod = produtos.find((p) => p.id === el.value);
          if (prod) {
            itensUI[idx].produtoId = prod.id;
            itensUI[idx].descricao = fmtProd(prod);
            itensUI[idx].valorUnit = Number(prod.valorVenda || 0);
            if (!Number(itensUI[idx].qtd || 0)) itensUI[idx].qtd = 1;
          } else {
            itensUI[idx].produtoId = "";
          }
          renderItens();
        };
      });

      $$(".pe_item_desc", itensWrap).forEach((el) => el.oninput = () => {
        itensUI[Number(el.dataset.idx)].descricao = el.value;
        $("#pe_total_txt", modal.box).textContent = money(calcTotal());
      });

      $$(".pe_item_qtd", itensWrap).forEach((el) => el.oninput = () => {
        itensUI[Number(el.dataset.idx)].qtd = Number(el.value || 0);
        renderItens();
      });

      $$(".pe_item_v", itensWrap).forEach((el) => el.oninput = () => {
        itensUI[Number(el.dataset.idx)].valorUnit = parseMoney(el.value);
        renderItens();
      });

      $$("[data-rem]", itensWrap).forEach((b) => b.onclick = () => {
        itensUI.splice(Number(b.dataset.rem), 1);
        renderItens();
      });

      $$("[data-dup]", itensWrap).forEach((b) => b.onclick = () => {
        const src = itensUI[Number(b.dataset.dup)];
        itensUI.splice(Number(b.dataset.dup) + 1, 0, { ...src });
        renderItens();
      });
    }

    $("#pe_add_manual", modal.box).onclick = () => {
      itensUI.push({ produtoId: "", descricao: "", qtd: 1, valorUnit: 0 });
      renderItens();
    };

    $("#pe_add_prod", modal.box).onclick = () => {
      const picker = openModal("Adicionar mercadoria ao pedido", `
        <div class="field"><label>Selecione um produto</label>
          <select id="pe_pick_prod">
            <option value="">Selecione...</option>
            ${produtos.map(pr => `<option value="${safe(pr.id)}">${safe(fmtProd(pr))} • ${money(pr.valorVenda || 0)} • estoque ${Number(pr.estoqueAtual || 0)}</option>`).join("")}
          </select>
        </div>
        <div class="right">
          <button id="pe_pick_cancel" class="btn btn-muted">Fechar</button>
          <button id="pe_pick_ok" class="btn">Adicionar</button>
        </div>
      `, "min(700px,100%)");
      $("#pe_pick_cancel", picker.box).onclick = () => picker.close();
      $("#pe_pick_ok", picker.box).onclick = () => {
        const idSel = $("#pe_pick_prod", picker.box).value;
        const prod = produtos.find((x) => x.id === idSel);
        if (!prod) return alert("Selecione uma mercadoria.");
        itensUI.push({
          produtoId: prod.id,
          descricao: fmtProd(prod),
          qtd: 1,
          valorUnit: Number(prod.valorVenda || 0),
        });
        picker.close();
        renderItens();
      };
    };

    $("#pe_close", modal.box).onclick = () => modal.close();

    $("#pe_save", modal.box).onclick = async () => {
      const clienteId = $("#pe_cliente", modal.box).value;
      const cliente = (state.clientes || []).find((c) => c.id === clienteId);
      if (!cliente) return alert("Selecione um cliente.");

      const itens = itensUI
        .map((it) => ({
          produtoId: (it.produtoId || "").trim(),
          descricao: (it.descricao || "").trim(),
          qtd: Number(it.qtd || 0),
          valorUnit: Number(it.valorUnit || 0),
        }))
        .filter((it) => it.qtd > 0 && (it.descricao || it.produtoId));

      if (!itens.length) return alert("Adicione ao menos 1 item válido.");

      const originais = normalizePedidoItens(jparse(p?.itens, p?.itens || []));
      const baixarEstoque = $("#pe_baixa_estoque", modal.box).checked;
      const bloquearNeg = $("#pe_bloq_neg", modal.box).checked;

      if (baixarEstoque && bloquearNeg) {
        const issues = getStockIssues(originais, itens);
        if (issues.length) {
          return alert("Estoque insuficiente:\n\n" + issues.map((x) => `- ${x}`).join("\n"));
        }
      }

      const total = itens.reduce((acc, it) => acc + it.qtd * it.valorUnit, 0);

      const payload = {
        id: p?.id || null,
        data: parseDateInputToIso($("#pe_data", modal.box).value),
        clienteId: cliente.id,
        clienteNome: cliente.nome || "",
        formaPagamento: $("#pe_fp", modal.box).value.trim(),
        prazoDias: Number($("#pe_prazo", modal.box).value || 0),
        status: $("#pe_status", modal.box).value || "aberto",
        obs: $("#pe_obs", modal.box).value.trim(),
        total,
        itens,
      };

      await withLoading(async () => {
        const saved = await api("/api/pedidos", { method: "POST", body: JSON.stringify(payload) });

        // baixa estoque por delta
        if (baixarEstoque) {
          const before = new Map();
          const after = new Map();

          originais.forEach((it) => {
            if (!it.produtoId) return;
            before.set(it.produtoId, (before.get(it.produtoId) || 0) + Number(it.qtd || 0));
          });
          itens.forEach((it) => {
            if (!it.produtoId) return;
            after.set(it.produtoId, (after.get(it.produtoId) || 0) + Number(it.qtd || 0));
          });

          const all = new Set([...before.keys(), ...after.keys()]);
          const pmap = new Map((state.produtos || []).map((x) => [x.id, x]));

          for (const pid of all) {
            const deltaConsumido = Number(after.get(pid) || 0) - Number(before.get(pid) || 0);
            if (deltaConsumido === 0) continue;
            const prod = pmap.get(pid);
            if (!prod) continue;

            const novoEstoque = Number(prod.estoqueAtual || 0) - deltaConsumido;
            const payloadProd = {
              id: prod.id,
              marca: prod.marca || "",
              produto: prod.produto || "",
              modelo: prod.modelo || "",
              descricao: prod.descricao || "",
              categoria: prod.categoria || "",
              sku: prod.sku || "",
              agregados: prod.agregados || "",
              valorCompra: Number(prod.valorCompra || 0),
              valorVenda: Number(prod.valorVenda || 0),
              estoqueAtual: novoEstoque,
              estoqueMin: Number(prod.estoqueMin || 0),
              local: prod.local || "",
              status: prod.status || "ativo",
            };
            const savedProd = await api("/api/produtos", { method: "POST", body: JSON.stringify(payloadProd) });
            upsertLocal("produtos", savedProd);
          }
        }

        upsertLocal("pedidos", saved);
        modal.close();
        await refreshState();
        render();
        toast("Pedido salvo");
      });
    };

    renderItens();
  }

  // ---------- rotas ----------
  function renderRotas(view, q) {
    const items = (state.rotas || []).filter((r) => {
      const paradas = jparse(r.paradas, []);
      if (!q) return true;
      return `${r.id || ""} ${r.obs || ""} ${JSON.stringify(paradas)}`.toLowerCase().includes(q);
    });

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Rotas</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="rt_new" class="btn">+ Nova rota</button>
          <button id="rt_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead><tr><th>ID</th><th>Data</th><th>Paradas</th><th>Obs</th><th>Ações</th></tr></thead>
      <tbody>
        ${items.map(r => {
          const paradas = jparse(r.paradas, []);
          return `
            <tr>
              <td>${safe(r.id || "")}</td>
              <td>${safe(onlyDate(r.data || ""))}</td>
              <td>${Array.isArray(paradas) ? paradas.length : 0}</td>
              <td>${safe(r.obs || "")}</td>
              <td class="right">
                <button class="btn btn-muted" data-edit="${safe(r.id)}">Editar</button>
                <button class="btn btn-danger" data-del="${safe(r.id)}">Excluir</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#rt_new").onclick = () => openRotaForm();
    $("#rt_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openRotaForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir rota?")) return;
      await withLoading(async () => {
        await api(`/api/rotas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("rotas", b.dataset.del);
        render();
        toast("Rota excluída");
      });
    }));
  }

  function openRotaForm(id = null) {
    const r = id ? (state.rotas || []).find((x) => x.id === id) : null;
    const paradasDefault = JSON.stringify(jparse(r?.paradas, []), null, 2);

    const modal = openModal("Rota", `
      <div class="grid2">
        <div class="field"><label>ID</label><input id="rt_id" value="${safe(r?.id || "")}" disabled></div>
        <div class="field"><label>Data</label><input id="rt_data" type="date" value="${safe(onlyDate(r?.data || new Date().toISOString()))}"></div>
      </div>
      <div class="field"><label>Observações</label><input id="rt_obs" value="${safe(r?.obs || "")}"></div>
      <div class="field">
        <label>Paradas (JSON)</label>
        <textarea id="rt_paradas" style="min-height:180px">${safe(paradasDefault)}</textarea>
        <div class="muted">Ex.: [{"clienteId":"CL-000001","clienteNome":"Mercado X","ordem":1,"obs":"Entregar catálogo"}]</div>
      </div>
      <div class="right">
        <button id="rt_close" class="btn btn-muted">Fechar</button>
        <button id="rt_save" class="btn">Salvar</button>
      </div>
    `);

    $("#rt_close", modal.box).onclick = () => modal.close();
    $("#rt_save", modal.box).onclick = async () => {
      let paradas = [];
      try {
        paradas = JSON.parse($("#rt_paradas", modal.box).value || "[]");
      } catch (_) {
        return alert("JSON de paradas inválido.");
      }

      const payload = {
        id: r?.id || null,
        data: parseDateInputToIso($("#rt_data", modal.box).value),
        obs: $("#rt_obs", modal.box).value.trim(),
        paradas,
      };

      await withLoading(async () => {
        const saved = await api("/api/rotas", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("rotas", saved);
        modal.close();
        render();
        toast("Rota salva");
      });
    };
  }

  // ---------- despesas ----------
  function renderDespesas(view, q) {
    const items = (state.despesas || []).filter((d) =>
      textContains(d, q, ["id", "categoria", "pagamento", "obs"])
    );
    const total = items.reduce((acc, d) => acc + Number(d.valor || 0), 0);

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Despesas</div>
          <div class="muted">Total: ${items.length} • Soma: ${money(total)}</div>
        </div>
        <div class="right">
          <button id="ds_new" class="btn">+ Nova despesa</button>
          <button id="ds_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead><tr><th>ID</th><th>Data</th><th>Categoria</th><th>Pagamento</th><th>Valor</th><th>Ações</th></tr></thead>
      <tbody>
        ${items.map(d => `
          <tr>
            <td>${safe(d.id || "")}</td>
            <td>${safe(onlyDate(d.data || ""))}</td>
            <td>${safe(d.categoria || "")}<div class="muted">${safe(d.obs || "")}</div></td>
            <td>${safe(d.pagamento || "")}</td>
            <td>${money(d.valor || 0)}</td>
            <td class="right">
              <button class="btn btn-muted" data-edit="${safe(d.id)}">Editar</button>
              <button class="btn btn-danger" data-del="${safe(d.id)}">Excluir</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#ds_new").onclick = () => openDespesaForm();
    $("#ds_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openDespesaForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir despesa?")) return;
      await withLoading(async () => {
        await api(`/api/despesas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("despesas", b.dataset.del);
        render();
        toast("Despesa excluída");
      });
    }));
  }

  function openDespesaForm(id = null) {
    const d = id ? (state.despesas || []).find((x) => x.id === id) : null;

    const modal = openModal("Despesa", `
      <div class="grid2">
        <div class="field"><label>ID</label><input id="ds_id" value="${safe(d?.id || "")}" disabled></div>
        <div class="field"><label>Data</label><input id="ds_data" type="date" value="${safe(onlyDate(d?.data || new Date().toISOString()))}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Categoria</label><input id="ds_cat" value="${safe(d?.categoria || "")}"></div>
        <div class="field"><label>Pagamento</label><input id="ds_pag" value="${safe(d?.pagamento || "")}"></div>
        <div class="field"><label>Valor</label><input id="ds_val" value="${safe(d?.valor ?? "")}" placeholder="0,00"></div>
      </div>
      <div class="field"><label>Obs</label><textarea id="ds_obs">${safe(d?.obs || "")}</textarea></div>
      <div class="right">
        <button id="ds_close" class="btn btn-muted">Fechar</button>
        <button id="ds_save" class="btn">Salvar</button>
      </div>
    `);

    $("#ds_close", modal.box).onclick = () => modal.close();
    $("#ds_save", modal.box).onclick = async () => {
      const payload = {
        id: d?.id || null,
        data: parseDateInputToIso($("#ds_data", modal.box).value),
        categoria: $("#ds_cat", modal.box).value.trim(),
        pagamento: $("#ds_pag", modal.box).value.trim(),
        valor: parseMoney($("#ds_val", modal.box).value),
        obs: $("#ds_obs", modal.box).value.trim(),
      };

      await withLoading(async () => {
        const saved = await api("/api/despesas", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("despesas", saved);
        modal.close();
        render();
        toast("Despesa salva");
      });
    };
  }

  // ---------- lembretes ----------
  function renderLembretes(view, q) {
    const items = (state.lembretes || []).filter((l) =>
      textContains(l, q, ["id", "titulo", "texto", "status", "clienteNome", "tipo", "segmento"])
    );

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Lembretes / Campanhas</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="lb_new" class="btn">+ Novo lembrete</button>
          <button id="lb_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead><tr><th>ID</th><th>Data</th><th>Título</th><th>Status</th><th>Cliente</th><th>Ações</th></tr></thead>
      <tbody>
        ${items.map(l => `
          <tr>
            <td>${safe(l.id || "")}</td>
            <td>${safe(onlyDate(l.data || ""))}</td>
            <td>
              <div style="font-weight:700">${safe(l.titulo || "")}</div>
              <div class="muted">${safe(l.tipo || "")} ${l.segmento ? "• " + safe(l.segmento) : ""}</div>
            </td>
            <td>${safe(l.status || "")}</td>
            <td>${safe(l.clienteNome || "")}</td>
            <td class="right">
              <button class="btn btn-muted" data-edit="${safe(l.id)}">Editar</button>
              <button class="btn btn-danger" data-del="${safe(l.id)}">Excluir</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    view.appendChild(table);

    $("#lb_new").onclick = () => openLembreteForm();
    $("#lb_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", table).forEach((b) => (b.onclick = () => openLembreteForm(b.dataset.edit)));
    $$("[data-del]", table).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir lembrete?")) return;
      await withLoading(async () => {
        await api(`/api/lembretes/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("lembretes", b.dataset.del);
        render();
        toast("Lembrete excluído");
      });
    }));
  }

  function openLembreteForm(id = null) {
    const l = id ? (state.lembretes || []).find((x) => x.id === id) : null;
    const clientes = state.clientes || [];

    const modal = openModal("Lembrete / Campanha", `
      <div class="grid3">
        <div class="field"><label>ID</label><input id="lb_id" value="${safe(l?.id || "")}" disabled></div>
        <div class="field"><label>Data</label><input id="lb_data" type="date" value="${safe(onlyDate(l?.data || new Date().toISOString()))}"></div>
        <div class="field"><label>Status</label>
          <select id="lb_status">
            ${["pendente","em andamento","feito","cancelado"].map(s=>`<option value="${s}" ${String(l?.status||"pendente")===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid3">
        <div class="field"><label>Tipo</label><input id="lb_tipo" value="${safe(l?.tipo || "")}" placeholder="campanha, retorno, visita..."></div>
        <div class="field"><label>Título</label><input id="lb_titulo" value="${safe(l?.titulo || "")}"></div>
        <div class="field"><label>Segmento</label><input id="lb_seg" value="${safe(l?.segmento || "")}"></div>
      </div>
      <div class="grid2">
        <div class="field">
          <label>Cliente</label>
          <select id="lb_cliente">
            <option value="">Nenhum</option>
            ${clientes.map(c => `<option value="${safe(c.id)}" ${(l?.clienteId===c.id)?"selected":""}>${safe(c.nome || c.id)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Cliente (nome manual opcional)</label><input id="lb_cnome" value="${safe(l?.clienteNome || "")}"></div>
      </div>
      <div class="field"><label>Texto</label><textarea id="lb_texto">${safe(l?.texto || "")}</textarea></div>
      <div class="right">
        <button id="lb_close" class="btn btn-muted">Fechar</button>
        <button id="lb_save" class="btn">Salvar</button>
      </div>
    `);

    $("#lb_close", modal.box).onclick = () => modal.close();

    $("#lb_save", modal.box).onclick = async () => {
      const selId = $("#lb_cliente", modal.box).value;
      const cli = (state.clientes || []).find((c) => c.id === selId);

      const payload = {
        id: l?.id || null,
        data: parseDateInputToIso($("#lb_data", modal.box).value),
        tipo: $("#lb_tipo", modal.box).value.trim(),
        titulo: $("#lb_titulo", modal.box).value.trim(),
        segmento: $("#lb_seg", modal.box).value.trim(),
        texto: $("#lb_texto", modal.box).value.trim(),
        status: $("#lb_status", modal.box).value || "pendente",
        clienteId: cli?.id || "",
        clienteNome: $("#lb_cnome", modal.box).value.trim() || cli?.nome || "",
      };

      if (!payload.titulo) return alert("Informe um título.");

      await withLoading(async () => {
        const saved = await api("/api/lembretes", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("lembretes", saved);
        modal.close();
        render();
        toast("Lembrete salvo");
      });
    };
  }

  // ---------- notas ----------
  function renderNotas(view, q) {
    const items = (state.notas || []).filter((n) => textContains(n, q, ["id", "titulo", "texto"]));

    view.appendChild(card(`
      <div class="inline" style="justify-content:space-between;">
        <div>
          <div style="font-weight:800;font-size:22px;">Anotações</div>
          <div class="muted">Total: ${items.length}</div>
        </div>
        <div class="right">
          <button id="nt_new" class="btn">+ Nova anotação</button>
          <button id="nt_refresh" class="btn btn-muted">Recarregar</button>
        </div>
      </div>
    `));

    const grid = document.createElement("div");
    grid.className = "grid2";
    grid.style.marginTop = "10px";
    grid.innerHTML = items.map(n => `
      <div class="card">
        <div class="inline" style="justify-content:space-between;">
          <div style="font-weight:700">${safe(n.titulo || "(sem título)")}</div>
          <span class="pill">${n.fixada ? "Fixada" : "Normal"}</span>
        </div>
        <div class="muted" style="margin-top:4px;">${safe(n.id || "")}</div>
        <div style="white-space:pre-wrap;margin-top:10px;">${safe(n.texto || "")}</div>
        <div class="right" style="margin-top:10px;">
          <button class="btn btn-muted" data-edit="${safe(n.id)}">Editar</button>
          <button class="btn btn-danger" data-del="${safe(n.id)}">Excluir</button>
        </div>
      </div>
    `).join("");
    view.appendChild(grid);

    $("#nt_new").onclick = () => openNotaForm();
    $("#nt_refresh").onclick = async () => { await refreshState(); render(); toast("Atualizado"); };

    $$("[data-edit]", grid).forEach((b) => (b.onclick = () => openNotaForm(b.dataset.edit)));
    $$("[data-del]", grid).forEach((b) => (b.onclick = async () => {
      if (!confirm("Excluir anotação?")) return;
      await withLoading(async () => {
        await api(`/api/notas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
        removeLocal("notas", b.dataset.del);
        render();
        toast("Anotação excluída");
      });
    }));
  }

  function openNotaForm(id = null) {
    const n = id ? (state.notas || []).find((x) => x.id === id) : null;
    const modal = openModal("Anotação", `
      <div class="grid2">
        <div class="field"><label>ID</label><input id="nt_id" value="${safe(n?.id || "")}" disabled></div>
        <div class="field"><label>Fixada</label>
          <select id="nt_fix">
            <option value="0" ${!n?.fixada ? "selected" : ""}>Não</option>
            <option value="1" ${n?.fixada ? "selected" : ""}>Sim</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Título</label><input id="nt_tit" value="${safe(n?.titulo || "")}"></div>
      <div class="field"><label>Texto</label><textarea id="nt_txt" style="min-height:180px">${safe(n?.texto || "")}</textarea></div>
      <div class="right">
        <button id="nt_close" class="btn btn-muted">Fechar</button>
        <button id="nt_save" class="btn">Salvar</button>
      </div>
    `);

    $("#nt_close", modal.box).onclick = () => modal.close();
    $("#nt_save", modal.box).onclick = async () => {
      const payload = {
        id: n?.id || null,
        titulo: $("#nt_tit", modal.box).value.trim(),
        texto: $("#nt_txt", modal.box).value.trim(),
        fixada: $("#nt_fix", modal.box).value === "1",
      };
      await withLoading(async () => {
        const saved = await api("/api/notas", { method: "POST", body: JSON.stringify(payload) });
        upsertLocal("notas", saved);
        modal.close();
        render();
        toast("Anotação salva");
      });
    };
  }

  // ---------- extras que você pediu ----------
  // mercadorias / rotas / despesas / lembretes / pedidos já implementados acima com salvar/editar/excluir

  // ---------- boot ----------
  async function boot() {
    ensureAppShell();

    // botão imprimir (se existir)
    const printBtn = $("#btn-print");
    if (printBtn) printBtn.onclick = () => window.print();

    const q = $("#q");
    if (q) q.addEventListener("input", () => render());

    window.addEventListener("hashchange", () => render());

    state.route = getHashRoute();

    // Se já tiver token, tenta carregar
    if (getToken()) {
      try {
        await ensureAuth();
        await refreshState();
        render();
      } catch (e) {
        console.warn("Sessão inválida/expirada", e);
        renderLogin();
      }
    } else {
      renderLogin();
    }

    // service worker opcional
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  }

  boot();
})();