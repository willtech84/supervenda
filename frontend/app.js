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
    {id:"financeiro",  label:"Financeiro",  icon:"💰"},
    {id:"relatorios",  label:"Relatórios",  icon:"📈"},
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
        {key:"clienteNome",label:"Cliente *",type:"autocomplete",source:"clientes",required:true},
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
    if(route.id==="financeiro"){renderFinanceiro(root);return;}
    if(route.id==="relatorios"){renderRelatorios(root);return;}
    if(route.id==="rotas"){renderRotas(root);return;}
    // Detalhes de cliente
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
    if(f.type==="autocomplete"){
      // Campo com busca dinâmica em clientes
      return`<div class="field" style="position:relative;">
        <label>${esc(f.label)}</label>
        <input type="text" name="${esc(f.key)}" id="ac-${esc(f.key)}" value="${esc(String(v).toUpperCase())}" placeholder="Digite para buscar..." autocomplete="off"
          style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;text-transform:uppercase;"/>
        <div id="ac-drop-${esc(f.key)}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border-hi);border-radius:9px;z-index:999;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);margin-top:2px;"></div>
      </div>`;
    }
    let out=v;
    if(f.type==="date"&&v){try{const d=new Date(v.includes("T")?v:v+"T12:00:00");if(!isNaN(d.getTime()))out=d.toISOString().slice(0,10);}catch{}}
    const type=f.type==="number"?"number":f.type==="date"?"date":f.type==="email"?"email":"text";
    const noUpper=type==="email"||type==="number"||type==="date";
    const inputStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;${noUpper?"":"text-transform:uppercase;"}`;
    return`<div class="field"><label>${esc(f.label)}</label><input type="${type}" name="${esc(f.key)}" value="${esc(noUpper?out:String(out).toUpperCase())}" style="${inputStyle}"/></div>`;
  }

  // Bind autocomplete fields after form render
  function bindAutocomplete(wrap,schema){
    schema.fields.filter(f=>f.type==="autocomplete").forEach(f=>{
      const input=wrap.querySelector(`#ac-${f.key}`);
      const drop=wrap.querySelector(`#ac-drop-${f.key}`);
      if(!input||!drop) return;
      const source=safeArray(state.cache[f.source]||[]);

      function showDrop(q){
        const qq=q.trim().toLowerCase();
        const matches=source.filter(it=>{
          const nome=String(it.nome||it.name||"").toLowerCase();
          return !qq||nome.includes(qq);
        }).slice(0,10);
        if(!matches.length){drop.style.display="none";return;}
        drop.innerHTML=matches.map(it=>`
          <div data-ac-val="${esc(String(it.nome||it.name||"").toUpperCase())}" data-ac-id="${esc(getId(it))}"
            style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);"
            onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
            ${esc(String(it.nome||it.name||"").toUpperCase())}
            ${it.cidade?`<span style="font-size:11px;color:var(--muted);margin-left:8px;">${esc(it.cidade)}</span>`:""}
          </div>`).join("");
        drop.style.display="block";
        drop.querySelectorAll("[data-ac-val]").forEach(el=>{
          el.addEventListener("mousedown",e=>{
            e.preventDefault();
            input.value=el.getAttribute("data-ac-val");
            // Guardar clienteId oculto se existir
            const hiddenId=wrap.querySelector(`[name="clienteId"]`);
            if(hiddenId) hiddenId.value=el.getAttribute("data-ac-id");
            drop.style.display="none";
            // Preencher pagamento padrão automaticamente
            const cli=source.find(x=>String(getId(x))===el.getAttribute("data-ac-id"));
            if(cli?.pagamentoPadrao){
              const pgField=wrap.querySelector("[name='formaPagamento']");
              if(pgField&&!pgField.value) pgField.value=cli.pagamentoPadrao.toUpperCase();
            }
          });
        });
      }

      input.addEventListener("input",()=>showDrop(input.value));
      input.addEventListener("focus",()=>showDrop(input.value));
      document.addEventListener("click",e=>{if(!wrap.contains(e.target)) drop.style.display="none";},{once:false});
    });
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
    // Pedidos tem tela especial com montagem de itens
    if(resource==="pedidos"){renderFormPedido(item);return;}

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

    bindAutocomplete(wrap,schema);

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

  // ─── FORM PEDIDO ESPECIAL (com itens do estoque + orçamento PDF) ─────────────
  function renderFormPedido(item){
    const wrap=$("#sv-form-wrap"); if(!wrap) return;
    const isEdit=!!item;
    const itemId=isEdit?getId(item):"";
    const mercadorias=safeArray(state.cache.mercadorias).map(m=>normalizeItem("mercadorias",m));
    const clientes=safeArray(state.cache.clientes);

    // Estado dos itens do pedido
    const pedidoItens=[];
    if(isEdit&&Array.isArray(item.itens)){
      item.itens.forEach(it=>pedidoItens.push({
        id:getId(it)||String(Math.random()),
        nome:it.nome||it.produto||"",
        codigo:it.codigo||it.sku||"",
        qtd:Number(it.qtd||it.quantidade||1),
        valorUnit:Number(it.valorUnit||it.valor||it.valorVenda||0),
        desconto:Number(it.desconto||0),
      }));
    }

    const inStyle="width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;text-transform:uppercase;";
    const inStyleSm="padding:8px 10px;background:var(--bg);border:1px solid var(--border-hi);border-radius:8px;color:var(--text);font-family:var(--font);font-size:13px;width:100%;";

    function calcTotal(){
      return pedidoItens.reduce((a,it)=>a+it.qtd*it.valorUnit*(1-it.desconto/100),0);
    }

    function renderItens(){
      const tbody=$("#ped-itens-tbody"); if(!tbody) return;
      if(!pedidoItens.length){
        tbody.innerHTML=`<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Nenhum item. Use o catálogo abaixo ou adicione manualmente.</div>`;
      } else {
        tbody.innerHTML=pedidoItens.map((it,i)=>{
          const sub=it.qtd*it.valorUnit*(1-it.desconto/100);
          return`<div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:6px;align-items:center;padding:8px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div>
              <div style="font-size:13px;font-weight:600;">${esc(it.nome)}</div>
              ${it.codigo?`<div style="font-size:11px;color:var(--muted);">${esc(it.codigo)}</div>`:""}
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
              <label style="font-size:10px;color:var(--muted);">Qtd</label>
              <input type="number" min="0.01" step="0.01" value="${it.qtd}" data-item-field="qtd" data-item-idx="${i}" style="${inStyleSm}width:60px;text-align:center;"/>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
              <label style="font-size:10px;color:var(--muted);">Unit R$</label>
              <input type="text" inputmode="decimal" value="${it.valorUnit.toFixed(2).replace(".",",")}" data-item-field="valorUnit" data-item-idx="${i}" style="${inStyleSm}width:80px;text-align:right;"/>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
              <label style="font-size:10px;color:var(--muted);">Desc%</label>
              <input type="number" min="0" max="100" step="0.1" value="${it.desconto}" data-item-field="desconto" data-item-idx="${i}" style="${inStyleSm}width:55px;text-align:center;"/>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
              <label style="font-size:10px;color:var(--muted);">Total</label>
              <div style="font-size:13px;font-weight:700;color:var(--green);white-space:nowrap;">${moneyBR(sub)}</div>
              <button type="button" data-remove-idx="${i}" style="background:transparent;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:0;line-height:1;">✕</button>
            </div>
          </div>`;
        }).join("");
      }
      const t=calcTotal();
      const totEl=$("#ped-total-display"); if(totEl) totEl.textContent=moneyBR(t);
      const totInput=wrap.querySelector("[name='total']"); if(totInput) totInput.value=t.toFixed(2).replace(".",",");

      $$("[data-item-field]",tbody).forEach(el=>{
        el.addEventListener("change",()=>{
          const i=Number(el.getAttribute("data-item-idx"));
          const field=el.getAttribute("data-item-field");
          if(field==="valorUnit") pedidoItens[i].valorUnit=Number(String(el.value).replace(",","."))||0;
          else pedidoItens[i][field]=Number(el.value)||0;
          renderItens();
        });
      });
      $$("[data-remove-idx]",tbody).forEach(btn=>{
        btn.addEventListener("click",()=>{pedidoItens.splice(Number(btn.getAttribute("data-remove-idx")),1);renderItens();});
      });
    }

    function addItemManual(){
      const nome=String(wrap.querySelector("#ped-item-nome")?.value||"").trim().toUpperCase();
      const qtd=Number(String(wrap.querySelector("#ped-item-qtd")?.value||"1").replace(",","."))||1;
      const val=Number(String(wrap.querySelector("#ped-item-val")?.value||"0").replace(",","."))||0;
      if(!nome){toast("Informe o nome do item.","warning");return;}
      pedidoItens.push({id:String(Math.random()),nome,codigo:"",qtd,valorUnit:val,desconto:0});
      wrap.querySelector("#ped-item-nome").value="";
      wrap.querySelector("#ped-item-qtd").value="1";
      wrap.querySelector("#ped-item-val").value="";
      renderItens();
    }

    function addFromEstoque(m){
      const nomeUp=String(m.nome||m.produto||"").toUpperCase();
      const exists=pedidoItens.find(it=>it.nome===nomeUp);
      if(exists){exists.qtd++;renderItens();toast(`+1 ${nomeUp}`,"info",1500);return;}
      pedidoItens.push({id:getId(m)||String(Math.random()),nome:nomeUp,codigo:String(m.codigo||m.sku||""),qtd:1,valorUnit:Number(m.valor_venda||m.valorVenda||0),desconto:0});
      renderItens();
      toast(`✅ ${nomeUp} adicionado`,"success",1500);
    }

    function renderCatalogo(q){
      const cat=$("#ped-catalogo"); if(!cat) return;
      const filtered=!q?mercadorias:mercadorias.filter(m=>
        String(m.nome||m.produto||"").toLowerCase().includes(q.toLowerCase())||
        String(m.codigo||m.sku||"").toLowerCase().includes(q.toLowerCase())||
        String(m.marca||"").toLowerCase().includes(q.toLowerCase())
      );
      if(!filtered.length){cat.innerHTML=`<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px;">Nenhum produto encontrado.</div>`;return;}
      cat.innerHTML=filtered.slice(0,30).map(m=>{
        const est=Number(m.estoqueAtual??m.estoque??0),min=Number(m.estoqueMin??0),alerta=min>0&&est<=min;
        const val=Number(m.valor_venda||m.valorVenda||0);
        return`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid ${alerta?"rgba(255,179,0,.3)":"var(--border)"};border-radius:8px;margin-bottom:4px;" data-add-merc="${esc(getId(m)||"")}">
          <div style="flex:1;overflow:hidden;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.nome||m.produto||"")}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(m.marca||"")} ${m.codigo?`· ${esc(m.codigo)}`:""}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:13px;font-weight:700;color:var(--green);">${moneyBR(val)}</div>
            <div style="font-size:10px;color:${alerta?"var(--amber)":"var(--muted)"};">${alerta?"⚠️ ":""}Est:${est}</div>
          </div>
          <button type="button" style="background:var(--green-bg);border:1px solid rgba(0,230,118,.2);border-radius:8px;color:var(--green);padding:6px 10px;font-size:18px;cursor:pointer;flex-shrink:0;">+</button>
        </div>`;
      }).join("");
      $$("[data-add-merc]",cat).forEach(el=>{
        const addBtn=el.querySelector("button");
        const handler=()=>{const id=el.getAttribute("data-add-merc");const m=mercadorias.find(x=>String(getId(x))===String(id));if(m)addFromEstoque(m);};
        el.addEventListener("click",handler);
        addBtn?.addEventListener("click",e=>{e.stopPropagation();handler();});
      });
    }

    const hoje=new Date().toISOString().slice(0,10);
    const clienteNomeAtual=isEdit?String(item.clienteNome||"").toUpperCase():"";
    const clienteIdAtual=isEdit?String(item.clienteId||""):"";

    wrap.innerHTML=`
      <div class="form-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"➕ Novo"} Pedido</div>
          <button id="sv-close-form" class="btn btn-ghost btn-icon">✕</button>
        </div>
        <form id="sv-crud-form">
          <input type="hidden" name="clienteId" id="ped-clienteId" value="${esc(clienteIdAtual)}" />
          <div class="form-grid">
            <div class="field" style="position:relative;">
              <label>Cliente *</label>
              <input type="text" name="clienteNome" id="ac-clienteNome" value="${esc(clienteNomeAtual)}" placeholder="Digite para buscar..." autocomplete="off" style="${inStyle}"/>
              <div id="ac-drop-clienteNome" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border-hi);border-radius:9px;z-index:999;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);margin-top:2px;"></div>
            </div>
            <div class="field">
              <label>Data</label>
              <input type="date" name="data" value="${isEdit?String(item.data||"").slice(0,10):hoje}" style="${inStyle}text-transform:none;"/>
            </div>
            <div class="field">
              <label>Urgência</label>
              <select name="urgencia" style="${inStyle}text-transform:none;">
                ${URGENCIA_OPTS.map(o=>`<option ${(item?.urgencia||"Normal")===o?"selected":""}>${esc(o)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Forma pagamento</label>
              <input type="text" name="formaPagamento" value="${esc(String(item?.formaPagamento||"").toUpperCase())}" style="${inStyle}"/>
            </div>
            <div class="field">
              <label>Status</label>
              <select name="status" style="${inStyle}text-transform:none;">
                ${STATUS_PEDIDO.map(o=>`<option ${(item?.status||"Aberto")===o?"selected":""}>${esc(o)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Observação</label>
              <textarea name="obs" rows="2" style="${inStyle}resize:vertical;">${esc(item?.obs||"")}</textarea>
            </div>
          </div>

          <div style="background:var(--bg2);border:1px solid var(--border-hi);border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="font-size:14px;font-weight:700;margin-bottom:10px;">📋 Itens do pedido</div>
            <div id="ped-itens-tbody"></div>
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
              <span style="font-size:13px;color:var(--muted);">Total:</span>
              <span id="ped-total-display" style="font-size:20px;font-weight:700;color:var(--green);">${moneyBR(calcTotal())}</span>
            </div>
            <input type="hidden" name="total" value="${calcTotal().toFixed(2).replace(".",",")}"/>
          </div>

          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">➕ Adicionar item manualmente</div>
            <div style="display:grid;grid-template-columns:1fr 70px 100px auto;gap:6px;align-items:flex-end;">
              <div><label style="font-size:11px;color:var(--muted);">Produto</label><input type="text" id="ped-item-nome" placeholder="Nome do item" style="${inStyleSm}"/></div>
              <div><label style="font-size:11px;color:var(--muted);">Qtd</label><input type="number" id="ped-item-qtd" value="1" min="0.01" step="0.01" style="${inStyleSm}text-align:center;"/></div>
              <div><label style="font-size:11px;color:var(--muted);">Valor unit.</label><input type="text" inputmode="decimal" id="ped-item-val" placeholder="0,00" style="${inStyleSm}text-align:right;"/></div>
              <button type="button" id="ped-add-manual" class="btn btn-secondary" style="padding:9px 12px;white-space:nowrap;">+ Add</button>
            </div>
          </div>

          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="font-size:14px;font-weight:700;margin-bottom:10px;">📦 Catálogo do estoque</div>
            <input type="text" id="ped-cat-search" placeholder="Buscar produto..." style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:13px;margin-bottom:10px;"/>
            <div id="ped-catalogo" style="max-height:260px;overflow-y:auto;"></div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Criar"} pedido</button>
            ${!isEdit?`<button type="button" id="btn-salvar-orcamento" class="btn btn-secondary" style="width:auto;">📄 Salvar e gerar orçamento</button>`:""}
            ${isEdit?`<button type="button" id="btn-gerar-orcamento" class="btn btn-secondary" style="width:auto;">📄 Gerar orçamento</button>`:""}
            ${isEdit?`<button type="button" id="sv-delete-current" class="btn btn-danger">🗑️ Excluir</button>`:""}
            <button type="button" id="sv-cancel-form" class="btn btn-ghost">Cancelar</button>
          </div>
        </form>
      </div>`;

    renderItens();
    renderCatalogo("");

    // Autocomplete cliente
    const acInput=wrap.querySelector("#ac-clienteNome");
    const acDrop=wrap.querySelector("#ac-drop-clienteNome");
    if(acInput&&acDrop){
      function showCliDrop(q){
        const qq=q.trim().toLowerCase();
        const matches=clientes.filter(c=>!qq||String(c.nome||"").toLowerCase().includes(qq)).slice(0,10);
        if(!matches.length){acDrop.style.display="none";return;}
        acDrop.innerHTML=matches.map(c=>`
          <div data-ac-cli="${esc(getId(c))}" data-ac-nome="${esc(String(c.nome||"").toUpperCase())}" data-ac-pag="${esc(c.pagamentoPadrao||"")}"
            style="padding:10px 14px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border);"
            onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
            ${esc(String(c.nome||"").toUpperCase())}
            ${c.cidade?`<span style="font-size:11px;color:var(--muted);margin-left:8px;">${esc(c.cidade)}</span>`:""}
          </div>`).join("");
        acDrop.style.display="block";
        acDrop.querySelectorAll("[data-ac-cli]").forEach(el=>{
          el.addEventListener("mousedown",e=>{
            e.preventDefault();
            acInput.value=el.getAttribute("data-ac-nome");
            wrap.querySelector("#ped-clienteId").value=el.getAttribute("data-ac-cli");
            const pag=el.getAttribute("data-ac-pag");
            if(pag){const pf=wrap.querySelector("[name='formaPagamento']");if(pf&&!pf.value)pf.value=pag.toUpperCase();}
            acDrop.style.display="none";
          });
        });
      }
      acInput.addEventListener("input",()=>showCliDrop(acInput.value));
      acInput.addEventListener("focus",()=>showCliDrop(acInput.value));
      document.addEventListener("click",e=>{if(!wrap.contains(e.target))acDrop.style.display="none";});
    }

    wrap.querySelector("#ped-cat-search")?.addEventListener("input",e=>renderCatalogo(e.target.value));
    wrap.querySelector("#ped-add-manual")?.addEventListener("click",addItemManual);
    $("#sv-close-form")?.addEventListener("click",()=>{wrap.innerHTML="";});
    $("#sv-cancel-form")?.addEventListener("click",()=>{wrap.innerHTML="";});

    async function salvarPedido(){
      const form=$("#sv-crud-form");
      const fd=new FormData(form);
      const clienteNome=String(acInput?.value||"").trim().toUpperCase();
      if(!clienteNome){toast("Informe o cliente.","warning");return null;}
      const payload={
        clienteNome,
        clienteId:wrap.querySelector("#ped-clienteId")?.value||"",
        data:fd.get("data")||"",
        urgencia:fd.get("urgencia")||"Normal",
        formaPagamento:String(fd.get("formaPagamento")||"").toUpperCase(),
        status:fd.get("status")||"Aberto",
        obs:String(fd.get("obs")||"").toUpperCase(),
        total:calcTotal(),
        itens:pedidoItens.map(it=>({
          nome:it.nome, codigo:it.codigo, qtd:it.qtd,
          valorUnit:it.valorUnit, desconto:it.desconto,
          subtotal:it.qtd*it.valorUnit*(1-it.desconto/100),
        })),
      };
      await runWithUi(async()=>{
        if(isEdit) await DB.update("pedidos",itemId,payload);
        else await DB.create("pedidos",payload);
        await loadResource("pedidos");
      },"Salvando pedido...");
      return payload;
    }

    function gerarOrcamentoPDF(pedido,pedidoId){
      const cliente=clientes.find(c=>String(getId(c))===String(pedido.clienteId||""))||{nome:pedido.clienteNome||""};
      const nomeVendedor=DB.getUser()?.name||"Vendedor";
      const dataEmissao=new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"});
      const numOrc=pedidoId?String(pedidoId).slice(-6).toUpperCase():`${Date.now()}`.slice(-6);
      const itensHtml=(pedido.itens||[]).map((it,i)=>`
        <tr>
          <td style="text-align:center;">${i+1}</td>
          <td>${esc(it.nome||"")}${it.codigo?` <small style="color:#888;">[${esc(it.codigo)}]</small>`:""}</td>
          <td style="text-align:center;">${Number(it.qtd).toLocaleString("pt-BR",{maximumFractionDigits:2})}</td>
          <td style="text-align:right;">${moneyBR(it.valorUnit)}</td>
          <td style="text-align:center;">${it.desconto?it.desconto+"%":"-"}</td>
          <td style="text-align:right;font-weight:600;">${moneyBR(it.subtotal||it.qtd*it.valorUnit*(1-(it.desconto||0)/100))}</td>
        </tr>`).join("");

      const telCliente=cliente.telefone?String(cliente.telefone).replace(/\D/g,""):"";
      const emailCliente=cliente.email||"";
      const msgWpp=encodeURIComponent(`Olá ${cliente.nome||""}! Segue o orçamento nº ${numOrc} no valor de ${moneyBR(pedido.total)}. Qualquer dúvida estou à disposição!`);
      const wppLink=telCliente?`https://wa.me/55${telCliente}?text=${msgWpp}`:"";
      const emailLink=emailCliente?`mailto:${emailCliente}?subject=Orçamento%20nº%20${numOrc}&body=${encodeURIComponent(`Olá ${cliente.nome||""}!\n\nSegue o orçamento nº ${numOrc} conforme solicitado.\nValor total: ${moneyBR(pedido.total)}\n\nAtenciosamente,\n${nomeVendedor}`)}`:"";

      const win=window.open("","_blank","width=850,height=700");
      if(!win){toast("Permita popups para gerar o orçamento.","warning");return;}

      win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8"><title>Orçamento nº ${numOrc}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff;font-size:13px;}
        .page{max-width:800px;margin:0 auto;padding:28px;}
        .header{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1a2744;}
        .logo{font-size:22px;font-weight:800;color:#1a2744;}
        .orcnum{text-align:right;} .orcnum h2{font-size:20px;font-weight:800;color:#1a2744;} .orcnum p{font-size:12px;color:#666;margin-top:2px;}
        .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
        .info-box{background:#f5f7fa;border-radius:8px;padding:12px;}
        .info-box h3{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}
        table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;}
        th{background:#1a2744;color:#fff;padding:9px 10px;text-align:left;font-size:11px;text-transform:uppercase;}
        td{padding:8px 10px;border-bottom:1px solid #eee;} tr:nth-child(even){background:#f9f9f9;}
        .total-box{display:flex;justify-content:flex-end;margin-bottom:20px;}
        .total-inner{background:#1a2744;color:#fff;border-radius:10px;padding:14px 20px;min-width:200px;text-align:right;}
        .total-inner .label{font-size:11px;opacity:.7;margin-bottom:4px;} .total-inner .valor{font-size:24px;font-weight:800;}
        .footer{border-top:1px solid #eee;padding-top:16px;font-size:11px;color:#888;text-align:center;}
        .btn-bar{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;padding:16px;background:#f0f4fb;border-radius:10px;}
        .btn-bar a,.btn-bar button{display:inline-flex;align-items:center;gap:6px;padding:10px 18px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;border:none;}
        .btn-print{background:#1a2744;color:#fff;} .btn-wpp{background:#25d366;color:#fff;} .btn-mail{background:#4285f4;color:#fff;} .btn-close{background:#eee;color:#333;}
        .obs-box{background:#fffbe6;border-left:3px solid #ffb300;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;}
        .btn-disabled{opacity:.4;cursor:not-allowed;}
        @media print{.btn-bar{display:none!important}.page{padding:10px;}}
      </style></head>
      <body>
      <div class="page">
        <div class="btn-bar">
          <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
          ${wppLink
            ?`<a class="btn-wpp" href="${wppLink}" target="_blank">💬 Enviar WhatsApp</a>`
            :`<button class="btn-wpp btn-disabled" disabled title="Cadastre o telefone do cliente">💬 WhatsApp</button>`}
          ${emailLink
            ?`<a class="btn-mail" href="${emailLink}">✉️ Enviar E-mail</a>`
            :`<button class="btn-mail btn-disabled" disabled title="Cadastre o e-mail do cliente">✉️ E-mail</button>`}
          <button class="btn-close" onclick="window.close()">✕ Fechar</button>
        </div>
        <div class="header">
          <div>
            <div class="logo">⚡ Supervenda</div>
            <div style="font-size:12px;color:#666;margin-top:4px;">Vendedor: ${esc(nomeVendedor)}</div>
          </div>
          <div class="orcnum">
            <h2>ORÇAMENTO</h2>
            <p>Nº ${numOrc}</p>
            <p>Emitido: ${dataEmissao}</p>
            ${pedido.data?`<p>Data pedido: ${dateFormatBR(pedido.data)}</p>`:""}
          </div>
        </div>
        <div class="info-grid">
          <div class="info-box">
            <h3>👤 Cliente</h3>
            <p style="font-size:15px;font-weight:700;">${esc(cliente.nome||pedido.clienteNome||"")}</p>
            ${cliente.cpfcnpj?`<p style="color:#666;font-size:12px;margin-top:3px;">CPF/CNPJ: ${esc(cliente.cpfcnpj)}</p>`:""}
            ${cliente.endereco?`<p style="color:#666;font-size:12px;margin-top:3px;">${esc(cliente.endereco)}${cliente.bairro?", "+esc(cliente.bairro):""}${cliente.cidade?" — "+esc(cliente.cidade):""}</p>`:""}
            ${telCliente?`<p style="color:#666;font-size:12px;margin-top:3px;">📞 ${esc(cliente.telefone)}</p>`:""}
            ${emailCliente?`<p style="color:#666;font-size:12px;margin-top:3px;">✉️ ${esc(emailCliente)}</p>`:""}
          </div>
          <div class="info-box">
            <h3>📋 Condições</h3>
            ${pedido.formaPagamento?`<p style="margin-bottom:4px;">Pagamento: <strong>${esc(pedido.formaPagamento)}</strong></p>`:""}
            ${pedido.urgencia&&pedido.urgencia!=="Normal"?`<p style="margin-bottom:4px;">Urgência: <strong style="color:${pedido.urgencia==="Alta"?"#c62828":pedido.urgencia==="Média"?"#e65100":"#1565c0"};">${esc(pedido.urgencia)}</strong></p>`:""}
            <p>Status: <strong>${esc(pedido.status||"Aberto")}</strong></p>
          </div>
        </div>
        <table>
          <thead><tr>
            <th style="width:32px;">#</th>
            <th>Produto / Descrição</th>
            <th style="width:55px;text-align:center;">Qtd</th>
            <th style="width:90px;text-align:right;">Unit.</th>
            <th style="width:55px;text-align:center;">Desc.</th>
            <th style="width:100px;text-align:right;">Subtotal</th>
          </tr></thead>
          <tbody>${itensHtml||`<tr><td colspan="6" style="text-align:center;color:#888;padding:16px;">Nenhum item registrado.</td></tr>`}</tbody>
        </table>
        <div class="total-box">
          <div class="total-inner">
            <div class="label">VALOR TOTAL</div>
            <div class="valor">${moneyBR(pedido.total)}</div>
          </div>
        </div>
        ${pedido.obs?`<div class="obs-box"><strong>Observação:</strong> ${esc(pedido.obs)}</div>`:""}
        <div class="footer">
          <p>Este orçamento é válido por 30 dias a partir da data de emissão.</p>
          <p style="margin-top:4px;">Gerado por Supervenda · ${esc(nomeVendedor)} · ${dataEmissao}</p>
        </div>
      </div></body></html>`);
      win.document.close();
    }

    // Submit: só salvar
    $("#sv-crud-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const pedido=await salvarPedido(); if(!pedido) return;
      wrap.innerHTML=""; renderCurrent();
      toast("✅ Pedido salvo.","success");
    });

    // Salvar + gerar orçamento
    $("#btn-salvar-orcamento")?.addEventListener("click",async()=>{
      const pedido=await salvarPedido(); if(!pedido) return;
      const pedidos=safeArray(state.cache.pedidos);
      const novo=pedidos.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")))[0];
      wrap.innerHTML=""; renderCurrent();
      toast("✅ Pedido salvo. Abrindo orçamento...","success");
      setTimeout(()=>gerarOrcamentoPDF(pedido,novo?getId(novo):""),600);
    });

    // Gerar orçamento (edição)
    $("#btn-gerar-orcamento")?.addEventListener("click",async()=>{
      const pedido=await salvarPedido(); if(!pedido) return;
      wrap.innerHTML=""; renderCurrent();
      setTimeout(()=>gerarOrcamentoPDF(pedido,itemId),600);
    });

    // Excluir
    if(isEdit){
      $("#sv-delete-current")?.addEventListener("click",async()=>{
        if(!confirm("Excluir este pedido?")) return;
        await runWithUi(async()=>{await DB.remove("pedidos",itemId);await loadResource("pedidos");wrap.innerHTML="";renderCurrent();toast("✅ Excluído.","success");},"Excluindo...");
      });
    }
  }

  // ─── Financeiro ─────────────────────────────────────────────────────────────
  function renderFinanceiro(root){
    const pedidos=safeArray(state.cache.pedidos);
    const despesas=safeArray(state.cache.despesas);
    const hoje=new Date();
    const mesAtual=hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0");

    // Período padrão = mês atual
    const [anoI,mesI]=mesAtual.split("-").map(Number);
    const dtInicio=new Date(anoI,mesI-1,1);
    const dtFim=new Date(anoI,mesI,0,23,59,59);

    function filtrarPorPeriodo(items,campo){
      return items.filter(it=>{
        const d=new Date(String(it[campo]||it.created_at||"").replace(/T.*/,"")+"T12:00:00");
        return !isNaN(d.getTime())&&d>=dtInicio&&d<=dtFim;
      });
    }

    const pedMes=filtrarPorPeriodo(pedidos,"data");
    const despMes=filtrarPorPeriodo(despesas,"data");

    const pedAtivos=pedMes.filter(p=>{const s=String(p.status||"").toLowerCase();return !s.includes("cancel");});
    const pedPagos=pedAtivos.filter(p=>{const s=String(p.status||"").toLowerCase();return s.includes("entregue")||s.includes("pago")||s.includes("conclu")||s==="";});
    const pedAbertos=pedAtivos.filter(p=>{const s=String(p.status||"").toLowerCase();return s==="aberto"||s==="em andamento"||s==="pendente"||s==="";});

    const receitaRealizada=pedPagos.reduce((a,p)=>a+Number(p.total||0),0);
    const receitaPrevista=pedAbertos.reduce((a,p)=>a+Number(p.total||0),0);
    const totalDespMes=despMes.reduce((a,d)=>a+Number(d.valor||0),0);
    const saldo=receitaRealizada-totalDespMes;

    // Ticket médio por cliente
    const porCliente={};
    pedAtivos.forEach(p=>{
      const k=p.clienteNome||p.clienteId||"?";
      if(!porCliente[k]) porCliente[k]={nome:k,total:0,qtd:0};
      porCliente[k].total+=Number(p.total||0);
      porCliente[k].qtd++;
    });
    const topClientes=Object.values(porCliente).sort((a,b)=>b.total-a.total).slice(0,5);
    const ticketMedio=pedAtivos.length?pedAtivos.reduce((a,p)=>a+Number(p.total||0),0)/pedAtivos.length:0;

    // Gráfico de barras simples dos últimos 6 meses
    const meses6=[];
    for(let i=5;i>=0;i--){
      const d=new Date(hoje.getFullYear(),hoje.getMonth()-i,1);
      const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
      const label=d.toLocaleDateString("pt-BR",{month:"short",year:"2-digit"});
      const total=pedidos.filter(p=>{
        const s=String(p.status||"").toLowerCase();
        if(s.includes("cancel")) return false;
        const pd=String(p.data||p.created_at||"").slice(0,7);
        return pd===key;
      }).reduce((a,p)=>a+Number(p.total||0),0);
      meses6.push({key,label,total});
    }
    const maxBar=Math.max(...meses6.map(m=>m.total),1);

    root.innerHTML=`
      <div class="card" style="background:linear-gradient(135deg,rgba(0,230,118,.06),rgba(68,136,255,.04));border-color:rgba(0,230,118,.12);">
        <div style="font-size:13px;color:var(--muted);">Período</div>
        <div style="font-size:17px;font-weight:700;">${dtInicio.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px;">
        ${[
          ["Receita realizada","✅",receitaRealizada,"var(--green)"],
          ["Receita prevista","⏳",receitaPrevista,"var(--blue)"],
          ["Despesas","📤",totalDespMes,"var(--red)"],
          ["Saldo","💰",saldo,saldo>=0?"var(--green)":"var(--red)"],
        ].map(([l,ic,v,col])=>`
          <div class="stat-card">
            <div class="stat-icon">${ic}</div>
            <div class="stat-label">${l}</div>
            <div style="font-size:16px;font-weight:700;color:${col};line-height:1.2;">${moneyBR(v)}</div>
          </div>`).join("")}
      </div>

      <!-- Pedidos do mês -->
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">🛒 Pedidos no mês</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          <div style="background:var(--bg2);border-radius:10px;padding:10px;border:1px solid var(--border);text-align:center;">
            <div style="font-size:10px;color:var(--muted);">Total</div>
            <div style="font-size:20px;font-weight:700;">${pedMes.length}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:10px;border:1px solid rgba(0,230,118,.2);text-align:center;">
            <div style="font-size:10px;color:var(--muted);">Pagos/Entregues</div>
            <div style="font-size:20px;font-weight:700;color:var(--green);">${pedPagos.length}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:10px;border:1px solid rgba(255,179,0,.2);text-align:center;">
            <div style="font-size:10px;color:var(--muted);">Em aberto</div>
            <div style="font-size:20px;font-weight:700;color:var(--amber);">${pedAbertos.length}</div>
          </div>
        </div>
        <div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:10px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;color:var(--muted);">Ticket médio</span>
          <span style="font-size:15px;font-weight:700;color:var(--blue);">${moneyBR(ticketMedio)}</span>
        </div>
      </div>

      <!-- Gráfico vendas 6 meses -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px;">📊 Vendas — últimos 6 meses</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding-bottom:4px;">
          ${meses6.map(m=>{
            const pct=maxBar>0?(m.total/maxBar*100):0;
            const isAtual=m.key===mesAtual;
            return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;">
              <div style="font-size:9px;color:var(--muted);text-align:center;">${moneyBR(m.total).replace("R$","")}</div>
              <div style="width:100%;background:${isAtual?"var(--green)":"var(--blue)"};border-radius:5px 5px 0 0;height:${Math.max(pct,2)}%;opacity:${isAtual?1:.65};transition:height .3s;"></div>
              <div style="font-size:10px;color:var(--muted);text-align:center;">${m.label}</div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Top clientes -->
      ${topClientes.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">👥 Top clientes no mês</div>
        ${topClientes.map((c,i)=>`
          <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div style="font-size:16px;font-weight:700;color:var(--muted2);min-width:20px;">${i+1}</div>
            <div style="flex:1;overflow:hidden;">
              <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.nome)}</div>
              <div style="font-size:11px;color:var(--muted);">${c.qtd} pedido${c.qtd!==1?"s":""} · ticket: ${moneyBR(c.total/c.qtd)}</div>
            </div>
            <div style="font-size:14px;font-weight:700;color:var(--green);flex-shrink:0;">${moneyBR(c.total)}</div>
          </div>`).join("")}
      </div>`:""}

      <!-- Despesas por categoria -->
      ${despMes.length?`
      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">💸 Despesas por categoria</div>
        ${Object.entries(despMes.reduce((acc,d)=>{const k=d.categoria||"Outros";acc[k]=(acc[k]||0)+Number(d.valor||0);return acc;},{})).sort((a,b)=>b[1]-a[1]).map(([cat,val])=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:6px;">
            <div style="font-size:13px;">${esc(cat)}</div>
            <div style="font-size:13px;font-weight:600;color:var(--red);">${moneyBR(val)}</div>
          </div>`).join("")}
      </div>`:""}

      <div style="text-align:center;padding:8px;font-size:11px;color:var(--muted);">Dados atualizados em tempo real · Clique em ↻ para recarregar</div>
      <div style="display:flex;justify-content:center;gap:8px;padding-bottom:8px;">
        <button id="fin-refresh" class="btn btn-secondary" style="font-size:13px;">↻ Atualizar</button>
      </div>
    `;

    $("#fin-refresh")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{await preloadAll();renderFinanceiro(root);},"Atualizando...");
    });
  }

  // ─── Relatórios ─────────────────────────────────────────────────────────────
  function renderRelatorios(root){
    const hoje=new Date();
    const mesAtual=hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0");
    const [anoI,mesI]=mesAtual.split("-").map(Number);

    // Estado do filtro
    if(!state._relFiltro) state._relFiltro={
      tipo:"pedidos",
      de:new Date(anoI,mesI-1,1).toISOString().slice(0,10),
      ate:new Date(anoI,mesI,0).toISOString().slice(0,10),
    };
    const f=state._relFiltro;

    function filtrar(items,campo){
      return items.filter(it=>{
        const d=new Date(String(it[campo]||it.created_at||"").replace(/T.*/,"")+"T12:00:00");
        return !isNaN(d.getTime())&&d>=new Date(f.de+"T00:00:00")&&d<=new Date(f.ate+"T23:59:59");
      });
    }

    const mercadorias=safeArray(state.cache.mercadorias);
    const totalEstoque=mercadorias.reduce((a,m)=>{
      const estoq=Number(m.estoqueAtual??m.estoque??0);
      const val=Number(m.valorVenda??m.valor_venda??0);
      return a+estoq*val;
    },0);

    let dadosFiltrados=[], colunas=[], titulo="";

    if(f.tipo==="pedidos"){
      const ped=filtrar(safeArray(state.cache.pedidos),"data")
        .filter(p=>!String(p.status||"").toLowerCase().includes("cancel"));
      dadosFiltrados=ped;
      titulo=`Pedidos (${ped.length}) — Total: ${moneyBR(ped.reduce((a,p)=>a+Number(p.total||0),0))}`;
      colunas=["Data","Cliente","Urgência","Status","Pagamento","Total"];
    } else if(f.tipo==="mercadorias"){
      dadosFiltrados=mercadorias;
      titulo=`Estoque (${mercadorias.length} itens) — Valor total: ${moneyBR(totalEstoque)}`;
      colunas=["Produto","Marca","Categoria","Estoque","Valor venda","Total em estoque"];
    } else if(f.tipo==="despesas"){
      const desp=filtrar(safeArray(state.cache.despesas),"data");
      dadosFiltrados=desp;
      titulo=`Despesas (${desp.length}) — Total: ${moneyBR(desp.reduce((a,d)=>a+Number(d.valor||0),0))}`;
      colunas=["Data","Categoria","Valor","Pagamento","Obs"];
    }

    function renderTabela(){
      if(!dadosFiltrados.length) return`<div style="text-align:center;padding:32px;color:var(--muted);">Nenhum registro no período.</div>`;
      if(f.tipo==="pedidos") return dadosFiltrados.map(p=>`
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;align-items:center;">
          <div>
            <div style="font-size:13px;font-weight:600;">${esc(p.clienteNome||"")}</div>
            <div style="font-size:11px;color:var(--muted);">${dateFormatBR(p.data)} · ${esc(p.formaPagamento||"")}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;">
            <span class="badge ${getBadgeClass(p.status)}">${esc(p.status||"")}</span>
            ${p.urgencia&&p.urgencia!=="Normal"?`<span style="font-size:11px;font-weight:700;color:${urgenciaColor(p.urgencia)};">▲${esc(p.urgencia)}</span>`:""}
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--green);white-space:nowrap;">${moneyBR(p.total)}</div>
        </div>`).join("");
      if(f.tipo==="mercadorias") return dadosFiltrados.map(m=>{
        const est=Number(m.estoqueAtual??m.estoque??0);
        const val=Number(m.valorVenda??m.valor_venda??0);
        const min=Number(m.estoqueMin??0);
        const alerta=min>0&&est<=min;
        return`<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:10px 12px;background:var(--bg2);border:1px solid ${alerta?"rgba(255,179,0,.3)":"var(--border)"};border-radius:9px;margin-bottom:6px;align-items:center;">
          <div>
            <div style="font-size:13px;font-weight:600;">${esc(m.nome||m.produto||"")}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(m.marca||"")} ${m.categoria?`· ${esc(m.categoria)}`:""} ${m.created_at?`· ${dateFormatBR(m.created_at)}`:""}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:${alerta?"var(--amber)":"var(--muted)"};">${alerta?"⚠️ ":""}Est: ${est}${min?` / Mín:${min}`:""}</div>
            <div style="font-size:12px;color:var(--muted);">Un: ${moneyBR(val)}</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--green);white-space:nowrap;">${moneyBR(est*val)}</div>
        </div>`;
      }).join("");
      if(f.tipo==="despesas") return dadosFiltrados.map(d=>`
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;align-items:center;">
          <div>
            <div style="font-size:13px;font-weight:600;">${esc(d.categoria||"")}</div>
            <div style="font-size:11px;color:var(--muted);">${dateFormatBR(d.data)} · ${esc(d.pagamento||"")} ${d.obs?`· ${esc(d.obs)}`:""}</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--red);white-space:nowrap;">${moneyBR(d.valor)}</div>
        </div>`).join("");
      return "";
    }

    function gerarPDF(){
      const win=window.open("","_blank","width=800,height=600");
      if(!win) return toast("Permita popups para gerar PDF.","warning");
      const nomeEmpresa=DB.getUser()?.name||"Supervenda";
      const dataGer=new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});

      let linhas="";
      if(f.tipo==="pedidos") linhas=dadosFiltrados.map(p=>`
        <tr><td>${dateFormatBR(p.data)}</td><td>${esc(p.clienteNome||"")}</td><td>${esc(p.urgencia||"")}</td><td>${esc(p.status||"")}</td><td>${esc(p.formaPagamento||"")}</td><td style="text-align:right;font-weight:600;">${moneyBR(p.total)}</td></tr>`).join("");
      else if(f.tipo==="mercadorias") linhas=dadosFiltrados.map(m=>{
        const est=Number(m.estoqueAtual??m.estoque??0),val=Number(m.valorVenda??m.valor_venda??0);
        return`<tr><td>${esc(m.nome||m.produto||"")}</td><td>${esc(m.marca||"")}</td><td>${esc(m.categoria||"")}</td><td style="text-align:center;">${est}</td><td style="text-align:right;">${moneyBR(val)}</td><td style="text-align:right;font-weight:600;">${moneyBR(est*val)}</td></tr>`;
      }).join("");
      else if(f.tipo==="despesas") linhas=dadosFiltrados.map(d=>`
        <tr><td>${dateFormatBR(d.data)}</td><td>${esc(d.categoria||"")}</td><td style="text-align:right;">${moneyBR(d.valor)}</td><td>${esc(d.pagamento||"")}</td><td>${esc(d.obs||"")}</td></tr>`).join("");

      const totalLinha=f.tipo==="mercadorias"
        ?`<tr style="background:#f0f0f0;font-weight:700;"><td colspan="5">TOTAL ESTOQUE</td><td style="text-align:right;">${moneyBR(totalEstoque)}</td></tr>`
        :f.tipo==="pedidos"
        ?`<tr style="background:#f0f0f0;font-weight:700;"><td colspan="5">TOTAL</td><td style="text-align:right;">${moneyBR(dadosFiltrados.reduce((a,p)=>a+Number(p.total||0),0))}</td></tr>`
        :`<tr style="background:#f0f0f0;font-weight:700;"><td colspan="4">TOTAL</td><td style="text-align:right;">${moneyBR(dadosFiltrados.reduce((a,d)=>a+Number(d.valor||0),0))}</td></tr>`;

      win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório ${titulo}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#111;padding:20px;font-size:13px}
      h1{font-size:18px;margin-bottom:4px}h2{font-size:13px;color:#555;font-weight:400;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1a2744;color:#fff;padding:8px;text-align:left}
      td{padding:7px 8px;border-bottom:1px solid #e0e0e0}tr:nth-child(even){background:#f8f8f8}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #1a2744}
      .print-btn{display:none}@media print{.print-btn{display:none!important}}</style></head>
      <body onload="window.print()">
      <div class="header">
        <div><h1>📊 ${esc(titulo)}</h1><h2>${nomeEmpresa} — Emitido em ${dataGer}</h2>
        ${f.tipo!=="mercadorias"?`<h2>Período: ${dateFormatBR(f.de)} a ${dateFormatBR(f.ate)}</h2>`:""}</div>
      </div>
      <table><thead><tr>${colunas.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${linhas}${totalLinha}</tbody></table>
      </body></html>`);
      win.document.close();
    }

    root.innerHTML=`
      <div class="card">
        <div class="card-title" style="margin-bottom:12px;">📈 Relatórios</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          ${["pedidos","mercadorias","despesas"].map(t=>`
            <button class="btn ${f.tipo===t?"btn-primary":"btn-secondary"}" data-rel-tipo="${t}" style="font-size:13px;">
              ${t==="pedidos"?"🛒 Pedidos":t==="mercadorias"?"📦 Estoque":"💸 Despesas"}
            </button>`).join("")}
        </div>
        ${f.tipo!=="mercadorias"?`
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <div class="field" style="flex:1;min-width:130px;margin:0;">
            <label style="font-size:11px;">De</label>
            <input type="date" id="rel-de" value="${f.de}" style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:13px;"/>
          </div>
          <div class="field" style="flex:1;min-width:130px;margin:0;">
            <label style="font-size:11px;">Até</label>
            <input type="date" id="rel-ate" value="${f.ate}" style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:13px;"/>
          </div>
          <button id="rel-filtrar" class="btn btn-primary" style="align-self:flex-end;font-size:13px;white-space:nowrap;">🔍 Filtrar</button>
        </div>`:`<div style="font-size:12px;color:var(--muted);">Exibindo todos os produtos cadastrados</div>`}
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-size:14px;font-weight:600;">${esc(titulo)}</div>
          <button id="rel-pdf" class="btn btn-secondary" style="font-size:13px;">🖨️ Gerar PDF</button>
        </div>
        <div id="rel-tabela">${renderTabela()}</div>
      </div>
    `;

    $$("[data-rel-tipo]",root).forEach(btn=>{
      btn.addEventListener("click",()=>{
        state._relFiltro.tipo=btn.getAttribute("data-rel-tipo");
        renderRelatorios(root);
      });
    });
    $("#rel-filtrar")?.addEventListener("click",()=>{
      const de=$("#rel-de")?.value,ate=$("#rel-ate")?.value;
      if(de) state._relFiltro.de=de;
      if(ate) state._relFiltro.ate=ate;
      renderRelatorios(root);
    });
    $("#rel-de")?.addEventListener("change",e=>{state._relFiltro.de=e.target.value;});
    $("#rel-ate")?.addEventListener("change",e=>{state._relFiltro.ate=e.target.value;});
    $("#rel-pdf")?.addEventListener("click",gerarPDF);
  }

  // ─── Rotas com Geolocalização ─────────────────────────────────────────────────
  function renderRotas(root){
    const clientes=safeArray(state.cache.clientes);
    const rotasSalvas=safeArray(state.cache.rotas);

    // Estado da rota atual sendo montada
    if(!state._rotaState) state._rotaState={paradas:[],geocoded:{},otimizada:false,map:null};
    const RS=state._rotaState;

    // ── helpers ──
    async function geocodeEndereco(cliente){
      const key=getId(cliente)||cliente.nome;
      if(RS.geocoded[key]) return RS.geocoded[key];
      const partes=[cliente.endereco,cliente.numero,cliente.bairro,cliente.cidade,cliente.uf,"Brasil"].filter(Boolean).join(", ");
      if(!partes.replace(/,\s*/g,"").trim()){return null;}
      try{
        const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(partes)}`,{headers:{"User-Agent":"supervenda-app"}});
        const j=await r.json();
        if(j&&j[0]){const coord={lat:parseFloat(j[0].lat),lng:parseFloat(j[0].lon),label:j[0].display_name};RS.geocoded[key]=coord;return coord;}
      }catch(e){console.warn("Geocode falhou:",e);}
      return null;
    }

    function distKm(a,b){
      // Haversine simplificado
      const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
      const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
      return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
    }

    function otimizarRota(paradas){
      // Nearest-neighbor TSP greedy a partir do primeiro ponto
      const com=paradas.filter(p=>p.coord);
      const sem=paradas.filter(p=>!p.coord);
      if(com.length<=1) return [...com,...sem];
      const visitados=new Set(),resultado=[com[0]];
      visitados.add(0);
      while(visitados.size<com.length){
        const ultimo=resultado[resultado.length-1];
        let melhorDist=Infinity,melhorIdx=-1;
        com.forEach((p,i)=>{if(!visitados.has(i)){const d=distKm(ultimo.coord,p.coord);if(d<melhorDist){melhorDist=d;melhorIdx=i;}}});
        if(melhorIdx<0) break;
        visitados.add(melhorIdx);resultado.push(com[melhorIdx]);
      }
      return [...resultado,...sem];
    }

    function totalKm(paradas){
      let total=0;
      for(let i=1;i<paradas.length;i++){
        if(paradas[i-1].coord&&paradas[i].coord) total+=distKm(paradas[i-1].coord,paradas[i].coord);
      }
      return total;
    }

    // ── Render mapa com Leaflet ──
    function initMap(){
      if(typeof window.L==="undefined") return;
      const mapDiv=document.getElementById("sv-rota-mapa");
      if(!mapDiv) return;
      if(RS.map){try{RS.map.remove();}catch{} RS.map=null;}
      RS.map=window.L.map("sv-rota-mapa").setView([-15.7801,-47.9292],5);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(RS.map);
      const coords=RS.paradas.filter(p=>p.coord);
      if(!coords.length) return;
      const bounds=[];
      coords.forEach((p,i)=>{
        const cor=i===0?"#00e676":i===coords.length-1?"#ff5252":"#4488ff";
        const marker=window.L.circleMarker([p.coord.lat,p.coord.lng],{radius:10,fillColor:cor,color:"#fff",weight:2,fillOpacity:0.9}).addTo(RS.map);
        marker.bindPopup(`<b>${i+1}. ${p.nome}</b><br><small>${p.endereco||""}</small>`);
        bounds.push([p.coord.lat,p.coord.lng]);
      });
      if(coords.length>1){
        const latlngs=coords.map(p=>[p.coord.lat,p.coord.lng]);
        window.L.polyline(latlngs,{color:"#4488ff",weight:3,dashArray:"6,6",opacity:.7}).addTo(RS.map);
      }
      if(bounds.length) RS.map.fitBounds(bounds,{padding:[20,20]});
    }

    // ── Render lista de paradas ──
    function renderParadas(){
      const wrap=document.getElementById("sv-paradas-lista"); if(!wrap) return;
      if(!RS.paradas.length){
        wrap.innerHTML=`<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma parada adicionada. Busque e adicione clientes abaixo.</div>`;
        updateKm(); return;
      }
      wrap.innerHTML=RS.paradas.map((p,i)=>`
        <div class="sv-parada-item" draggable="true" data-parada-idx="${i}"
          style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg2);border:1px solid ${p.coord?"var(--border)":"rgba(255,179,0,.3)"};border-radius:10px;margin-bottom:6px;cursor:grab;">
          <div style="font-size:18px;color:var(--muted2);font-weight:700;min-width:28px;text-align:center;">${i+1}</div>
          <div style="flex:1;overflow:hidden;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.nome)}</div>
            <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${p.coord?`📍 ${esc(p.endereco||"")}`:`⚠️ Sem coordenadas — ${esc(p.endereco||"Endereço não cadastrado")}`}
            </div>
            ${p.coord&&i>0&&RS.paradas[i-1].coord?`<div style="font-size:10px;color:var(--blue);">↑ ${distKm(RS.paradas[i-1].coord,p.coord).toFixed(1)} km do anterior</div>`:""}
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${i>0?`<button type="button" data-mover="up" data-idx="${i}" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;cursor:pointer;font-size:13px;">↑</button>`:""}
            ${i<RS.paradas.length-1?`<button type="button" data-mover="down" data-idx="${i}" style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;cursor:pointer;font-size:13px;">↓</button>`:""}
            <button type="button" data-remover="${i}" style="background:transparent;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
          </div>
        </div>`).join("");

      // Botões mover/remover
      wrap.querySelectorAll("[data-mover]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const i=Number(btn.getAttribute("data-idx")),dir=btn.getAttribute("data-mover");
          const j=dir==="up"?i-1:i+1;
          [RS.paradas[i],RS.paradas[j]]=[RS.paradas[j],RS.paradas[i]];
          RS.otimizada=false;renderParadas();initMap();
        });
      });
      wrap.querySelectorAll("[data-remover]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          RS.paradas.splice(Number(btn.getAttribute("data-remover")),1);
          RS.otimizada=false;renderParadas();initMap();
        });
      });

      // Drag & drop
      let dragIdx=null;
      wrap.querySelectorAll(".sv-parada-item").forEach(el=>{
        el.addEventListener("dragstart",()=>{dragIdx=Number(el.getAttribute("data-parada-idx"));el.style.opacity=".4";});
        el.addEventListener("dragend",()=>{el.style.opacity="1";});
        el.addEventListener("dragover",e=>{e.preventDefault();el.style.background="var(--bg3)";});
        el.addEventListener("dragleave",()=>{el.style.background="var(--bg2)";});
        el.addEventListener("drop",e=>{
          e.preventDefault();el.style.background="var(--bg2)";
          const toIdx=Number(el.getAttribute("data-parada-idx"));
          if(dragIdx!==null&&dragIdx!==toIdx){
            const [moved]=RS.paradas.splice(dragIdx,1);RS.paradas.splice(toIdx,0,moved);
            RS.otimizada=false;renderParadas();initMap();
          }
        });
      });
      updateKm();
    }

    function updateKm(){
      const km=totalKm(RS.paradas);
      const el=document.getElementById("sv-km-total");
      if(el) el.textContent=km>0?`${km.toFixed(1)} km total`:"";
    }

    // ── Geocode autocomplete de clientes ──
    function setupBusca(){
      const input=document.getElementById("sv-rota-busca");
      const drop=document.getElementById("sv-rota-drop");
      if(!input||!drop) return;

      input.addEventListener("input",()=>{
        const q=input.value.trim().toLowerCase();
        const matches=clientes.filter(c=>!q||String(c.nome||"").toLowerCase().includes(q)||String(c.cidade||"").toLowerCase().includes(q)).slice(0,10);
        if(!matches.length||!q){drop.style.display="none";return;}
        drop.innerHTML=matches.map(c=>`
          <div data-cli-id="${esc(getId(c))}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;"
            onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
            <div style="font-weight:600;">${esc(String(c.nome||"").toUpperCase())}</div>
            <div style="font-size:11px;color:var(--muted);">${[c.endereco,c.numero,c.bairro,c.cidade,c.uf].filter(Boolean).join(", ")||"Endereço não cadastrado"}</div>
          </div>`).join("");
        drop.style.display="block";
        drop.querySelectorAll("[data-cli-id]").forEach(el=>{
          el.addEventListener("mousedown",async e=>{
            e.preventDefault();
            const id=el.getAttribute("data-cli-id");
            const cli=clientes.find(c=>String(getId(c))===id);
            if(!cli) return;
            // Evitar duplicata
            if(RS.paradas.find(p=>p.clienteId===id)){toast("Cliente já adicionado à rota.","warning");input.value="";drop.style.display="none";return;}
            const endereco=[cli.endereco,cli.numero,cli.bairro,cli.cidade,cli.uf].filter(Boolean).join(", ");
            const parada={clienteId:id,nome:String(cli.nome||"").toUpperCase(),endereco,telefone:cli.telefone||"",coord:null};
            RS.paradas.push(parada);
            input.value="";drop.style.display="none";
            renderParadas();
            // Geocode em background
            toast(`🔍 Buscando localização de ${parada.nome}...`,"info",2500);
            const coord=await geocodeEndereco(cli);
            if(coord){parada.coord=coord;toast(`📍 ${parada.nome} localizado!`,"success",2000);}
            else toast(`⚠️ Não foi possível localizar ${parada.nome}. Verifique o endereço.`,"warning",4000);
            renderParadas();initMap();
          });
        });
      });
      input.addEventListener("focus",()=>{if(input.value.trim()) input.dispatchEvent(new Event("input"));});
      document.addEventListener("click",e=>{if(!input.closest("[id]").contains(e.target)) drop.style.display="none";});
    }

    // ── Carregar rota salva ──
    function carregarRotaSalva(rota){
      try{
        const dados=JSON.parse(rota.obs||"{}");
        if(Array.isArray(dados.paradas)){
          RS.paradas=dados.paradas;
          // Restaurar geocoded cache
          dados.geocoded&&Object.assign(RS.geocoded,dados.geocoded);
          RS.otimizada=dados.otimizada||false;
          renderParadas();
          setTimeout(initMap,300);
          toast("Rota carregada.","success");
        }
      }catch{toast("Não foi possível carregar esta rota.","error");}
    }

    // ── Render principal ──
    root.innerHTML=`
      <!-- CSS Leaflet -->
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>

      <div class="card">
        <div class="card-title" style="margin-bottom:10px;">🗺️ Planejador de Rotas</div>
        <div style="font-size:12px;color:var(--muted);">Adicione clientes, otimize o trajeto e salve a rota. Drag & drop ou ↑↓ para reordenar.</div>
      </div>

      <!-- Busca de clientes -->
      <div class="card">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;">➕ Adicionar parada</div>
        <div style="position:relative;">
          <input type="text" id="sv-rota-busca" placeholder="Buscar cliente pelo nome ou cidade..." autocomplete="off"
            style="width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;"/>
          <div id="sv-rota-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border-hi);border-radius:9px;z-index:999;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.3);margin-top:2px;"></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button id="btn-geo-atual" class="btn btn-secondary" style="font-size:12px;">📍 Adicionar minha posição atual</button>
          <button id="btn-otimizar" class="btn btn-primary" style="font-size:12px;">⚡ Otimizar trajeto</button>
          <button id="btn-limpar-rota" class="btn btn-ghost" style="font-size:12px;">🗑️ Limpar</button>
        </div>
      </div>

      <!-- Lista de paradas -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="font-size:13px;font-weight:600;">📋 Paradas <span id="sv-km-total" style="font-size:12px;color:var(--blue);margin-left:8px;"></span></div>
          <div style="display:flex;gap:6px;">
            <button id="btn-abrir-google" class="btn btn-secondary" style="font-size:12px;">🗺️ Abrir no Google Maps</button>
            <button id="btn-salvar-rota" class="btn btn-primary" style="font-size:12px;">💾 Salvar rota</button>
          </div>
        </div>
        <div id="sv-paradas-lista"></div>
      </div>

      <!-- Mapa -->
      <div class="card" style="padding:0;overflow:hidden;border-radius:14px;">
        <div id="sv-rota-mapa" style="height:340px;width:100%;border-radius:14px;"></div>
      </div>

      <!-- Rotas salvas -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
          <div style="font-size:13px;font-weight:600;">📁 Rotas salvas (${rotasSalvas.length})</div>
          <button id="btn-refresh-rotas" class="btn btn-secondary btn-icon" style="font-size:13px;">↻</button>
        </div>
        ${rotasSalvas.length?rotasSalvas.map(r=>{
          let info="";
          try{const d=JSON.parse(r.obs||"{}");if(d.paradas)info=` · ${d.paradas.length} paradas`;}catch{}
          return`<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;">
            <div style="flex:1;overflow:hidden;">
              <div style="font-size:13px;font-weight:600;">${esc(r.nome||r.titulo||dateFormatBR(r.data)||"Rota")}</div>
              <div style="font-size:11px;color:var(--muted);">${dateFormatBR(r.data)}${info}</div>
            </div>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 10px;" data-carregar-rota="${esc(getId(r))}">📂 Carregar</button>
            <button class="btn btn-danger" style="font-size:12px;padding:6px 10px;" data-excluir-rota="${esc(getId(r))}">🗑️</button>
          </div>`;
        }).join(""):`<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma rota salva ainda.</div>`}
      </div>
    `;

    // Carregar Leaflet dinamicamente
    if(typeof window.L==="undefined"){
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      s.onload=()=>{renderParadas();setTimeout(initMap,200);};
      document.head.appendChild(s);
    } else {
      renderParadas();setTimeout(initMap,200);
    }

    setupBusca();

    // Posição atual
    document.getElementById("btn-geo-atual")?.addEventListener("click",()=>{
      if(!navigator.geolocation){toast("Geolocalização não suportada neste dispositivo.","warning");return;}
      toast("📍 Buscando sua localização...","info",2500);
      navigator.geolocation.getCurrentPosition(pos=>{
        const coord={lat:pos.coords.latitude,lng:pos.coords.longitude,label:"Minha posição"};
        const existe=RS.paradas.find(p=>p.clienteId==="__minha_pos__");
        if(existe){existe.coord=coord;toast("📍 Posição atualizada.","success");}
        else{RS.paradas.unshift({clienteId:"__minha_pos__",nome:"📍 MINHA POSIÇÃO ATUAL",endereco:"",telefone:"",coord});}
        renderParadas();initMap();
      },err=>{toast(`Erro ao obter localização: ${err.message}`,"error");});
    });

    // Otimizar
    document.getElementById("btn-otimizar")?.addEventListener("click",()=>{
      if(RS.paradas.length<2){toast("Adicione pelo menos 2 paradas para otimizar.","warning");return;}
      const comCoord=RS.paradas.filter(p=>p.coord).length;
      if(comCoord<2){toast("Aguarde a geocodificação de pelo menos 2 paradas.","warning");return;}
      const antes=totalKm(RS.paradas);
      RS.paradas=otimizarRota(RS.paradas);
      RS.otimizada=true;
      const depois=totalKm(RS.paradas);
      renderParadas();initMap();
      toast(`⚡ Rota otimizada! ${antes.toFixed(1)} → ${depois.toFixed(1)} km (-${(antes-depois).toFixed(1)} km)`,"success",5000);
    });

    // Limpar
    document.getElementById("btn-limpar-rota")?.addEventListener("click",()=>{
      if(!confirm("Limpar todas as paradas?")) return;
      RS.paradas=[];RS.otimizada=false;renderParadas();
      if(RS.map){try{RS.map.remove();}catch{}RS.map=null;}
      setTimeout(initMap,100);
    });

    // Abrir no Google Maps
    document.getElementById("btn-abrir-google")?.addEventListener("click",()=>{
      const comCoord=RS.paradas.filter(p=>p.coord);
      if(!comCoord.length){toast("Nenhuma parada com localização encontrada.","warning");return;}
      const waypoints=comCoord.map((p,i)=>`${p.coord.lat},${p.coord.lng}`);
      const origem=waypoints[0],destino=waypoints[waypoints.length-1];
      const via=waypoints.slice(1,-1).join("|");
      const url=`https://www.google.com/maps/dir/?api=1&origin=${origem}&destination=${destino}${via?`&waypoints=${via}`:""}&travelmode=driving`;
      window.open(url,"_blank");
    });

    // Salvar rota
    document.getElementById("btn-salvar-rota")?.addEventListener("click",async()=>{
      if(!RS.paradas.length){toast("Adicione paradas antes de salvar.","warning");return;}
      const nome=prompt("Nome da rota (ex: Rota Centro - 01/03):",`Rota ${new Date().toLocaleDateString("pt-BR")}`);
      if(!nome) return;
      const payload={
        nome:nome.toUpperCase(),
        data:new Date().toISOString().slice(0,10),
        obs:JSON.stringify({paradas:RS.paradas,geocoded:RS.geocoded,otimizada:RS.otimizada}),
      };
      await runWithUi(async()=>{
        await DB.create("rotas",payload);
        await loadResource("rotas");
        renderRotas(root);
        toast("✅ Rota salva!","success");
      },"Salvando rota...");
    });

    // Refresh rotas salvas
    document.getElementById("btn-refresh-rotas")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{await loadResource("rotas");renderRotas(root);},"Atualizando...");
    });

    // Carregar rota salva
    root.querySelectorAll("[data-carregar-rota]").forEach(btn=>{
      btn.addEventListener("click",()=>{
        const id=btn.getAttribute("data-carregar-rota");
        const rota=rotasSalvas.find(r=>String(getId(r))===String(id));
        if(rota) carregarRotaSalva(rota);
      });
    });

    // Excluir rota salva
    root.querySelectorAll("[data-excluir-rota]").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const id=btn.getAttribute("data-excluir-rota");
        if(!confirm("Excluir esta rota salva?")) return;
        await runWithUi(async()=>{await DB.remove("rotas",id);await loadResource("rotas");renderRotas(root);toast("Excluído.","success");},"Excluindo...");
      });
    });
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
