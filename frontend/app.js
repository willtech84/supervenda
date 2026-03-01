(function () {
  const DB = window.DB;

  const state = {
    route: "dashboard",
    cache: { clientes:[], mercadorias:[], pedidos:[], rotas:[], despesas:[], lembretes:[], notas:[] },
    ui: { search: "" },
    lembretesPopupShown: false,
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function moneyBR(v) {
    const n=Number(v||0); return isNaN(n)?String(v??""):n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  }
  function dateFormatBR(v) {
    if(!v) return "";
    try { const d=new Date(v.includes("T")?v:v+"T12:00:00"); return isNaN(d.getTime())?v:d.toLocaleDateString("pt-BR"); } catch{return v;}
  }
  function daysDiff(v) {
    if(!v) return null;
    const d=new Date(v.includes("T")?v:v+"T12:00:00"); if(isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime()-Date.now())/86400000);
  }
  function getId(item) { return item?.id??item?._id??item?.codigo??""; }
  function safeArray(v) { return Array.isArray(v)?v:[]; }
  function downloadJson(fname,data) {
    const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),download:fname});
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // Toast
  function toast(msg,type="info",ms=3500) {
    let w=$("#sv-toast-wrap"); if(!w){w=Object.assign(document.createElement("div"),{id:"sv-toast-wrap"});document.body.appendChild(w);}
    const C={error:["rgba(255,82,82,.12)","#ff5252","✕"],success:["rgba(0,230,118,.10)","#00e676","✓"],warning:["rgba(255,179,0,.10)","#ffb300","!"],info:["rgba(68,136,255,.10)","#4488ff","ℹ"]};
    const [bg,bd,ic]=C[type]||C.info;
    const el=document.createElement("div");
    el.style.cssText=`background:${bg};border:1px solid ${bd};border-radius:10px;padding:10px 14px;font-size:13px;color:#e8eef8;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;pointer-events:auto;animation:fadeUp .2s ease both;`;
    el.innerHTML=`<span style="color:${bd};font-weight:700;">${ic}</span><span>${esc(String(msg||""))}</span>`;
    w.appendChild(el); setTimeout(()=>{el.style.transition="opacity .2s";el.style.opacity="0";setTimeout(()=>el.remove(),220);},ms);
  }

  function setLoading(on,text="Carregando...") {
    const el=$("#sv-loading"),txt=$("#sv-loading-text");
    if(txt) txt.textContent=text; if(el) el.style.display=on?"flex":"none";
  }
  async function runWithUi(fn,text) {
    try{setLoading(true,text||"Processando...");return await fn();}
    catch(e){console.error(e);toast(e?.message||"Erro inesperado","error",5000);throw e;}
    finally{setLoading(false);}
  }

  // Routes
  const ROUTES=[
    {id:"dashboard",   label:"Dashboard",   icon:"📊"},
    {id:"clientes",    label:"Clientes",    icon:"👥", resource:"clientes"},
    {id:"mercadorias", label:"Mercadorias", icon:"📦", resource:"mercadorias"},
    {id:"pedidos",     label:"Pedidos",     icon:"🛒", resource:"pedidos"},
    {id:"rotas",       label:"Rotas",       icon:"🗺️", resource:"rotas"},
    {id:"despesas",    label:"Despesas",    icon:"💸", resource:"despesas"},
    {id:"lembretes",   label:"Lembretes",   icon:"🔔", resource:"lembretes"},
    {id:"anotacoes",   label:"Anotações",   icon:"📝", resource:"notas"},
    {id:"usuarios",    label:"Usuários",    icon:"👤"},
  ];
  const BOTTOM_NAV=["dashboard","clientes","pedidos","mercadorias"];

  function getRoute(id){return ROUTES.find(r=>r.id===id)||ROUTES[0];}
  function navigate(id){
    state.route=getRoute(id).id; state.ui.search=""; state._clienteId=null;
    location.hash="#"+state.route; renderNav(); renderCurrent(); closeSidebar(); closeMoreDrawer();
  }
  window.closeSidebar=()=>{$("#app-sidebar")?.classList.remove("mobile-open");const b=$("#sidebar-backdrop");if(b)b.style.display="none";};
  window.closeMoreDrawer=()=>$("#more-drawer")?.classList.remove("open");

  function pendentesCount(){
    return safeArray(state.cache.lembretes).filter(l=>{const s=String(l.status||"").toLowerCase();return !s.includes("conclu")&&!s.includes("cancel");}).length;
  }

  function renderNav(){
    const nav=$("#sidebar-nav");
    if(nav){
      nav.innerHTML=`<div class="nav-section-label">Menu</div>`+ROUTES.map(r=>`
        <div class="nav-item ${state.route===r.id?"active":""}" data-nav="${esc(r.id)}">
          <span class="nav-item-icon">${r.icon}</span>${esc(r.label)}
          ${r.id==="lembretes"&&pendentesCount()>0?`<span style="margin-left:auto;background:var(--amber);color:#000;border-radius:20px;font-size:10px;font-weight:700;padding:1px 6px;">${pendentesCount()}</span>`:""}
        </div>`).join("");
      $$(".nav-item[data-nav]",nav).forEach(el=>el.addEventListener("click",()=>navigate(el.getAttribute("data-nav"))));
    }
    const bn=$("#bottom-nav-items");
    if(bn){
      bn.innerHTML=BOTTOM_NAV.map(id=>{const r=getRoute(id);return`<div class="bottom-nav-item ${state.route===r.id?"active":""}" data-nav="${esc(r.id)}"><span class="icon">${r.icon}</span><span>${esc(r.label)}</span></div>`;}).join("")+
        `<div class="bottom-nav-item ${!BOTTOM_NAV.includes(state.route)?"active":""}" id="btn-more"><span class="icon">⋯</span><span>Mais</span></div>`;
      $$(".bottom-nav-item[data-nav]",bn).forEach(el=>el.addEventListener("click",()=>navigate(el.getAttribute("data-nav"))));
      $("#btn-more")?.addEventListener("click",openMoreDrawer);
    }
    const mg=$("#more-drawer-grid");
    if(mg){
      mg.innerHTML=ROUTES.filter(r=>!BOTTOM_NAV.includes(r.id)).map(r=>`
        <div class="more-drawer-item ${state.route===r.id?"active":""}" data-nav="${esc(r.id)}">
          <span class="icon">${r.icon}</span>${esc(r.label)}
          ${r.id==="lembretes"&&pendentesCount()>0?`<br><span style="font-size:10px;color:var(--amber);">${pendentesCount()} pendente${pendentesCount()>1?"s":""}</span>`:""}
        </div>`).join("");
      $$(".more-drawer-item[data-nav]",mg).forEach(el=>el.addEventListener("click",()=>navigate(el.getAttribute("data-nav"))));
    }
    const title=$("#topbar-title"); const r=getRoute(state.route);
    if(title) title.textContent=`${r.icon} ${r.label}`;
  }
  function openMoreDrawer(){renderNav();$("#more-drawer")?.classList.add("open");}

  function syncLoginWorkspace(){
    const has=!!DB.getToken();
    $("#login-section")?.classList.toggle("hidden",has);
    $("#workspace-section")?.classList.toggle("hidden",!has);
  }
  function updateUserUI(){
    const u=DB.getUser(); const name=u?.name||u?.email||"Usuário"; const role=u?.role||"seller";
    [["#sidebar-user-name",name],["#btn-user-name",name.split(" ")[0]],["#dropdown-user-name",name],["#dropdown-user-role",role==="admin"?"Administrador":"Vendedor"]]
      .forEach(([s,v])=>{const el=$(s);if(el)el.textContent=v;});
  }

  // Popup lembretes
  function showLembretesPopupIfNeeded(){
    if(state.lembretesPopupShown) return;
    const urgentes=safeArray(state.cache.lembretes).filter(l=>{
      const s=String(l.status||"").toLowerCase();
      if(s.includes("conclu")||s.includes("cancel")) return false;
      const diff=daysDiff(l.data); return diff!==null&&diff<=1;
    });
    if(!urgentes.length) return;
    state.lembretesPopupShown=true;

    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;";
    const panel=document.createElement("div");
    panel.style.cssText="background:var(--bg2);border:1px solid var(--border-hi);border-radius:18px;padding:20px;max-width:380px;width:100%;animation:fadeUp .25s ease both;max-height:80vh;overflow-y:auto;";
    panel.innerHTML=`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <span style="font-size:22px;">🔔</span>
        <div style="font-size:15px;font-weight:700;">Lembretes de hoje</div>
        <button id="popup-close" style="margin-left:auto;background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      ${urgentes.map(l=>{
        const diff=daysDiff(l.data);
        const label=diff===0?"Hoje":diff<0?`${Math.abs(diff)}d atraso`:"Amanhã";
        const color=diff<=0?"var(--red)":"var(--amber)";
        return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
            <div style="font-size:13px;font-weight:600;">${esc(l.titulo||"")}</div>
            <span style="font-size:11px;font-weight:700;color:${color};white-space:nowrap;">${label}</span>
          </div>
          ${l.texto?`<div style="font-size:12px;color:var(--muted);">${esc(l.texto)}</div>`:""}
        </div>`;
      }).join("")}
      <button id="popup-ver" style="width:100%;margin-top:6px;padding:10px;background:var(--green-bg);border:1px solid rgba(0,230,118,.2);border-radius:10px;color:var(--green);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">Ver todos os lembretes</button>
    `;
    overlay.appendChild(panel); document.body.appendChild(overlay);
    overlay.addEventListener("click",e=>{if(e.target===overlay)overlay.remove();});
    panel.querySelector("#popup-close")?.addEventListener("click",()=>overlay.remove());
    panel.querySelector("#popup-ver")?.addEventListener("click",()=>{overlay.remove();navigate("lembretes");});
  }

  // Data
  async function loadResource(resource){
    const apiKey=resource==="anotacoes"?"notas":resource;
    const cacheKey=resource==="anotacoes"?"notas":resource;
    const items=await DB.list(apiKey);
    state.cache[cacheKey]=safeArray(items);
    return state.cache[cacheKey];
  }
  async function preloadAll(){
    await Promise.allSettled(["clientes","mercadorias","pedidos","rotas","despesas","lembretes","notas"].map(r=>loadResource(r).catch(e=>console.warn(r,e))));
  }

  // Schemas
  const URGENCIA_OPTS=["Normal","Baixa","Média","Alta"];
  const STATUS_PEDIDO=["Aberto","Em andamento","Entregue","Cancelado","Pausado"];
  const STATUS_LEMBRETE=["Pendente","Concluído","Cancelado"];

  const SCHEMAS={
    clientes:{
      title:"Clientes",icon:"👥",primaryKey:"nome",
      fields:[
        {key:"nome",label:"Nome *",type:"text",required:true},
        {key:"telefone",label:"Telefone",type:"text"},
        {key:"email",label:"E-mail",type:"email"},
        {key:"cidade",label:"Cidade",type:"text"},
        {key:"endereco",label:"Endereço",type:"text"},
        {key:"bairro",label:"Bairro",type:"text"},
        {key:"cep",label:"CEP",type:"text"},
        {key:"cpfcnpj",label:"CPF / CNPJ",type:"text"},
        {key:"pagamentoPadrao",label:"Pagamento padrão",type:"text"},
        {key:"obs",label:"Observação",type:"textarea"},
      ],
      listFields:[{key:"telefone",label:"Tel"},{key:"cidade",label:"Cidade"}],
    },
    mercadorias:{
      title:"Mercadorias",icon:"📦",primaryKey:"nome",
      fields:[
        {key:"marca",label:"Marca",type:"text"},
        {key:"nome",label:"Produto *",type:"text",required:true},
        {key:"codigo",label:"Código / SKU",type:"text"},
        {key:"categoria",label:"Categoria",type:"text"},
        {key:"valor_compra",label:"Valor compra",type:"money"},
        {key:"valor_venda",label:"Valor venda",type:"money"},
        {key:"estoque",label:"Estoque atual",type:"number"},
        {key:"estoqueMin",label:"Estoque mínimo",type:"number"},
        {key:"descricao",label:"Descrição",type:"textarea"},
      ],
      listFields:[
        {key:"valorVenda",label:"Venda",money:true},
        {key:"estoqueAtual",label:"Estoque",estoqueAlert:true},
      ],
      normalizeOut(item){return{...item,
        nome:item.nome??item.produto??"",
        codigo:item.codigo??item.sku??"",
        valor_compra:item.valor_compra??item.valorCompra??0,
        valor_venda:item.valor_venda??item.valorVenda??0,
        estoque:item.estoque??item.estoqueAtual??0,
        estoqueMin:item.estoqueMin??0,
      };},
      normalizeIn(p){return{...p,produto:p.nome||"",sku:p.codigo||"",valorCompra:p.valor_compra??0,valorVenda:p.valor_venda??0,estoqueAtual:p.estoque??0};},
    },
    pedidos:{
      title:"Pedidos",icon:"🛒",primaryKey:"clienteNome",
      fields:[
        {key:"clienteNome",label:"Cliente *",type:"text",required:true},
        {key:"data",label:"Data",type:"date"},
        {key:"urgencia",label:"Urgência",type:"select",options:URGENCIA_OPTS},
        {key:"formaPagamento",label:"Forma pagamento",type:"text"},
        {key:"total",label:"Total (R$)",type:"money"},
        {key:"status",label:"Status",type:"select",options:STATUS_PEDIDO},
        {key:"obs",label:"Observação",type:"textarea"},
      ],
      listFields:[
        {key:"urgencia",label:"Urgência",urgencia:true},
        {key:"status",label:"Status",badge:true},
        {key:"total",label:"Total",money:true},
        {key:"data",label:"Data",date:true},
      ],
    },
    rotas:{
      title:"Rotas",icon:"🗺️",primaryKey:"obs",
      fields:[{key:"data",label:"Data",type:"date"},{key:"obs",label:"Roteiro *",type:"textarea",required:true}],
      listFields:[{key:"data",label:"Data",date:true}],
    },
    despesas:{
      title:"Despesas",icon:"💸",primaryKey:"categoria",
      fields:[
        {key:"data",label:"Data *",type:"date"},
        {key:"categoria",label:"Categoria *",type:"text",required:true},
        {key:"valor",label:"Valor (R$)",type:"money",required:true},
        {key:"pagamento",label:"Pagamento",type:"text"},
        {key:"obs",label:"Observação",type:"textarea"},
      ],
      listFields:[{key:"valor",label:"Valor",money:true},{key:"pagamento",label:"Pagamento"},{key:"data",label:"Data",date:true}],
    },
    lembretes:{
      title:"Lembretes",icon:"🔔",primaryKey:"titulo",
      fields:[
        {key:"titulo",label:"Título *",type:"text",required:true},
        {key:"tipo",label:"Tipo",type:"text"},
        {key:"data",label:"Data",type:"date"},
        {key:"texto",label:"Mensagem",type:"textarea"},
        {key:"status",label:"Status",type:"select",options:STATUS_LEMBRETE},
      ],
      listFields:[
        {key:"status",label:"Status",badge:true},
        {key:"data",label:"Data",date:true,dateAlert:true},
      ],
    },
    notas:{
      title:"Anotações",icon:"📝",primaryKey:"titulo",
      fields:[
        {key:"titulo",label:"Título *",type:"text",required:true},
        {key:"texto",label:"Anotação",type:"textarea"},
        {key:"fixada",label:"Fixar nota",type:"checkbox"},
      ],
      listFields:[{key:"fixada",label:"",fixada:true},{key:"texto",label:"",trunc:true}],
    },
  };

  function normalizeItem(resource,item){if(!item)return item;const s=SCHEMAS[resource];return s?.normalizeOut?s.normalizeOut(item):item;}
  function normalizeForSubmit(resource,payload){const s=SCHEMAS[resource];return s?.normalizeIn?s.normalizeIn(payload):payload;}

  // ─── Detalhes do cliente ─────────────────────────────────────────────────────
  function renderClienteDetalhes(root, clienteId) {
    const cliente = safeArray(state.cache.clientes).find(c => String(getId(c)) === String(clienteId));
    if (!cliente) { navigate("clientes"); return; }

    const pedidosCli = safeArray(state.cache.pedidos).filter(p =>
      String(p.clienteId) === String(clienteId) || String(p.clienteNome||"").toLowerCase() === String(cliente.nome||"").toLowerCase()
    );
    const totalGasto = pedidosCli.reduce((a,p)=>a+Number(p.total||0),0);
    const abertos = pedidosCli.filter(p=>{const s=String(p.status||"").toLowerCase();return !s||s==="aberto"||s==="em andamento"||s==="pendente";});
    const ultimoPedido = pedidosCli.sort((a,b)=>String(b.created_at||b.data||"").localeCompare(String(a.created_at||a.data||"")))[0];

    // Produtos mais comprados
    const prodCount = {};
    pedidosCli.forEach(p => {
      const itens = Array.isArray(p.itens) ? p.itens : [];
      itens.forEach(it => {
        const nome = it.nome || it.produto || it.descricao || "";
        if (nome) prodCount[nome] = (prodCount[nome]||0) + Number(it.qtd||it.quantidade||1);
      });
    });
    const topProd = Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <button id="btn-back-clientes" class="btn btn-ghost" style="font-size:13px;padding:8px 12px;">← Voltar</button>
        <div style="font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cliente.nome||"")}</div>
      </div>

      <!-- Resumo financeiro -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
        <div class="stat-card">
          <div class="stat-icon">💰</div>
          <div class="stat-label">Total gasto</div>
          <div style="font-size:16px;font-weight:700;color:var(--green);line-height:1.2;">${moneyBR(totalGasto)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🛒</div>
          <div class="stat-label">Pedidos</div>
          <div class="stat-value" style="color:var(--blue);">${pedidosCli.length}</div>
        </div>
        <div class="stat-card" style="${abertos.length?'border-color:rgba(255,179,0,.3);':''}">
          <div class="stat-icon">⏳</div>
          <div class="stat-label">Em aberto</div>
          <div class="stat-value" style="color:var(--amber);">${abertos.length}</div>
        </div>
      </div>

      <!-- Info do cliente -->
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">📋 Dados do cliente</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
          ${[
            ["Telefone", cliente.telefone, "📞"],
            ["Cidade", cliente.cidade ? `${cliente.cidade}${cliente.uf?" - "+cliente.uf:""}` : "", "📍"],
            ["Endereço", cliente.endereco ? `${cliente.endereco}${cliente.numero?" "+cliente.numero:""}${cliente.bairro?", "+cliente.bairro:""}` : "", "🏠"],
            ["CPF/CNPJ", cliente.cpfcnpj, "📄"],
            ["Pagamento", cliente.pagamentoPadrao, "💳"],
            ["Último pedido", ultimoPedido ? `${dateFormatBR(ultimoPedido.data||ultimoPedido.created_at)}` : "—", "📅"],
          ].filter(([,v])=>v).map(([l,v,ic])=>`
            <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px;">
              <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">${ic} ${esc(l)}</div>
              <div style="font-size:13px;font-weight:500;">${esc(v)}</div>
            </div>`).join("")}
        </div>
        ${cliente.obs?`<div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:10px;border:1px solid var(--border);font-size:13px;color:var(--muted);">${esc(cliente.obs)}</div>`:""}
        <div style="margin-top:10px;">
          <button id="btn-editar-cliente" class="btn btn-secondary" style="font-size:13px;">✏️ Editar cliente</button>
        </div>
      </div>

      <!-- Produtos mais comprados -->
      ${topProd.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">📦 Produtos mais comprados</div>
        ${topProd.map(([nome,qtd])=>`
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div style="font-size:13px;font-weight:500;">${esc(nome)}</div>
            <span class="badge badge-blue">${qtd}x</span>
          </div>`).join("")}
      </div>`:""}

      <!-- Histórico de pedidos -->
      ${pedidosCli.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">🛒 Histórico de pedidos</div>
        ${pedidosCli.slice(0,10).map(p=>{
          const s=String(p.status||"Aberto");
          const urgColor=urgenciaColor(p.urgencia);
          return`<div style="padding:10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <div>
                <span class="badge ${getBadgeClass(s)}" style="margin-right:6px;">${esc(s)}</span>
                ${p.urgencia&&p.urgencia!=="Normal"?`<span style="font-size:11px;font-weight:700;color:${urgColor};">▲${esc(p.urgencia)}</span>`:""}
              </div>
              <div style="font-size:13px;font-weight:700;color:var(--green);">${moneyBR(p.total)}</div>
            </div>
            <div style="margin-top:6px;font-size:12px;color:var(--muted);display:flex;gap:12px;flex-wrap:wrap;">
              ${p.data?`<span>📅 ${dateFormatBR(p.data)}</span>`:""}
              ${p.formaPagamento?`<span>💳 ${esc(p.formaPagamento)}</span>`:""}
              <span style="color:var(--muted2);font-family:var(--mono);font-size:11px;">${esc(p.id||"")}</span>
            </div>
            ${p.obs?`<div style="margin-top:6px;font-size:12px;color:var(--muted);">${esc(p.obs)}</div>`:""}
          </div>`;
        }).join("")}
        ${pedidosCli.length>10?`<div style="text-align:center;font-size:12px;color:var(--muted);padding-top:4px;">Exibindo 10 de ${pedidosCli.length} pedidos</div>`:""}
      </div>`:`
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <div class="empty-text">Nenhum pedido encontrado para este cliente.</div>
        </div>
      </div>`}
    `;

    $("#btn-back-clientes")?.addEventListener("click", () => navigate("clientes"));
    $("#btn-editar-cliente")?.addEventListener("click", () => {
      navigate("clientes");
      setTimeout(() => {
        const rawItems = safeArray(state.cache.clientes);
        renderForm("clientes", rawItems.find(c => String(getId(c)) === String(clienteId)) || null);
        setTimeout(() => $("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"}), 80);
      }, 100);
    });
  }

  // Render current
  function renderCurrent(){
    const root=$("#sv-screen-root"); if(!root||!DB.getToken()) return;
    updateUserUI(); renderNav();
    const route=getRoute(state.route);
    if(route.id==="dashboard"){renderDashboard(root);return;}
    if(route.id==="usuarios"){renderUsersScreen(root);return;}
    if(state._clienteId){renderClienteDetalhes(root,state._clienteId);return;}
    if(route.resource&&SCHEMAS[route.resource]){renderCrudScreen(root,route.resource);return;}
    root.innerHTML=`<div class="card"><p style="color:var(--muted);">Tela em preparação.</p></div>`;
  }

  // Dashboard
  function renderDashboard(root){
    const u=DB.getUser();
    const pedidos=safeArray(state.cache.pedidos);
    // Pedidos ativos = não cancelados
    const pedidosAtivos=pedidos.filter(p=>{const s=String(p.status||"").toLowerCase();return !s.includes("cancel");});
    const abertos=pedidosAtivos.filter(p=>{const s=String(p.status||"").toLowerCase();return !s||s==="aberto"||s==="em andamento"||s==="pendente";});
    // Total de vendas = só pedidos entregues/pagos/concluídos
    const totalVendas=pedidosAtivos.filter(p=>{const s=String(p.status||"").toLowerCase();return s.includes("entregue")||s.includes("pago")||s.includes("conclu")||s==="";}).reduce((a,p)=>a+Number(p.total||0),0);
    const despesas=safeArray(state.cache.despesas);
    const totalDespesas=despesas.reduce((a,d)=>a+Number(d.valor||0),0);
    const lemPendentes=safeArray(state.cache.lembretes).filter(l=>{const s=String(l.status||"").toLowerCase();return !s.includes("conclu")&&!s.includes("cancel");});
    const estoqueBaixo=safeArray(state.cache.mercadorias).filter(m=>{const atual=Number(m.estoqueAtual??m.estoque??0),min=Number(m.estoqueMin??0);return min>0&&atual<=min;});

    const stats=[
      {label:"Clientes",value:state.cache.clientes.length,icon:"👥",color:"#4488ff",nav:"clientes"},
      {label:"Mercadorias",value:state.cache.mercadorias.length,icon:"📦",color:"#00e676",nav:"mercadorias"},
      {label:"Pedidos",value:pedidos.length,icon:"🛒",color:"#ffb300",nav:"pedidos"},
      {label:"Despesas",value:despesas.length,icon:"💸",color:"#ff5252",nav:"despesas"},
    ];

    root.innerHTML=`
      <div class="card" style="background:linear-gradient(135deg,rgba(0,230,118,.06) 0%,rgba(68,136,255,.04) 100%);border-color:rgba(0,230,118,.12);">
        <div style="font-size:13px;color:var(--muted);margin-bottom:2px;">Olá,</div>
        <div style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">${esc((u?.name||"Vendedor").split(" ")[0])} 👋</div>
      </div>

      <div class="stats-grid">
        ${stats.map(s=>`<div class="stat-card" style="cursor:pointer;" onclick="SuperVendaApp.navigate('${s.nav}')">
          <div class="stat-icon">${s.icon}</div>
          <div class="stat-label">${esc(s.label)}</div>
          <div class="stat-value" style="color:${s.color}">${s.value}</div>
        </div>`).join("")}
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">💰 Financeiro</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div style="background:var(--bg2);border-radius:10px;padding:12px;border:1px solid var(--border);">
            <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">Pedidos abertos</div>
            <div style="font-size:22px;font-weight:700;color:var(--amber);">${abertos.length}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:12px;border:1px solid var(--border);">
            <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">Total vendas</div>
            <div style="font-size:13px;font-weight:700;color:var(--green);">${moneyBR(totalVendas)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:12px;border:1px solid var(--border);">
            <div style="font-size:10px;color:var(--muted);margin-bottom:3px;">Despesas</div>
            <div style="font-size:13px;font-weight:700;color:var(--red);">${moneyBR(totalDespesas)}</div>
          </div>
        </div>
      </div>

      ${abertos.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">🛒 Pedidos em aberto (${abertos.length})</div>
        ${abertos.slice(0,5).map(p=>{
          const urg=String(p.urgencia||"Normal");
          const urgColor=urg==="Alta"?"var(--red)":urg==="Média"?"var(--amber)":urg==="Baixa"?"var(--blue)":"var(--muted)";
          return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;" onclick="SuperVendaApp.navigate('pedidos')">
            <div><div style="font-size:13px;font-weight:600;">${esc(p.clienteNome||"")}</div>${p.data?`<div style="font-size:11px;color:var(--muted);">${dateFormatBR(p.data)}</div>`:""}</div>
            <div style="text-align:right;flex-shrink:0;"><div style="font-size:13px;font-weight:600;color:var(--green);">${moneyBR(p.total)}</div><div style="font-size:11px;font-weight:600;color:${urgColor};">${esc(urg)}</div></div>
          </div>`;
        }).join("")}
        ${abertos.length>5?`<div style="text-align:center;font-size:12px;color:var(--muted);padding-top:4px;">+${abertos.length-5} pedidos</div>`:""}
      </div>`:""}

      ${lemPendentes.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">🔔 Lembretes pendentes (${lemPendentes.length})</div>
        ${lemPendentes.slice(0,4).map(l=>{
          const diff=daysDiff(l.data),isU=diff!==null&&diff<=1;
          return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid ${isU?"var(--red)":"var(--border)"};margin-bottom:6px;cursor:pointer;" onclick="SuperVendaApp.navigate('lembretes')">
            <div style="font-size:13px;font-weight:600;">${esc(l.titulo||"")}</div>
            ${l.data?`<div style="font-size:11px;font-weight:600;color:${isU?"var(--red)":"var(--muted)"};">${dateFormatBR(l.data)}</div>`:""}
          </div>`;
        }).join("")}
      </div>`:""}

      ${estoqueBaixo.length?`
      <div class="card" style="border-color:rgba(255,179,0,.15);">
        <div class="card-title" style="margin-bottom:10px;color:var(--amber);">⚠️ Estoque baixo (${estoqueBaixo.length})</div>
        ${estoqueBaixo.slice(0,5).map(m=>{
          const nome=m.nome||m.produto||"";
          return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div style="font-size:13px;font-weight:600;">${esc(nome)}</div>
            <div style="font-size:12px;color:var(--amber);font-weight:600;">Est:${m.estoqueAtual??m.estoque??0}/Mín:${m.estoqueMin??0}</div>
          </div>`;
        }).join("")}
      </div>`:""}
    `;
  }

  // CRUD screen
  function renderCrudScreen(root,resource){
    const schema=SCHEMAS[resource];
    const cacheKey=resource;
    const rawItems=safeArray(state.cache[cacheKey]);

    function getFiltered(){
      const q=String(state.ui.search||"").trim().toLowerCase();
      const items=rawItems.map(it=>normalizeItem(resource,it));
      return !q?items:items.filter(it=>Object.values(it||{}).some(v=>String(v??"").toLowerCase().includes(q)));
    }

    root.innerHTML=`
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="search-wrap" style="flex:1;min-width:150px;">
            <span class="search-icon">🔍</span>
            <input id="sv-search-input" type="search" placeholder="Buscar..." value="${esc(state.ui.search)}" autocomplete="off" />
          </div>
          <button id="sv-new-btn" class="btn btn-primary" style="width:auto;">+ Novo</button>
          <button id="sv-refresh-btn" class="btn btn-secondary btn-icon" title="Atualizar">↻</button>
        </div>
        <div id="sv-count" style="margin-top:6px;font-size:12px;color:var(--muted);">${getFiltered().length} registro${getFiltered().length!==1?"s":""}</div>
      </div>
      <div id="sv-form-wrap"></div>
      <div id="sv-list-wrap"></div>`;

    // Busca instantânea — ao digitar a primeira letra já filtra
    const searchInput=$("#sv-search-input");
    if(searchInput){
      searchInput.focus();
      searchInput.addEventListener("input",e=>{
        state.ui.search=e.target.value||"";
        const f=getFiltered();
        const cnt=$("#sv-count");
        if(cnt) cnt.textContent=`${f.length} registro${f.length!==1?"s":""}`;
        renderList(resource,f,rawItems);
      });
    }

    $("#sv-new-btn")?.addEventListener("click",()=>{renderForm(resource,null);setTimeout(()=>$("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"}),60);});
    $("#sv-refresh-btn")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{await loadResource(resource);renderCrudScreen(root,resource);toast("Atualizado.","success");},"Atualizando...");
    });
    renderList(resource,getFiltered(),rawItems);
  }

  function urgenciaColor(v){const s=String(v||"").toLowerCase();return s==="alta"?"var(--red)":s==="média"?"var(--amber)":s==="baixa"?"var(--blue)":"var(--muted)";}

  function renderList(resource,items,rawItems){
    const wrap=$("#sv-list-wrap"),schema=SCHEMAS[resource]; if(!wrap) return;
    if(!items.length){wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">${schema.icon}</div><div class="empty-text">Nenhum registro encontrado.<br>Clique em "+ Novo" para adicionar.</div></div>`;return;}

    wrap.innerHTML=items.map(item=>{
      const id=getId(item);
      const pv=item[schema.primaryKey]||item.nome||item.titulo||id;
      const metaHtml=(schema.listFields||[]).map(f=>{
        const v=item[f.key];
        if(f.fixada) return v?`<span style="font-size:11px;color:var(--amber);">📌 Fixada</span>`:"";
        if(f.trunc)  return v?`<span style="font-size:12px;color:var(--muted);">${esc(String(v).slice(0,80))}${String(v).length>80?"…":""}</span>`:"";
        if(f.money)  return (!v&&v!==0)?"":`<span style="font-size:13px;font-weight:600;color:var(--green);">${moneyBR(v)}</span>`;
        if(f.urgencia){const col=urgenciaColor(v);return`<span style="font-size:11px;font-weight:700;color:${col};">▲ ${esc(v||"Normal")}</span>`;}
        if(f.badge)  return !v?"":`<span class="badge ${getBadgeClass(v)}">${esc(v)}</span>`;
        if(f.estoqueAlert){const min=Number(item.estoqueMin||0),alerta=min>0&&Number(v||0)<=min;return`<span style="font-size:12px;color:${alerta?"var(--amber)":"var(--muted)"};">${alerta?"⚠️ ":""}Est:${esc(String(v??0))}</span>`;}
        if(f.date){
          if(!v) return "";
          const diff=daysDiff(v),isA=f.dateAlert&&diff!==null&&diff<=1;
          const color=isA?(diff<0?"var(--red)":"var(--amber)"):"var(--muted)";
          const label=isA&&diff===0?"Hoje!":isA&&diff<0?`${Math.abs(diff)}d atraso`:dateFormatBR(v);
          return`<span style="font-size:12px;color:${color};font-weight:${isA?"700":"400"};">${label}</span>`;
        }
        return !v?"":`<span style="font-size:12px;color:var(--muted);">${esc(f.label)}: <strong style="color:var(--text);">${esc(String(v))}</strong></span>`;
      }).filter(Boolean).join(" &nbsp;");

      const clickable = resource==="clientes";
      return`<div class="list-item">
        <div class="list-item-top">
          <div class="list-item-title" ${clickable?`data-cliente-id="${esc(id)}" style="cursor:pointer;color:var(--green);text-decoration:underline;text-decoration-style:dotted;"`:""}>${esc(String(pv||""))}</div>
          <span class="badge badge-muted" style="font-size:10px;">${esc(id)}</span>
        </div>
        ${metaHtml?`<div style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">${metaHtml}</div>`:""}
        <div class="list-item-actions">
          ${clickable?`<button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-cliente-ver="${esc(id)}">👁 Ver detalhes</button>`:""}
          <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-action="edit" data-id="${esc(id)}">✏️ Editar</button>
          <button class="btn btn-danger" style="font-size:13px;padding:7px 14px;" data-action="delete" data-id="${esc(id)}">🗑️</button>
        </div>
      </div>`;
    }).join("");

    // Click no nome ou botão "Ver detalhes" do cliente
    $$("[data-cliente-id],[data-cliente-ver]",wrap).forEach(el=>{
      el.addEventListener("click",()=>{
        const id=el.getAttribute("data-cliente-id")||el.getAttribute("data-cliente-ver");
        state._clienteId=id;
        renderCurrent();
        $("#sv-screen-root")?.scrollIntoView({behavior:"smooth",block:"start"});
      });
    });

    $$("[data-action='edit']",wrap).forEach(btn=>{
      btn.addEventListener("click",()=>{
        const id=btn.getAttribute("data-id");
        const item=rawItems.find(x=>String(getId(x))===String(id));
        renderForm(resource,item||null);
        setTimeout(()=>$("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"}),60);
      });
    });
    $$("[data-action='delete']",wrap).forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const id=btn.getAttribute("data-id");
        if(!id||!confirm("Excluir este registro?")) return;
        const apiR=resource==="anotacoes"?"notas":resource;
        await runWithUi(async()=>{await DB.remove(apiR,id);await loadResource(resource);renderCurrent();toast("Excluído.","success");},"Excluindo...");
      });
    });
  }

  function getBadgeClass(status){
    if(!status) return "badge-muted"; const s=String(status).toLowerCase();
    if(s.includes("conclu")||s.includes("entregue")||s.includes("pago")) return "badge-green";
    if(s.includes("cancel")||s.includes("atraso")) return "badge-red";
    if(s.includes("aberto")||s.includes("pendente")||s.includes("andamento")) return "badge-amber";
    return "badge-blue";
  }

  // Form field
  function renderField(f,value){
    const v=value??"";
    const base=`style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;text-transform:${f.type==="email"||f.type==="money"||f.type==="number"||f.type==="date"?"none":"uppercase"};"`;
    if(f.type==="checkbox") return`<div class="field" style="display:flex;align-items:center;gap:10px;"><input type="checkbox" name="${esc(f.key)}" id="cb-${esc(f.key)}" ${v?"checked":""} style="width:18px;height:18px;accent-color:var(--green);cursor:pointer;"/><label for="cb-${esc(f.key)}" style="font-size:14px;cursor:pointer;">${esc(f.label)}</label></div>`;
    if(f.type==="textarea") return`<div class="field"><label>${esc(f.label)}</label><textarea name="${esc(f.key)}" rows="3" ${base} style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;text-transform:uppercase;resize:vertical;">${esc(v)}</textarea></div>`;
    if(f.type==="select"){const opts=(f.options||[]).map(o=>`<option value="${esc(o)}" ${String(v)===o?"selected":""}>${esc(o)}</option>`).join("");return`<div class="field"><label>${esc(f.label)}</label><select name="${esc(f.key)}" style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;">${opts}</select></div>`;}
    if(f.type==="money"){const n=Number(v||0);const d=isNaN(n)||n===0?"":n.toFixed(2).replace(".",",");return`<div class="field"><label>${esc(f.label)}</label><input type="text" inputmode="decimal" name="${esc(f.key)}" value="${esc(d)}" placeholder="0,00" style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;"/></div>`;}
    let out=v;
    if(f.type==="date"&&v){try{const d=new Date(v.includes("T")?v:v+"T12:00:00");if(!isNaN(d.getTime()))out=d.toISOString().slice(0,10);}catch{}}
    const type=f.type==="number"?"number":f.type==="date"?"date":f.type==="email"?"email":"text";
    // Email sem uppercase, números e datas sem uppercase
    const noUpper=type==="email"||type==="number"||type==="date";
    const inputStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;${noUpper?"":"text-transform:uppercase;"}`;
    return`<div class="field"><label>${esc(f.label)}</label><input type="${type}" name="${esc(f.key)}" value="${esc(noUpper?out:String(out).toUpperCase())}" style="${inputStyle}"/></div>`;
  }

  function formToPayload(form,fields){
    const fd=new FormData(form),payload={};
    fields.forEach(f=>{
      if(f.type==="checkbox"){payload[f.key]=form.querySelector(`[name="${f.key}"]`)?.checked?1:0;return;}
      let v=fd.get(f.key); if(typeof v==="string") v=v.trim();
      if(f.type==="money"||f.type==="number") payload[f.key]=v===""||v==null?0:(Number(String(v).replace(",","."))||0);
      else if(f.type==="email"||f.type==="date") payload[f.key]=v??"";
      else payload[f.key]=v?String(v).toUpperCase():"";
    });
    return payload;
  }

  function renderForm(resource,item){
    const wrap=$("#sv-form-wrap"); if(!wrap) return;
    const schema=SCHEMAS[resource];
    const isEdit=!!item;
    const itemView=normalizeItem(resource,item||{});
    const itemId=isEdit?getId(item):"";
    const apiR=resource==="anotacoes"?"notas":resource;

    wrap.innerHTML=`
      <div class="form-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"➕ Novo"} ${esc(schema.title)}</div>
          <button id="sv-close-form" class="btn btn-ghost btn-icon">✕</button>
        </div>
        <form id="sv-crud-form">
          <div class="form-grid">${schema.fields.map(f=>renderField(f,itemView?.[f.key])).join("")}</div>
          ${isEdit&&resource==="mercadorias"?`
          <div style="margin-bottom:14px;padding:12px;background:var(--blue-bg);border:1px solid rgba(68,136,255,.2);border-radius:10px;">
            <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:8px;">⚡ Ajustar preço de venda por %</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="sv-pct-input" type="number" step="0.1" placeholder="Ex: 10 ou -5" style="flex:1;min-width:120px;padding:9px 12px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;" />
              <button type="button" id="sv-pct-apply" class="btn btn-secondary" style="white-space:nowrap;">Aplicar %</button>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;">Positivo = aumento · Negativo = desconto · Atualiza o campo "Valor venda" acima</div>
          </div>`:""}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Criar"}</button>
            ${isEdit?`<button type="button" id="sv-delete-current" class="btn btn-danger">🗑️ Excluir</button>`:""}
            <button type="button" id="sv-cancel-form" class="btn btn-ghost">Cancelar</button>
          </div>
        </form>
      </div>`;

    $$("input,select,textarea",wrap).forEach(el=>{
      el.addEventListener("focus",()=>{el.style.outline="none";el.style.borderColor="var(--green-dim)";el.style.boxShadow="0 0 0 3px rgba(0,230,118,.08)";});
      el.addEventListener("blur",()=>{el.style.borderColor="var(--border-hi)";el.style.boxShadow="none";});
    });

    // Ajuste % mercadorias
    $("#sv-pct-apply")?.addEventListener("click",()=>{
      const pct=Number(String($("#sv-pct-input")?.value||"").replace(",","."));
      if(isNaN(pct)||pct===0){toast("Informe um percentual válido (ex: 10 ou -5).","warning");return;}
      const vendaInput=wrap.querySelector("[name='valor_venda']");
      if(!vendaInput){toast("Campo valor venda não encontrado.","error");return;}
      const current=Number(String(vendaInput.value||"0").replace(",","."));
      if(isNaN(current)||current<=0){toast("Preencha o valor de venda antes de aplicar %.","warning");return;}
      const novo=current*(1+pct/100);
      vendaInput.value=novo.toFixed(2).replace(".",",");
      toast(`✅ Preço ajustado em ${pct>0?"+":""}${pct}%: ${moneyBR(novo)}`,"success");
    });
    $("#sv-close-form")?.addEventListener("click",()=>{wrap.innerHTML="";});
    $("#sv-cancel-form")?.addEventListener("click",()=>{wrap.innerHTML="";});

    $("#sv-crud-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      let payload=formToPayload(e.currentTarget,schema.fields);
      payload=normalizeForSubmit(resource,payload);
      const missing=schema.fields.find(f=>f.required&&!String(payload[f.key]??"").trim());
      if(missing){toast(`Preencha: ${missing.label.replace(" *","")}`, "warning");return;}
      await runWithUi(async()=>{
        if(isEdit) await DB.update(apiR,itemId,payload);
        else       await DB.create(apiR,payload);
        await loadResource(resource);
        wrap.innerHTML=""; renderCurrent();
        toast(isEdit?"✅ Atualizado.":"✅ Salvo.","success");
      },"Salvando...");
    });

    if(isEdit){
      $("#sv-delete-current")?.addEventListener("click",async()=>{
        if(!confirm("Excluir este registro?")) return;
        await runWithUi(async()=>{await DB.remove(apiR,itemId);await loadResource(resource);wrap.innerHTML="";renderCurrent();toast("✅ Excluído.","success");},"Excluindo...");
      });
    }
  }

  // Users
  async function renderUsersScreen(root){
    const user=DB.getUser();
    if(!user||user.role!=="admin"){root.innerHTML=`<div class="card"><div class="card-title">👤 Usuários</div><p style="color:var(--red);font-size:14px;margin-top:8px;">Acesso restrito ao administrador.</p></div>`;return;}
    let users=[];
    try{users=safeArray(await DB.listUsers());}catch(e){root.innerHTML=`<div class="card"><div class="card-title">👤 Usuários</div><p style="color:var(--red);font-size:14px;margin-top:8px;">${esc(e?.message||"Falha")}</p></div>`;return;}
    const base=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;`;
    root.innerHTML=`
      <div class="card">
        <div class="card-header">
          <div class="card-title">👤 Usuários</div>
          <div style="display:flex;gap:6px;"><button id="sv-user-new" class="btn btn-primary" style="width:auto;">+ Novo</button><button id="sv-user-refresh" class="btn btn-secondary btn-icon">↻</button></div>
        </div>
        <div style="font-size:12px;color:var(--muted);">${users.length} usuário${users.length!==1?"s":""}</div>
      </div>
      <div id="sv-users-form-wrap"></div>
      <div id="sv-users-list">
        ${users.length?users.map(u=>`
          <div class="list-item">
            <div class="list-item-top">
              <div><div class="list-item-title">${esc(u.name||"")}</div><div style="font-size:12px;color:var(--muted);margin-top:2px;">${esc(u.email||"")}</div></div>
              <span class="badge ${u.role==="admin"?"badge-blue":"badge-muted"}">${esc(u.role||"seller")}</span>
            </div>
            <div class="list-item-meta">
              <span class="meta-item">Ativo: <strong style="color:${Number(u.active)?"var(--green)":"var(--red)"}">${Number(u.active)?"Sim":"Não"}</strong></span>
              ${u.created_at?`<span class="meta-item">Desde: <strong>${dateFormatBR(u.created_at)}</strong></span>`:""}
            </div>
            <div class="list-item-actions"><button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-user-edit="${esc(u.id||"")}">✏️ Editar</button></div>
          </div>`).join(""):`<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">Nenhum usuário.</div></div>`}
      </div>`;

    const fw=$("#sv-users-form-wrap");
    function renderUserForm(item){
      const isEdit=!!item;
      fw.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"➕ Novo"} usuário</div>
            <button id="sv-user-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          <form id="sv-user-form">
            <div class="form-grid">
              <div class="field"><label>Nome *</label><input name="name" value="${esc(item?.name||"")}" placeholder="Nome completo" style="${base}"/></div>
              <div class="field"><label>E-mail *</label><input name="email" type="email" value="${esc(item?.email||"")}" style="${base}"/></div>
              <div class="field"><label>Perfil</label><select name="role" style="${base}"><option value="seller" ${(item?.role||"seller")==="seller"?"selected":""}>Vendedor</option><option value="admin" ${(item?.role||"seller")==="admin"?"selected":""}>Administrador</option></select></div>
              <div class="field"><label>Ativo</label><select name="active" style="${base}"><option value="1" ${Number(item?.active??1)?"selected":""}>Sim</option><option value="0" ${!Number(item?.active??1)?"selected":""}>Não</option></select></div>
              <div class="field"><label>${isEdit?"Nova senha (opcional)":"Senha *"}</label><input name="password" type="password" placeholder="${isEdit?"Deixe em branco para manter":"Senha"}" style="${base}"/></div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Criar"}</button>
              <button type="button" id="sv-user-cancel" class="btn btn-ghost">Cancelar</button>
            </div>
          </form>
        </div>`;
      setTimeout(()=>fw?.scrollIntoView({behavior:"smooth",block:"start"}),60);
      $("#sv-user-close")?.addEventListener("click",()=>{fw.innerHTML="";});
      $("#sv-user-cancel")?.addEventListener("click",()=>{fw.innerHTML="";});
      $("#sv-user-form")?.addEventListener("submit",async e=>{
        e.preventDefault();const fd=new FormData(e.currentTarget);
        const p={name:String(fd.get("name")||"").trim(),email:String(fd.get("email")||"").trim(),role:String(fd.get("role")||"seller"),active:Number(fd.get("active")||1),password:String(fd.get("password")||"")};
        if(!p.name) return toast("Nome obrigatório.","warning");
        if(!p.email) return toast("E-mail obrigatório.","warning");
        if(!isEdit&&!p.password) return toast("Senha obrigatória.","warning");
        await runWithUi(async()=>{
          if(isEdit){if(!p.password) delete p.password;await DB.updateUser(item.id,p);}else await DB.createUser(p);
          toast(`✅ Usuário ${isEdit?"atualizado":"criado"}.`,"success");await renderUsersScreen(root);
        },isEdit?"Salvando...":"Criando...");
      });
    }
    $("#sv-user-new")?.addEventListener("click",()=>renderUserForm(null));
    $("#sv-user-refresh")?.addEventListener("click",async()=>{await runWithUi(()=>renderUsersScreen(root),"Atualizando...");});
    $$("[data-user-edit]").forEach(btn=>{btn.addEventListener("click",()=>{const id=btn.getAttribute("data-user-edit");const u=users.find(x=>String(x.id)===String(id));if(u)renderUserForm(u);});});
  }

  // Shell
  function bindShell(){
    $("#menu-toggle")?.addEventListener("click",()=>{$("#app-sidebar")?.classList.add("mobile-open");const b=$("#sidebar-backdrop");if(b)b.style.display="block";});
    $("#sidebar-backup-btn")?.addEventListener("click",doBackup);
    $("#sidebar-logout-btn")?.addEventListener("click",doLogout);

    // Modo claro/escuro
    const themeBtn=$("#btn-theme");
    function applyTheme(light){
      document.body.classList.toggle("light-mode",light);
      if(themeBtn) themeBtn.textContent=light?"🌙":"☀️";
      if(themeBtn) themeBtn.title=light?"Modo escuro":"Modo claro";
      try{localStorage.setItem("sv_theme",light?"light":"dark");}catch{}
    }
    const savedTheme=()=>{try{return localStorage.getItem("sv_theme");}catch{return null;}};
    applyTheme(savedTheme()==="light");
    themeBtn?.addEventListener("click",()=>applyTheme(!document.body.classList.contains("light-mode")));
    const btnUser=$("#btn-user"),dropdown=$("#user-dropdown");
    if(btnUser&&dropdown){
      btnUser.addEventListener("click",e=>{e.stopPropagation();dropdown.classList.toggle("open");});
      document.addEventListener("click",()=>dropdown.classList.remove("open"));
      $$("[data-action]",dropdown).forEach(btn=>{btn.addEventListener("click",()=>{dropdown.classList.remove("open");const a=btn.getAttribute("data-action");if(a==="sair")doLogout();if(a==="trocar")doLogout(true);});});
    }
  }

  async function doBackup(){
    await runWithUi(async()=>{
      const result=await DB.backup();
      const fname=`supervenda-backup-${new Date().toISOString().replace(/[:.]/g,"-").slice(0,19)}.json`;
      downloadJson(fname,result.data);
      const r2msg=result.data?.r2key?` • R2: ${result.data.r2key}`:"";
      toast("✅ Backup gerado."+r2msg,"success",5000);
    },"Gerando backup...");
  }
  function doLogout(trocar=false){
    if(!confirm(trocar?"Trocar usuário?":"Deseja sair?")) return;
    DB.clearSession(); toast("Sessão encerrada.","info"); setTimeout(()=>location.reload(),400);
  }

  // Auth forms
  function bindAuthForms(){
    $("#goto-register")?.addEventListener("click",()=>{$("#view-login")?.classList.add("hidden");$("#view-register")?.classList.remove("hidden");});
    $("#goto-login")?.addEventListener("click",()=>{$("#view-register")?.classList.add("hidden");$("#view-login")?.classList.remove("hidden");});

    const lf=$("#login-form");
    if(lf&&!lf.dataset.bound){lf.dataset.bound="1";lf.addEventListener("submit",async e=>{
      e.preventDefault();
      const email=lf.querySelector("[name='email']")?.value?.trim()||"",senha=lf.querySelector("[name='senha']")?.value||"";
      if(!email||!senha) return toast("Informe e-mail e senha.","warning");
      await runWithUi(async()=>{await DB.login(email,senha);try{await DB.me();}catch{}syncLoginWorkspace();bindShell();renderNav();await preloadAll();renderCurrent();showLembretesPopupIfNeeded();toast("✅ Login realizado!","success");},"Entrando...");
    });}

    const rf=$("#register-form");
    if(rf&&!rf.dataset.bound){rf.dataset.bound="1";rf.addEventListener("submit",async e=>{
      e.preventDefault();
      const name=rf.querySelector("[name='name']")?.value?.trim()||"",email=rf.querySelector("[name='email']")?.value?.trim()||"",senha=rf.querySelector("[name='senha']")?.value||"";
      if(!name||!email||!senha) return toast("Preencha todos os campos.","warning");
      if(senha.length<6) return toast("Senha mínimo 6 caracteres.","warning");
      await runWithUi(async()=>{await DB.register({name,email,senha});syncLoginWorkspace();bindShell();renderNav();await preloadAll();renderCurrent();toast("✅ Conta criada!","success");},"Criando conta...");
    });}
  }

  // Init
  async function init(){
    // Restaurar tema salvo
    try{if(localStorage.getItem("sv_theme")==="light") document.body.classList.add("light-mode");}catch{}

    bindAuthForms();
    if(DB.getToken()){
      try{
        await DB.me(); syncLoginWorkspace(); bindShell(); renderNav();
        await runWithUi(preloadAll,"Carregando dados...");
        const hash=(location.hash||"#dashboard").replace("#","")||"dashboard";
        state.route=getRoute(hash).id; renderNav(); renderCurrent();
        showLembretesPopupIfNeeded();
      }catch(e){console.warn("Sessão inválida:",e);DB.clearSession();syncLoginWorkspace();}
    }else{syncLoginWorkspace();}

    window.addEventListener("hashchange",()=>{
      const h=(location.hash||"#dashboard").replace("#","")||"dashboard";
      state.route=getRoute(h).id; state.ui.search=""; renderNav(); renderCurrent();
    });
  }

  window.SuperVendaApp={state,navigate};
  init();
})();
