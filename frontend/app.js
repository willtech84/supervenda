(function () {
  const DB = window.DB;

  const state = {
    route: "dashboard",
    cache: {
      clientes: [],
      mercadorias: [],
      pedidos: [],
      rotas: [],
      despesas: [],
      lembretes: [],
      notas: [],
    },
    ui: { search: "" },
  };

  // ---------------- Utils ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function moneyBR(v) {
    const n = Number(v || 0);
    if (Number.isNaN(n)) return String(v ?? "");
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function dateFormatBR(v) {
    if (!v) return "";
    try {
      const d = new Date(v.includes("T") ? v : v + "T12:00:00");
      if (Number.isNaN(d.getTime())) return v;
      return d.toLocaleDateString("pt-BR");
    } catch { return v; }
  }

  function getId(item) {
    return item?.id ?? item?._id ?? item?.codigo ?? item?.uuid ?? "";
  }

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------- Toast ----------------
  function toast(msg, type = "info", timeout = 3500) {
    let wrap = $("#sv-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "sv-toast-wrap";
      document.body.appendChild(wrap);
    }

    const colors = {
      error:   { bg: "rgba(255,82,82,0.12)",   border: "#ff5252", icon: "✕" },
      success: { bg: "rgba(0,230,118,0.10)",   border: "#00e676", icon: "✓" },
      warning: { bg: "rgba(255,179,0,0.10)",   border: "#ffb300", icon: "!" },
      info:    { bg: "rgba(68,136,255,0.10)",  border: "#4488ff", icon: "ℹ" },
    };
    const c = colors[type] || colors.info;

    const el = document.createElement("div");
    el.style.cssText = `
      background:${c.bg}; border:1px solid ${c.border}; border-radius:10px;
      padding:10px 14px; font-size:13px; color:#e8eef8;
      box-shadow:0 8px 24px rgba(0,0,0,.3);
      display:flex; align-items:center; gap:8px;
      pointer-events:auto; animation:fadeUp .2s ease both;
    `;
    el.innerHTML = `<span style="color:${c.border};font-weight:700;">${c.icon}</span><span>${esc(String(msg || ""))}</span>`;
    wrap.appendChild(el);

    setTimeout(() => {
      el.style.transition = "opacity .2s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 220);
    }, timeout);
  }

  // ---------------- Loading ----------------
  function setLoading(on, text = "Carregando...") {
    const el = $("#sv-loading");
    const txt = $("#sv-loading-text");
    if (txt) txt.textContent = text;
    if (el) el.style.display = on ? "flex" : "none";
  }

  async function runWithUi(fn, text) {
    try {
      setLoading(true, text || "Processando...");
      return await fn();
    } catch (e) {
      console.error(e);
      toast(e?.message || "Erro inesperado", "error", 5000);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  // ---------------- Routes ----------------
  const ROUTES = [
    { id: "dashboard",   label: "Dashboard",       icon: "📊", nav: true  },
    { id: "clientes",    label: "Clientes",         icon: "👥", nav: true,  resource: "clientes"    },
    { id: "mercadorias", label: "Mercadorias",      icon: "📦", nav: true,  resource: "mercadorias" },
    { id: "pedidos",     label: "Pedidos",          icon: "🛒", nav: true,  resource: "pedidos"     },
    { id: "rotas",       label: "Rotas",            icon: "🗺️", nav: false, resource: "rotas"       },
    { id: "despesas",    label: "Despesas",         icon: "💸", nav: false, resource: "despesas"    },
    { id: "lembretes",   label: "Lembretes",        icon: "🔔", nav: false, resource: "lembretes"   },
    { id: "usuarios",    label: "Usuários",         icon: "👤", nav: false },
    { id: "anotacoes",   label: "Anotações",        icon: "📝", nav: false },
  ];

  // bottom nav: 4 principais + "mais"
  const BOTTOM_NAV_ROUTES = ["dashboard", "clientes", "pedidos", "mercadorias"];

  function getRoute(id) {
    return ROUTES.find((r) => r.id === id) || ROUTES[0];
  }

  function navigate(id) {
    state.route = getRoute(id).id;
    state.ui.search = "";
    location.hash = "#" + state.route;
    renderNav();
    renderCurrent();
    closeSidebar();
    closeMoreDrawer();
  }

  window.closeSidebar = function () {
    $("#app-sidebar")?.classList.remove("mobile-open");
    const bd = $("#sidebar-backdrop");
    if (bd) bd.style.display = "none";
  };

  window.closeMoreDrawer = function () {
    $("#more-drawer")?.classList.remove("open");
  };

  // ---------------- Nav builders ----------------
  function renderNav() {
    // Sidebar
    const nav = $("#sidebar-nav");
    if (nav) {
      nav.innerHTML = `
        <div class="nav-section-label">Menu</div>
        ${ROUTES.map((r) => `
          <div class="nav-item ${state.route === r.id ? "active" : ""}" data-nav="${esc(r.id)}">
            <span class="nav-item-icon">${r.icon}</span>
            ${esc(r.label)}
          </div>
        `).join("")}
      `;

      $$(".nav-item[data-nav]", nav).forEach((el) => {
        el.addEventListener("click", () => navigate(el.getAttribute("data-nav")));
      });
    }

    // Bottom nav
    const bnItems = $("#bottom-nav-items");
    if (bnItems) {
      const bottomRoutes = BOTTOM_NAV_ROUTES.map((id) => getRoute(id));
      bnItems.innerHTML = `
        ${bottomRoutes.map((r) => `
          <div class="bottom-nav-item ${state.route === r.id ? "active" : ""}" data-nav="${esc(r.id)}">
            <span class="icon">${r.icon}</span>
            <span>${esc(r.label)}</span>
          </div>
        `).join("")}
        <div class="bottom-nav-item ${!BOTTOM_NAV_ROUTES.includes(state.route) ? "active" : ""}" id="btn-more">
          <span class="icon">⋯</span>
          <span>Mais</span>
        </div>
      `;

      $$(".bottom-nav-item[data-nav]", bnItems).forEach((el) => {
        el.addEventListener("click", () => navigate(el.getAttribute("data-nav")));
      });

      $("#btn-more")?.addEventListener("click", openMoreDrawer);
    }

    // More drawer
    const moreGrid = $("#more-drawer-grid");
    if (moreGrid) {
      const moreRoutes = ROUTES.filter((r) => !BOTTOM_NAV_ROUTES.includes(r.id));
      moreGrid.innerHTML = moreRoutes.map((r) => `
        <div class="more-drawer-item ${state.route === r.id ? "active" : ""}" data-nav="${esc(r.id)}">
          <span class="icon">${r.icon}</span>
          ${esc(r.label)}
        </div>
      `).join("");

      $$(".more-drawer-item[data-nav]", moreGrid).forEach((el) => {
        el.addEventListener("click", () => navigate(el.getAttribute("data-nav")));
      });
    }

    // Topbar title
    const route = getRoute(state.route);
    const title = $("#topbar-title");
    if (title) title.textContent = `${route.icon} ${route.label}`;
  }

  function openMoreDrawer() {
    renderNav(); // atualiza estado ativo
    $("#more-drawer")?.classList.add("open");
  }

  // ---------------- Sync visibility ----------------
  function syncLoginWorkspace() {
    const hasToken = !!DB.getToken();
    $("#login-section")?.classList.toggle("hidden", hasToken);
    $("#workspace-section")?.classList.toggle("hidden", !hasToken);
  }

  function updateUserUI() {
    const u = DB.getUser();
    const name = u?.name || u?.email || "Usuário";
    const role = u?.role || "seller";

    const els = {
      "#sidebar-user-name": name,
      "#btn-user-name": name.split(" ")[0],
      "#dropdown-user-name": name,
      "#dropdown-user-role": role === "admin" ? "Administrador" : "Vendedor",
    };

    Object.entries(els).forEach(([sel, val]) => {
      const el = $(sel);
      if (el) el.textContent = val;
    });
  }

  // ---------------- Data ----------------
  async function loadResource(resource) {
    const items = await DB.list(resource);
    state.cache[resource] = safeArray(items);
    return state.cache[resource];
  }

  async function preloadAll() {
    const resources = ["clientes", "mercadorias", "pedidos", "rotas", "despesas", "lembretes"];
    await Promise.allSettled(resources.map((r) => loadResource(r).catch((e) => console.warn(r, e))));
  }

  // ---------------- Schemas ----------------
  const SCHEMAS = {
    clientes: {
      title: "Clientes",
      icon: "👥",
      primaryKey: "nome",
      fields: [
        { key: "nome",            label: "Nome",             type: "text",     required: true },
        { key: "telefone",        label: "Telefone",         type: "text" },
        { key: "cidade",          label: "Cidade",           type: "text" },
        { key: "endereco",        label: "Endereço",         type: "text" },
        { key: "bairro",          label: "Bairro",           type: "text" },
        { key: "cep",             label: "CEP",              type: "text" },
        { key: "cpfcnpj",         label: "CPF / CNPJ",       type: "text" },
        { key: "pagamentoPadrao", label: "Pagamento padrão", type: "text" },
        { key: "obs",             label: "Observação",       type: "textarea" },
      ],
      listFields: [
        { key: "telefone", label: "Tel" },
        { key: "cidade",   label: "Cidade" },
      ],
    },
    mercadorias: {
      title: "Mercadorias",
      icon: "📦",
      primaryKey: "nome",
      fields: [
        { key: "marca",       label: "Marca",       type: "text" },
        { key: "nome",        label: "Produto",     type: "text",   required: true },
        { key: "codigo",      label: "Código / SKU",type: "text" },
        { key: "categoria",   label: "Categoria",   type: "text" },
        { key: "valor_compra",label: "Valor compra",type: "number" },
        { key: "valor_venda", label: "Valor venda", type: "number" },
        { key: "estoque",     label: "Estoque",     type: "number" },
        { key: "descricao",   label: "Descrição",   type: "textarea" },
      ],
      listFields: [
        { key: "valorVenda",   label: "Venda",   money: true },
        { key: "estoqueAtual", label: "Estoque" },
      ],
      normalizeOut(item) {
        return {
          ...item,
          nome:        item.nome ?? item.produto ?? "",
          codigo:      item.codigo ?? item.sku ?? "",
          valor_compra:item.valor_compra ?? item.valorCompra ?? 0,
          valor_venda: item.valor_venda ?? item.valorVenda ?? 0,
          estoque:     item.estoque ?? item.estoqueAtual ?? 0,
        };
      },
    },
    pedidos: {
      title: "Pedidos / Vendas",
      icon: "🛒",
      primaryKey: "clienteNome",
      fields: [
        { key: "clienteNome",    label: "Cliente",           type: "text",   required: true },
        { key: "data",           label: "Data",              type: "date" },
        { key: "urgencia",       label: "Urgência",          type: "text" },
        { key: "formaPagamento", label: "Forma de pagamento",type: "text" },
        { key: "total",          label: "Total (R$)",        type: "number" },
        { key: "status",         label: "Status",            type: "text" },
        { key: "obs",            label: "Observação",        type: "textarea" },
      ],
      listFields: [
        { key: "status", label: "Status", badge: true },
        { key: "total",  label: "Total",  money: true },
        { key: "data",   label: "Data",   date: true },
      ],
    },
    rotas: {
      title: "Rotas",
      icon: "🗺️",
      primaryKey: "obs",
      fields: [
        { key: "data", label: "Data",     type: "date" },
        { key: "obs",  label: "Roteiro",  type: "textarea", required: true },
      ],
      listFields: [
        { key: "data", label: "Data", date: true },
      ],
    },
    despesas: {
      title: "Despesas",
      icon: "💸",
      primaryKey: "categoria",
      fields: [
        { key: "data",      label: "Data",       type: "date" },
        { key: "categoria", label: "Categoria",  type: "text",   required: true },
        { key: "valor",     label: "Valor (R$)", type: "number", required: true },
        { key: "pagamento", label: "Pagamento",  type: "text" },
        { key: "obs",       label: "Observação", type: "textarea" },
      ],
      listFields: [
        { key: "valor",    label: "Valor",    money: true },
        { key: "pagamento",label: "Pagamento" },
        { key: "data",     label: "Data",     date: true },
      ],
    },
    lembretes: {
      title: "Lembretes",
      icon: "🔔",
      primaryKey: "titulo",
      fields: [
        { key: "tipo",   label: "Tipo",     type: "text" },
        { key: "titulo", label: "Título",   type: "text",     required: true },
        { key: "data",   label: "Data",     type: "date" },
        { key: "texto",  label: "Mensagem", type: "textarea" },
        { key: "status", label: "Status",   type: "text" },
      ],
      listFields: [
        { key: "tipo",   label: "Tipo" },
        { key: "status", label: "Status", badge: true },
        { key: "data",   label: "Data",   date: true },
      ],
    },
  };

  function normalizeItem(resource, item) {
    if (!item) return item;
    const s = SCHEMAS[resource];
    return s?.normalizeOut ? s.normalizeOut(item) : item;
  }

  // ---------------- Render ----------------
  function renderCurrent() {
    const root = $("#sv-screen-root");
    if (!root || !DB.getToken()) return;

    updateUserUI();
    renderNav();

    const route = getRoute(state.route);

    if (route.id === "dashboard")  { renderDashboard(root); return; }
    if (route.id === "usuarios")   { renderUsersScreen(root); return; }
    if (route.id === "anotacoes")  {
      root.innerHTML = `<div class="card"><div class="card-title" style="margin-bottom:8px">📝 Anotações</div><p style="color:var(--muted);font-size:14px;">Módulo em breve.</p></div>`;
      return;
    }
    if (route.resource && SCHEMAS[route.resource]) {
      renderCrudScreen(root, route.resource);
      return;
    }

    root.innerHTML = `<div class="card"><p style="color:var(--muted);">Tela em preparação.</p></div>`;
  }

  // ---------------- Dashboard ----------------
  function renderDashboard(root) {
    const u = DB.getUser();

    const statItems = [
      { label: "Clientes",    value: state.cache.clientes.length,    icon: "👥", color: "#4488ff" },
      { label: "Mercadorias", value: state.cache.mercadorias.length,  icon: "📦", color: "#00e676" },
      { label: "Pedidos",     value: state.cache.pedidos.length,      icon: "🛒", color: "#ffb300" },
      { label: "Despesas",    value: state.cache.despesas.length,     icon: "💸", color: "#ff5252" },
      { label: "Lembretes",   value: state.cache.lembretes.length,    icon: "🔔", color: "#b97fff" },
      { label: "Rotas",       value: state.cache.rotas.length,        icon: "🗺️", color: "#00d4c8" },
    ];

    // Calcular totais de pedidos
    const pedidos = state.cache.pedidos;
    const totalVendas = pedidos.reduce((acc, p) => acc + Number(p.total || 0), 0);
    const pedidosAbertos = pedidos.filter(p => !p.status || p.status.toLowerCase().includes("aberto") || p.status.toLowerCase().includes("pendente")).length;

    root.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg, rgba(0,230,118,0.06) 0%, rgba(68,136,255,0.04) 100%); border-color:rgba(0,230,118,0.12);">
        <div style="font-size:13px;color:var(--muted);margin-bottom:4px;">Olá,</div>
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">${esc(u?.name?.split(" ")[0] || "Vendedor")} 👋</div>
      </div>

      <div class="stats-grid">
        ${statItems.map(s => `
          <div class="stat-card" style="cursor:pointer;" onclick="navigate_to('${s.label.toLowerCase()}')">
            <div class="stat-icon">${s.icon}</div>
            <div class="stat-label">${esc(s.label)}</div>
            <div class="stat-value" style="color:${s.color}">${s.value}</div>
          </div>
        `).join("")}
      </div>

      ${pedidos.length ? `
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">💰 Resumo de Vendas</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:var(--bg2);border-radius:10px;padding:12px;border:1px solid var(--border);">
              <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Total em pedidos</div>
              <div style="font-size:18px;font-weight:700;color:var(--green);">${moneyBR(totalVendas)}</div>
            </div>
            <div style="background:var(--bg2);border-radius:10px;padding:12px;border:1px solid var(--border);">
              <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Pedidos em aberto</div>
              <div style="font-size:18px;font-weight:700;color:var(--amber);">${pedidosAbertos}</div>
            </div>
          </div>
        </div>
      ` : ""}

      ${state.cache.lembretes.filter(l => l.status !== "concluído").slice(0, 3).length ? `
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">🔔 Lembretes pendentes</div>
          ${state.cache.lembretes.filter(l => l.status !== "concluído").slice(0, 3).map(l => `
            <div style="padding:10px;background:var(--bg2);border-radius:10px;border:1px solid var(--border);margin-bottom:6px;font-size:13px;">
              <span style="font-weight:600;">${esc(l.titulo || "")}</span>
              ${l.data ? `<span style="color:var(--muted);margin-left:8px;">${dateFormatBR(l.data)}</span>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}
    `;
  }

  // Helper para nav no dashboard
  window.navigate_to = function(label) {
    const map = { clientes: "clientes", mercadorias: "mercadorias", pedidos: "pedidos", despesas: "despesas", lembretes: "lembretes", rotas: "rotas" };
    const id = map[label];
    if (id) navigate(id);
  };

  // ---------------- CRUD ----------------
  function renderCrudScreen(root, resource) {
    const schema = SCHEMAS[resource];
    const rawItems = safeArray(state.cache[resource]);
    const items = rawItems.map((it) => normalizeItem(resource, it));
    const q = String(state.ui.search || "").trim().toLowerCase();

    const filtered = !q ? items : items.filter((it) =>
      Object.values(it || {}).some((v) => String(v ?? "").toLowerCase().includes(q))
    );

    root.innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="search-wrap" style="flex:1;min-width:160px;">
            <span class="search-icon">🔍</span>
            <input id="sv-search-input" type="search" placeholder="Buscar ${esc(schema.title.toLowerCase())}..." value="${esc(state.ui.search)}" />
          </div>
          <button id="sv-new-btn" class="btn btn-primary" style="width:auto;gap:4px;">
            <span>+</span> Novo
          </button>
          <button id="sv-refresh-btn" class="btn btn-secondary btn-icon" title="Atualizar">↻</button>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--muted);">${filtered.length} registro${filtered.length !== 1 ? "s" : ""}</div>
      </div>

      <div id="sv-form-wrap"></div>
      <div id="sv-list-wrap"></div>
    `;

    $("#sv-search-input")?.addEventListener("input", (e) => {
      state.ui.search = e.target.value || "";
      renderCrudScreen(root, resource);
    });

    $("#sv-new-btn")?.addEventListener("click", () => {
      renderForm(resource, null);
      setTimeout(() => $("#sv-form-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    });

    $("#sv-refresh-btn")?.addEventListener("click", async () => {
      await runWithUi(async () => {
        await loadResource(resource);
        renderCrudScreen(root, resource);
        toast("Dados atualizados.", "success");
      }, "Atualizando...");
    });

    renderList(resource, filtered, rawItems);
  }

  function renderList(resource, items, rawItems) {
    const wrap = $("#sv-list-wrap");
    const schema = SCHEMAS[resource];
    if (!wrap) return;

    if (!items.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${schema.icon}</div>
          <div class="empty-text">Nenhum registro encontrado.<br>Clique em "+ Novo" para adicionar.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = items.map((item) => {
      const id = getId(item);
      const primaryVal = item[schema.primaryKey] || item.nome || item.titulo || id;
      const metaFields = (schema.listFields || []).map((f) => {
        let v = item[f.key];
        if (f.money) v = moneyBR(v);
        else if (f.date) v = dateFormatBR(v);
        if (!v && v !== 0) return "";
        const badge = f.badge
          ? `<span class="badge ${getBadgeClass(v)}">${esc(v)}</span>`
          : `<strong>${esc(v)}</strong>`;
        return `<span class="meta-item">${esc(f.label)}: ${badge}</span>`;
      }).filter(Boolean).join("");

      return `
        <div class="list-item">
          <div class="list-item-top">
            <div class="list-item-title">${esc(primaryVal)}</div>
            <span class="badge badge-muted" style="font-size:10px;">${esc(id)}</span>
          </div>
          ${metaFields ? `<div class="list-item-meta">${metaFields}</div>` : ""}
          <div class="list-item-actions">
            <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-action="edit" data-id="${esc(id)}">
              ✏️ Editar
            </button>
            <button class="btn btn-danger" style="font-size:13px;padding:7px 14px;" data-action="delete" data-id="${esc(id)}">
              🗑️ Excluir
            </button>
          </div>
        </div>
      `;
    }).join("");

    $$("[data-action='edit']", wrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const item = rawItems.find((x) => String(getId(x)) === String(id));
        renderForm(resource, item || null);
        setTimeout(() => $("#sv-form-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      });
    });

    $$("[data-action='delete']", wrap).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id || !confirm("Excluir este registro?")) return;
        await runWithUi(async () => {
          await DB.remove(resource, id);
          await loadResource(resource);
          renderCurrent();
          toast("Registro excluído.", "success");
        }, "Excluindo...");
      });
    });
  }

  function getBadgeClass(status) {
    if (!status) return "badge-muted";
    const s = String(status).toLowerCase();
    if (s.includes("conclu") || s.includes("entregue") || s.includes("pago")) return "badge-green";
    if (s.includes("cancel") || s.includes("atraso")) return "badge-red";
    if (s.includes("aberto") || s.includes("pendente")) return "badge-amber";
    return "badge-blue";
  }

  function renderField(f, value) {
    const v = value ?? "";
    const baseInput = `style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;"`;

    if (f.type === "textarea") {
      return `
        <div class="field">
          <label>${esc(f.label)}${f.required ? " *" : ""}</label>
          <textarea name="${esc(f.key)}" rows="3" ${baseInput}>${esc(v)}</textarea>
        </div>
      `;
    }

    const type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
    let out = v;
    if (type === "date" && v) {
      try {
        const d = new Date(v.includes("T") ? v : v + "T12:00:00");
        if (!Number.isNaN(d.getTime())) out = d.toISOString().slice(0, 10);
      } catch {}
    }

    return `
      <div class="field">
        <label>${esc(f.label)}${f.required ? " *" : ""}</label>
        <input type="${type}" name="${esc(f.key)}" value="${esc(out)}" ${baseInput} />
      </div>
    `;
  }

  function formToPayload(form, fields) {
    const fd = new FormData(form);
    const payload = {};
    fields.forEach((f) => {
      let v = fd.get(f.key);
      if (typeof v === "string") v = v.trim();
      if (f.type === "number") {
        payload[f.key] = v === "" || v == null ? 0 : (Number(String(v).replace(",", ".")) || 0);
      } else {
        payload[f.key] = v ?? "";
      }
    });
    return payload;
  }

  function normalizeForSubmit(resource, payload) {
    if (resource !== "mercadorias") return payload;
    return {
      ...payload,
      produto:      payload.nome || "",
      sku:          payload.codigo || "",
      valorCompra:  payload.valor_compra ?? 0,
      valorVenda:   payload.valor_venda ?? 0,
      estoqueAtual: payload.estoque ?? 0,
    };
  }

  function renderForm(resource, item) {
    const wrap = $("#sv-form-wrap");
    if (!wrap) return;

    const schema = SCHEMAS[resource];
    const isEdit = !!item;
    const itemView = normalizeItem(resource, item || {});
    const itemId = isEdit ? getId(item) : "";

    wrap.innerHTML = `
      <div class="form-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="font-size:15px;font-weight:600;">${isEdit ? "✏️ Editar" : "➕ Novo"} ${esc(schema.title)}</div>
          <button id="sv-close-form" class="btn btn-ghost btn-icon">✕</button>
        </div>

        <form id="sv-crud-form">
          <div class="form-grid">
            ${schema.fields.map((f) => renderField(f, itemView?.[f.key])).join("")}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" style="width:auto;">
              💾 ${isEdit ? "Salvar alterações" : "Salvar"}
            </button>
            ${isEdit ? `<button type="button" id="sv-delete-current" class="btn btn-danger">🗑️ Excluir</button>` : ""}
            <button type="button" id="sv-cancel-form" class="btn btn-ghost">Cancelar</button>
          </div>
        </form>
      </div>
    `;

    // Fix: add focus style via JS (CSS :focus doesn't work in style attr)
    $$("input, select, textarea", wrap).forEach((el) => {
      el.addEventListener("focus", () => {
        el.style.outline = "none";
        el.style.borderColor = "var(--green-dim)";
        el.style.boxShadow = "0 0 0 3px rgba(0,230,118,0.08)";
      });
      el.addEventListener("blur", () => {
        el.style.borderColor = "var(--border-hi)";
        el.style.boxShadow = "none";
      });
    });

    $("#sv-close-form")?.addEventListener("click", () => { wrap.innerHTML = ""; });
    $("#sv-cancel-form")?.addEventListener("click", () => { wrap.innerHTML = ""; });

    $("#sv-crud-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      let payload = formToPayload(e.currentTarget, schema.fields);
      payload = normalizeForSubmit(resource, payload);

      const missing = schema.fields.find((f) => f.required && !String(payload[f.key] ?? "").trim());
      if (missing) { toast(`Preencha: ${missing.label}`, "warning"); return; }

      await runWithUi(async () => {
        if (isEdit) await DB.update(resource, itemId, payload);
        else        await DB.create(resource, payload);
        await loadResource(resource);
        wrap.innerHTML = "";
        renderCurrent();
        toast(isEdit ? "✅ Registro atualizado." : "✅ Registro salvo.", "success");
      }, "Salvando...");
    });

    if (isEdit) {
      $("#sv-delete-current")?.addEventListener("click", async () => {
        if (!confirm("Excluir este registro?")) return;
        await runWithUi(async () => {
          await DB.remove(resource, itemId);
          await loadResource(resource);
          wrap.innerHTML = "";
          renderCurrent();
          toast("✅ Registro excluído.", "success");
        }, "Excluindo...");
      });
    }
  }

  // ---------------- Users screen ----------------
  async function renderUsersScreen(root) {
    const user = DB.getUser();
    if (!user || user.role !== "admin") {
      root.innerHTML = `
        <div class="card">
          <div class="card-title">👤 Usuários</div>
          <p style="color:var(--red);font-size:14px;margin-top:8px;">Acesso restrito ao administrador.</p>
        </div>
      `;
      return;
    }

    let users = [];
    try {
      users = safeArray(await DB.listUsers());
    } catch (e) {
      root.innerHTML = `
        <div class="card">
          <div class="card-title">👤 Usuários</div>
          <p style="color:var(--red);font-size:14px;margin-top:8px;">Erro: ${esc(e?.message || "Falha")}</p>
        </div>
      `;
      return;
    }

    const inputStyle = `width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;`;

    root.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">👤 Usuários</div>
          <div style="display:flex;gap:6px;">
            <button id="sv-user-new" class="btn btn-primary" style="width:auto;">+ Novo</button>
            <button id="sv-user-refresh" class="btn btn-secondary btn-icon">↻</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--muted);">${users.length} usuário${users.length !== 1 ? "s" : ""}</div>
      </div>

      <div id="sv-users-form-wrap"></div>

      <div id="sv-users-list">
        ${users.length
          ? users.map((u) => `
            <div class="list-item">
              <div class="list-item-top">
                <div>
                  <div class="list-item-title">${esc(u.name || "")}</div>
                  <div style="font-size:12px;color:var(--muted);margin-top:2px;">${esc(u.email || "")}</div>
                </div>
                <span class="badge ${u.role === "admin" ? "badge-blue" : "badge-muted"}">${esc(u.role || "seller")}</span>
              </div>
              <div class="list-item-meta">
                <span class="meta-item">Ativo: <strong style="color:${Number(u.active) ? "var(--green)" : "var(--red)"}">${Number(u.active) ? "Sim" : "Não"}</strong></span>
                <span class="meta-item">ID: <strong>${esc(u.id || "")}</strong></span>
              </div>
              <div class="list-item-actions">
                <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-user-edit="${esc(u.id || "")}">✏️ Editar</button>
              </div>
            </div>
          `).join("")
          : `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">Nenhum usuário cadastrado.</div></div>`
        }
      </div>
    `;

    const formWrap = $("#sv-users-form-wrap");

    function renderUserForm(item) {
      const isEdit = !!item;
      formWrap.innerHTML = `
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit ? "✏️ Editar usuário" : "➕ Novo usuário"}</div>
            <button id="sv-user-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          <form id="sv-user-form">
            <div class="form-grid">
              <div class="field">
                <label>Nome *</label>
                <input name="name" value="${esc(item?.name || "")}" placeholder="Nome completo" style="${inputStyle}" />
              </div>
              <div class="field">
                <label>E-mail *</label>
                <input name="email" type="email" value="${esc(item?.email || "")}" placeholder="email@exemplo.com" style="${inputStyle}" />
              </div>
              <div class="field">
                <label>Perfil</label>
                <select name="role" style="${inputStyle}">
                  <option value="seller" ${(item?.role || "seller") === "seller" ? "selected" : ""}>Vendedor (seller)</option>
                  <option value="admin"  ${(item?.role || "seller") === "admin"  ? "selected" : ""}>Administrador (admin)</option>
                </select>
              </div>
              <div class="field">
                <label>Ativo</label>
                <select name="active" style="${inputStyle}">
                  <option value="1" ${Number(item?.active ?? 1) ? "selected" : ""}>Sim</option>
                  <option value="0" ${!Number(item?.active ?? 1) ? "selected" : ""}>Não</option>
                </select>
              </div>
              <div class="field">
                <label>${isEdit ? "Nova senha (deixe em branco para manter)" : "Senha *"}</label>
                <input name="password" type="password" placeholder="${isEdit ? "Nova senha (opcional)" : "Senha"}" style="${inputStyle}" />
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" style="width:auto;">💾 ${isEdit ? "Salvar" : "Criar usuário"}</button>
              <button type="button" id="sv-user-cancel" class="btn btn-ghost">Cancelar</button>
            </div>
          </form>
        </div>
      `;

      setTimeout(() => formWrap?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);

      $("#sv-user-close")?.addEventListener("click", () => { formWrap.innerHTML = ""; });
      $("#sv-user-cancel")?.addEventListener("click", () => { formWrap.innerHTML = ""; });

      $("#sv-user-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const payload = {
          name:     String(fd.get("name") || "").trim(),
          email:    String(fd.get("email") || "").trim(),
          role:     String(fd.get("role") || "seller"),
          active:   Number(fd.get("active") || 1),
          password: String(fd.get("password") || ""),
        };

        if (!payload.name)                       return toast("Nome é obrigatório.", "warning");
        if (!payload.email)                      return toast("E-mail é obrigatório.", "warning");
        if (!isEdit && !payload.password)        return toast("Senha é obrigatória.", "warning");

        await runWithUi(async () => {
          if (isEdit) {
            if (!payload.password) delete payload.password;
            await DB.updateUser(item.id, payload);
            toast("✅ Usuário atualizado.", "success");
          } else {
            await DB.createUser(payload);
            toast("✅ Usuário criado.", "success");
          }
          await renderUsersScreen(root);
        }, isEdit ? "Salvando..." : "Criando...");
      });
    }

    $("#sv-user-new")?.addEventListener("click", () => renderUserForm(null));
    $("#sv-user-refresh")?.addEventListener("click", async () => {
      await runWithUi(() => renderUsersScreen(root), "Atualizando...");
    });

    $$("[data-user-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-edit");
        const item = users.find((u) => String(u.id) === String(id));
        if (item) renderUserForm(item);
      });
    });
  }

  // ---------------- Topbar / Sidebar bind ----------------
  function bindShell() {
    // Mobile menu toggle
    $("#menu-toggle")?.addEventListener("click", () => {
      $("#app-sidebar")?.classList.add("mobile-open");
      const bd = $("#sidebar-backdrop");
      if (bd) bd.style.display = "block";
    });

    // Desktop backup btn
    $("#btn-backup")?.addEventListener("click", doBackup);

    // Sidebar backup / logout
    $("#sidebar-backup-btn")?.addEventListener("click", doBackup);
    $("#sidebar-logout-btn")?.addEventListener("click", doLogout);

    // User dropdown
    const btnUser = $("#btn-user");
    const dropdown = $("#user-dropdown");
    if (btnUser && dropdown) {
      btnUser.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
      });
      document.addEventListener("click", () => dropdown.classList.remove("open"));

      $$("[data-action]", dropdown).forEach((btn) => {
        btn.addEventListener("click", () => {
          dropdown.classList.remove("open");
          const action = btn.getAttribute("data-action");
          if (action === "sair") doLogout();
          if (action === "trocar") doLogout(true);
        });
      });
    }
  }

  async function doBackup() {
    await runWithUi(async () => {
      const result = await DB.backup();
      const filename = `supervenda-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      downloadJson(filename, result.data);
      toast("✅ Backup gerado.", "success");
    }, "Gerando backup...");
  }

  function doLogout(trocar = false) {
    const msg = trocar ? "Trocar usuário? Sessão atual será encerrada." : "Deseja sair?";
    if (!confirm(msg)) return;
    DB.clearSession();
    toast("Sessão encerrada.", "info");
    setTimeout(() => location.reload(), 400);
  }

  // ---------------- Auth forms ----------------
  function bindAuthForms() {
    $("#goto-register")?.addEventListener("click", () => {
      $("#view-login")?.classList.add("hidden");
      $("#view-register")?.classList.remove("hidden");
    });
    $("#goto-login")?.addEventListener("click", () => {
      $("#view-register")?.classList.add("hidden");
      $("#view-login")?.classList.remove("hidden");
    });

    const loginForm = $("#login-form");
    if (loginForm && !loginForm.dataset.bound) {
      loginForm.dataset.bound = "1";
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = loginForm.querySelector("[name='email']")?.value?.trim() || "";
        const senha = loginForm.querySelector("[name='senha']")?.value || "";
        if (!email || !senha) return toast("Informe e-mail e senha.", "warning");

        await runWithUi(async () => {
          await DB.login(email, senha);
          try { await DB.me(); } catch (_) {}
          syncLoginWorkspace();
          bindShell();
          renderNav();
          await preloadAll();
          renderCurrent();
          toast("✅ Login realizado!", "success");
        }, "Entrando...");
      });
    }

    const regForm = $("#register-form");
    if (regForm && !regForm.dataset.bound) {
      regForm.dataset.bound = "1";
      regForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name  = regForm.querySelector("[name='name']")?.value?.trim() || "";
        const email = regForm.querySelector("[name='email']")?.value?.trim() || "";
        const senha = regForm.querySelector("[name='senha']")?.value || "";
        if (!name || !email || !senha) return toast("Preencha todos os campos.", "warning");
        if (senha.length < 6) return toast("Senha deve ter ao menos 6 caracteres.", "warning");

        await runWithUi(async () => {
          await DB.register({ name, email, senha });
          syncLoginWorkspace();
          bindShell();
          renderNav();
          await preloadAll();
          renderCurrent();
          toast("✅ Conta criada!", "success");
        }, "Criando conta...");
      });
    }
  }

  // ---------------- Init ----------------
  async function init() {
    bindAuthForms();

    // Mixed content warning
    if (location.protocol === "https:" && window.CONFIG?.API_BASE && /^http:\/\//i.test(window.CONFIG.API_BASE)) {
      alert("⚠️ A API está em HTTP mas o site está em HTTPS.\nAtualize a URL em config.js para HTTPS.");
    }

    if (DB.getToken()) {
      try {
        await DB.me();
        syncLoginWorkspace();
        bindShell();
        renderNav();
        await runWithUi(preloadAll, "Carregando dados...");
      } catch (e) {
        console.warn("Sessão inválida:", e);
        DB.clearSession();
        syncLoginWorkspace();
      }
    } else {
      syncLoginWorkspace();
    }

    // Hash routing
    const hash = (location.hash || "#dashboard").replace("#", "") || "dashboard";
    state.route = getRoute(hash).id;
    renderNav();
    renderCurrent();

    window.addEventListener("hashchange", () => {
      const h = (location.hash || "#dashboard").replace("#", "") || "dashboard";
      state.route = getRoute(h).id;
      state.ui.search = "";
      renderNav();
      renderCurrent();
    });
  }

  window.SuperVendaApp = { state, navigate };
  init();
})();
