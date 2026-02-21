import { api, login, me, money, calcMargin, clearToken, getToken } from "./db.js";
import { CONFIG } from "./config.js";

let state=null;
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const routes=[{id:"dashboard",label:"Dashboard"},{id:"clientes",label:"Clientes"},{id:"produtos",label:"Mercadorias"},{id:"pedidos",label:"Pedidos/Vendas"},{id:"rotas",label:"Rotas"},{id:"despesas",label:"Despesas"},{id:"lembretes",label:"Lembretes/Campanhas"},{id:"notas",label:"Anotações"}];
const safe=s=>(s??"").toString().replace(/[<>]/g,"");

function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.style.opacity=1;
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.style.opacity=0,2200);
}
function navTo(id){ location.hash=`#${id}`; }
function getHash(){ return (location.hash||"#dashboard").slice(1); }
function setActiveNav(id){ $$(".nav button").forEach(b=>b.classList.toggle("active", b.dataset.route===id)); }

async function ensureAuth(){
  if(!getToken()){ await loginModal(); return; }
  try{ await me(); }catch(e){ clearToken(); await loginModal(); }
}
async function bootstrap(){ state = await api("/api/bootstrap"); }

async function loginModal(){
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:18px;z-index:99999";
  const box=document.createElement("div");
  box.className="card"; box.style.width="min(520px,100%)";
  box.innerHTML=`
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
  wrap.appendChild(box); document.body.appendChild(wrap);
  $("#lg_api").onclick=()=>{ const u=prompt("Cole a URL do Worker (API):", CONFIG.API_BASE); if(u){ localStorage.setItem("API_BASE", u.trim()); location.reload(); } };
  $("#lg_ok").onclick=async()=>{
    try{
      await login($("#lg_email").value.trim(), $("#lg_senha").value);
      wrap.remove(); await bootstrap(); render(); toast("Logado");
    }catch(e){ alert(e.message||"Falha"); }
  };
}

function render(){
  const id=getHash(); setActiveNav(id);
  $("#pageTitle").textContent = routes.find(r=>r.id===id)?.label || "App";
  const q=$("#q").value.trim().toLowerCase();
  const view=$("#view"); view.innerHTML="";
  if(!state){ view.appendChild(card(`<div class="small">Carregando…</div>`)); return; }

  if(id==="dashboard"){ renderDashboard(view); return; }
  if(id==="clientes"){ renderClientes(view,q); return; }
  if(id==="produtos"){ renderProdutos(view,q); return; }

  view.appendChild(card(`<h3>${safe($("#pageTitle").textContent)}</h3><div class="small">Backend pronto. Se quiser, eu completo as telas restantes no mesmo padrão do módulo Clientes.</div>`));
}

function card(html){ const d=document.createElement("div"); d.className="card"; d.innerHTML=html; return d; }

function renderDashboard(view){
  const pedidosAbertos = state.pedidos.filter(p=>p.status!=="pago");
  const urgentes = pedidosAbertos.filter(p=>p.urgencia==="Alta");
  const estoqueBaixo = state.produtos.filter(p=>Number(p.estoqueAtual||0)<=Number(p.estoqueMin||0));
  view.appendChild(card(`
    <h3>Resumo</h3>
    <div class="grid3">
      <div class="card" style="padding:12px"><div class="small">Clientes</div><div class="v">${state.clientes.length}</div></div>
      <div class="card" style="padding:12px"><div class="small">Pedidos em aberto</div><div class="v">${pedidosAbertos.length}</div><div class="small">Urgentes: ${urgentes.length}</div></div>
      <div class="card" style="padding:12px"><div class="small">Estoque baixo</div><div class="v">${estoqueBaixo.length}</div></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn" id="b_refresh">Recarregar</button>
      <button class="btn" id="b_backup">Backup na nuvem</button>
      <button class="btn danger" id="b_logout">Sair</button>
    </div>
  `));
  $("#b_refresh").onclick=async()=>{ state=await api("/api/bootstrap"); render(); toast("Atualizado"); };
  $("#b_backup").onclick=async()=>{ const r=await api("/api/backup",{method:"POST"}); toast(`Backup: ${r.key}`); };
  $("#b_logout").onclick=()=>{ clearToken(); location.reload(); };
}

function renderClientes(view,q){
  const items = state.clientes.filter(c=>{
    if(!q) return true;
    return (c.nome||"").toLowerCase().includes(q) || (c.telefone||"").includes(q) || (c.cidade||"").toLowerCase().includes(q);
  });
  view.appendChild(card(`
    <h3>Clientes</h3>
    <div class="actions">
      <button class="btn primary" id="c_new">+ Novo cliente</button>
    </div>
    <div class="small" style="margin-top:8px">Total: ${items.length}</div>
  `));
  const table=document.createElement("table"); table.className="table";
  table.innerHTML=`
    <thead><tr><th>ID</th><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Ações</th></tr></thead>
    <tbody>
      ${items.map(c=>`
        <tr>
          <td>${safe(c.id)}</td>
          <td><b>${safe(c.nome)}</b><div class="small">${safe(c.endereco||"")}</div></td>
          <td>${safe(c.telefone||"")}</td>
          <td>${safe(c.cidade||"")}/${safe(c.uf||"")}</td>
          <td>
            <div class="actions">
              <button class="btn" data-edit="${c.id}">Editar</button>
              <button class="btn danger" data-del="${c.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `).join("")}
    </tbody>`;
  view.appendChild(table);

  $("#c_new").onclick=()=> openClienteForm();
  table.querySelectorAll("[data-edit]").forEach(b=> b.onclick=()=> openClienteForm(b.dataset.edit));
  table.querySelectorAll("[data-del]").forEach(b=> b.onclick=async()=>{
    if(confirm("Excluir cliente?")){
      await api(`/api/clientes/${encodeURIComponent(b.dataset.del)}`,{method:"DELETE"});
      state.clientes = state.clientes.filter(x=>x.id!==b.dataset.del);
      toast("Excluído"); render();
    }
  });
}

function openClienteForm(id=null){
  const c = id ? state.clientes.find(x=>x.id===id) : null;
  const modal=openModal("Cliente",`
    <div class="row">
      <div style="grid-column:span 4"><label class="small">ID</label><input id="cid" disabled value="${safe(c?.id||"")}"/></div>
      <div style="grid-column:span 8"><label class="small">Nome *</label><input id="cnome" value="${safe(c?.nome||"")}"/></div>
      <div style="grid-column:span 6"><label class="small">Telefone *</label><input id="ctel" value="${safe(c?.telefone||"")}"/></div>
      <div style="grid-column:span 6"><label class="small">Cidade</label><input id="ccid" value="${safe(c?.cidade||"")}"/></div>
      <div style="grid-column:span 6"><label class="small">UF</label><input id="cuf" value="${safe(c?.uf||"")}"/></div>
      <div style="grid-column:span 12"><label class="small">Endereço</label><input id="cend" value="${safe(c?.endereco||"")}"/></div>
      <div style="grid-column:span 12"><label class="small">Obs</label><textarea id="cobs">${safe(c?.obs||"")}</textarea></div>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="csave">Salvar</button>
      <button class="btn" id="cclose">Fechar</button>
    </div>
  `);
  $("#cclose").onclick=()=>modal.close();
  $("#csave").onclick=async()=>{
    const nome=$("#cnome").value.trim(), tel=$("#ctel").value.trim();
    if(!nome||!tel){ alert("Nome e telefone são obrigatórios."); return; }
    const payload={ id:c?.id||null, nome, telefone:tel, cidade:$("#ccid").value.trim(), uf:$("#cuf").value.trim(), endereco:$("#cend").value.trim(), obs:$("#cobs").value.trim(), tags:[] };
    const saved=await api("/api/clientes",{method:"POST",body:JSON.stringify(payload)});
    const idx=state.clientes.findIndex(x=>x.id===saved.id);
    if(idx>=0) state.clientes[idx]=saved; else state.clientes.unshift(saved);
    toast("Salvo"); modal.close(); render();
  };
}

function renderProdutos(view,q){
  const items = state.produtos.filter(p=>{
    if(!q) return true;
    return (`${p.marca||""} ${p.produto||""} ${p.modelo||""}`).toLowerCase().includes(q);
  });
  view.appendChild(card(`
    <h3>Mercadorias</h3>
    <div class="small">Lista resumida (UI completa pode ser finalizada depois).</div>
    <div class="actions" style="margin-top:10px">
      <button class="btn" id="p_refresh">Recarregar</button>
    </div>
    <ul style="margin-top:10px">${items.slice(0,80).map(p=>{
      const m=calcMargin(p); 
      return `<li style="margin:6px 0"><b>${safe(p.marca||"")}</b> ${safe(p.produto||"")} (${safe(p.modelo||"")}) — <span class="badge">${money(m.margem)}</span></li>`;
    }).join("")}</ul>
  `));
  $("#p_refresh").onclick=async()=>{ state=await api("/api/bootstrap"); render(); toast("Atualizado"); };
}

function openModal(title, innerHTML){
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px;z-index:9999";
  const box=document.createElement("div");
  box.className="card"; box.style.width="min(760px,100%)"; box.style.maxHeight="92vh"; box.style.overflow="auto";
  box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px">
    <div style="font-weight:800;font-size:16px">${safe(title)}</div><button class="btn" id="mx">X</button></div>${innerHTML}`;
  wrap.appendChild(box); document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  box.querySelector("#mx").onclick=close;
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  return { close };
}

window.addEventListener("hashchange", render);
$("#q").addEventListener("input", render);

routes.forEach(r=>{
  const b=document.createElement("button");
  b.textContent=r.label; b.dataset.route=r.id; b.onclick=()=>navTo(r.id);
  $(".nav").appendChild(b);
});

(async()=>{
  await ensureAuth();
  await bootstrap();
  render();
})();

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
