(function () {
  const DB = window.DB;
  const CONFIG = window.CONFIG || {};

  const state = {
    route: (location.hash || "#dashboard").replace("#", "") || "dashboard",
    cache: {
      clientes: [],
      mercadorias: [],
      pedidos: [],
      rotas: [],
      despesas: [],
      lembretes: [],
      notas: [],
    },
    ui: {
      search: "",
    },
  };

  // ---------------- Utils ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function btnStyle(kind = "default") {
    const map = {
      default:
        "padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:#0d1930;color:#fff;cursor:pointer",
      primary:
        "padding:8px 12px;border-radius:10px;border:1px solid #1dd17b;background:#11261b;color:#fff;cursor:pointer",
      danger:
        "padding:8px 12px;border-radius:10px;border:1px solid #ff6b6b;background:#2a1616;color:#fff;cursor:pointer",
      soft:
        "padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#fff;cursor:pointer",
    };
    return map[kind] || map.default;
  }

  function cardStyle() {
    return `
      background: rgba(10,20,40,.7);
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      padding:12px;
      margin-bottom:12px;
    `;
  }

  function inputStyle() {
    return `
      width:100%; padding:10px; border-radius:10px;
      border:1px solid rgba(255,255,255,.12);
      background:#091329; color:#fff; box-sizing:border-box;
    `;
  }

  function labelWrap(title, innerHtml) {
    return `
      <label style="display:block; font-size:12px; color:#b7c7e7; margin-bottom:8px">
        <div style="margin-bottom:5px">${escapeHtml(title)}</div>
        ${innerHtml}
      </label>
    `;
  }

  function moneyBR(v) {
    const n = Number(v || 0);
    if (Number.isNaN(n)) return String(v ?? "");
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function getId(item) {
    return item?.id ?? item?._id ?? item?.codigo ?? item?.uuid ?? "";
  }

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------- Toast / Loading ----------------
  function ensureToastWrap() {
    let el = $("#sv-toast-wrap");
    if (!el) {
      el = document.createElement("div");
      el.id = "sv-toast-wrap";
      el.style.cssText =
        "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:360px;";
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(msg, type = "info", timeout = 3200) {
    const wrap = ensureToastWrap();
    const bg =
      type === "error" ? "#4a1515" :
      type === "success" ? "#12351f" :
      type === "warning" ? "#4a3c14" : "#13233c";

    const el = document.createElement("div");
    el.style.cssText = `
      background:${bg}; color:#fff; border:1px solid rgba(255,255,255,.18);
      padding:10px 12px; border-radius:10px; font-size:13px;
      box-shadow:0 6px 18px rgba(0,0,0,.25);
    `;
    el.textContent = String(msg || "");
    wrap.appendChild(el);

    setTimeout(() => {
      el.style.transition = "opacity .2s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 220);
    }, timeout);
  }

  function ensureLoading() {
    let el = $("#sv-loading");
    if (!el) {
      el = document.createElement("div");
      el.id = "sv-loading";
      el.style.cssText =
        "position:fixed;inset:0;z-index:9998;display:none;background:rgba(0,0,0,.38);align-items:center;justify-content:center;";
      el.innerHTML = `
        <div style="background:#0d1930;color:#fff;padding:14px 18px;border-radius:12px;border:1px solid rgba(255,255,255,.14);min-width:220px;text-align:center">
          <div id="sv-loading-text" style="font-size:14px">Carregando...</div>
        </div>`;
      document.body.appendChild(el);
    }
    return el;
  }

  function setLoading(on, text = "Carregando...") {
    const el = ensureLoading();
    const txt = $("#sv-loading-text", el);
    if (txt) txt.textContent = text;
    el.style.display = on ? "flex" : "none";
  }

  async function runWithUi(fn, text) {
    try {
      setLoading(true, text || "Processando...");
      return await fn();
    } catch (e) {
      console.error(e);
      const msg = e?.message || "Erro inesperado";
      toast(msg, "error", 5000);
      alert(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  // ---------------- Layout helpers ----------------
  function ensureTopActions() {
    let bar = $("#sv-top-actions");
    if (bar) return bar;

    const host =
      document.querySelector("#workspace-anchor") ||
      document.querySelector("#workspace-section") ||
      document.querySelector("#app") ||
      document.body;

    bar = document.createElement("div");
    bar.id = "sv-top-actions";
    bar.style.cssText =
      "display:flex;gap:8px;align-items:center;justify-content:flex-end;margin:8px 0 12px 0;flex-wrap:wrap;";

    bar.innerHTML = `
      <button id="sv-btn-backup" style="${btnStyle()}">Backup</button>
      <div style="position:relative">
        <button id="sv-btn-user" style="${btnStyle()}">👤 Usuário ▾</button>
        <div id="sv-user-menu" style="display:none; position:absolute; right:0; top:38px; min-width:180px; background:#0d1930; border:1px solid rgba(255,255,255,.12); border-radius:10px; z-index:50; box-shadow:0 8px 20px rgba(0,0,0,.35)">
          <button data-user-action="trocar" style="width:100%;text-align:left;padding:10px 12px;background:transparent;color:#fff;border:none;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer">Trocar usuário</button>
          <button data-user-action="sair" style="width:100%;text-align:left;padding:10px 12px;background:transparent;color:#fff;border:none;cursor:pointer">Sair</button>
        </div>
      </div>
    `;

    host.prepend(bar);

    $("#sv-btn-user", bar)?.addEventListener("click", () => {
      const m = $("#sv-user-menu", bar);
      if (!m) return;
      m.style.display = m.style.display === "none" ? "block" : "none";
    });

    document.addEventListener("click", (e) => {
      const menu = $("#sv-user-menu", bar);
      const btn = $("#sv-btn-user", bar);
      if (!menu || !btn) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      menu.style.display = "none";
    });

    $$("#sv-user-menu [data-user-action]", bar).forEach((b) => {
      b.addEventListener("click", () => {
        const action = b.getAttribute("data-user-action");
        $("#sv-user-menu", bar).style.display = "none";

        if (action === "sair") {
          if (!confirm("Deseja sair?")) return;
          DB.clearSession();
          toast("Sessão encerrada.", "success");
          location.reload();
        }

        if (action === "trocar") {
          if (!confirm("Trocar usuário? A sessão atual será encerrada.")) return;
          DB.clearSession();
          toast("Faça login com outro usuário.", "info");
          location.reload();
        }
      });
    });

    $("#sv-btn-backup", bar)?.addEventListener("click", async () => {
      await runWithUi(async () => {
        const result = await DB.backup();
        const filename = `supervenda-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        downloadJson(filename, result.data);
        toast("Backup gerado com sucesso.", "success");
      }, "Gerando backup...");
    });

    return bar;
  }

  function updateUserButtonLabel() {
    const u = DB.getUser();
    const btn = $("#sv-btn-user");
    if (!btn) return;
    btn.textContent = `👤 ${u?.name || u?.email || "Usuário"} ▾`;
  }

  function ensureScreenRoot() {
    let root = $("#sv-screen-root");
    if (root) return root;

    const host =
      document.querySelector("#workspace-anchor") ||
      document.querySelector("#workspace-section") ||
      document.querySelector("#app") ||
      document.body;

    root = document.createElement("div");
    root.id = "sv-screen-root";
    host.appendChild(root);
    return root;
  }

  function syncLoginWorkspace() {
    const hasToken = !!DB.getToken();
    const login = $("#login-section");
    const work = $("#workspace-section");
    if (!login || !work) return;
    if (hasToken) {
      login.classList.add("hidden");
      work.classList.remove("hidden");
    } else {
      login.classList.remove("hidden");
      work.classList.add("hidden");
    }
  }

  // ---------------- Data ----------------
  async function loadResource(resource) {
    const items = await DB.list(resource);
    state.cache[resource] = safeArray(items);
    return state.cache[resource];
  }

  async function preloadAll() {
    const resources = ["clientes", "mercadorias", "pedidos", "rotas", "despesas", "lembretes"];
    for (const r of resources) {
      try {
        await loadResource(r);
      } catch (e) {
        console.warn("Falha ao carregar", r, e);
      }
    }
  }

  // ---------------- Schemas CRUD ----------------
  const SCHEMAS = {
    clientes: {
      title: "Clientes",
      fields: [
        { key: "nome", label: "Nome", type: "text", required: true },
        { key: "telefone", label: "Telefone", type: "text" },
        { key: "cidade", label: "Cidade", type: "text" },
        { key: "endereco", label: "Endereço", type: "text" },
        { key: "obs", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "nome", "telefone", "cidade"],
    },
    mercadorias: {
      title: "Mercadorias",
      fields: [
        { key: "marca", label: "Marca", type: "text" },
        { key: "nome", label: "Produto", type: "text", required: true },
        { key: "codigo", label: "Código / SKU", type: "text" },
        { key: "categoria", label: "Categoria", type: "text" },
        { key: "valor_compra", label: "Valor compra", type: "number" },
        { key: "valor_venda", label: "Valor venda", type: "number" },
        { key: "estoque", label: "Estoque", type: "number" },
        { key: "agregados", label: "Agregados/Kits", type: "text" },
        { key: "descricao", label: "Descrição", type: "textarea" },
      ],
      columns: ["id", "marca", "produto", "valorVenda", "estoqueAtual"],
      normalizeOut(item) {
        return {
          ...item,
          nome: item.nome ?? item.produto ?? "",
          codigo: item.codigo ?? item.sku ?? "",
          valor_compra: item.valor_compra ?? item.valorCompra ?? 0,
          valor_venda: item.valor_venda ?? item.valorVenda ?? 0,
          estoque: item.estoque ?? item.estoqueAtual ?? 0,
        };
      },
    },
    pedidos: {
      title: "Pedidos / Vendas",
      fields: [
        { key: "clienteNome", label: "Cliente", type: "text", required: true },
        { key: "data", label: "Data", type: "date" },
        { key: "urgencia", label: "Urgência", type: "text" },
        { key: "formaPagamento", label: "Forma de pagamento", type: "text" },
        { key: "total", label: "Total", type: "number" },
        { key: "status", label: "Status", type: "text" },
        { key: "obs", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "clienteNome", "status", "total", "data"],
    },
    rotas: {
      title: "Rotas",
      fields: [
        { key: "data", label: "Data", type: "date" },
        { key: "obs", label: "Observação / roteiro", type: "textarea", required: true },
      ],
      columns: ["id", "data", "obs"],
    },
    despesas: {
      title: "Despesas",
      fields: [
        { key: "data", label: "Data", type: "date" },
        { key: "categoria", label: "Categoria", type: "text", required: true },
        { key: "valor", label: "Valor", type: "number", required: true },
        { key: "pagamento", label: "Pagamento", type: "text" },
        { key: "obs", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "categoria", "valor", "pagamento", "data"],
    },
    lembretes: {
      title: "Lembretes",
      fields: [
        { key: "tipo", label: "Tipo", type: "text" },
        { key: "titulo", label: "Título", type: "text", required: true },
        { key: "data", label: "Data", type: "date" },
        { key: "texto", label: "Mensagem", type: "textarea" },
        { key: "status", label: "Status", type: "text" },
      ],
      columns: ["id", "tipo", "titulo", "status", "data"],
    },
  };

  // ---------------- Routes ----------------
  const ROUTES = [
    { id: "dashboard", label: "Dashboard" },
    { id: "clientes", label: "Clientes", resource: "clientes" },
    { id: "mercadorias", label: "Mercadorias", resource: "mercadorias" },
    { id: "pedidos", label: "Pedidos / Vendas", resource: "pedidos" },
    { id: "rotas", label: "Rotas", resource: "rotas" },
    { id: "despesas", label: "Despesas", resource: "despesas" },
    { id: "lembretes", label: "Lembretes", resource: "lembretes" },
    { id: "usuarios", label: "Usuários" },
    { id: "anotacoes", label: "Anotações" },
  ];

  function getRouteObj(id) {
    return ROUTES.find((r) => r.id === id) || ROUTES[0];
  }

  // ---------------- Render base ----------------
  function renderDashboard(root) {
    const user = DB.getUser();
    root.innerHTML = `
      <div style="${cardStyle()}">
        <h3 style="margin:0 0 8px 0;color:#fff">Dashboard</h3>
        <div style="color:#b7c7e7">Bem-vindo, <b>${escapeHtml(user?.name || user?.email || "Usuário")}</b></div>
      </div>
      <div style="${cardStyle()}">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
          ${stat("Clientes", state.cache.clientes.length)}
          ${stat("Mercadorias", state.cache.mercadorias.length)}
          ${stat("Pedidos", state.cache.pedidos.length)}
          ${stat("Despesas", state.cache.despesas.length)}
        </div>
      </div>
    `;
  }

  function stat(label, value) {
    return `
      <div style="border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;background:#091329">
        <div style="font-size:12px;color:#b7c7e7">${escapeHtml(label)}</div>
        <div style="font-size:24px;color:#fff;font-weight:700">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function renderCurrent() {
    ensureTopActions();
    updateUserButtonLabel();
    syncLoginWorkspace();

    const root = ensureScreenRoot();
    const route = getRouteObj(state.route);

    if (!DB.getToken()) {
      root.innerHTML = "";
      return;
    }

    if (route.id === "dashboard") {
      renderDashboard(root);
      return;
    }

    if (route.id === "usuarios") {
      renderUsersScreen(root);
      return;
    }

    if (route.id === "anotacoes") {
      root.innerHTML = `
        <div style="${cardStyle()}">
          <h3 style="margin:0 0 8px 0;color:#fff">Anotações</h3>
          <div style="color:#b7c7e7">Use a API /api/notas se quiser ativar essa tela depois.</div>
        </div>
      `;
      return;
    }

    if (route.resource && SCHEMAS[route.resource]) {
      renderCrudScreen(root, route.resource);
      return;
    }

    root.innerHTML = `<div style="${cardStyle()}"><div style="color:#b7c7e7">Tela em preparação.</div></div>`;
  }

  // ---------------- CRUD genérico ----------------
  function normalizeItemForScreen(resource, item) {
    if (!item) return item;
    const schema = SCHEMAS[resource];
    if (schema && typeof schema.normalizeOut === "function") return schema.normalizeOut(item);
    return item;
  }

  function renderCrudScreen(root, resource) {
    const schema = SCHEMAS[resource];
    const rawItems = safeArray(state.cache[resource]);
    const items = rawItems.map((it) => normalizeItemForScreen(resource, it));
    const q = String(state.ui.search || "").trim().toLowerCase();

    const filtered = !q
      ? items
      : items.filter((it) =>
          Object.values(it || {}).some((v) =>
            String(v ?? "").toLowerCase().includes(q)
          )
        );

    root.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
          <h3 style="margin:0;color:#fff">${escapeHtml(schema.title)}</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <input id="sv-search-input" placeholder="Buscar..." value="${escapeHtml(state.ui.search)}" style="${inputStyle()};width:220px" />
            <button id="sv-new-btn" style="${btnStyle("primary")}">+ Novo</button>
            <button id="sv-refresh-btn" style="${btnStyle()}">Atualizar</button>
          </div>
        </div>
        <div style="margin-top:8px;color:#b7c7e7;font-size:12px;">Total: ${filtered.length}</div>
      </div>

      <div id="sv-form-wrap"></div>
      <div id="sv-list-wrap"></div>
    `;

    $("#sv-search-input")?.addEventListener("input", (e) => {
      state.ui.search = e.target.value || "";
      renderCrudScreen(root, resource);
    });

    $("#sv-new-btn")?.addEventListener("click", () => renderForm(resource, null));

    $("#sv-refresh-btn")?.addEventListener("click", async () => {
      await runWithUi(async () => {
        await loadResource(resource);
        renderCrudScreen(root, resource);
        toast("Atualizado.", "success");
      }, "Atualizando...");
    });

    renderList(resource, filtered, rawItems);
  }

  function renderList(resource, items, rawItems) {
    const wrap = $("#sv-list-wrap");
    const schema = SCHEMAS[resource];
    if (!wrap) return;

    if (!items.length) {
      wrap.innerHTML = `<div style="${cardStyle()}"><div style="color:#b7c7e7">Nenhum registro encontrado.</div></div>`;
      return;
    }

    wrap.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:grid;gap:10px;">
          ${items.map((item) => {
            const id = getId(item);
            const cols = schema.columns || [];
            const cells = cols.map((k) => {
              let v = item[k];
              if (k === "id" && !v) v = id;
              if (String(k).toLowerCase().includes("valor") || k === "total") v = moneyBR(v);
              return `
                <div>
                  <div style="font-size:11px;color:#9cb2d8">${escapeHtml(String(k))}</div>
                  <div style="color:#fff;font-weight:600;word-break:break-word">${escapeHtml(v ?? "")}</div>
                </div>
              `;
            }).join("");

            return `
              <div style="border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;background:#091329">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
                  ${cells}
                  <div>
                    <div style="font-size:11px;color:#9cb2d8">Ações</div>
                    <div style="display:flex;gap:8px;margin-top:4px;">
                      <button data-action="edit" data-id="${escapeHtml(id)}" style="${btnStyle()}">Editar</button>
                      <button data-action="delete" data-id="${escapeHtml(id)}" style="${btnStyle("danger")}">Excluir</button>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;

    $$("[data-action='edit']", wrap).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const item = rawItems.find((x) => String(getId(x)) === String(id));
        renderForm(resource, item || null);
      });
    });

    $$("[data-action='delete']", wrap).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        if (!confirm("Deseja excluir este registro?")) return;

        await runWithUi(async () => {
          await DB.remove(resource, id);
          await loadResource(resource);
          renderCurrent();
          toast("Registro excluído.", "success");
        }, "Excluindo...");
      });
    });
  }

  function normalizeForSubmit(resource, payload) {
    if (resource !== "mercadorias") return payload;

    return {
      marca: payload.marca || "",
      nome: payload.nome || "",
      codigo: payload.codigo || "",
      categoria: payload.categoria || "",
      valor_compra: payload.valor_compra ?? 0,
      valor_venda: payload.valor_venda ?? 0,
      estoque: payload.estoque ?? 0,
      agregados: payload.agregados || "",
      descricao: payload.descricao || "",
    };
  }

  function renderField(f, value) {
    const v = value ?? "";
    if (f.type === "textarea") {
      return labelWrap(
        f.label,
        `<textarea name="${escapeHtml(f.key)}" rows="3" style="${inputStyle()}">${escapeHtml(v)}</textarea>`
      );
    }
    const type = f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
    let out = v;
    if (type === "date" && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) out = d.toISOString().slice(0, 10);
    }
    return labelWrap(
      f.label,
      `<input type="${type}" name="${escapeHtml(f.key)}" value="${escapeHtml(out)}" style="${inputStyle()}" />`
    );
  }

  function formToPayload(form, fields) {
    const fd = new FormData(form);
    const payload = {};

    fields.forEach((f) => {
      let v = fd.get(f.key);
      if (typeof v === "string") v = v.trim();
      if (f.type === "number") {
        if (v === "" || v == null) payload[f.key] = 0;
        else {
          const n = Number(String(v).replace(",", "."));
          payload[f.key] = Number.isNaN(n) ? 0 : n;
        }
      } else {
        payload[f.key] = v ?? "";
      }
    });

    return payload;
  }

  function renderForm(resource, item) {
    const wrap = $("#sv-form-wrap");
    if (!wrap) return;

    const schema = SCHEMAS[resource];
    const isEdit = !!item;
    const itemView = normalizeItemForScreen(resource, item || {});
    const itemId = isEdit ? getId(item) : "";

    wrap.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <h4 style="margin:0;color:#fff">${isEdit ? "Editar" : "Novo"} ${escapeHtml(schema.title)}</h4>
          <button id="sv-close-form" style="${btnStyle("soft")}">Fechar</button>
        </div>

        <form id="sv-crud-form" style="margin-top:10px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
            ${schema.fields.map((f) => renderField(f, itemView?.[f.key])).join("")}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button type="submit" style="${btnStyle("primary")}">${isEdit ? "Salvar alterações" : "Salvar"}</button>
            ${isEdit ? `<button type="button" id="sv-delete-current" style="${btnStyle("danger")}">Excluir</button>` : ""}
          </div>
        </form>
      </div>
    `;

    $("#sv-close-form")?.addEventListener("click", () => {
      wrap.innerHTML = "";
    });

    $("#sv-crud-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      let payload = formToPayload(e.currentTarget, schema.fields);
      payload = normalizeForSubmit(resource, payload);

      const missing = schema.fields.find((f) => f.required && !String(payload[f.key] ?? "").trim());
      if (missing) {
        toast(`Preencha: ${missing.label}`, "warning");
        return;
      }

      await runWithUi(async () => {
        if (isEdit) await DB.update(resource, itemId, payload);
        else await DB.create(resource, payload);

        await loadResource(resource);
        renderCurrent();
        toast(isEdit ? "Registro atualizado." : "Registro salvo.", "success");
      }, "Salvando...");
    });

    if (isEdit) {
      $("#sv-delete-current")?.addEventListener("click", async () => {
        if (!confirm("Deseja excluir este registro?")) return;
        await runWithUi(async () => {
          await DB.remove(resource, itemId);
          await loadResource(resource);
          renderCurrent();
          toast("Registro excluído.", "success");
        }, "Excluindo...");
      });
    }
  }

  // ---------------- Users screen (admin) ----------------
  async function renderUsersScreen(root) {
    const user = DB.getUser();
    if (!user || user.role !== "admin") {
      root.innerHTML = `
        <div style="${cardStyle()}">
          <h3 style="margin:0 0 8px 0;color:#fff">Usuários</h3>
          <div style="color:#ffb3b3">Acesso restrito ao administrador.</div>
        </div>
      `;
      return;
    }

    let users = [];
    try {
      users = safeArray(await DB.listUsers());
    } catch (e) {
      root.innerHTML = `
        <div style="${cardStyle()}">
          <h3 style="margin:0 0 8px 0;color:#fff">Usuários</h3>
          <div style="color:#ffb3b3">Erro ao carregar usuários: ${escapeHtml(e?.message || "Falha")}</div>
        </div>
      `;
      return;
    }

    root.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <h3 style="margin:0;color:#fff">Usuários</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="sv-user-new" style="${btnStyle("primary")}">+ Novo usuário</button>
            <button id="sv-user-refresh" style="${btnStyle()}">Atualizar</button>
          </div>
        </div>
        <div style="margin-top:8px;color:#b7c7e7;font-size:12px;">Total: ${users.length}</div>
      </div>

      <div id="sv-users-form-wrap"></div>

      <div style="${cardStyle()}">
        <div style="display:grid;gap:10px;">
          ${
            users.length
              ? users.map((u) => `
                <div style="border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;background:#091329">
                  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;">
                    <div><div style="font-size:11px;color:#9cb2d8">ID</div><div style="color:#fff;font-weight:600">${escapeHtml(u.id || "")}</div></div>
                    <div><div style="font-size:11px;color:#9cb2d8">Nome</div><div style="color:#fff;font-weight:600">${escapeHtml(u.name || "")}</div></div>
                    <div><div style="font-size:11px;color:#9cb2d8">Email</div><div style="color:#fff;font-weight:600">${escapeHtml(u.email || "")}</div></div>
                    <div><div style="font-size:11px;color:#9cb2d8">Perfil</div><div style="color:#fff;font-weight:600">${escapeHtml(u.role || "seller")}</div></div>
                    <div><div style="font-size:11px;color:#9cb2d8">Ativo</div><div style="color:#fff;font-weight:600">${Number(u.active) ? "Sim" : "Não"}</div></div>
                    <div>
                      <div style="font-size:11px;color:#9cb2d8">Ações</div>
                      <div style="display:flex;gap:8px;margin-top:4px;">
                        <button data-user-edit="${escapeHtml(u.id || "")}" style="${btnStyle()}">Editar</button>
                      </div>
                    </div>
                  </div>
                </div>
              `).join("")
              : `<div style="color:#b7c7e7">Nenhum usuário cadastrado.</div>`
          }
        </div>
      </div>
    `;

    const formWrap = $("#sv-users-form-wrap");

    function renderUserForm(item) {
      const isEdit = !!item;
      formWrap.innerHTML = `
        <div style="${cardStyle()}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <h4 style="margin:0;color:#fff">${isEdit ? "Editar usuário" : "Novo usuário"}</h4>
            <button id="sv-user-close-form" style="${btnStyle("soft")}">Fechar</button>
          </div>

          <form id="sv-user-form" style="margin-top:10px;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
              ${labelWrap("Nome", `<input name="name" value="${escapeHtml(item?.name || "")}" style="${inputStyle()}" />`)}
              ${labelWrap("E-mail", `<input name="email" type="email" value="${escapeHtml(item?.email || "")}" style="${inputStyle()}" />`)}
              ${labelWrap("Perfil", `
                <select name="role" style="${inputStyle()}">
                  <option value="seller" ${(item?.role || "seller") === "seller" ? "selected" : ""}>seller</option>
                  <option value="admin" ${(item?.role || "seller") === "admin" ? "selected" : ""}>admin</option>
                </select>
              `)}
              ${labelWrap("Ativo", `
                <select name="active" style="${inputStyle()}">
                  <option value="1" ${Number(item?.active ?? 1) ? "selected" : ""}>Sim</option>
                  <option value="0" ${!Number(item?.active ?? 1) ? "selected" : ""}>Não</option>
                </select>
              `)}
              ${labelWrap(isEdit ? "Nova senha (opcional)" : "Senha", `<input name="password" type="password" placeholder="${isEdit ? "Deixe em branco para manter" : "Digite a senha"}" style="${inputStyle()}" />`)}
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button type="submit" style="${btnStyle("primary")}">${isEdit ? "Salvar alterações" : "Criar usuário"}</button>
            </div>
          </form>
        </div>
      `;

      $("#sv-user-close-form")?.addEventListener("click", () => {
        formWrap.innerHTML = "";
      });

      $("#sv-user-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);

        const payload = {
          name: String(fd.get("name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          role: String(fd.get("role") || "seller").trim(),
          active: Number(fd.get("active") || 1) ? 1 : 0,
          password: String(fd.get("password") || ""),
        };

        if (!payload.name) return toast("Nome é obrigatório.", "warning");
        if (!payload.email) return toast("E-mail é obrigatório.", "warning");
        if (!isEdit && !payload.password) return toast("Senha é obrigatória.", "warning");

        await runWithUi(async () => {
          if (isEdit) {
            if (!payload.password) delete payload.password;
            await DB.updateUser(item.id, payload);
            toast("Usuário atualizado.", "success");
          } else {
            await DB.createUser(payload);
            toast("Usuário criado.", "success");
          }
          await renderUsersScreen(root);
        }, isEdit ? "Salvando usuário..." : "Criando usuário...");
      });
    }

    $("#sv-user-new")?.addEventListener("click", () => renderUserForm(null));
    $("#sv-user-refresh")?.addEventListener("click", async () => {
      await runWithUi(async () => {
        await renderUsersScreen(root);
      }, "Atualizando usuários...");
    });

    $$("[data-user-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-user-edit");
        const item = users.find((u) => String(u.id) === String(id));
        if (item) renderUserForm(item);
      });
    });
  }

  // ---------------- Login binding ----------------
  function bindLoginForm() {
    const form = $("#login-form");
    if (!form || form.dataset.svBound === "1") return;
    form.dataset.svBound = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.querySelector("input[name='email']")?.value?.trim() || "";
      const senha = form.querySelector("input[name='senha']")?.value || "";

      if (!email || !senha) {
        toast("Informe e-mail e senha.", "warning");
        return;
      }

      await runWithUi(async () => {
        await DB.login(email, senha);
        try {
          await DB.me();
        } catch (_) {}
        syncLoginWorkspace();
        await preloadAll();
        renderCurrent();
        toast("Login realizado com sucesso.", "success");
      }, "Entrando...");
    });
  }

  // ---------------- Init ----------------
  async function init() {
    ensureTopActions();
    bindLoginForm();

    window.addEventListener("hashchange", () => {
      state.route = (location.hash || "#dashboard").replace("#", "") || "dashboard";
      renderCurrent();
    });

    // API em HTTP sob front HTTPS => alerta
    if (
      location.protocol === "https:" &&
      window.CONFIG &&
      typeof window.CONFIG.API_BASE === "string" &&
      /^http:\/\//i.test(window.CONFIG.API_BASE)
    ) {
      alert(
        "Erro de fetch (Mixed Content): seu frontend está em HTTPS e a API está em HTTP.\n" +
          "Troque a URL da API para HTTPS (workers.dev)."
      );
    }

    // sessão existente
    if (DB.getToken()) {
      try {
        await DB.me();
        syncLoginWorkspace();
        await runWithUi(async () => {
          await preloadAll();
        }, "Carregando dados...");
      } catch (e) {
        console.warn("Sessão inválida:", e);
        DB.clearSession();
      }
    }

    state.route = (location.hash || "#dashboard").replace("#", "") || "dashboard";
    renderCurrent();
  }

  // Expor helpers
  window.SuperVendaApp = {
    state,
    reload: () => location.reload(),
  };

  init();
})();