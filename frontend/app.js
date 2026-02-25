// app.js
(function () {
  const DB = window.DB;
  const CONFIG = window.CONFIG;

  // =========================
  // Estado
  // =========================
  const state = {
    route: (location.hash || "#dashboard").replace("#", "") || "dashboard",
    loading: false,
    currentUser: DB.getUser(),
    cache: {
      clientes: [],
      mercadorias: [],
      rotas: [],
      despesas: [],
      lembretes: [],
      pedidos: [],
    },
    ui: {
      search: "",
    },
  };

  // =========================
  // Util
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function moneyBR(value) {
    if (value == null || value === "") return "";
    const n = Number(String(value).replace(",", "."));
    if (Number.isNaN(n)) return String(value);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDateTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("pt-BR");
  }

  function getId(item) {
    return (
      item?.id ??
      item?._id ??
      item?.codigo ??
      item?.uuid ??
      item?.numero ??
      ""
    );
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

  // =========================
  // Toast / Loading / Erros
  // =========================
  function ensureToastContainer() {
    let el = $("#sv-toast-wrap");
    if (!el) {
      el = document.createElement("div");
      el.id = "sv-toast-wrap";
      el.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 9999;
        display: flex; flex-direction: column; gap: 8px; max-width: 360px;
      `;
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(msg, type = "info", timeout = 3500) {
    const wrap = ensureToastContainer();
    const item = document.createElement("div");
    const bg =
      type === "error" ? "#4a1515" :
      type === "success" ? "#12351f" :
      type === "warning" ? "#4a3c14" : "#13233c";

    item.style.cssText = `
      background:${bg}; color:#fff; border:1px solid rgba(255,255,255,.18);
      padding:10px 12px; border-radius:10px; font-size:13px;
      box-shadow:0 6px 18px rgba(0,0,0,.25);
    `;
    item.textContent = msg;
    wrap.appendChild(item);

    setTimeout(() => {
      item.style.opacity = "0";
      item.style.transition = "opacity .2s";
      setTimeout(() => item.remove(), 220);
    }, timeout);
  }

  function setLoading(on, text = "Carregando...") {
    state.loading = !!on;
    let el = $("#sv-loading");
    if (!el) {
      el = document.createElement("div");
      el.id = "sv-loading";
      el.style.cssText = `
        position: fixed; inset: 0; z-index: 9998; display:none;
        background: rgba(0,0,0,.38); align-items:center; justify-content:center;
      `;
      el.innerHTML = `
        <div style="background:#0d1930;color:#fff;padding:14px 18px;border-radius:12px;
        border:1px solid rgba(255,255,255,.14);min-width:220px;text-align:center">
          <div id="sv-loading-text" style="font-size:14px">${escapeHtml(text)}</div>
        </div>
      `;
      document.body.appendChild(el);
    }
    const txt = $("#sv-loading-text", el);
    if (txt) txt.textContent = text;
    el.style.display = on ? "flex" : "none";
  }

  async function runWithUi(fn, loadingText = "Processando...") {
    try {
      setLoading(true, loadingText);
      return await fn();
    } catch (err) {
      console.error(err);
      const msg = err?.message || "Erro interno";
      toast(msg, "error", 5000);
      alert(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // Layout hooks
  // =========================
  function findMainContainer() {
    // tenta áreas já existentes do seu HTML
    return (
      document.querySelector("main") ||
      document.querySelector(".main") ||
      document.querySelector(".content") ||
      document.querySelector("#app") ||
      document.body
    );
  }

  function ensureTopActions() {
    // tenta encontrar a linha do topo com busca/imprimir já existente
    let bar = $("#sv-top-actions");
    if (bar) return bar;

    const host = findMainContainer();

    bar = document.createElement("div");
    bar.id = "sv-top-actions";
    bar.style.cssText = `
      display:flex; gap:8px; align-items:center; justify-content:flex-end;
      margin: 8px 0 12px 0; flex-wrap: wrap;
    `;

    bar.innerHTML = `
      <button id="sv-btn-backup" style="${btnStyle()}">Backup</button>
      <div style="position:relative">
        <button id="sv-btn-user" style="${btnStyle()}">👤 Usuário ▾</button>
        <div id="sv-user-menu" style="display:none; position:absolute; right:0; top:38px; min-width:180px;
            background:#0d1930; border:1px solid rgba(255,255,255,.12); border-radius:10px; z-index:50;
            box-shadow:0 8px 20px rgba(0,0,0,.35)">
          <button data-user-action="trocar" style="${menuItemStyle()}">Trocar usuário</button>
          <button data-user-action="sair" style="${menuItemStyle()}">Sair</button>
        </div>
      </div>
    `;

    // injeta no topo do conteúdo
    host.prepend(bar);

    $("#sv-btn-user").addEventListener("click", () => {
      const m = $("#sv-user-menu");
      m.style.display = m.style.display === "none" ? "block" : "none";
    });

    document.addEventListener("click", (e) => {
      const menu = $("#sv-user-menu");
      const btn = $("#sv-btn-user");
      if (!menu || !btn) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      menu.style.display = "none";
    });

    $$("#sv-user-menu [data-user-action]").forEach((b) => {
      b.addEventListener("click", async () => {
        const action = b.getAttribute("data-user-action");
        $("#sv-user-menu").style.display = "none";

        if (action === "sair") {
          if (!confirm("Deseja sair?")) return;
          DB.clearSession();
          toast("Sessão encerrada.", "success");
          location.reload();
          return;
        }

        if (action === "trocar") {
          if (!confirm("Trocar usuário? A sessão atual será encerrada.")) return;
          DB.clearSession();
          toast("Faça login com outro usuário.", "info");
          location.reload();
        }
      });
    });

    $("#sv-btn-backup").addEventListener("click", async () => {
      await runWithUi(async () => {
        const result = await DB.backup();
        const filename = `supervenda-backup-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.json`;

        downloadJson(filename, result.data);
        toast(
          result.mode === "remote"
            ? "Backup remoto baixado com sucesso."
            : "Backup local gerado com sucesso.",
          "success"
        );
      }, "Gerando backup...");
    });

    return bar;
  }

  function ensureContentMount() {
    let root = $("#sv-screen-root");
    if (root) return root;

    const host = findMainContainer();
    root = document.createElement("div");
    root.id = "sv-screen-root";
    root.style.cssText = `margin-top:8px;`;
    host.appendChild(root);

    return root;
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

  function menuItemStyle() {
    return `
      width:100%; text-align:left; padding:10px 12px; background:transparent;
      color:#fff; border:none; border-bottom:1px solid rgba(255,255,255,.06); cursor:pointer;
    `;
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
      background:#091329; color:#fff;
      box-sizing:border-box;
    `;
  }

  function labelWrap(title, inner) {
    return `
      <label style="display:block; font-size:12px; color:#b7c7e7; margin-bottom:8px">
        <div style="margin-bottom:5px">${escapeHtml(title)}</div>
        ${inner}
      </label>
    `;
  }

  function updateTopUserLabel() {
    const btn = $("#sv-btn-user");
    if (!btn) return;
    const u = DB.getUser();
    const name = u?.name || u?.nome || u?.email || "Usuário";
    btn.textContent = `👤 ${name} ▾`;
  }

  // =========================
  // Rotas / Navegação
  // =========================
  const ROUTES = [
    { id: "dashboard", label: "Dashboard" },
    { id: "clientes", label: "Clientes", resource: "clientes" },
    { id: "mercadorias", label: "Mercadorias", resource: "mercadorias" },
    { id: "pedidos", label: "Pedidos/Vendas", resource: "pedidos" },
    { id: "rotas", label: "Rotas", resource: "rotas" },
    { id: "despesas", label: "Despesas", resource: "despesas" },
    { id: "lembretes", label: "Lembretes/Campanhas", resource: "lembretes" },
    { id: "anotacoes", label: "Anotações" }, // opcional
  ];

  function routeById(id) {
    return ROUTES.find((r) => r.id === id) || ROUTES[0];
  }

  function go(routeId) {
    location.hash = `#${routeId}`;
  }

  window.addEventListener("hashchange", () => {
    state.route = (location.hash || "#dashboard").replace("#", "");
    renderCurrent();
  });

  // =========================
  // Schemas (forms)
  // =========================
  const SCHEMAS = {
    clientes: {
      title: "Clientes",
      fields: [
        { key: "nome", label: "Nome", type: "text", required: true },
        { key: "telefone", label: "Telefone", type: "text" },
        { key: "cidade", label: "Cidade", type: "text" },
        { key: "endereco", label: "Endereço", type: "text" },
        { key: "observacao", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "nome", "telefone", "cidade"],
    },

    mercadorias: {
      title: "Mercadorias",
      fields: [
        { key: "nome", label: "Nome da mercadoria", type: "text", required: true },
        { key: "codigo", label: "Código", type: "text" },
        { key: "categoria", label: "Categoria", type: "text" },
        { key: "valor_compra", label: "Valor compra", type: "number" },
        { key: "valor_venda", label: "Valor venda", type: "number" },
        { key: "estoque", label: "Estoque", type: "number" },
        { key: "observacao", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "nome", "codigo", "valor_venda", "estoque"],
    },

    rotas: {
      title: "Rotas",
      fields: [
        { key: "nome", label: "Nome da rota", type: "text", required: true },
        { key: "cidade", label: "Cidade/Região", type: "text" },
        { key: "dia_semana", label: "Dia da semana", type: "text" },
        { key: "sequencia", label: "Sequência", type: "number" },
        { key: "observacao", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "nome", "cidade", "dia_semana", "sequencia"],
    },

    despesas: {
      title: "Despesas",
      fields: [
        { key: "descricao", label: "Descrição", type: "text", required: true },
        { key: "categoria", label: "Categoria", type: "text" },
        { key: "valor", label: "Valor", type: "number", required: true },
        { key: "data", label: "Data", type: "date" },
        { key: "observacao", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "descricao", "categoria", "valor", "data"],
    },

    lembretes: {
      title: "Lembretes/Campanhas",
      fields: [
        { key: "titulo", label: "Título", type: "text", required: true },
        { key: "mensagem", label: "Mensagem", type: "textarea" },
        { key: "data", label: "Data", type: "date" },
        { key: "status", label: "Status", type: "text" },
      ],
      columns: ["id", "titulo", "status", "data"],
    },

    pedidos: {
      title: "Pedidos/Vendas",
      fields: [
        { key: "cliente_id", label: "ID do Cliente", type: "text" },
        { key: "cliente_nome", label: "Cliente", type: "text" },
        { key: "data", label: "Data", type: "date" },
        { key: "status", label: "Status", type: "text" },
        { key: "valor_total", label: "Valor total", type: "number" },
        { key: "forma_pagamento", label: "Forma de pagamento", type: "text" },
        { key: "observacao", label: "Observação", type: "textarea" },
      ],
      columns: ["id", "cliente_nome", "status", "valor_total", "data"],
    },
  };

  // =========================
  // Data
  // =========================
  async function loadResource(resource) {
    const items = await DB.list(resource);
    state.cache[resource] = safeArray(items);
    return state.cache[resource];
  }

  // =========================
  // Render helpers
  // =========================
  function renderCurrent() {
    ensureTopActions();
    updateTopUserLabel();

    const route = routeById(state.route);
    const root = ensureContentMount();

    if (route.id === "dashboard") {
      renderDashboard(root);
      return;
    }

    if (SCHEMAS[route.resource]) {
      renderCrudScreen(root, route.resource);
      return;
    }

    // fallback para telas sem implementação específica
    root.innerHTML = `
      <div style="${cardStyle()}">
        <h3 style="margin:0 0 8px 0; color:#fff">${escapeHtml(route.label)}</h3>
        <div style="color:#b7c7e7">Tela em preparação.</div>
      </div>
    `;
  }

  function renderDashboard(root) {
    const user = DB.getUser();
    root.innerHTML = `
      <div style="${cardStyle()}">
        <h3 style="margin:0 0 8px 0; color:#fff">Dashboard</h3>
        <div style="color:#b7c7e7; margin-bottom:8px">
          Bem-vindo, <b>${escapeHtml(user?.name || user?.email || "Usuário")}</b>
        </div>
        <div style="color:#b7c7e7">Use o menu lateral para acessar cadastros e pedidos.</div>
      </div>

      <div style="${cardStyle()}">
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
          ${statCard("Clientes", state.cache.clientes?.length || 0)}
          ${statCard("Mercadorias", state.cache.mercadorias?.length || 0)}
          ${statCard("Pedidos", state.cache.pedidos?.length || 0)}
          ${statCard("Despesas", state.cache.despesas?.length || 0)}
        </div>
      </div>
    `;
  }

  function statCard(label, value) {
    return `
      <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:10px; background:#091329">
        <div style="font-size:12px;color:#b7c7e7">${escapeHtml(label)}</div>
        <div style="font-size:24px;color:#fff;font-weight:700">${escapeHtml(value)}</div>
      </div>
    `;
  }

  function renderCrudScreen(root, resource) {
    const schema = SCHEMAS[resource];
    const items = safeArray(state.cache[resource] || []);
    const q = (state.ui.search || "").trim().toLowerCase();

    const filtered = !q
      ? items
      : items.filter((it) =>
          Object.values(it || {}).some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(q)
          )
        );

    root.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:flex; gap:8px; justify-content:space-between; align-items:center; flex-wrap:wrap;">
          <h3 style="margin:0; color:#fff">${escapeHtml(schema.title)}</h3>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <input id="sv-search-input" placeholder="Buscar..." value="${escapeHtml(
              state.ui.search || ""
            )}" style="${inputStyle()}; width:220px;" />
            <button id="sv-new-btn" style="${btnStyle("primary")}">+ Novo</button>
            <button id="sv-refresh-btn" style="${btnStyle()}">Atualizar</button>
          </div>
        </div>
        <div style="margin-top:8px; color:#b7c7e7; font-size:12px;">Total: ${filtered.length}</div>
      </div>

      <div id="sv-form-wrap"></div>
      <div id="sv-list-wrap"></div>
    `;

    $("#sv-search-input").addEventListener("input", (e) => {
      state.ui.search = e.target.value || "";
      renderCrudScreen(root, resource);
    });

    $("#sv-new-btn").addEventListener("click", () => {
      renderForm(resource, null);
    });

    $("#sv-refresh-btn").addEventListener("click", async () => {
      await runWithUi(async () => {
        await loadResource(resource);
        renderCrudScreen(root, resource);
        toast(`${schema.title} atualizados.`, "success");
      }, "Atualizando...");
    });

    renderList(resource, filtered);
  }

  function renderList(resource, items) {
    const wrap = $("#sv-list-wrap");
    if (!wrap) return;

    const schema = SCHEMAS[resource];

    if (!items.length) {
      wrap.innerHTML = `
        <div style="${cardStyle()}">
          <div style="color:#b7c7e7">Nenhum registro encontrado.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:grid; gap:10px;">
          ${items.map((item) => renderItemCard(resource, item, schema)).join("")}
        </div>
      </div>
    `;

    $$("[data-action='edit']", wrap).forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-id");
        const item = state.cache[resource].find((x) => String(getId(x)) === String(id));
        renderForm(resource, item || null);
      });
    });

    $$("[data-action='delete']", wrap).forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-id");
        if (!id) return;

        if (!confirm("Deseja excluir este registro?")) return;

        await runWithUi(async () => {
          await DB.remove(resource, id);
          await loadResource(resource);
          renderCurrent();
          toast("Registro excluído com sucesso.", "success");
        }, "Excluindo...");
      });
    });
  }

  function renderItemCard(resource, item, schema) {
    const id = getId(item);
    const cols = schema.columns || [];
    const lines = cols
      .map((k) => {
        const label = k.replace(/_/g, " ");
        let v = item?.[k];
        if (v == null && k === "id") v = id;

        if (k.includes("valor")) v = moneyBR(v);
        if (k === "data" || k.endsWith("_at")) v = formatDateTime(v);

        return `
          <div>
            <div style="font-size:11px;color:#9cb2d8">${escapeHtml(label)}</div>
            <div style="color:#fff; font-weight:600; word-break:break-word">${escapeHtml(v ?? "")}</div>
          </div>
        `;
      })
      .join("");

    return `
      <div style="border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:10px; background:#091329">
        <div style="display:grid; grid-template-columns: repeat(auto-fit,minmax(130px,1fr)); gap:10px;">
          ${lines}
          <div>
            <div style="font-size:11px;color:#9cb2d8">Ações</div>
            <div style="display:flex; gap:8px; margin-top:4px;">
              <button data-action="edit" data-id="${escapeHtml(id)}" style="${btnStyle()}">Editar</button>
              <button data-action="delete" data-id="${escapeHtml(id)}" style="${btnStyle("danger")}">Excluir</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderForm(resource, item) {
    const wrap = $("#sv-form-wrap");
    if (!wrap) return;

    const schema = SCHEMAS[resource];
    const isEdit = !!item;
    const itemId = isEdit ? getId(item) : "";

    wrap.innerHTML = `
      <div style="${cardStyle()}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <h4 style="margin:0;color:#fff">${isEdit ? "Editar" : "Novo"} ${escapeHtml(schema.title.slice(0, -1) || schema.title)}</h4>
          <button id="sv-cancel-form" style="${btnStyle("soft")}">Fechar</button>
        </div>

        <form id="sv-crud-form" style="margin-top:10px;">
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
            ${schema.fields.map((f) => renderField(f, item?.[f.key])).join("")}
          </div>

          <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
            <button type="submit" style="${btnStyle("primary")}">${isEdit ? "Salvar alterações" : "Salvar"}</button>
            ${isEdit ? `<button type="button" id="sv-delete-current" style="${btnStyle("danger")}">Excluir</button>` : ""}
          </div>
        </form>
      </div>
    `;

    $("#sv-cancel-form").addEventListener("click", () => {
      wrap.innerHTML = "";
    });

    const form = $("#sv-crud-form");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const payload = formToPayload(form, schema.fields);

      // validação mínima
      const missing = schema.fields
        .filter((f) => f.required)
        .find((f) => !String(payload[f.key] ?? "").trim());

      if (missing) {
        toast(`Preencha: ${missing.label}`, "warning");
        return;
      }

      await runWithUi(async () => {
        if (isEdit) {
          await DB.update(resource, itemId, payload);
          toast("Registro atualizado com sucesso.", "success");
        } else {
          await DB.create(resource, payload);
          toast("Registro salvo com sucesso.", "success");
        }

        await loadResource(resource);
        renderCurrent();
      }, isEdit ? "Salvando alterações..." : "Salvando...");
    });

    if (isEdit) {
      $("#sv-delete-current").addEventListener("click", async () => {
        if (!confirm("Deseja excluir este registro?")) return;

        await runWithUi(async () => {
          await DB.remove(resource, itemId);
          await loadResource(resource);
          renderCurrent();
          toast("Registro excluído com sucesso.", "success");
        }, "Excluindo...");
      });
    }
  }

  function renderField(field, value) {
    const v = value ?? "";

    if (field.type === "textarea") {
      return labelWrap(
        field.label,
        `<textarea name="${escapeHtml(field.key)}" rows="3" style="${inputStyle()}">${escapeHtml(v)}</textarea>`
      );
    }

    const type =
      field.type === "number" ? "number" :
      field.type === "date" ? "date" :
      "text";

    let inputValue = v;
    if (type === "date" && v) {
      // normaliza para yyyy-mm-dd
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) inputValue = d.toISOString().slice(0, 10);
    }

    return labelWrap(
      field.label,
      `<input name="${escapeHtml(field.key)}" type="${type}" value="${escapeHtml(inputValue)}" style="${inputStyle()}" />`
    );
  }

  function formToPayload(form, fields) {
    const fd = new FormData(form);
    const payload = {};

    fields.forEach((f) => {
      let v = fd.get(f.key);

      if (typeof v === "string") v = v.trim();

      if (f.type === "number") {
        if (v === "" || v == null) {
          payload[f.key] = null;
        } else {
          const n = Number(String(v).replace(",", "."));
          payload[f.key] = Number.isNaN(n) ? v : n;
        }
        return;
      }

      payload[f.key] = v;
    });

    return payload;
  }

  // =========================
  // Login / sessão / bootstrap
  // =========================
  function tryFindLoginForm() {
    // suporte ao HTML atual que você já tem
    return (
      document.querySelector("form") ||
      document.querySelector("#login-form") ||
      null
    );
  }

  async function ensureLoggedInOrBindLogin() {
    const token = DB.getToken();
    if (token) {
      try {
        // Tenta dados do usuário
        const me = await DB.me().catch(() => null);
        if (me) DB.setUser(me.user || me);
        state.currentUser = DB.getUser();
        return true;
      } catch {
        DB.clearSession();
      }
    }

    // Se não tiver token, tenta ligar no formulário de login existente
    const form = tryFindLoginForm();

    if (!form) return false;

    // evita bind duplicado
    if (form.dataset.svBound === "1") return false;
    form.dataset.svBound = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const emailInput =
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[name="email"]') ||
        form.querySelector("input");

      const passInput =
        form.querySelector('input[type="password"]') ||
        form.querySelector('input[name="senha"]');

      const email = emailInput?.value?.trim();
      const senha = passInput?.value ?? "";

      if (!email || !senha) {
        toast("Informe e-mail e senha.", "warning");
        return;
      }

      await runWithUi(async () => {
        await DB.login(email, senha);
        state.currentUser = DB.getUser();
        toast("Login realizado com sucesso.", "success");
        location.reload();
      }, "Entrando...");
    });

    return false;
  }

  async function preloadBootstrapAndLists() {
    // bootstrap pode falhar com 401 antes de login — ignora
    try {
      await DB.bootstrap();
    } catch (e) {
      if (e?.status !== 401) console.warn("bootstrap:", e);
    }

    // carrega listas principais (se autenticado)
    const token = DB.getToken();
    if (!token) return;

    const resources = ["clientes", "mercadorias", "rotas", "despesas", "lembretes", "pedidos"];
    for (const r of resources) {
      try {
        await loadResource(r);
      } catch (e) {
        // backend ainda sem rota -> não quebra UI
        console.warn(`Falha ao carregar ${r}:`, e);
      }
    }
  }

  // =========================
  // Correção do problema de fetch (mixed content)
  // =========================
  function patchIfApiBaseHttp() {
    const apiBase = (CONFIG.API_BASE || "").trim();
    if (/^http:\/\//i.test(apiBase) && location.protocol === "https:") {
      toast("API está em HTTP. Troque para HTTPS para evitar bloqueio de Mixed Content.", "error", 7000);
      alert(
        "Erro de fetch (Mixed Content): seu front está em HTTPS e a API está em HTTP.\n\n" +
          "Use a URL da API com HTTPS em 'Trocar URL da API'.\n" +
          "Exemplo: https://supervenda.krasinskyekuroli.workers.dev"
      );
    }
  }

  // =========================
  // Init
  // =========================
  async function init() {
    try {
      patchIfApiBaseHttp();

      ensureTopActions();
      updateTopUserLabel();

      const logged = await ensureLoggedInOrBindLogin();

      // Se já está logado, pre-carrega dados e renderiza
      if (logged) {
        await runWithUi(async () => {
          await preloadBootstrapAndLists();
        }, "Carregando dados...");
      }

      renderCurrent();

      toast(`${CONFIG.APP_NAME} pronto.`, "success", 1800);
    } catch (err) {
      console.error(err);
      toast(err?.message || "Erro ao iniciar o app", "error", 6000);
    }
  }

  // expõe alguns helpers no console (debug)
  window.SuperVendaApp = {
    state,
    go,
    reload: () => location.reload(),
    setApiBase: window.setApiBase,
  };

  // inicia
  init();
})();