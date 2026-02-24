import { api, login, me, money, calcMargin, clearToken, getToken, parseMoney } from "./db.js";
import { CONFIG } from "./config.js";

let state = null;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const routes = [
  { id: "dashboard", label: "Dashboard" },
  { id: "clientes", label: "Clientes" },
  { id: "produtos", label: "Mercadorias" },
  { id: "pedidos", label: "Pedidos/Vendas" },
  { id: "rotas", label: "Rotas" },
  { id: "despesas", label: "Despesas" },
  { id: "lembretes", label: "Lembretes/Campanhas" },
  { id: "notas", label: "Anotações" },
];

const safe = (s) => (s ?? "").toString().replace(/[<>]/g, "");
const jparse = (v, fallback = []) => {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? fallback); }
  catch { return fallback; }
};

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = 1;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.opacity = 0), 2200);
}

function navTo(id) { location.hash = `#${id}`; }
function getHash() { return (location.hash || "#dashboard").slice(1); }
function setActiveNav(id) {
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.route === id));
}

async function ensureAuth() {
  if (!getToken()) { await loginModal(); return; }
  try { await me(); } catch { clearToken(); await loginModal(); }
}
async function bootstrap() { state = await api("/api/bootstrap"); }

async function refreshState() {
  state = await api("/api/bootstrap");
  render();
}

async function loginModal() {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:18px;z-index:99999";
  const box = document.createElement("div");
  box.className = "card";
  box.style.width = "min(520px,100%)";
  box.innerHTML = `
    <h3>Entrar</h3>
    <div class="small">API: <b>${safe(CONFIG.API_BASE)}</b></div>
    <div style="margin-top:10px"><label class="small">E-mail</label><input id="lg_email" placeholder="vendedor@exemplo.com"/></div>
    <div style="margin-top:10px"><label class="small">Senha</label><input id="lg_senha" type="password"/></div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="lg_ok">Entrar</button>
      <button class="btn" id="lg_api">Trocar URL da API</button>
    </div>
    <div class="small" style="margin-top:10px">O primeiro vendedor é criado via CLI (ver README do backend).</div>
  `;
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  $("#lg_api").onclick = () => {
    const u = prompt("Cole a URL do Worker (API):", CONFIG.API_BASE);
    if (u) { localStorage.setItem("API_BASE", u.trim()); location.reload(); }
  };

  $("#lg_ok").onclick = async () => {
    try {
      await login($("#lg_email").value.trim(), $("#lg_senha").value);
      wrap.remove();
      await bootstrap();
      render();
      toast("Logado");
    } catch (e) {
      alert(e.message || "Falha");
    }
  };
}

function card(html) {
  const d = document.createElement("div");
  d.className = "card";
  d.innerHTML = html;
  return d;
}

function openModal(title, innerHTML, width = "min(900px,100%)") {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px;z-index:9999";
  const box = document.createElement("div");
  box.className = "card";
  box.style.width = width;
  box.style.maxHeight = "92vh";
  box.style.overflow = "auto";
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
      <div style="font-weight:800;font-size:16px">${safe(title)}</div>
      <button class="btn" id="mx">X</button>
    </div>
    ${innerHTML}
  `;
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  box.querySelector("#mx").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  return { close, box, wrap };
}

function render() {
  const id = getHash();
  setActiveNav(id);

  const titleEl = $("#pageTitle");
  if (titleEl) titleEl.textContent = routes.find((r) => r.id === id)?.label || "App";

  const q = (($("#q") && $("#q").value) || "").trim().toLowerCase();
  const view = $("#view");
  if (!view) return;
  view.innerHTML = "";

  if (!state) {
    view.appendChild(card(`<div class="small">Carregando…</div>`));
    return;
  }

  if (id === "dashboard") return renderDashboard(view);
  if (id === "clientes") return renderClientes(view, q);
  if (id === "produtos") return renderProdutos(view, q);
  if (id === "pedidos") return renderPedidos(view, q);
  if (id === "rotas") return renderRotas(view, q);
  if (id === "despesas") return renderDespesas(view, q);
  if (id === "lembretes") return renderLembretes(view, q);
  if (id === "notas") return renderNotas(view, q);

  view.appendChild(card(`<h3>Não implementado</h3>`));
}

function renderDashboard(view) {
  const pedidosAbertos = (state.pedidos || []).filter((p) => (p.status || "").toLowerCase() !== "pago");
  const urgentes = pedidosAbertos.filter((p) => (p.urgencia || "") === "Alta");
  const estoqueBaixo = (state.produtos || []).filter(
    (p) => Number(p.estoqueAtual || 0) <= Number(p.estoqueMin || 0)
  );
  const totalReceber = pedidosAbertos.reduce((acc, p) => acc + Number(p.total || 0), 0);

  view.appendChild(card(`
    <h3>Resumo</h3>
    <div class="grid3">
      <div class="card" style="padding:12px"><div class="small">Clientes</div><div class="v">${(state.clientes || []).length}</div></div>
      <div class="card" style="padding:12px"><div class="small">Pedidos em aberto</div><div class="v">${pedidosAbertos.length}</div><div class="small">Urgentes: ${urgentes.length}</div></div>
      <div class="card" style="padding:12px"><div class="small">A receber (abertos)</div><div class="v">${money(totalReceber)}</div></div>
      <div class="card" style="padding:12px"><div class="small">Estoque baixo</div><div class="v">${estoqueBaixo.length}</div></div>
      <div class="card" style="padding:12px"><div class="small">Despesas</div><div class="v">${(state.despesas || []).length}</div></div>
      <div class="card" style="padding:12px"><div class="small">Lembretes pendentes</div><div class="v">${(state.lembretes || []).filter(x => (x.status||"pendente") !== "feito").length}</div></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn" id="b_refresh">Recarregar</button>
      <button class="btn" id="b_backup">Backup na nuvem</button>
      <button class="btn danger" id="b_logout">Sair</button>
    </div>
  `));

  $("#b_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  $("#b_backup").onclick = async () => {
    try {
      const r = await api("/api/backup", { method: "POST" });
      toast(`Backup: ${r.key}`);
    } catch (e) {
      alert(e.message || "Falha no backup");
    }
  };
  $("#b_logout").onclick = () => { clearToken(); location.reload(); };
}

/* ================= CLIENTES ================= */
function renderClientes(view, q) {
  const items = (state.clientes || []).filter((c) => {
    if (!q) return true;
    return (c.nome || "").toLowerCase().includes(q)
      || (c.telefone || "").includes(q)
      || (c.cidade || "").toLowerCase().includes(q);
  });

  view.appendChild(card(`
    <h3>Clientes</h3>
    <div class="actions"><button class="btn primary" id="c_new">+ Novo cliente</button></div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
  `));

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr><th>ID</th><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Ações</th></tr>
    </thead>
    <tbody>
      ${items.map(c => `
        <tr>
          <td>${safe(c.id)}</td>
          <td><b>${safe(c.nome)}</b><div class="small">${safe(c.endereco || "")}</div></td>
          <td>${safe(c.telefone || "")}</td>
          <td>${safe(c.cidade || "")}/${safe(c.uf || "")}</td>
          <td>
            <div class="actions">
              <button class="btn" data-edit="${safe(c.id)}">Editar</button>
              <button class="btn danger" data-del="${safe(c.id)}">Excluir</button>
            </div>
          </td>
        </tr>
      `).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#c_new").onclick = () => openClienteForm();
  table.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openClienteForm(b.dataset.edit)));
  table.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir cliente?")) return;
    await api(`/api/clientes/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.clientes = state.clientes.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openClienteForm(id = null) {
  const c = id ? (state.clientes || []).find((x) => x.id === id) : null;
  const modal = openModal("Cliente", `
    <div class="row">
      <div style="grid-column:span 4"><label class="small">ID</label><input id="cid" disabled value="${safe(c?.id || "")}"/></div>
      <div style="grid-column:span 8"><label class="small">Nome *</label><input id="cnome" value="${safe(c?.nome || "")}"/></div>
      <div style="grid-column:span 6"><label class="small">Telefone *</label><input id="ctel" value="${safe(c?.telefone || "")}"/></div>
      <div style="grid-column:span 6"><label class="small">Cidade</label><input id="ccid" value="${safe(c?.cidade || "")}"/></div>
      <div style="grid-column:span 6"><label class="small">UF</label><input id="cuf" value="${safe(c?.uf || "")}"/></div>
      <div style="grid-column:span 12"><label class="small">Endereço</label><input id="cend" value="${safe(c?.endereco || "")}"/></div>
      <div style="grid-column:span 12"><label class="small">Obs</label><textarea id="cobs">${safe(c?.obs || "")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="csave">Salvar</button>
      <button class="btn" id="cclose">Fechar</button>
    </div>
  `);

  $("#cclose").onclick = () => modal.close();
  $("#csave").onclick = async () => {
    const nome = $("#cnome").value.trim();
    const tel = $("#ctel").value.trim();
    if (!nome || !tel) return alert("Nome e telefone são obrigatórios.");
    const payload = {
      id: c?.id || null,
      nome,
      telefone: tel,
      cidade: $("#ccid").value.trim(),
      uf: $("#cuf").value.trim(),
      endereco: $("#cend").value.trim(),
      obs: $("#cobs").value.trim(),
      tags: c?.tags || [],
    };
    const saved = await api("/api/clientes", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("clientes", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= PRODUTOS ================= */
function renderProdutos(view, q) {
  const items = (state.produtos || []).filter((p) => {
    if (!q) return true;
    return (`${p.marca || ""} ${p.produto || ""} ${p.modelo || ""} ${p.categoria || ""}`).toLowerCase().includes(q);
  });

  view.appendChild(card(`
    <h3>Mercadorias</h3>
    <div class="actions">
      <button class="btn primary" id="p_new">+ Nova mercadoria</button>
      <button class="btn" id="p_refresh">Recarregar</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
  `));

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th><th>Produto</th><th>Compra</th><th>Venda</th><th>Estoque</th><th>Margem</th><th>Ações</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(p => {
        const m = calcMargin(p);
        return `
          <tr>
            <td>${safe(p.id)}</td>
            <td>
              <b>${safe(p.marca || "")} ${safe(p.produto || "")}</b>
              <div class="small">${safe(p.modelo || "")} • ${safe(p.categoria || "")}</div>
            </td>
            <td>${money(p.valorCompra)}</td>
            <td>${money(p.valorVenda)}</td>
            <td>${Number(p.estoqueAtual || 0)} <span class="small">/ min ${Number(p.estoqueMin || 0)}</span></td>
            <td>${money(m.margem)}</td>
            <td>
              <div class="actions">
                <button class="btn" data-edit="${safe(p.id)}">Editar</button>
                <button class="btn danger" data-del="${safe(p.id)}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#p_new").onclick = () => openProdutoForm();
  $("#p_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  table.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openProdutoForm(b.dataset.edit)));
  table.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir mercadoria?")) return;
    await api(`/api/produtos/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.produtos = state.produtos.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openProdutoForm(id = null) {
  const p = id ? (state.produtos || []).find((x) => x.id === id) : null;
  const modal = openModal("Mercadoria", `
    <div class="row">
      <div style="grid-column:span 3"><label class="small">ID</label><input disabled value="${safe(p?.id || "")}"></div>
      <div style="grid-column:span 3"><label class="small">Marca</label><input id="pmarca" value="${safe(p?.marca || "")}"></div>
      <div style="grid-column:span 6"><label class="small">Produto *</label><input id="pproduto" value="${safe(p?.produto || "")}"></div>
      <div style="grid-column:span 4"><label class="small">Modelo</label><input id="pmodelo" value="${safe(p?.modelo || "")}"></div>
      <div style="grid-column:span 4"><label class="small">Categoria</label><input id="pcategoria" value="${safe(p?.categoria || "")}"></div>
      <div style="grid-column:span 4"><label class="small">SKU</label><input id="psku" value="${safe(p?.sku || "")}"></div>

      <div style="grid-column:span 3"><label class="small">Valor compra</label><input id="pcompra" value="${safe(p?.valorCompra ?? 0)}"></div>
      <div style="grid-column:span 3"><label class="small">Valor venda</label><input id="pvenda" value="${safe(p?.valorVenda ?? 0)}"></div>
      <div style="grid-column:span 3"><label class="small">Estoque atual</label><input id="pestq" value="${safe(p?.estoqueAtual ?? 0)}"></div>
      <div style="grid-column:span 3"><label class="small">Estoque mínimo</label><input id="pestqmin" value="${safe(p?.estoqueMin ?? 0)}"></div>

      <div style="grid-column:span 6"><label class="small">Local</label><input id="plocal" value="${safe(p?.local || "")}"></div>
      <div style="grid-column:span 6"><label class="small">Status</label>
        <select id="pstatus">
          <option value="ativo" ${p?.status === "ativo" ? "selected" : ""}>ativo</option>
          <option value="inativo" ${p?.status === "inativo" ? "selected" : ""}>inativo</option>
        </select>
      </div>

      <div style="grid-column:span 12"><label class="small">Descrição</label><textarea id="pdesc">${safe(p?.descricao || "")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="psave">Salvar</button>
      <button class="btn" id="pclose">Fechar</button>
    </div>
  `);

  $("#pclose").onclick = () => modal.close();
  $("#psave").onclick = async () => {
    const produto = $("#pproduto").value.trim();
    if (!produto) return alert("Produto é obrigatório.");
    const payload = {
      id: p?.id || null,
      marca: $("#pmarca").value.trim(),
      produto,
      modelo: $("#pmodelo").value.trim(),
      descricao: $("#pdesc").value.trim(),
      categoria: $("#pcategoria").value.trim(),
      sku: $("#psku").value.trim(),
      agregados: p?.agregados || "",
      valorCompra: parseMoney($("#pcompra").value),
      valorVenda: parseMoney($("#pvenda").value),
      estoqueAtual: Number($("#pestq").value || 0),
      estoqueMin: Number($("#pestqmin").value || 0),
      local: $("#plocal").value.trim(),
      status: $("#pstatus").value || "ativo",
    };
    const saved = await api("/api/produtos", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("produtos", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= PEDIDOS / VENDAS V2.1 ================= */
function renderPedidos(view, q) {
  const all = (state.pedidos || []);

  const statusFilter = (localStorage.getItem("pedidos_f_status") || "todos").toLowerCase();
  const dIni = localStorage.getItem("pedidos_f_ini") || "";
  const dFim = localStorage.getItem("pedidos_f_fim") || "";

  const items = all.filter((p) => {
    const textOk = !q || (`${p.id || ""} ${p.clienteNome || ""} ${p.status || ""} ${p.formaPagamento || ""}`)
      .toLowerCase()
      .includes(q);

    let statusOk = true;
    if (statusFilter !== "todos") statusOk = (p.status || "").toLowerCase() === statusFilter;

    let dataOk = true;
    const d = (p.data || "").slice(0, 10);
    if (dIni && d) dataOk = dataOk && d >= dIni;
    if (dFim && d) dataOk = dataOk && d <= dFim;

    return textOk && statusOk && dataOk;
  });

  const totalGeral = items.reduce((acc, p) => acc + Number(p.total || 0), 0);
  const emAberto = items.filter((p) => !["pago", "cancelado"].includes((p.status || "").toLowerCase()));
  const totalAberto = emAberto.reduce((acc, p) => acc + Number(p.total || 0), 0);

  view.appendChild(card(`
    <h3>Pedidos / Vendas</h3>

    <div class="row" style="margin-top:8px">
      <div style="grid-column:span 4">
        <label class="small">Status</label>
        <select id="pd_f_status">
          ${["todos","aberto","negociando","faturado","pago","cancelado"].map(s => `
            <option value="${s}" ${statusFilter === s ? "selected" : ""}>${s}</option>
          `).join("")}
        </select>
      </div>
      <div style="grid-column:span 4">
        <label class="small">Data inicial</label>
        <input id="pd_f_ini" type="date" value="${safe(dIni)}">
      </div>
      <div style="grid-column:span 4">
        <label class="small">Data final</label>
        <input id="pd_f_fim" type="date" value="${safe(dFim)}">
      </div>
    </div>

    <div class="actions" style="margin-top:10px">
      <button class="btn primary" id="pd_new">+ Novo pedido</button>
      <button class="btn" id="pd_refresh">Recarregar</button>
      <button class="btn" id="pd_filter_apply">Aplicar filtros</button>
      <button class="btn" id="pd_filter_clear">Limpar filtros</button>
    </div>

    <div class="small" style="margin-top:8px">
      Total: ${items.length} • Soma: ${money(totalGeral)} • Em aberto: ${emAberto.length} (${money(totalAberto)})
    </div>
  `));

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Data</th>
        <th>Cliente</th>
        <th>Status</th>
        <th>Pagamento</th>
        <th>Total</th>
        <th>Itens</th>
        <th>Ações</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(p => {
        const itens = jparse(p.itens, []);
        return `
          <tr>
            <td>${safe(p.id)}</td>
            <td>${safe((p.data || "").slice(0, 10))}</td>
            <td>
              <b>${safe(p.clienteNome || "")}</b>
              <div class="small">${safe(p.clienteId || "")}</div>
            </td>
            <td>
              ${safe(p.status || "")}
              <div class="small">${safe(p.urgencia || "")}</div>
            </td>
            <td>${safe(p.formaPagamento || "")}</td>
            <td>${money(p.total)}</td>
            <td>${Array.isArray(itens) ? itens.length : 0}</td>
            <td>
              <div class="actions">
                <button class="btn" data-print="${safe(p.id)}">Imprimir</button>
                <button class="btn" data-edit="${safe(p.id)}">Editar</button>
                <button class="btn danger" data-del="${safe(p.id)}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#pd_new").onclick = () => openPedidoForm();
  $("#pd_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };

  $("#pd_filter_apply").onclick = () => {
    localStorage.setItem("pedidos_f_status", ($("#pd_f_status").value || "todos").toLowerCase());
    localStorage.setItem("pedidos_f_ini", $("#pd_f_ini").value || "");
    localStorage.setItem("pedidos_f_fim", $("#pd_f_fim").value || "");
    render();
  };

  $("#pd_filter_clear").onclick = () => {
    localStorage.removeItem("pedidos_f_status");
    localStorage.removeItem("pedidos_f_ini");
    localStorage.removeItem("pedidos_f_fim");
    render();
  };

  table.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => openPedidoForm(b.dataset.edit);
  });

  table.querySelectorAll("[data-print]").forEach((b) => {
    b.onclick = () => {
      const p = (state.pedidos || []).find(x => x.id === b.dataset.print);
      if (!p) return;
      imprimirPedido(p);
    };
  });

  table.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Excluir pedido?")) return;
      await api(`/api/pedidos/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
      state.pedidos = (state.pedidos || []).filter((x) => x.id !== b.dataset.del);
      toast("Pedido excluído");
      render();
    };
  });
}

function openPedidoForm(id = null) {
  const pedido = id ? (state.pedidos || []).find((x) => x.id === id) : null;
  const produtosBase = (state.produtos || []).filter((p) => (p.status || "ativo") !== "inativo");
  const clientesBase = (state.clientes || []);

  const itensOriginais = normalizePedidoItens(jparse(pedido?.itens, []));
  let itensUI = itensOriginais.map((x) => ({ ...x }));

  const clienteOptions = `
    <option value="">Selecione...</option>
    ${clientesBase.map(c => `
      <option value="${safe(c.id)}" ${pedido?.clienteId === c.id ? "selected" : ""}>
        ${safe(c.nome)} ${c.telefone ? `(${safe(c.telefone)})` : ""}
      </option>
    `).join("")}
  `;

  const modal = openModal("Pedido / Venda (V2.1)", `
    <div class="row">
      <div style="grid-column:span 3">
        <label class="small">ID</label>
        <input id="pd_id" disabled value="${safe(pedido?.id || "")}">
      </div>

      <div style="grid-column:span 3">
        <label class="small">Data</label>
        <input id="pd_data" type="date" value="${safe((pedido?.data || new Date().toISOString()).slice(0,10))}">
      </div>

      <div style="grid-column:span 3">
        <label class="small">Urgência</label>
        <select id="pd_urg">
          <option value="" ${!pedido?.urgencia ? "selected" : ""}>(vazio)</option>
          <option value="Baixa" ${pedido?.urgencia === "Baixa" ? "selected" : ""}>Baixa</option>
          <option value="Média" ${pedido?.urgencia === "Média" ? "selected" : ""}>Média</option>
          <option value="Alta" ${pedido?.urgencia === "Alta" ? "selected" : ""}>Alta</option>
        </select>
      </div>

      <div style="grid-column:span 3">
        <label class="small">Status</label>
        <select id="pd_status">
          ${["aberto","negociando","faturado","pago","cancelado"].map(s =>
            `<option value="${s}" ${pedido?.status === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </div>

      <div style="grid-column:span 6">
        <label class="small">Cliente</label>
        <select id="pd_cliente">${clienteOptions}</select>
      </div>

      <div style="grid-column:span 3">
        <label class="small">Forma de pagamento</label>
        <input id="pd_forma" value="${safe(pedido?.formaPagamento || "")}" placeholder="Pix, Dinheiro, Prazo...">
      </div>

      <div style="grid-column:span 3">
        <label class="small">Prazo (dias)</label>
        <input id="pd_prazo" type="number" value="${safe(pedido?.prazoDias ?? 0)}">
      </div>

      <div style="grid-column:span 12">
        <label class="small">Obs</label>
        <input id="pd_obs" value="${safe(pedido?.obs || "")}">
      </div>

      <div style="grid-column:span 6;display:flex;align-items:end">
        <label style="display:flex;gap:8px;align-items:center;font-size:13px">
          <input type="checkbox" id="pd_baixa_estoque" ${id ? "" : "checked"}>
          Baixar estoque ao salvar
        </label>
      </div>

      <div style="grid-column:span 6;display:flex;align-items:end">
        <label style="display:flex;gap:8px;align-items:center;font-size:13px">
          <input type="checkbox" id="pd_bloqueia_negativo" checked>
          Bloquear estoque negativo
        </label>
      </div>
    </div>

    <div class="card" style="margin-top:12px;padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="font-weight:700">Itens do pedido</div>
        <div class="actions">
          <button class="btn" id="pd_add_item">+ Item manual</button>
          <button class="btn" id="pd_add_produto">+ Da mercadoria</button>
        </div>
      </div>

      <div id="pd_alerta_estoque" class="small" style="margin-top:8px;color:#b45309"></div>
      <div id="pd_itens_wrap" style="margin-top:10px"></div>

      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:12px;align-items:center">
        <div class="small">Subtotal calculado automaticamente (qtd × valor unitário).</div>
        <div style="text-align:right">
          <div class="small">Total do pedido</div>
          <div id="pd_total_txt" style="font-size:20px;font-weight:800">${money(pedido?.total || 0)}</div>
        </div>
      </div>
    </div>

    <div class="actions" style="margin-top:12px">
      <button class="btn" id="pd_print_preview">Imprimir (prévia)</button>
      <button class="btn primary" id="pd_save">Salvar pedido</button>
      <button class="btn" id="pd_close">Fechar</button>
    </div>
  `, "min(1120px,100%)");

  const itensWrap = modal.box.querySelector("#pd_itens_wrap");
  const alertaEstoqueEl = modal.box.querySelector("#pd_alerta_estoque");

  function renderItensUI() {
    if (!itensUI.length) {
      itensWrap.innerHTML = `<div class="small">Nenhum item adicionado.</div>`;
      updateTotalUI();
      renderAlertaEstoque();
      return;
    }

    itensWrap.innerHTML = `
      <div style="overflow:auto">
        <table class="table">
          <thead>
            <tr>
              <th style="min-width:220px">Produto</th>
              <th style="min-width:220px">Descrição</th>
              <th style="width:100px">Qtd</th>
              <th style="width:150px">Valor unit.</th>
              <th style="width:150px">Subtotal</th>
              <th style="min-width:160px">Estoque</th>
              <th style="min-width:120px">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${itensUI.map((it, idx) => {
              const prod = produtosBase.find(p => p.id === it.produtoId);
              const est = prod ? Number(prod.estoqueAtual || 0) : null;
              const qtd = Number(it.qtd || 0);
              const insuf = prod && qtd > est;
              return `
                <tr data-row="${idx}">
                  <td>
                    <select class="pd_item_produto" data-idx="${idx}">
                      <option value="">(manual)</option>
                      ${produtosBase.map(p => `
                        <option value="${safe(p.id)}" ${it.produtoId === p.id ? "selected" : ""}>
                          ${safe((p.marca || "") + " " + (p.produto || ""))} ${p.modelo ? "• " + safe(p.modelo) : ""}
                        </option>
                      `).join("")}
                    </select>
                    <div class="small">${safe(it.produtoId || "")}</div>
                  </td>
                  <td>
                    <input class="pd_item_desc" data-idx="${idx}" value="${safe(it.descricao || "")}" placeholder="Descrição">
                  </td>
                  <td>
                    <input class="pd_item_qtd" data-idx="${idx}" type="number" step="0.01" min="0" value="${Number(it.qtd || 0)}">
                  </td>
                  <td>
                    <input class="pd_item_valor" data-idx="${idx}" type="number" step="0.01" min="0" value="${Number(it.valorUnit || 0)}">
                  </td>
                  <td>
                    <b>${money((Number(it.qtd || 0) * Number(it.valorUnit || 0)))}</b>
                  </td>
                  <td>
                    ${prod
                      ? `<span ${insuf ? 'style="color:#b91c1c;font-weight:700"' : ""}>Atual: ${Number(prod.estoqueAtual || 0)}</span><div class="small">Min: ${Number(prod.estoqueMin || 0)}</div>`
                      : `<span class="small">N/A</span>`
                    }
                  </td>
                  <td>
                    <div class="actions">
                      <button class="btn" data-dup="${idx}">Duplicar</button>
                      <button class="btn danger" data-rem="${idx}">Remover</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    itensWrap.querySelectorAll(".pd_item_produto").forEach((el) => {
      el.onchange = () => {
        const idx = Number(el.dataset.idx);
        const prod = produtosBase.find((p) => p.id === el.value);
        if (prod) {
          itensUI[idx].produtoId = prod.id;
          itensUI[idx].descricao = formatProdutoDisplay(prod);
          itensUI[idx].valorUnit = Number(prod.valorVenda || 0);
          if (!Number(itensUI[idx].qtd || 0)) itensUI[idx].qtd = 1;
        } else {
          itensUI[idx].produtoId = "";
        }
        renderItensUI();
      };
    });

    itensWrap.querySelectorAll(".pd_item_desc").forEach((el) => {
      el.oninput = () => {
        const idx = Number(el.dataset.idx);
        itensUI[idx].descricao = el.value;
      };
    });

    itensWrap.querySelectorAll(".pd_item_qtd").forEach((el) => {
      el.oninput = () => {
        const idx = Number(el.dataset.idx);
        itensUI[idx].qtd = Number(el.value || 0);
        updateTotalUI();
        renderAlertaEstoque();
        const tr = el.closest("tr");
        if (tr) tr.children[4].innerHTML = `<b>${money(Number(itensUI[idx].qtd || 0) * Number(itensUI[idx].valorUnit || 0))}</b>`;
      };
    });

    itensWrap.querySelectorAll(".pd_item_valor").forEach((el) => {
      el.oninput = () => {
        const idx = Number(el.dataset.idx);
        itensUI[idx].valorUnit = Number(el.value || 0);
        updateTotalUI();
        const tr = el.closest("tr");
        if (tr) tr.children[4].innerHTML = `<b>${money(Number(itensUI[idx].qtd || 0) * Number(itensUI[idx].valorUnit || 0))}</b>`;
      };
    });

    itensWrap.querySelectorAll("[data-rem]").forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.rem);
        itensUI.splice(idx, 1);
        renderItensUI();
      };
    });

    itensWrap.querySelectorAll("[data-dup]").forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.dup);
        const src = itensUI[idx];
        itensUI.splice(idx + 1, 0, { ...src });
        renderItensUI();
      };
    });

    updateTotalUI();
    renderAlertaEstoque();
  }

  function updateTotalUI() {
    const total = itensUI.reduce((acc, it) => acc + (Number(it.qtd || 0) * Number(it.valorUnit || 0)), 0);
    modal.box.querySelector("#pd_total_txt").textContent = money(total);
  }

  function renderAlertaEstoque() {
    const linhas = getInsuficienciasEstoque(itensOriginais, itensUI);
    if (!linhas.length) {
      alertaEstoqueEl.textContent = "";
      return;
    }
    alertaEstoqueEl.innerHTML = linhas.map(x => `⚠️ ${safe(x)}`).join("<br>");
  }

  function addItemManual() {
    itensUI.push({ produtoId: "", descricao: "", qtd: 1, valorUnit: 0 });
    renderItensUI();
  }

  function addFromProdutoPicker() {
    const picker = openModal("Adicionar item da mercadoria", `
      <div class="small">Clique em um produto para adicionar ao pedido.</div>
      <div style="margin-top:10px;max-height:65vh;overflow:auto">
        <table class="table">
          <thead><tr><th>Produto</th><th>Venda</th><th>Estoque</th><th>Ação</th></tr></thead>
          <tbody>
            ${produtosBase.map(p => `
              <tr>
                <td>
                  <b>${safe(formatProdutoDisplay(p))}</b>
                  <div class="small">${safe(p.id || "")} • ${safe(p.categoria || "")}</div>
                </td>
                <td>${money(p.valorVenda)}</td>
                <td>${Number(p.estoqueAtual || 0)} <span class="small">/ min ${Number(p.estoqueMin || 0)}</span></td>
                <td><button class="btn primary" data-pick="${safe(p.id)}">Adicionar</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `, "min(900px,100%)");

    picker.box.querySelectorAll("[data-pick]").forEach((b) => {
      b.onclick = () => {
        const prod = produtosBase.find((p) => p.id === b.dataset.pick);
        if (!prod) return;
        itensUI.push({
          produtoId: prod.id,
          descricao: formatProdutoDisplay(prod),
          qtd: 1,
          valorUnit: Number(prod.valorVenda || 0)
        });
        picker.close();
        renderItensUI();
      };
    });
  }

  modal.box.querySelector("#pd_add_item").onclick = addItemManual;
  modal.box.querySelector("#pd_add_produto").onclick = addFromProdutoPicker;
  modal.box.querySelector("#pd_close").onclick = () => modal.close();

  modal.box.querySelector("#pd_print_preview").onclick = () => {
    const preview = buildPedidoPreviewFromForm(modal.box, itensUI, clientesBase);
    imprimirPedido(preview);
  };

  renderItensUI();

  modal.box.querySelector("#pd_save").onclick = async () => {
    const selClienteId = modal.box.querySelector("#pd_cliente").value;
    const cliente = clientesBase.find((c) => c.id === selClienteId);

    const itensLimpos = itensUI
      .map((it) => ({
        produtoId: (it.produtoId || "").trim(),
        descricao: (it.descricao || "").trim(),
        qtd: Number(it.qtd || 0),
        valorUnit: Number(it.valorUnit || 0)
      }))
      .filter((it) => it.qtd > 0 && (it.descricao || it.produtoId));

    if (!cliente) return alert("Selecione um cliente.");
    if (!itensLimpos.length) return alert("Adicione pelo menos 1 item válido.");

    const total = itensLimpos.reduce((acc, it) => acc + (it.qtd * it.valorUnit), 0);

    const payload = {
      id: pedido?.id || null,
      data: modal.box.querySelector("#pd_data").value
        ? `${modal.box.querySelector("#pd_data").value}T00:00:00.000Z`
        : "",
      clienteId: cliente.id,
      clienteNome: cliente.nome || "",
      urgencia: modal.box.querySelector("#pd_urg").value || "",
      formaPagamento: modal.box.querySelector("#pd_forma").value.trim(),
      prazoDias: Number(modal.box.querySelector("#pd_prazo").value || 0),
      status: modal.box.querySelector("#pd_status").value || "aberto",
      obs: modal.box.querySelector("#pd_obs").value.trim(),
      total,
      itens: itensLimpos
    };

    const baixarEstoque = modal.box.querySelector("#pd_baixa_estoque").checked;
    const bloquearNegativo = modal.box.querySelector("#pd_bloqueia_negativo").checked;

    try {
      if (baixarEstoque && bloquearNegativo) {
        const violacoes = validarEstoqueNegativoPorDelta(itensOriginais, itensLimpos);
        if (violacoes.length) {
          return alert("Estoque insuficiente:\n\n" + violacoes.map(v => `- ${v}`).join("\n"));
        }
      }

      const saved = await api("/api/pedidos", { method: "POST", body: JSON.stringify(payload) });

      if (baixarEstoque) {
        await aplicarBaixaEstoquePorDelta(itensOriginais, itensLimpos);
      }

      upsertLocal("pedidos", saved);
      modal.close();
      toast("Pedido salvo");
      await refreshState();
    } catch (e) {
      alert(e.message || "Falha ao salvar pedido");
    }
  };
}

/* ===== HELPERS PEDIDOS V2.1 ===== */
function formatProdutoDisplay(p) {
  return [p.marca, p.produto, p.modelo].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || p.id || "Produto";
}

function normalizePedidoItens(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => ({
    produtoId: (it.produtoId || "").toString(),
    descricao: (it.descricao || it.nome || "").toString(),
    qtd: Number(it.qtd ?? it.quantidade ?? 0),
    valorUnit: Number(it.valorUnit ?? it.valor ?? it.preco ?? 0)
  }));
}

function mapQtdPorProduto(itens) {
  const m = new Map();
  (itens || []).forEach((it) => {
    const pid = (it.produtoId || "").trim();
    if (!pid) return;
    const qtd = Number(it.qtd || 0);
    if (!qtd) return;
    m.set(pid, (m.get(pid) || 0) + qtd);
  });
  return m;
}

function getInsuficienciasEstoque(itensOriginais, itensNovos) {
  const before = mapQtdPorProduto(normalizePedidoItens(itensOriginais));
  const after = mapQtdPorProduto(normalizePedidoItens(itensNovos));
  const produtosMap = new Map((state.produtos || []).map((p) => [p.id, p]));
  const msgs = [];

  const allIds = new Set([...before.keys(), ...after.keys()]);
  for (const produtoId of allIds) {
    const qtdAntes = Number(before.get(produtoId) || 0);
    const qtdDepois = Number(after.get(produtoId) || 0);
    const deltaConsumido = qtdDepois - qtdAntes;
    if (deltaConsumido <= 0) continue;

    const prod = produtosMap.get(produtoId);
    if (!prod) continue;

    const estoqueAtual = Number(prod.estoqueAtual || 0);
    const restante = estoqueAtual - deltaConsumido;
    if (restante < 0) {
      msgs.push(`${formatProdutoDisplay(prod)} (${produtoId}) precisa ${deltaConsumido} e tem ${estoqueAtual}. Faltam ${Math.abs(restante)}.`);
    }
  }
  return msgs;
}

function validarEstoqueNegativoPorDelta(itensOriginais, itensNovos) {
  return getInsuficienciasEstoque(itensOriginais, itensNovos);
}

async function aplicarBaixaEstoquePorDelta(itensOriginais, itensNovos) {
  const before = mapQtdPorProduto(normalizePedidoItens(itensOriginais));
  const after = mapQtdPorProduto(normalizePedidoItens(itensNovos));

  const allIds = new Set([...before.keys(), ...after.keys()]);
  if (!allIds.size) return;

  const produtosMap = new Map((state.produtos || []).map((p) => [p.id, p]));

  for (const produtoId of allIds) {
    const qtdAntes = Number(before.get(produtoId) || 0);
    const qtdDepois = Number(after.get(produtoId) || 0);
    const deltaConsumido = qtdDepois - qtdAntes;

    if (deltaConsumido === 0) continue;

    const prod = produtosMap.get(produtoId);
    if (!prod) continue;

    const estoqueAtual = Number(prod.estoqueAtual || 0);
    const novoEstoque = estoqueAtual - deltaConsumido;

    const payloadProduto = {
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

    const savedProd = await api("/api/produtos", {
      method: "POST",
      body: JSON.stringify(payloadProduto)
    });

    upsertLocal("produtos", savedProd);
  }
}

function buildPedidoPreviewFromForm(box, itensUI, clientesBase) {
  const clienteId = box.querySelector("#pd_cliente")?.value || "";
  const cliente = (clientesBase || []).find(c => c.id === clienteId);
  const itens = (itensUI || [])
    .map(it => ({
      produtoId: (it.produtoId || "").trim(),
      descricao: (it.descricao || "").trim(),
      qtd: Number(it.qtd || 0),
      valorUnit: Number(it.valorUnit || 0)
    }))
    .filter(it => it.qtd > 0 && (it.descricao || it.produtoId));

  const total = itens.reduce((acc, it) => acc + (it.qtd * it.valorUnit), 0);

  return {
    id: box.querySelector("#pd_id")?.value || "(novo)",
    data: (box.querySelector("#pd_data")?.value || "") + "T00:00:00.000Z",
    clienteId: cliente?.id || "",
    clienteNome: cliente?.nome || "",
    formaPagamento: box.querySelector("#pd_forma")?.value || "",
    prazoDias: Number(box.querySelector("#pd_prazo")?.value || 0),
    status: box.querySelector("#pd_status")?.value || "aberto",
    urgencia: box.querySelector("#pd_urg")?.value || "",
    obs: box.querySelector("#pd_obs")?.value || "",
    total,
    itens
  };
}

function imprimirPedido(p) {
  const itens = normalizePedidoItens(jparse(p.itens, []));
  const total = Number(p.total || itens.reduce((a, it) => a + (Number(it.qtd || 0) * Number(it.valorUnit || 0)), 0));

  const html = `
  <html>
    <head>
      <title>Pedido ${safe(p.id || "")}</title>
      <meta charset="utf-8"/>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0 0 8px}
        .muted{color:#555;font-size:12px}
        .box{border:1px solid #ddd;border-radius:8px;padding:12px;margin-top:12px}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left}
        th{background:#f5f5f5}
        .right{text-align:right}
        .total{font-size:18px;font-weight:700}
        @media print { button { display:none } body{padding:0} }
      </style>
    </head>
    <body>
      <button onclick="window.print()">Imprimir</button>
      <h1>Pedido / Venda ${safe(p.id || "")}</h1>
      <div class="muted">Data: ${safe((p.data || "").slice(0,10))} • Status: ${safe(p.status || "")} • Urgência: ${safe(p.urgencia || "")}</div>

      <div class="box">
        <div><b>Cliente:</b> ${safe(p.clienteNome || "")}</div>
        <div class="muted">ID cliente: ${safe(p.clienteId || "")}</div>
        <div style="margin-top:6px"><b>Pagamento:</b> ${safe(p.formaPagamento || "")} ${Number(p.prazoDias || 0) ? `• Prazo: ${Number(p.prazoDias)} dias` : ""}</div>
        ${p.obs ? `<div style="margin-top:6px"><b>Obs:</b> ${safe(p.obs)}</div>` : ""}
      </div>

      <div class="box">
        <b>Itens</b>
        <table>
          <thead>
            <tr><th>#</th><th>Descrição</th><th>Qtd</th><th>Valor unit.</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            ${itens.map((it, i) => `
              <tr>
                <td>${i+1}</td>
                <td>${safe(it.descricao || it.produtoId || "")} ${it.produtoId ? `<div class="muted">${safe(it.produtoId)}</div>` : ""}</td>
                <td class="right">${Number(it.qtd || 0)}</td>
                <td class="right">${money(it.valorUnit)}</td>
                <td class="right">${money(Number(it.qtd || 0) * Number(it.valorUnit || 0))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="margin-top:12px;text-align:right" class="total">Total: ${money(total)}</div>
      </div>
    </body>
  </html>`;

  const w = window.open("", "_blank");
  if (!w) return alert("O navegador bloqueou a janela de impressão. Libere pop-up para este site.");
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ================= DESPESAS ================= */
function renderDespesas(view, q) {
  const items = (state.despesas || []).filter((d) => {
    if (!q) return true;
    return (`${d.id || ""} ${d.categoria || ""} ${d.pagamento || ""} ${d.obs || ""}`).toLowerCase().includes(q);
  });

  const total = items.reduce((acc, d) => acc + Number(d.valor || 0), 0);

  view.appendChild(card(`
    <h3>Despesas</h3>
    <div class="actions">
      <button class="btn primary" id="d_new">+ Nova despesa</button>
      <button class="btn" id="d_refresh">Recarregar</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length} • Soma: ${money(total)}</div>
  `));

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead><tr><th>ID</th><th>Data</th><th>Categoria</th><th>Pagamento</th><th>Valor</th><th>Ações</th></tr></thead>
    <tbody>
      ${items.map(d => `
        <tr>
          <td>${safe(d.id)}</td>
          <td>${safe((d.data || "").slice(0,10))}</td>
          <td><b>${safe(d.categoria || "")}</b><div class="small">${safe(d.obs || "")}</div></td>
          <td>${safe(d.pagamento || "")}</td>
          <td>${money(d.valor)}</td>
          <td>
            <div class="actions">
              <button class="btn" data-edit="${safe(d.id)}">Editar</button>
              <button class="btn danger" data-del="${safe(d.id)}">Excluir</button>
            </div>
          </td>
        </tr>
      `).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#d_new").onclick = () => openDespesaForm();
  $("#d_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  table.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openDespesaForm(b.dataset.edit)));
  table.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir despesa?")) return;
    await api(`/api/despesas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.despesas = state.despesas.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openDespesaForm(id = null) {
  const d = id ? (state.despesas || []).find((x) => x.id === id) : null;
  const modal = openModal("Despesa", `
    <div class="row">
      <div style="grid-column:span 3"><label class="small">ID</label><input disabled value="${safe(d?.id || "")}"></div>
      <div style="grid-column:span 3"><label class="small">Data</label><input id="dd_data" type="date" value="${safe((d?.data || new Date().toISOString()).slice(0,10))}"></div>
      <div style="grid-column:span 6"><label class="small">Categoria</label><input id="dd_cat" value="${safe(d?.categoria || "")}"></div>
      <div style="grid-column:span 4"><label class="small">Valor</label><input id="dd_valor" value="${safe(d?.valor ?? 0)}"></div>
      <div style="grid-column:span 4"><label class="small">Pagamento</label><input id="dd_pag" value="${safe(d?.pagamento || "")}"></div>
      <div style="grid-column:span 12"><label class="small">Obs</label><textarea id="dd_obs">${safe(d?.obs || "")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="dd_save">Salvar</button>
      <button class="btn" id="dd_close">Fechar</button>
    </div>
  `);

  $("#dd_close").onclick = () => modal.close();
  $("#dd_save").onclick = async () => {
    const payload = {
      id: d?.id || null,
      data: $("#dd_data").value ? `${$("#dd_data").value}T00:00:00.000Z` : "",
      categoria: $("#dd_cat").value.trim(),
      valor: parseMoney($("#dd_valor").value),
      pagamento: $("#dd_pag").value.trim(),
      obs: $("#dd_obs").value.trim(),
    };
    const saved = await api("/api/despesas", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("despesas", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= LEMBRETES ================= */
function renderLembretes(view, q) {
  const items = (state.lembretes || []).filter((l) => {
    if (!q) return true;
    return (`${l.id || ""} ${l.titulo || ""} ${l.texto || ""} ${l.status || ""}`).toLowerCase().includes(q);
  });

  view.appendChild(card(`
    <h3>Lembretes / Campanhas</h3>
    <div class="actions">
      <button class="btn primary" id="lb_new">+ Novo lembrete</button>
      <button class="btn" id="lb_refresh">Recarregar</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
  `));

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead><tr><th>ID</th><th>Data</th><th>Título</th><th>Status</th><th>Cliente</th><th>Ações</th></tr></thead>
    <tbody>
      ${items.map(l => `
        <tr>
          <td>${safe(l.id)}</td>
          <td>${safe((l.data || "").slice(0,10))}</td>
          <td><b>${safe(l.titulo || "")}</b><div class="small">${safe(l.tipo || "")}</div></td>
          <td>${safe(l.status || "")}</td>
          <td>${safe(l.clienteNome || "")}</td>
          <td>
            <div class="actions">
              <button class="btn" data-edit="${safe(l.id)}">Editar</button>
              <button class="btn danger" data-del="${safe(l.id)}">Excluir</button>
            </div>
          </td>
        </tr>
      `).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#lb_new").onclick = () => openLembreteForm();
  $("#lb_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  table.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openLembreteForm(b.dataset.edit)));
  table.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir lembrete?")) return;
    await api(`/api/lembretes/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.lembretes = state.lembretes.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openLembreteForm(id = null) {
  const l = id ? (state.lembretes || []).find((x) => x.id === id) : null;
  const clienteOptions = `<option value="">Nenhum</option>` +
    (state.clientes || []).map(c =>
      `<option value="${safe(c.id)}" ${l?.clienteId === c.id ? "selected" : ""}>${safe(c.nome)}</option>`
    ).join("");

  const modal = openModal("Lembrete / Campanha", `
    <div class="row">
      <div style="grid-column:span 3"><label class="small">ID</label><input disabled value="${safe(l?.id || "")}"></div>
      <div style="grid-column:span 3"><label class="small">Data</label><input id="lb_data" type="date" value="${safe((l?.data || new Date().toISOString()).slice(0,10))}"></div>
      <div style="grid-column:span 3"><label class="small">Tipo</label><input id="lb_tipo" value="${safe(l?.tipo || "")}" placeholder="retorno, campanha, visita..."></div>
      <div style="grid-column:span 3"><label class="small">Status</label>
        <select id="lb_status">
          ${["pendente","em andamento","feito","cancelado"].map(s=>`<option value="${s}" ${l?.status===s?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>

      <div style="grid-column:span 8"><label class="small">Título</label><input id="lb_titulo" value="${safe(l?.titulo || "")}"></div>
      <div style="grid-column:span 4"><label class="small">Cliente</label><select id="lb_cliente">${clienteOptions}</select></div>

      <div style="grid-column:span 6"><label class="small">Cliente (nome manual, opcional)</label><input id="lb_cnome" value="${safe(l?.clienteNome || "")}"></div>
      <div style="grid-column:span 6"><label class="small">Segmento</label><input id="lb_seg" value="${safe(l?.segmento || "")}"></div>

      <div style="grid-column:span 12"><label class="small">Texto</label><textarea id="lb_texto">${safe(l?.texto || "")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="lb_save">Salvar</button>
      <button class="btn" id="lb_close">Fechar</button>
    </div>
  `);

  $("#lb_close").onclick = () => modal.close();
  $("#lb_save").onclick = async () => {
    const selId = $("#lb_cliente").value;
    const c = (state.clientes || []).find(x => x.id === selId);
    const payload = {
      id: l?.id || null,
      tipo: $("#lb_tipo").value.trim(),
      titulo: $("#lb_titulo").value.trim(),
      data: $("#lb_data").value ? `${$("#lb_data").value}T00:00:00.000Z` : "",
      texto: $("#lb_texto").value.trim(),
      status: $("#lb_status").value || "pendente",
      clienteId: c?.id || "",
      clienteNome: $("#lb_cnome").value.trim() || c?.nome || "",
      segmento: $("#lb_seg").value.trim()
    };
    const saved = await api("/api/lembretes", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("lembretes", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= NOTAS ================= */
function renderNotas(view, q) {
  const items = (state.notas || []).filter((n) => {
    if (!q) return true;
    return (`${n.id || ""} ${n.titulo || ""} ${n.texto || ""}`).toLowerCase().includes(q);
  });

  view.appendChild(card(`
    <h3>Anotações</h3>
    <div class="actions">
      <button class="btn primary" id="nt_new">+ Nova anotação</button>
      <button class="btn" id="nt_refresh">Recarregar</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
  `));

  const grid = document.createElement("div");
  grid.className = "grid2";
  grid.style.marginTop = "12px";
  grid.innerHTML = items.map(n => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
        <div>
          <div style="font-weight:700">${safe(n.titulo || "(sem título)")}</div>
          <div class="small">${safe(n.id || "")} ${n.fixada ? "• Fixada" : ""}</div>
        </div>
        <span class="badge">${n.fixada ? "Fixada" : "Normal"}</span>
      </div>
      <div style="margin-top:10px; white-space:pre-wrap">${safe(n.texto || "")}</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" data-edit="${safe(n.id)}">Editar</button>
        <button class="btn danger" data-del="${safe(n.id)}">Excluir</button>
      </div>
    </div>
  `).join("");
  view.appendChild(grid);

  $("#nt_new").onclick = () => openNotaForm();
  $("#nt_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  grid.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openNotaForm(b.dataset.edit)));
  grid.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir anotação?")) return;
    await api(`/api/notas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.notas = state.notas.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openNotaForm(id = null) {
  const n = id ? (state.notas || []).find((x) => x.id === id) : null;
  const modal = openModal("Anotação", `
    <div class="row">
      <div style="grid-column:span 4"><label class="small">ID</label><input disabled value="${safe(n?.id || "")}"></div>
      <div style="grid-column:span 8"><label class="small">Título</label><input id="nt_titulo" value="${safe(n?.titulo || "")}"></div>
      <div style="grid-column:span 12"><label class="small">Texto</label><textarea id="nt_texto" style="min-height:180px">${safe(n?.texto || "")}</textarea></div>
      <div style="grid-column:span 4">
        <label class="small">Fixada</label>
        <select id="nt_fixada">
          <option value="0" ${!n?.fixada ? "selected" : ""}>Não</option>
          <option value="1" ${n?.fixada ? "selected" : ""}>Sim</option>
        </select>
      </div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="nt_save">Salvar</button>
      <button class="btn" id="nt_close">Fechar</button>
    </div>
  `);

  $("#nt_close").onclick = () => modal.close();
  $("#nt_save").onclick = async () => {
    const payload = {
      id: n?.id || null,
      titulo: $("#nt_titulo").value.trim(),
      texto: $("#nt_texto").value.trim(),
      fixada: $("#nt_fixada").value === "1"
    };
    const saved = await api("/api/notas", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("notas", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= ROTAS ================= */
function renderRotas(view, q) {
  const items = (state.rotas || []).filter((r) => {
    const paradas = jparse(r.paradas, []);
    if (!q) return true;
    return (`${r.id || ""} ${r.obs || ""} ${JSON.stringify(paradas)}`).toLowerCase().includes(q);
  });

  view.appendChild(card(`
    <h3>Rotas</h3>
    <div class="actions">
      <button class="btn primary" id="rt_new">+ Nova rota</button>
      <button class="btn" id="rt_refresh">Recarregar</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
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
            <td>${safe(r.id)}</td>
            <td>${safe((r.data || "").slice(0,10))}</td>
            <td>${Array.isArray(paradas) ? paradas.length : 0}</td>
            <td>${safe(r.obs || "")}</td>
            <td>
              <div class="actions">
                <button class="btn" data-edit="${safe(r.id)}">Editar</button>
                <button class="btn danger" data-del="${safe(r.id)}">Excluir</button>
              </div>
            </td>
          </tr>
        `;
      }).join("")}
    </tbody>
  `;
  view.appendChild(table);

  $("#rt_new").onclick = () => openRotaForm();
  $("#rt_refresh").onclick = async () => { await refreshState(); toast("Atualizado"); };
  table.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openRotaForm(b.dataset.edit)));
  table.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Excluir rota?")) return;
    await api(`/api/rotas/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" });
    state.rotas = state.rotas.filter((x) => x.id !== b.dataset.del);
    toast("Excluído");
    render();
  }));
}

function openRotaForm(id = null) {
  const r = id ? (state.rotas || []).find((x) => x.id === id) : null;
  const paradasDefault = JSON.stringify(jparse(r?.paradas, []), null, 2);

  const modal = openModal("Rota", `
    <div class="row">
      <div style="grid-column:span 3"><label class="small">ID</label><input disabled value="${safe(r?.id || "")}"></div>
      <div style="grid-column:span 3"><label class="small">Data</label><input id="rt_data" type="date" value="${safe((r?.data || new Date().toISOString()).slice(0,10))}"></div>
      <div style="grid-column:span 12"><label class="small">Obs</label><input id="rt_obs" value="${safe(r?.obs || "")}"></div>
      <div style="grid-column:span 12">
        <label class="small">Paradas (JSON)</label>
        <textarea id="rt_paradas" style="min-height:180px">${safe(paradasDefault)}</textarea>
        <div class="small">Ex.: [{"clienteId":"CL-000001","clienteNome":"Mercado X","ordem":1,"obs":"Entregar catálogo"}]</div>
      </div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="rt_save">Salvar</button>
      <button class="btn" id="rt_close">Fechar</button>
    </div>
  `);

  $("#rt_close").onclick = () => modal.close();
  $("#rt_save").onclick = async () => {
    let paradas = [];
    try { paradas = JSON.parse($("#rt_paradas").value || "[]"); }
    catch { return alert("JSON de paradas inválido."); }

    const payload = {
      id: r?.id || null,
      data: $("#rt_data").value ? `${$("#rt_data").value}T00:00:00.000Z` : "",
      obs: $("#rt_obs").value.trim(),
      paradas
    };
    const saved = await api("/api/rotas", { method: "POST", body: JSON.stringify(payload) });
    upsertLocal("rotas", saved);
    modal.close();
    toast("Salvo");
    render();
  };
}

/* ================= HELPERS GERAIS ================= */
function upsertLocal(key, saved) {
  if (!state[key]) state[key] = [];
  const idx = state[key].findIndex((x) => x.id === saved.id);
  if (idx >= 0) state[key][idx] = saved;
  else state[key].unshift(saved);
}
/* ================= AÇÕES GLOBAIS (Sair / Trocar usuário / Backup) ================= */

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

function downloadBackupLocal() {
  const payload = {
    exportedAt: new Date().toISOString(),
    apiBase: (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "",
    user: state?.me || null,
    data: {
      clientes: state.clientes || [],
      produtos: state.produtos || [],
      pedidos: state.pedidos || [],
      rotas: state.rotas || [],
      despesas: state.despesas || [],
      lembretes: state.lembretes || [],
      notas: state.notas || [],
      counters: state.counters || {}
    }
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  exportJsonFile(`supervenda-backup-${stamp}.json`, payload);
  toast("Backup baixado (.json)");
}

async function tryApiBackup() {
  // tenta endpoint de backup, se existir no backend
  try {
    const res = await api("/api/backup");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    exportJsonFile(`supervenda-backup-api-${stamp}.json`, res);
    toast("Backup da API baixado");
    return true;
  } catch (_) {
    return false;
  }
}

async function handleBackup() {
  const okApi = await tryApiBackup();
  if (!okApi) downloadBackupLocal();
}

function handleRestoreLocal(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const d = parsed?.data || parsed || {};

      // restaura somente em memória/local e tenta enviar para API item a item
      const keys = ["clientes", "produtos", "pedidos", "rotas", "despesas", "lembretes", "notas"];
      for (const k of keys) {
        if (!Array.isArray(d[k])) continue;
        state[k] = d[k];
      }
      render();
      toast("Backup carregado localmente");

      // opcional: sincronizar com API (melhor esforço)
      const map = {
        clientes: "/api/clientes",
        produtos: "/api/produtos",
        pedidos: "/api/pedidos",
        rotas: "/api/rotas",
        despesas: "/api/despesas",
        lembretes: "/api/lembretes",
        notas: "/api/notas"
      };

      for (const [k, endpoint] of Object.entries(map)) {
        if (!Array.isArray(state[k])) continue;
        for (const item of state[k]) {
          try {
            await api(endpoint, { method: "POST", body: JSON.stringify(item) });
          } catch (e) {
            console.warn("Falha ao restaurar item", k, item?.id, e);
          }
        }
      }

      await refreshState();
      render();
      toast("Restauração concluída (com melhor esforço)");
    } catch (e) {
      console.error(e);
      alert("Arquivo de backup inválido.");
    }
  };
  reader.readAsText(file);
}

function logout(forceRelogin = false) {
  try {
    localStorage.removeItem("sv_token");
    localStorage.removeItem("sv_me");
    // se seu projeto usa outro nome, limpamos também:
    localStorage.removeItem("token");
    localStorage.removeItem("auth_token");
  } catch (_) {}

  if (forceRelogin) {
    alert("Sessão encerrada. Faça login novamente.");
  }
  location.hash = "#dashboard";
  location.reload();
}

function ensureTopActions() {
  // cria barra de ações só uma vez
  if (document.getElementById("sv-top-actions")) return;

  const headerTarget =
    document.querySelector(".topbar") ||
    document.querySelector("header") ||
    document.querySelector(".content") ||
    document.body;

  const wrap = document.createElement("div");
  wrap.id = "sv-top-actions";
  wrap.style.display = "flex";
  wrap.style.gap = "8px";
  wrap.style.flexWrap = "wrap";
  wrap.style.margin = "8px 0 12px 0";
  wrap.style.alignItems = "center";

  wrap.innerHTML = `
    <button id="sv_backup_btn" class="btn">Backup</button>
    <button id="sv_restore_btn" class="btn">Restaurar</button>
    <button id="sv_trocar_btn" class="btn">Trocar usuário</button>
    <button id="sv_sair_btn" class="btn btn-danger">Sair</button>
    <input id="sv_restore_input" type="file" accept=".json,application/json" style="display:none" />
  `;

  // tenta inserir em área principal sem quebrar layout
  if (headerTarget.firstChild) headerTarget.insertBefore(wrap, headerTarget.firstChild);
  else headerTarget.appendChild(wrap);

  const backupBtn = document.getElementById("sv_backup_btn");
  const restoreBtn = document.getElementById("sv_restore_btn");
  const trocarBtn = document.getElementById("sv_trocar_btn");
  const sairBtn = document.getElementById("sv_sair_btn");
  const restoreInput = document.getElementById("sv_restore_input");

  backupBtn.onclick = handleBackup;
  restoreBtn.onclick = () => restoreInput.click();
  restoreInput.onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleRestoreLocal(f);
    e.target.value = "";
  };

  trocarBtn.onclick = () => {
    logout(true);
  };

  sairBtn.onclick = () => {
    if (!confirm("Deseja sair da conta?")) return;
    logout(false);
  };
}
/* ================= BOOT ================= */
window.addEventListener("hashchange", render);

if ($("#q")) $("#q").addEventListener("input", render);

routes.forEach((r) => {
  const b = document.createElement("button");
  b.textContent = r.label;
  b.dataset.route = r.id;
  b.onclick = () => navTo(r.id);
  $(".nav")?.appendChild(b);
});

(async () => {
  await ensureAuth();
  ensureTopActions(); // <-- adiciona botões globais
  await bootstrap();
  render();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
