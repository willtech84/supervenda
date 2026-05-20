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
    {id:"manuais",     label:"Manuais",     icon:"📚"},
    {id:"vendas",      label:"Vendas",      icon:"💵"},
    {id:"visitas",     label:"Visitas",     icon:"🏢"},
    {id:"cartao",      label:"Cartões",     icon:"🪪"},
    {id:"rotas",       label:"Rotas",       icon:"🗺️", resource:"rotas"},
    {id:"despesas",    label:"Despesas",    icon:"💸", resource:"despesas"},
    {id:"lembretes",   label:"Lembretes",   icon:"🔔", resource:"lembretes"},
    {id:"anotacoes",   label:"Anotações",   icon:"📝", resource:"notas"},
    {id:"usuarios",    label:"Usuários",    icon:"👤"},
  ];
  const BOTTOM_NAV=["dashboard","clientes","pedidos","mercadorias"];

  // Ordem do menu lateral — personalizável e salva em localStorage
  function getMenuOrder(){
    try{
      const saved=JSON.parse(localStorage.getItem("sv_menu_order")||"[]");
      if(saved.length===ROUTES.length) return saved;
    }catch{}
    return ROUTES.map(r=>r.id);
  }
  function setMenuOrder(order){try{localStorage.setItem("sv_menu_order",JSON.stringify(order));}catch{}}
  function getRoutesOrdenadas(){
    const order=getMenuOrder();
    return order.map(id=>ROUTES.find(r=>r.id===id)).filter(Boolean);
  }

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

  // Mapa de rota -> recurso de permissão
  const ROTA_PERM={
    clientes:"clientes", mercadorias:"mercadorias", pedidos:"pedidos",
    despesas:"despesas", lembretes:"lembretes", anotacoes:"anotacoes",
    rotas:"rotas", financeiro:"financeiro", relatorios:"relatorios",
    manuais:"manuais",
  };
  function rotaPermitida(routeId){
    const u=DB.getUser(); if(!u) return false;
    if(u.role==="admin") return true;
    // dashboard e usuarios sempre visíveis
    if(routeId==="dashboard"||routeId==="usuarios") return true;
    const permKey=ROTA_PERM[routeId];
    if(!permKey) return true; // rota sem mapeamento = permitida
    return temPermissaoLocal(permKey,"ver");
  }

  function renderNav(){
    const nav=$("#sidebar-nav");
    if(nav){
      const routesOrdenadas=getRoutesOrdenadas().filter(r=>rotaPermitida(r.id));
      nav.innerHTML=`<div class="nav-section-label" style="display:flex;justify-content:space-between;align-items:center;">
        <span>Menu</span>
        <span style="font-size:10px;color:var(--muted);font-weight:400;">✥ arraste para reordenar</span>
      </div>`+routesOrdenadas.map(r=>`
        <div class="nav-item ${state.route===r.id?"active":""}" data-nav="${esc(r.id)}" draggable="true" data-nav-id="${esc(r.id)}" style="cursor:grab;">
          <span class="nav-item-icon">${r.icon}</span>${esc(r.label)}
          ${r.id==="lembretes"&&pendentesCount()>0?`<span style="margin-left:auto;background:var(--amber);color:#000;border-radius:20px;font-size:10px;font-weight:700;padding:1px 6px;">${pendentesCount()}</span>`:""}
        </div>`).join("");
      $$(".nav-item[data-nav]",nav).forEach(el=>el.addEventListener("click",()=>navigate(el.getAttribute("data-nav"))));

      // Drag-and-drop para reordenar
      let dragId=null;
      $$("[data-nav-id]",nav).forEach(el=>{
        el.addEventListener("dragstart",e=>{
          dragId=el.getAttribute("data-nav-id");
          el.style.opacity="0.4";
          e.dataTransfer.effectAllowed="move";
        });
        el.addEventListener("dragend",()=>{el.style.opacity="";dragId=null;});
        el.addEventListener("dragover",e=>{e.preventDefault();el.style.background="rgba(0,230,118,.1)";});
        el.addEventListener("dragleave",()=>{el.style.background="";});
        el.addEventListener("drop",e=>{
          e.preventDefault();
          el.style.background="";
          if(!dragId||dragId===el.getAttribute("data-nav-id")) return;
          const order=getMenuOrder();
          const fromIdx=order.indexOf(dragId);
          const toIdx=order.indexOf(el.getAttribute("data-nav-id"));
          if(fromIdx<0||toIdx<0) return;
          order.splice(fromIdx,1);
          order.splice(toIdx,0,dragId);
          setMenuOrder(order);
          renderNav();
          toast("✅ Menu reordenado.","info",1500);
        });
      });
    }

    const bottomPermitidos=BOTTOM_NAV.filter(id=>rotaPermitida(id));
    const bn=$("#bottom-nav-items");
    if(bn){
      bn.innerHTML=bottomPermitidos.map(id=>{const r=getRoute(id);return`<div class="bottom-nav-item ${state.route===r.id?"active":""}" data-nav="${esc(r.id)}"><span class="icon">${r.icon}</span><span>${esc(r.label)}</span></div>`;}).join("")+
        `<div class="bottom-nav-item ${!bottomPermitidos.includes(state.route)?"active":""}" id="btn-more"><span class="icon">⋯</span><span>Mais</span></div>`;
      $$(".bottom-nav-item[data-nav]",bn).forEach(el=>el.addEventListener("click",()=>navigate(el.getAttribute("data-nav"))));
      $("#btn-more")?.addEventListener("click",openMoreDrawer);
    }
    const mg=$("#more-drawer-grid");
    if(mg){
      mg.innerHTML=getRoutesOrdenadas().filter(r=>!BOTTOM_NAV.includes(r.id)&&rotaPermitida(r.id)).map(r=>`
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
    // Garantir que cache sempre começa como array mesmo em erro
    if(!Array.isArray(state.cache[cacheKey])) state.cache[cacheKey]=[];
    try{
      const items=await DB.list(apiKey);
      state.cache[cacheKey]=safeArray(items);
    }catch(e){
      // 403 = sem permissão, manter cache como [] silenciosamente
      if(e?.status===403||String(e?.message||"").includes("permiss")){
        state.cache[cacheKey]=[];
      } else {
        console.warn("loadResource erro:",resource,e?.message||e);
      }
    }
    return state.cache[cacheKey];
  }

  async function preloadAll(){
    const user=DB.getUser();
    const isAdmin=user?.role==="admin";
    const perms=user?.permissions||{};
    // Mapa recurso -> chave de permissão
    const recursoPermMap={
      clientes:"clientes", mercadorias:"mercadorias", pedidos:"pedidos",
      rotas:"rotas", despesas:"despesas", lembretes:"lembretes",
      notas:"anotacoes",  // recurso da API "notas" → permissão chave "anotacoes"
    };
    const todos=["clientes","mercadorias","pedidos","rotas","despesas","lembretes","notas"];
    // Filtrar só os que o usuário tem permissão de ver
    const permitidos=todos.filter(r=>{
      if(isAdmin) return true;
      const permKey=recursoPermMap[r]||r;
      if(!perms||Object.keys(perms).length===0) return true; // sem restrições = tudo
      const rp=perms[permKey];
      if(rp===false) return false;
      if(typeof rp==="object"&&rp!==null) return rp.ver!==false;
      return true;
    });
    // Garantir que recursos bloqueados ficam como [] no cache
    todos.forEach(r=>{
      if(!permitidos.includes(r)) state.cache[r==="anotacoes"?"notas":r]=[];
    });
    await Promise.allSettled(permitidos.map(r=>loadResource(r)));
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
    if(route.id==="financeiro"){
      if(!temPermissaoLocal("financeiro")){root.innerHTML=`<div class="card"><p style="color:var(--red);">🚫 Sem permissão para acessar Financeiro.</p></div>`;return;}
      renderFinanceiro(root);return;
    }
    if(route.id==="relatorios"){
      if(!temPermissaoLocal("relatorios")){root.innerHTML=`<div class="card"><p style="color:var(--red);">🚫 Sem permissão para acessar Relatórios.</p></div>`;return;}
      renderRelatorios(root);return;
    }
    if(route.id==="manuais"){renderManuais(root);return;}
    if(route.id==="vendas"){renderVendas(root);return;}
    if(route.id==="visitas"){renderVisitas(root);return;}
    if(route.id==="cartao"){renderCartoes(root);return;}
    if(route.id==="rotas"){
      if(!temPermissaoLocal("rotas")){root.innerHTML=`<div class="card"><p style="color:var(--red);">🚫 Sem permissão para acessar Rotas.</p></div>`;return;}
      renderRotas(root);return;
    }
    if(state._clienteId){renderClienteDetalhes(root,state._clienteId);return;}
    if(route.resource&&SCHEMAS[route.resource]){
      const recurso=route.resource==="notas"?"anotacoes":route.resource;
      if(!temPermissaoLocal(recurso)){root.innerHTML=`<div class="card"><p style="color:var(--red);">🚫 Sem permissão para acessar ${esc(route.label)}.</p></div>`;return;}
      renderCrudScreen(root,route.resource);return;
    }
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
        ${abertos.slice(0,8).map(p=>{
          const urg=String(p.urgencia||"Normal");
          const urgColor=urg==="Alta"?"var(--red)":urg==="Média"?"var(--amber)":urg==="Baixa"?"var(--blue)":"var(--muted)";
          const pid=esc(getId(p));
          return`<div style="background:var(--bg2);border-radius:9px;border:1px solid var(--border);margin-bottom:8px;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;cursor:pointer;" onclick="SuperVendaApp.navigate('pedidos')">
              <div><div style="font-size:13px;font-weight:600;">${esc(p.clienteNome||"")}</div>${p.data?`<div style="font-size:11px;color:var(--muted);">${dateFormatBR(p.data)}</div>`:""}</div>
              <div style="text-align:right;flex-shrink:0;"><div style="font-size:13px;font-weight:600;color:var(--green);">${moneyBR(p.total)}</div><div style="font-size:11px;font-weight:600;color:${urgColor};">${esc(urg)}</div></div>
            </div>
            <div style="display:flex;gap:0;border-top:1px solid var(--border);">
              <button class="btn-dash-acao" data-ped-id="${pid}" data-ped-acao="concluir"
                style="flex:1;padding:7px;background:rgba(0,230,118,.08);border:none;border-right:1px solid var(--border);color:var(--green);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;">
                ✅ Concluir
              </button>
              <button class="btn-dash-acao" data-ped-id="${pid}" data-ped-acao="cancelar"
                style="flex:1;padding:7px;background:rgba(255,82,82,.06);border:none;color:var(--red);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer;">
                ✕ Cancelar
              </button>
            </div>
          </div>`;
        }).join("")}
        ${abertos.length>8?`<div style="text-align:center;font-size:12px;color:var(--muted);padding-top:4px;">+${abertos.length-8} pedidos</div>`:""}
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

    // Botões Concluir / Cancelar do dashboard
    $$(`.btn-dash-acao`,root).forEach(btn=>{
      btn.addEventListener("click",async e=>{
        e.stopPropagation();
        const id=btn.getAttribute("data-ped-id");
        const acao=btn.getAttribute("data-ped-acao");
        const novoStatus=acao==="concluir"?"Entregue":"Cancelado";
        const msg=acao==="concluir"?"Marcar pedido como Entregue?":"Cancelar este pedido?";
        if(!confirm(msg)) return;
        const pedido=safeArray(state.cache.pedidos).find(p=>String(getId(p))===String(id));
        if(!pedido) return;
        await runWithUi(async()=>{
          await DB.update("pedidos",id,{...pedido,status:novoStatus});
          await loadResource("pedidos");
          renderDashboard(root);
          toast(`✅ Pedido ${novoStatus.toLowerCase()}.`,"success");
        },"Atualizando...");
      });
    });
  }

  // CRUD screen
  function renderCrudScreen(root,resource){
    const schema=SCHEMAS[resource];
    const cacheKey=resource;
    const rawItems=safeArray(state.cache[cacheKey]);

    const hoje=new Date().toISOString().slice(0,10);
    const mesAtual=new Date().toISOString().slice(0,7);
    const semanaAtras=new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
    if(!state._pedFiltro) state._pedFiltro="tudo";
    if(!state._lemFiltro) state._lemFiltro="tudo";

    const getFiltered=()=>{
      const q=String(state.ui.search||"").trim().toLowerCase();
      let items=rawItems.map(it=>normalizeItem(resource,it));
      // Filtro de período nos pedidos
      if(resource==="pedidos"&&state._pedFiltro!=="tudo"){
        items=items.filter(it=>{
          const d=String(it.data||"").slice(0,10);
          if(state._pedFiltro==="hoje")   return d===hoje;
          if(state._pedFiltro==="semana") return d>=semanaAtras&&d<=hoje;
          if(state._pedFiltro==="mes")    return d.startsWith(mesAtual);
          return true;
        });
      }
      // Filtro de período nos lembretes
      if(resource==="lembretes"&&state._lemFiltro!=="tudo"){
        items=items.filter(it=>{
          const d=String(it.data||"").slice(0,10);
          if(!d) return state._lemFiltro==="tudo";
          if(state._lemFiltro==="hoje")   return d===hoje;
          if(state._lemFiltro==="semana") return d>=semanaAtras&&d<=hoje;
          if(state._lemFiltro==="mes")    return d.startsWith(mesAtual);
          return true;
        });
      }
      return !q?items:items.filter(it=>Object.values(it||{}).some(v=>String(v??"").toLowerCase().includes(q)));
    };

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
        ${resource==="pedidos"?`
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button class="btn-pfiltro btn ${state._pedFiltro==="hoje"?"btn-primary":"btn-secondary"}" data-pf="hoje" style="font-size:12px;flex:1;">📅 Hoje</button>
          <button class="btn-pfiltro btn ${state._pedFiltro==="semana"?"btn-primary":"btn-secondary"}" data-pf="semana" style="font-size:12px;flex:1;">📆 Semana</button>
          <button class="btn-pfiltro btn ${state._pedFiltro==="mes"?"btn-primary":"btn-secondary"}" data-pf="mes" style="font-size:12px;flex:1;">🗓️ Mês</button>
          <button class="btn-pfiltro btn ${state._pedFiltro==="tudo"?"btn-primary":"btn-secondary"}" data-pf="tudo" style="font-size:12px;flex:1;">📋 Todos</button>
        </div>`:""}
        ${resource==="lembretes"?renderFiltroPeriodo("_lemFiltro"):""}
        ${resource==="mercadorias"?`
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center;">
          <button id="sv-scan-btn" class="btn btn-secondary" style="font-size:12px;background:rgba(0,230,118,.1);border-color:rgba(0,230,118,.3);color:var(--green);">📷 Ler código de barras</button>
          <button id="sv-fotonota-btn" class="btn btn-secondary" style="font-size:12px;background:rgba(68,136,255,.08);border-color:rgba(68,136,255,.25);color:var(--blue);">📸 Importar por foto</button>
          <button id="sv-export-btn" class="btn btn-secondary" style="font-size:12px;">📤 Exportar CSV</button>
          <label id="sv-import-label" class="btn btn-secondary" style="font-size:12px;cursor:pointer;margin:0;">
            📥 Importar CSV/Excel
            <input type="file" id="sv-import-file" accept=".csv,.xlsx,.xls" style="display:none;"/>
          </label>
        </div>`:""}
        <div id="sv-scanner-wrap"></div>
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

    // Filtro de período — pedidos
    if(resource==="pedidos"){
      $$(".btn-pfiltro").forEach(btn=>{
        btn.addEventListener("click",()=>{
          state._pedFiltro=btn.getAttribute("data-pf")||"tudo";
          $$(".btn-pfiltro").forEach(b=>{b.className=b.className.replace("btn-primary","btn-secondary");});
          btn.className=btn.className.replace("btn-secondary","btn-primary");
          const f=getFiltered();
          const cnt=$("#sv-count");
          if(cnt) cnt.textContent=`${f.length} registro${f.length!==1?"s":""}`;
          renderList(resource,f,rawItems);
        });
      });
    }
    // Filtro de período — lembretes
    if(resource==="lembretes"){
      bindFiltroPeriodo("_lemFiltro",()=>{
        const f=getFiltered();
        const cnt=$("#sv-count");
        if(cnt) cnt.textContent=`${f.length} registro${f.length!==1?"s":""}`;
        renderList(resource,f,rawItems);
      });
    }

    // Exportar CSV (mercadorias)
    if(resource==="mercadorias"){
      $("#sv-export-btn")?.addEventListener("click",()=>{
        const items=rawItems.map(it=>normalizeItem("mercadorias",it));
        const cols=["nome","marca","categoria","codigo","valor_compra","valor_venda","estoque","estoqueMin","descricao"];
        const header=cols.join(";");
        const rows=items.map(m=>cols.map(c=>{
          const v=m[c]??"";
          return typeof v==="string"&&v.includes(";")?`"${v}"`:v;
        }).join(";"));
        const csv="\uFEFF"+[header,...rows].join("\n"); // BOM para Excel PT-BR
        const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
        const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(blob),download:`mercadorias_${new Date().toISOString().slice(0,10)}.csv`});
        a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
        toast(`✅ ${items.length} produtos exportados.`,"success");
      });

      // Importar CSV ou Excel
      $("#sv-import-file")?.addEventListener("change",async e=>{
        const file=e.target.files[0]; if(!file) return;
        e.target.value="";
        const ext=file.name.split(".").pop().toLowerCase();

        const processRows=async(rows)=>{
          if(!rows.length){toast("Arquivo vazio ou sem dados reconhecíveis.","warning");return;}
          const ok=[];const erros=[];
          for(const row of rows){
            const nome=String(row.nome||row.Produto||row.produto||row.NOME||"").trim().toUpperCase();
            if(!nome){erros.push("Linha sem nome ignorada");continue;}
            const payload={
              nome, produto:nome,
              marca:String(row.marca||row.Marca||"").toUpperCase(),
              categoria:String(row.categoria||row.Categoria||"").toUpperCase(),
              codigo:String(row.codigo||row.sku||row.Codigo||row.SKU||"").toUpperCase(),
              valor_compra:Number(String(row.valor_compra||row.valorCompra||row["Valor compra"]||0).replace(",","."))||0,
              valor_venda:Number(String(row.valor_venda||row.valorVenda||row["Valor venda"]||0).replace(",","."))||0,
              estoque:Number(row.estoque||row.Estoque||row.estoqueAtual||0)||0,
              estoqueMin:Number(row.estoqueMin||row["Estoque minimo"]||row["Estoque mínimo"]||0)||0,
              descricao:String(row.descricao||row.Descrição||row.descricao||""),
              valorCompra:Number(String(row.valor_compra||row.valorCompra||0).replace(",","."))||0,
              valorVenda:Number(String(row.valor_venda||row.valorVenda||0).replace(",","."))||0,
              estoqueAtual:Number(row.estoque||row.estoqueAtual||0)||0,
              sku:String(row.codigo||row.sku||""),
            };
            try{
              const existente=rawItems.find(m=>String(m.nome||m.produto||"").toUpperCase()===nome);
              if(existente) await DB.update("mercadorias",getId(existente),payload);
              else await DB.create("mercadorias",payload);
              ok.push(nome);
            }catch(err){erros.push(`${nome}: ${err?.message||"erro"}`);}
          }
          await loadResource("mercadorias");
          renderCrudScreen(root,"mercadorias");
          toast(`✅ ${ok.length} produto${ok.length!==1?"s":""} importado${ok.length!==1?"s":""}${erros.length?` · ⚠️ ${erros.length} erro(s)`:""}`, ok.length?"success":"warning", 6000);
          if(erros.length) console.warn("Erros na importação:",erros);
        };

        if(ext==="csv"){
          const text=await file.text();
          const lines=text.replace(/\r/g,"").split("\n").filter(l=>l.trim());
          if(lines.length<2){toast("CSV sem dados.","warning");return;}
          const sep=lines[0].includes(";")?";":lines[0].includes("\t")?"\t":",";
          const headers=lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,""));
          const rows=lines.slice(1).map(line=>{
            const vals=line.split(sep).map(v=>v.trim().replace(/^"|"$/g,""));
            const obj={};headers.forEach((h,i)=>obj[h]=vals[i]||"");return obj;
          });
          await runWithUi(()=>processRows(rows),"Importando CSV...");
        } else {
          // Excel via FileReader + parse manual simplificado (sem lib)
          toast("Para Excel, salve como CSV (separado por ponto-e-vírgula) e importe novamente. O CSV é compatível com Excel.","warning",6000);
        }
      });
    }

    // Scanner de código de barras via câmera
    if(resource==="mercadorias"){
      $("#sv-scan-btn")?.addEventListener("click",()=>abrirScanner(root,rawItems,resource));
      $("#sv-fotonota-btn")?.addEventListener("click",()=>abrirFotoNotaMercadorias(root,rawItems));
    }

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
      const tel=resource==="clientes"?String(item.telefone||"").replace(/\D/g,""):"";
      const wppMsg=encodeURIComponent("Olá, Willyam da Cefeq.");
      const wppHref=tel.length>=10?`https://wa.me/55${tel}?text=${wppMsg}`:"";
      return`<div class="list-item">
        <div class="list-item-top">
          <div class="list-item-title" ${clickable?`data-cliente-id="${esc(id)}" style="cursor:pointer;color:var(--green);text-decoration:underline;text-decoration-style:dotted;"`:""}>${esc(String(pv||""))}</div>
          <span class="badge badge-muted" style="font-size:10px;">${esc(id)}</span>
        </div>
        ${metaHtml?`<div style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">${metaHtml}</div>`:""}
        <div class="list-item-actions">
          ${clickable?`<button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-cliente-ver="${esc(id)}">👁 Ver detalhes</button>`:""}
          ${wppHref?`<a href="${wppHref}" target="_blank" class="btn btn-secondary" style="font-size:13px;padding:7px 14px;background:rgba(37,211,102,.12);border-color:rgba(37,211,102,.35);color:#25d366;text-decoration:none;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#25d366" style="vertical-align:middle;margin-right:4px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp</a>`:""}
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

  // Máscaras de input
  function aplicarMascaras(wrap){
    // Telefone: (00) 00000-0000 ou (00) 0000-0000
    wrap.querySelectorAll("[name='telefone']").forEach(el=>{
      el.setAttribute("inputmode","tel");
      el.setAttribute("placeholder","(00) 00000-0000");
      el.addEventListener("input",()=>{
        let v=el.value.replace(/\D/g,"").slice(0,11);
        if(v.length<=10) v=v.replace(/^(\d{2})(\d{4})(\d{0,4})$/,"($1) $2-$3");
        else             v=v.replace(/^(\d{2})(\d{5})(\d{0,4})$/,"($1) $2-$3");
        el.value=v.replace(/-$/,"");
      });
    });
    // CEP: 00000-000
    wrap.querySelectorAll("[name='cep']").forEach(el=>{
      el.setAttribute("inputmode","numeric");
      el.setAttribute("placeholder","00000-000");
      el.addEventListener("input",()=>{
        let v=el.value.replace(/\D/g,"").slice(0,8);
        if(v.length>5) v=v.replace(/^(\d{5})(\d{0,3})$/,"$1-$2");
        el.value=v;
      });
    });
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
    // Formatar telefone e CEP na exibição
    let displayVal=noUpper?out:String(out).toUpperCase();
    if(f.key==="telefone"&&displayVal){
      const d=displayVal.replace(/\D/g,"");
      if(d.length===11) displayVal=d.replace(/^(\d{2})(\d{5})(\d{4})$/,"($1) $2-$3");
      else if(d.length===10) displayVal=d.replace(/^(\d{2})(\d{4})(\d{4})$/,"($1) $2-$3");
    }
    if(f.key==="cep"&&displayVal){
      const d=displayVal.replace(/\D/g,"");
      if(d.length===8) displayVal=d.replace(/^(\d{5})(\d{3})$/,"$1-$2");
    }
    const inputStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;${noUpper||f.key==="telefone"||f.key==="cep"?"":"text-transform:uppercase;"}`;

    // Campo endereço com botão de localização atual
    if(f.key==="endereco"){
      return`<div class="field">
        <label style="display:flex;align-items:center;justify-content:space-between;">
          ${esc(f.label)}
          <button type="button" id="btn-geo-endereco" style="font-size:11px;padding:3px 8px;background:rgba(0,230,118,.1);border:1px solid rgba(0,230,118,.3);border-radius:6px;color:var(--green);cursor:pointer;font-family:var(--font);">📍 Usar localização</button>
        </label>
        <input type="text" name="${esc(f.key)}" id="inp-endereco" value="${esc(displayVal)}" style="${inputStyle}"/>
      </div>`;
    }

    return`<div class="field"><label>${esc(f.label)}</label><input type="${type}" name="${esc(f.key)}" value="${esc(displayVal)}" style="${inputStyle}"/></div>`;
  }

  // Bind autocomplete fields after form render
  function bindAutocomplete(wrap,schema){
    schema.fields.filter(f=>f.type==="autocomplete").forEach(f=>{
      const input=wrap.querySelector(`#ac-${f.key}`);
      const drop=wrap.querySelector(`#ac-drop-${f.key}`);
      if(!input||!drop) return;
      const source=safeArray(state.cache[f.source]||[]);

      const showDrop=(q)=>{
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
          <div style="display:flex;gap:6px;align-items:center;">
            <button id="sv-close-form" class="btn btn-ghost btn-icon">✕</button>
          </div>
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
            ${isEdit&&resource==="clientes"?`<button type="button" id="sv-btn-pedido-cliente" class="btn btn-secondary" style="font-size:13px;">🛒 Novo pedido</button>`:""}
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
    aplicarMascaras(wrap);

    // Geolocalização no endereço (clientes)
    wrap.querySelector("#btn-geo-endereco")?.addEventListener("click",async()=>{
      const btn=wrap.querySelector("#btn-geo-endereco");
      const inp=wrap.querySelector("#inp-endereco");
      if(!inp) return;
      if(!navigator.geolocation){toast("Geolocalização não disponível neste dispositivo.","warning");return;}
      btn.textContent="⏳ Buscando..."; btn.disabled=true;
      navigator.geolocation.getCurrentPosition(async pos=>{
        const {latitude:lat,longitude:lng}=pos.coords;
        try{
          const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
            {headers:{"User-Agent":"supervenda-app"}});
          const d=await r.json();
          const a=d.address||{};
          const rua=a.road||a.pedestrian||a.footway||"";
          const num=a.house_number||"";
          const bairro=a.suburb||a.neighbourhood||a.quarter||"";
          const cidade=a.city||a.town||a.village||"";
          const uf=a.state_code||a.state||"";
          const cep=(a.postcode||"").replace(/\D/g,"");
          // Preencher campos do formulário
          inp.value=(rua+(num?" "+num:"")).toUpperCase();
          const campos={bairro,cidade,"uf":uf,cep};
          Object.entries(campos).forEach(([k,v])=>{
            const el=wrap.querySelector(`[name="${k}"]`);
            if(el&&v) el.value=k==="cep"?v.replace(/^(\d{5})(\d{3})$/,"$1-$2"):v.toUpperCase();
          });
          toast("📍 Endereço preenchido pela localização atual.","success");
        }catch{
          inp.value=`LAT ${lat.toFixed(6)}, LNG ${lng.toFixed(6)}`;
          toast("Localização obtida (sem endereço reverso disponível).","info");
        }
        btn.textContent="📍 Usar localização"; btn.disabled=false;
      },err=>{
        toast("Não foi possível obter localização: "+err.message,"error");
        btn.textContent="📍 Usar localização"; btn.disabled=false;
      },{enableHighAccuracy:true,timeout:10000});
    });

    // Voz em todos os campos de texto de qualquer formulário
    setTimeout(()=>bindVozNoCampo(wrap),120);

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

    // Botão novo pedido a partir do cliente
    $("#sv-btn-pedido-cliente")?.addEventListener("click",()=>{
      const nome=wrap.querySelector("[name='nome']")?.value||itemView?.nome||"";
      wrap.innerHTML="";
      navigate("pedidos");
      setTimeout(()=>{
        renderFormPedido(null);
        setTimeout(()=>{
          const acInp=$("#sv-form-wrap #ac-clienteNome");
          if(acInp&&nome){ acInp.value=nome.toUpperCase(); acInp.dispatchEvent(new Event("input")); }
          $("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"});
        },120);
      },80);
    });

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

    function addItemManual(salvarMerc=false){
      const nome=String(wrap.querySelector("#ped-item-nome")?.value||"").trim().toUpperCase();
      const qtd=Number(String(wrap.querySelector("#ped-item-qtd")?.value||"1").replace(",","."))||1;
      const val=Number(String(wrap.querySelector("#ped-item-val")?.value||"0").replace(",","."))||0;
      if(!nome){toast("Informe o nome do item.","warning");return;}
      pedidoItens.push({id:String(Math.random()),nome,codigo:"",qtd,valorUnit:val,desconto:0});
      wrap.querySelector("#ped-item-nome").value="";
      wrap.querySelector("#ped-item-qtd").value="1";
      wrap.querySelector("#ped-item-val").value="";
      renderItens();
      // Salvar em mercadorias se solicitado
      if(salvarMerc&&nome){
        DB.create("mercadorias",{
          nome,produto:nome,codigo:"",sku:"",marca:"",categoria:"",
          valor_venda:val,valorVenda:val,valor_compra:0,valorCompra:0,
          estoque:0,estoqueAtual:0,estoqueMin:0,descricao:"",
        }).then(()=>{
          loadResource("mercadorias");
          toast(`✅ "${nome}" salvo em Mercadorias.`,"success",3000);
        }).catch(()=>toast("Erro ao salvar em Mercadorias.","error"));
      }
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
            <div style="display:grid;grid-template-columns:1fr 70px 100px;gap:6px;align-items:flex-end;margin-bottom:6px;">
              <div><label style="font-size:11px;color:var(--muted);">Produto</label><input type="text" id="ped-item-nome" placeholder="Nome do item" style="${inStyleSm}"/></div>
              <div><label style="font-size:11px;color:var(--muted);">Qtd</label><input type="number" id="ped-item-qtd" value="1" min="0.01" step="0.01" style="${inStyleSm}text-align:center;"/></div>
              <div><label style="font-size:11px;color:var(--muted);">Valor unit.</label><input type="text" inputmode="decimal" id="ped-item-val" placeholder="0,00" style="${inStyleSm}text-align:right;"/></div>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" id="ped-add-manual" class="btn btn-secondary" style="flex:1;">+ Add ao pedido</button>
              <button type="button" id="ped-add-salvar-merc" class="btn btn-secondary" style="flex:1;font-size:12px;color:var(--blue);border-color:rgba(68,136,255,.3);background:rgba(68,136,255,.07);" title="Adiciona ao pedido E salva em Mercadorias">+ Add + 📦 Salvar</button>
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
      const showCliDrop=(q)=>{
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
    wrap.querySelector("#ped-add-manual")?.addEventListener("click",()=>addItemManual(false));
    wrap.querySelector("#ped-add-salvar-merc")?.addEventListener("click",()=>addItemManual(true));
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
          <p style="margin-top:6px;font-size:10px;color:#aaa;">Desenvolvido por Willtech84</p>
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

    // Voz nos campos do pedido
    setTimeout(()=>bindVozNoCampo(wrap),120);

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

  // ─── Scanner de Câmera: Código de Barras + OCR via Claude ───────────────────
  async function abrirScanner(root, rawItems, resource){
    const wrap=$("#sv-scanner-wrap"); if(!wrap) return;
    if(wrap.querySelector("#sv-scanner-modal")){wrap.innerHTML="";return;}

    // ── modos: "barcode" = leitura contínua | "ocr" = foto + Claude AI ──
    let modoAtual="barcode";
    let stream=null, rafId=null, detector=null, ultimoCodigo="", debounceTimer=null;

    wrap.innerHTML=`
      <div id="sv-scanner-modal" style="position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.95);
        display:flex;flex-direction:column;align-items:center;overflow:hidden;">

        <!-- Header -->
        <div style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:rgba(0,0,0,.7);flex-shrink:0;">
          <div>
            <div style="font-size:15px;font-weight:700;color:#fff;">📷 Buscar produto pela câmera</div>
            <div id="sv-scan-status" style="font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;">Iniciando câmera...</div>
          </div>
          <button id="sv-scan-close" style="background:rgba(255,255,255,.1);border:none;color:#fff;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;">✕</button>
        </div>

        <!-- Tabs de modo -->
        <div style="display:flex;width:100%;max-width:480px;background:rgba(255,255,255,.06);flex-shrink:0;">
          <button id="tab-barcode" style="flex:1;padding:10px;border:none;background:rgba(0,230,118,.15);color:#00e676;font-family:var(--font);font-size:13px;font-weight:700;border-bottom:2px solid #00e676;cursor:pointer;">
            ▌▌▌ Código de barras
          </button>
          <button id="tab-ocr" style="flex:1;padding:10px;border:none;background:transparent;color:rgba(255,255,255,.5);font-family:var(--font);font-size:13px;font-weight:600;border-bottom:2px solid transparent;cursor:pointer;">
            🔤 Ler texto / código
          </button>
        </div>

        <!-- Visor -->
        <div style="position:relative;width:100%;max-width:480px;flex:1;overflow:hidden;background:#000;min-height:200px;">
          <video id="sv-scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;display:block;"></video>

          <!-- Mira modo barcode -->
          <div id="sv-mira-barcode" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <div style="position:relative;width:75%;max-width:300px;height:100px;border:2px solid rgba(0,230,118,.7);border-radius:10px;box-shadow:0 0 0 2000px rgba(0,0,0,.35);">
              <div style="position:absolute;top:-2px;left:-2px;width:18px;height:18px;border-top:3px solid #00e676;border-left:3px solid #00e676;border-radius:3px 0 0 0;"></div>
              <div style="position:absolute;top:-2px;right:-2px;width:18px;height:18px;border-top:3px solid #00e676;border-right:3px solid #00e676;border-radius:0 3px 0 0;"></div>
              <div style="position:absolute;bottom:-2px;left:-2px;width:18px;height:18px;border-bottom:3px solid #00e676;border-left:3px solid #00e676;border-radius:0 0 0 3px;"></div>
              <div style="position:absolute;bottom:-2px;right:-2px;width:18px;height:18px;border-bottom:3px solid #00e676;border-right:3px solid #00e676;border-radius:0 0 3px 0;"></div>
              <div style="position:absolute;left:6px;right:6px;height:2px;background:rgba(0,230,118,.8);top:50%;border-radius:2px;animation:scanLine 2s linear infinite;"></div>
              <div style="position:absolute;bottom:-28px;width:100%;text-align:center;font-size:11px;color:rgba(255,255,255,.5);">Alinhe o código de barras aqui</div>
            </div>
          </div>

          <!-- Mira modo OCR -->
          <div id="sv-mira-ocr" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;display:none;">
            <div style="position:relative;width:85%;max-width:340px;height:160px;border:2px dashed rgba(255,200,0,.7);border-radius:10px;box-shadow:0 0 0 2000px rgba(0,0,0,.35);">
              <div style="position:absolute;bottom:-28px;width:100%;text-align:center;font-size:11px;color:rgba(255,200,0,.7);">Enquadre a etiqueta ou código do produto</div>
            </div>
          </div>

          <!-- Botão tirar foto (só modo OCR) -->
          <div id="sv-foto-btn-wrap" style="display:none;position:absolute;bottom:16px;left:50%;transform:translateX(-50%);">
            <button id="sv-foto-btn" style="width:64px;height:64px;border-radius:50%;background:#fff;border:4px solid rgba(255,255,255,.4);cursor:pointer;font-size:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.5);">📸</button>
          </div>

          <canvas id="sv-scan-canvas" style="display:none;"></canvas>
        </div>

        <!-- Resultado + manual -->
        <div style="width:100%;max-width:480px;padding:14px 18px;flex-shrink:0;overflow-y:auto;max-height:45vh;">
          <div id="sv-scan-result" style="display:none;border-radius:12px;padding:14px;margin-bottom:10px;"></div>

          <div style="display:flex;gap:8px;">
            <input id="sv-scan-manual" type="text" placeholder="Buscar por código ou nome..." autocomplete="off"
              style="flex:1;padding:11px 14px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:10px;color:#fff;font-family:var(--font);font-size:14px;"/>
            <button id="sv-scan-manual-btn" style="padding:11px 16px;background:var(--green);border:none;border-radius:10px;color:#000;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;">Buscar</button>
          </div>
          <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,.35);text-align:center;" id="sv-scan-hint">
            Modo barras: leitura automática contínua
          </div>
        </div>
      </div>
      <style>@keyframes scanLine{0%{top:10%}50%{top:88%}100%{top:10%}}</style>`;

    const video=document.getElementById("sv-scan-video");
    const canvas=document.getElementById("sv-scan-canvas");
    const status=document.getElementById("sv-scan-status");
    const resultDiv=document.getElementById("sv-scan-result");
    const hint=document.getElementById("sv-scan-hint");

    // ── Fechar ──────────────────────────────────────────────────────────────
    function fecharScanner(){
      if(rafId) cancelAnimationFrame(rafId);
      if(stream) stream.getTracks().forEach(t=>t.stop());
      wrap.innerHTML="";
    }
    document.getElementById("sv-scan-close")?.addEventListener("click",fecharScanner);

    // ── Buscar produto (por código exato ou texto parcial) ─────────────────
    function exibirResultado(codigo, encontrados){
      resultDiv.style.display="block";
      try{ navigator.vibrate?.([80]); }catch{}

      if(encontrados.length===1){
        const m=encontrados[0];
        const nome=m.nome||m.produto||"";
        const preco=Number(m.valorVenda||m.valor_venda||0);
        const cod=m.codigo||m.sku||codigo;
        resultDiv.style.background="rgba(0,230,118,.1)";
        resultDiv.style.border="1px solid rgba(0,230,118,.3)";
        resultDiv.innerHTML=`
          <div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:6px;">✅ Produto encontrado</div>
          <div style="font-size:15px;font-weight:700;color:#fff;">${esc(nome)}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;">Código: ${esc(m.codigo||m.sku||codigo)}</div>
          <div style="font-size:16px;font-weight:700;color:#00e676;margin-top:6px;">R$ ${preco.toFixed(2).replace(".",",")}</div>
          <button id="sv-r-editar" style="margin-top:10px;width:100%;padding:12px;background:#00e676;border:none;border-radius:10px;color:#000;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer;">✏️ Editar produto / preço</button>`;
        document.getElementById("sv-r-editar")?.addEventListener("click",()=>{
          fecharScanner();
          renderForm(resource,encontrados[0]);
          setTimeout(()=>$("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"}),100);
        });

      } else if(encontrados.length>1){
        // Múltiplos resultados — mostrar lista
        resultDiv.style.background="rgba(68,136,255,.1)";
        resultDiv.style.border="1px solid rgba(68,136,255,.3)";
        resultDiv.innerHTML=`
          <div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:8px;">${encontrados.length} produtos encontrados para "${esc(codigo)}"</div>
          ${encontrados.slice(0,5).map((m,i)=>{
            const nome=m.nome||m.produto||"";
            const preco=Number(m.valorVenda||m.valor_venda||0);
            return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,.06);border-radius:8px;margin-bottom:6px;cursor:pointer;" data-idx="${i}">
              <div><div style="font-size:13px;font-weight:600;color:#fff;">${esc(nome)}</div><div style="font-size:11px;color:rgba(255,255,255,.4);">${esc(m.codigo||m.sku||"")}</div></div>
              <div style="font-size:14px;font-weight:700;color:#00e676;white-space:nowrap;">R$ ${preco.toFixed(2).replace(".",",")}</div>
            </div>`;
          }).join("")}`;
        resultDiv.querySelectorAll("[data-idx]").forEach(el=>{
          el.addEventListener("click",()=>{
            const idx=Number(el.getAttribute("data-idx"));
            fecharScanner();
            renderForm(resource,encontrados[idx]);
            setTimeout(()=>$("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"}),100);
          });
        });

      } else {
        // Não encontrado
        resultDiv.style.background="rgba(255,179,0,.08)";
        resultDiv.style.border="1px solid rgba(255,179,0,.25)";
        resultDiv.innerHTML=`
          <div style="font-size:13px;color:var(--amber);font-weight:600;">⚠️ Produto não encontrado</div>
          <div style="font-size:12px;color:rgba(255,255,255,.4);margin-top:4px;">Buscado: "${esc(codigo)}"</div>
          <button id="sv-r-criar" style="margin-top:10px;width:100%;padding:12px;background:rgba(0,230,118,.12);border:1px solid rgba(0,230,118,.3);border-radius:10px;color:#00e676;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer;">➕ Cadastrar novo produto</button>`;
        document.getElementById("sv-r-criar")?.addEventListener("click",()=>{
          fecharScanner();
          renderForm(resource,null);
          setTimeout(()=>{
            const el=$("#sv-form-wrap [name='codigo']")||$("#sv-form-wrap [name='sku']");
            if(el){ el.value=codigo.toUpperCase(); el.dispatchEvent(new Event("input")); }
            const nomEl=$("#sv-form-wrap [name='nome']")||$("#sv-form-wrap [name='produto']");
            if(nomEl&&!nomEl.value) nomEl.focus();
            $("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"});
          },150);
        });
      }
    }

    function buscarPorCodigo(codigo){
      if(!codigo) return;
      const q=codigo.trim().toLowerCase();
      const norm=s=>String(s||"").toLowerCase().replace(/[\s\-_]/g,"");
      // Normalizar rawItems para garantir campo nome/codigo correto
      const items=rawItems.map(m=>normalizeItem(resource,m));

      // 1. Busca exata por código/SKU/barcode
      let encontrados=items.filter(m=>
        norm(m.codigo)===norm(q)||norm(m.sku)===norm(q)||
        norm(m.codigoBarras)===norm(q)||norm(m.barcode)===norm(q)
      );
      // 2. Busca parcial em nome + código + marca
      if(!encontrados.length){
        encontrados=items.filter(m=>
          String(m.nome||m.produto||"").toLowerCase().includes(q)||
          String(m.codigo||m.sku||"").toLowerCase().includes(q)||
          String(m.marca||"").toLowerCase().includes(q)||
          String(m.descricao||"").toLowerCase().includes(q)
        );
      }
      // Referenciar os rawItems originais para o renderForm funcionar corretamente
      const encontradosRaw=encontrados.map(m=>rawItems.find(r=>getId(r)===getId(m))||m);
      exibirResultado(codigo, encontradosRaw);
    }

    // ── OCR via Claude API ──────────────────────────────────────────────────
    async function processarFotoOCR(){
      if(!stream||!video.readyState||video.readyState<2) return;
      canvas.width=video.videoWidth||640;
      canvas.height=video.videoHeight||480;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(video,0,0,canvas.width,canvas.height);

      const fotoBtn=document.getElementById("sv-foto-btn");
      if(fotoBtn){ fotoBtn.disabled=true; fotoBtn.textContent="⏳"; }
      if(status) status.textContent="🤖 Analisando imagem...";

      try{
        const base64=canvas.toDataURL("image/jpeg",0.85).split(",")[1];
        const resp=await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            model:"claude-sonnet-4-20250514",
            max_tokens:200,
            messages:[{
              role:"user",
              content:[
                {type:"image",source:{type:"base64",media_type:"image/jpeg",data:base64}},
                {type:"text",text:`Analise esta imagem de produto/etiqueta e extraia APENAS o código do produto ou referência alfanumérica (ex: ST5454, CHV-001, ABC123). Se houver um código de barras, extraia o número dele. Se houver apenas nome do produto sem código, retorne o nome. Responda SOMENTE com o código ou nome encontrado, sem explicações. Se não conseguir identificar nada útil, responda: NAO_IDENTIFICADO`}
              ]
            }]
          })
        });
        const data=await resp.json();
        const texto=(data?.content?.[0]?.text||"").trim().replace(/["'.]/g,"");

        if(!texto||texto==="NAO_IDENTIFICADO"||texto.length<2){
          if(status) status.textContent="Não consegui ler — tente aproximar mais ou melhorar a luz";
          toast("Não foi possível identificar texto na imagem.","warning");
          if(fotoBtn){ fotoBtn.disabled=false; fotoBtn.textContent="📸"; }
          return;
        }

        if(status) status.textContent=`🔤 Texto lido: "${texto}"`;
        // Preencher a busca manual e disparar a busca
        const manInp=document.getElementById("sv-scan-manual");
        if(manInp){ manInp.value=texto; }
        buscarPorCodigo(texto);

      }catch(e){
        if(status) status.textContent="Erro ao analisar — tente novamente";
        console.warn("OCR erro:",e);
      }
      if(fotoBtn){ fotoBtn.disabled=false; fotoBtn.textContent="📸"; }
    }

    // ── Tabs: trocar modo ───────────────────────────────────────────────────
    function setModo(modo){
      modoAtual=modo;
      ultimoCodigo="";
      resultDiv.style.display="none";

      const tabBar=document.getElementById("tab-barcode");
      const tabOcr=document.getElementById("tab-ocr");
      const miraBar=document.getElementById("sv-mira-barcode");
      const miraOcr=document.getElementById("sv-mira-ocr");
      const fotoBtnWrap=document.getElementById("sv-foto-btn-wrap");

      if(modo==="barcode"){
        tabBar.style.background="rgba(0,230,118,.15)"; tabBar.style.color="#00e676"; tabBar.style.borderBottom="2px solid #00e676";
        tabOcr.style.background="transparent"; tabOcr.style.color="rgba(255,255,255,.5)"; tabOcr.style.borderBottom="2px solid transparent";
        miraBar.style.display="flex"; miraOcr.style.display="none"; fotoBtnWrap.style.display="none";
        if(hint) hint.textContent="Modo barras: leitura automática contínua";
        if(status) status.textContent="Aponte para o código de barras";
        document.getElementById("sv-scan-manual").placeholder="Ou digite o código...";
        document.getElementById("sv-scan-manual").inputMode="numeric";
      } else {
        tabOcr.style.background="rgba(255,200,0,.1)"; tabOcr.style.color="#ffd700"; tabOcr.style.borderBottom="2px solid #ffd700";
        tabBar.style.background="transparent"; tabBar.style.color="rgba(255,255,255,.5)"; tabBar.style.borderBottom="2px solid transparent";
        miraBar.style.display="none"; miraOcr.style.display="flex"; fotoBtnWrap.style.display="flex";
        if(hint) hint.textContent="Enquadre a etiqueta e toque 📸 para analisar";
        if(status) status.textContent="Posicione o produto no enquadramento";
        document.getElementById("sv-scan-manual").placeholder="Ou digite código/nome do produto...";
        document.getElementById("sv-scan-manual").inputMode="text";
      }
    }

    document.getElementById("tab-barcode")?.addEventListener("click",()=>setModo("barcode"));
    document.getElementById("tab-ocr")?.addEventListener("click",()=>setModo("ocr"));
    document.getElementById("sv-foto-btn")?.addEventListener("click",processarFotoOCR);

    // ── Busca manual ────────────────────────────────────────────────────────
    const manualInput=document.getElementById("sv-scan-manual");
    document.getElementById("sv-scan-manual-btn")?.addEventListener("click",()=>{
      const v=manualInput?.value?.trim(); if(v) buscarPorCodigo(v);
    });
    manualInput?.addEventListener("keydown",e=>{
      if(e.key==="Enter"){ const v=manualInput.value.trim(); if(v) buscarPorCodigo(v); }
    });

    // ── Iniciar câmera ──────────────────────────────────────────────────────
    try{
      stream=await navigator.mediaDevices.getUserMedia({
        video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}}
      });
      video.srcObject=stream;
      await video.play();
      canvas.width=video.videoWidth||640;
      canvas.height=video.videoHeight||480;
      if(status) status.textContent="Câmera ativa — aponte para o código";

      // BarcodeDetector nativo
      if(typeof BarcodeDetector!=="undefined"){
        try{
          const fmts=await BarcodeDetector.getSupportedFormats().catch(()=>[]);
          detector=new BarcodeDetector({formats:fmts.length?fmts:["ean_13","ean_8","code_128","qr_code","upc_a","upc_e","code_39","code_93"]});
        }catch{ detector=null; }
      }

      // Loop de detecção (só no modo barcode)
      const ctx=canvas.getContext("2d");
      const loopDetect=async()=>{
        if(!stream) return;
        if(modoAtual==="barcode"&&video.readyState>=2){
          try{
            if(detector){
              const hits=await detector.detect(video);
              if(hits.length){
                const cod=hits[0].rawValue;
                if(cod!==ultimoCodigo){
                  ultimoCodigo=cod;
                  clearTimeout(debounceTimer);
                  debounceTimer=setTimeout(()=>buscarPorCodigo(cod),250);
                }
              }
            } else if(window.ZXing){
              ctx.drawImage(video,0,0,canvas.width,canvas.height);
              const imgData=ctx.getImageData(0,0,canvas.width,canvas.height);
              const res=window.ZXing.readBarcodesFromImageData?.(imgData,{tryHarder:true});
              if(res?.length&&res[0].text&&res[0].text!==ultimoCodigo){
                ultimoCodigo=res[0].text;
                clearTimeout(debounceTimer);
                debounceTimer=setTimeout(()=>buscarPorCodigo(res[0].text),250);
              }
            }
          }catch{}
        }
        rafId=requestAnimationFrame(loopDetect);
      };
      loopDetect();

      // Fallback ZXing
      if(!detector&&!window.ZXing){
        const s=document.createElement("script");
        s.src="https://cdn.jsdelivr.net/npm/zxing-wasm@1.2.8/dist/full/zxing_full.min.js";
        s.onload=()=>window.ZXing?.initialize?.().catch(()=>{});
        document.head.appendChild(s);
      }

    }catch(e){
      if(status) status.textContent="❌ Câmera indisponível — use a busca manual";
      console.warn("Câmera:",e?.message);
    }
  }

  // ─── Entrada por Voz (Anotações e Lembretes) ─────────────────────────────────
  function bindVozNoCampo(wrap){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return;

    const campos=Array.from(wrap.querySelectorAll("input,textarea")).filter(el=>{
      const t=(el.type||"text").toLowerCase();
      return !["number","email","date","checkbox","radio","file","submit","button","hidden","search"].includes(t);
    });

    campos.forEach(campo=>{
      const nome=campo.name||campo.id||Math.random().toString(36).slice(2,8);
      const btnId="bvoz-"+nome;
      if(wrap.querySelector("#"+btnId)) return;
      const lbl=campo.closest(".field")?.querySelector("label");
      if(!lbl) return;

      const btn=document.createElement("button");
      btn.type="button"; btn.id=btnId;
      btn.style.cssText="margin-left:6px;padding:3px 9px;background:rgba(68,136,255,.12);border:1px solid rgba(68,136,255,.3);border-radius:6px;color:var(--blue);font-size:12px;cursor:pointer;font-family:var(--font);flex-shrink:0;";
      btn.textContent="🎤";
      btn.title="Clique para falar";
      lbl.style.cssText+="display:flex;align-items:center;justify-content:space-between;";
      lbl.appendChild(btn);

      let rec=null, ativo=false;

      btn.addEventListener("click",()=>{
        if(ativo){ rec?.stop(); return; }

        rec=new SR();
        rec.lang="pt-BR";
        rec.continuous=false;   // ← uma frase por vez: sem repetição
        rec.interimResults=false; // ← só entrega resultado final confirmado

        rec.onstart=()=>{
          ativo=true;
          btn.textContent="⏹";
          btn.style.background="rgba(255,82,82,.15)";
          btn.style.borderColor="rgba(255,82,82,.4)";
          btn.style.color="var(--red)";
          btn.title="Parar";
        };

        rec.onend=()=>{
          ativo=false;
          btn.textContent="🎤";
          btn.style.background="rgba(68,136,255,.12)";
          btn.style.borderColor="rgba(68,136,255,.3)";
          btn.style.color="var(--blue)";
          btn.title="Clique para falar";
          rec=null;
        };

        rec.onerror=e=>{
          const msgs={
            "not-allowed":"Permissão de microfone negada.",
            "no-speech":"Nenhuma fala detectada.",
            "network":"Erro de conexão.",
          };
          toast(msgs[e.error]||"Erro: "+e.error,"warning",3000);
          rec?.stop();
        };

        rec.onresult=e=>{
          // Com interimResults=false, results[0] é sempre final e único
          const texto=(e.results[0][0].transcript||"").trim().toUpperCase();
          if(!texto) return;
          const sep=campo.value.trim()?" ":"";
          campo.value=campo.value.trim()+sep+texto;
          campo.dispatchEvent(new Event("input",{bubbles:true}));
          // Reiniciar automaticamente para continuar ditando
          setTimeout(()=>{ if(!ativo) btn.click(); },300);
        };

        try{ rec.start(); }
        catch(e){ toast("Microfone indisponível.","warning"); }
      });
    });
  }

  // ─── Helper OCR: carrega Tesseract + redimensiona imagem para economizar memória ──
  let _tesseractLoading=null; // evitar carregar múltiplas vezes
  async function rodarOCR(blob, onProgress){
    // 1. Carregar Tesseract.js apenas se necessário
    if(!window.Tesseract){
      if(!_tesseractLoading){
        _tesseractLoading=new Promise((res,rej)=>{
          // Verificar se já existe script no DOM
          if(document.querySelector('script[src*="tesseract"]')){
            // Script já no DOM mas ainda carregando — aguardar
            const check=()=>{window.Tesseract?res():setTimeout(check,200);};
            setTimeout(check,200);
            return;
          }
          const s=document.createElement("script");
          s.src="https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
          s.onload=()=>{_tesseractLoading=null; res();};
          s.onerror=()=>{_tesseractLoading=null; rej(new Error("Falha ao carregar leitor OCR. Verifique a conexão."));};
          document.head.appendChild(s);
        });
      }
      await _tesseractLoading;
    }

    // 2. Redimensionar imagem para max 1200px — reduz memória ~75%
    const blobReduzido=await new Promise((res)=>{
      const img=new Image();
      const url=URL.createObjectURL(blob);
      img.onload=()=>{
        URL.revokeObjectURL(url);
        const MAX=1200;
        let {width,height}=img;
        if(width>MAX||height>MAX){
          if(width>height){height=Math.round(height*MAX/width);width=MAX;}
          else{width=Math.round(width*MAX/height);height=MAX;}
        }
        const canvas=document.createElement("canvas");
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext("2d");
        ctx.filter="contrast(1.4) brightness(1.1)";
        ctx.drawImage(img,0,0,width,height);
        canvas.toBlob(b=>res(b||blob),"image/jpeg",0.85);
      };
      img.onerror=()=>{URL.revokeObjectURL(url); res(blob);};
      img.src=url;
    });

    // 3. Rodar OCR com timeout de 60s
    const timeoutPromise=new Promise((_,rej)=>
      setTimeout(()=>rej(new Error("Tempo esgotado. Tente com imagem menor ou mais nítida.")),60000)
    );
    const ocrPromise=window.Tesseract.recognize(blobReduzido,"por+eng",{
      logger:m=>{
        if(m.status==="recognizing text"&&onProgress){
          onProgress(Math.round((m.progress||0)*100));
        }
      }
    });
    const result=await Promise.race([ocrPromise,timeoutPromise]);
    return result?.data?.text||"";
  }

  // ─── Helper filtro período ─────────────────────────────────────────────────
  function renderFiltroPeriodo(chaveState, onChangeCb){
    if(!state[chaveState]) state[chaveState]="tudo";
    const f=state[chaveState];
    const dataKey=chaveState+"_data";
    if(!state[dataKey]) state[dataKey]="";
    const html=`<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
      <div style="display:flex;gap:6px;">
        <button class="btn-periodo btn ${f==="hoje"?"btn-primary":"btn-secondary"}" data-fp="hoje" style="font-size:12px;flex:1;">📅 Hoje</button>
        <button class="btn-periodo btn ${f==="semana"?"btn-primary":"btn-secondary"}" data-fp="semana" style="font-size:12px;flex:1;">📆 Semana</button>
        <button class="btn-periodo btn ${f==="mes"?"btn-primary":"btn-secondary"}" data-fp="mes" style="font-size:12px;flex:1;">🗓️ Mês</button>
        <button class="btn-periodo btn ${f==="tudo"?"btn-primary":"btn-secondary"}" data-fp="tudo" style="font-size:12px;flex:1;">📋 Todos</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="date" class="btn-data-especifica" value="${esc(state[dataKey]||"")}"
          style="flex:1;padding:8px 10px;background:var(--bg);border:1px solid var(--border-hi);border-radius:8px;color:var(--text);font-family:var(--font);font-size:13px;"/>
        <button class="btn-data-limpar btn btn-ghost" style="font-size:12px;padding:7px 10px;white-space:nowrap;" title="Limpar data">✕ Data</button>
      </div>
    </div>`;
    return html;
  }

  function bindFiltroPeriodo(chaveState, cb){
    const dataKey=chaveState+"_data";
    document.querySelectorAll(".btn-periodo").forEach(btn=>{
      btn.addEventListener("click",()=>{
        state[chaveState]=btn.getAttribute("data-fp")||"tudo";
        state[dataKey]=""; // limpar data ao escolher período
        document.querySelectorAll(".btn-periodo").forEach(b=>{
          b.className=b.className.replace("btn-primary","btn-secondary");
        });
        btn.className=btn.className.replace("btn-secondary","btn-primary");
        // Limpar input de data
        const di=document.querySelector(".btn-data-especifica");
        if(di) di.value="";
        cb();
      });
    });
    // Filtro por data específica
    document.querySelector(".btn-data-especifica")?.addEventListener("change",e=>{
      state[dataKey]=e.target.value||"";
      if(state[dataKey]){
        // Desativar botões de período
        document.querySelectorAll(".btn-periodo").forEach(b=>{
          b.className=b.className.replace("btn-primary","btn-secondary");
        });
        state[chaveState]="data_especifica";
      }
      cb();
    });
    // Limpar data
    document.querySelector(".btn-data-limpar")?.addEventListener("click",()=>{
      state[dataKey]="";
      state[chaveState]="tudo";
      const di=document.querySelector(".btn-data-especifica");
      if(di) di.value="";
      document.querySelectorAll(".btn-periodo").forEach(b=>{
        b.className=b.className.replace("btn-primary","btn-secondary");
        if(b.getAttribute("data-fp")==="tudo") b.className=b.className.replace("btn-secondary","btn-primary");
      });
      cb();
    });
  }

  function filtrarPorPeriodoGen(items, campoData, chaveState){
    const f=state[chaveState]||"tudo";
    const dataKey=chaveState+"_data";
    const dataEsp=state[dataKey]||"";
    // Filtro por data específica
    if(f==="data_especifica"&&dataEsp){
      return items.filter(it=>String(it[campoData]||"").slice(0,10)===dataEsp);
    }
    if(f==="tudo") return items;
    const hoje=new Date().toISOString().slice(0,10);
    const mesAtual=new Date().toISOString().slice(0,7);
    const semanaAtras=new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
    return items.filter(it=>{
      const d=String(it[campoData]||"").slice(0,10);
      if(!d) return f==="tudo";
      if(f==="hoje")   return d===hoje;
      if(f==="semana") return d>=semanaAtras&&d<=hoje;
      if(f==="mes")    return d.startsWith(mesAtual);
      return true;
    });
  }

  // ─── Foto de Nota/Orçamento → Cadastro Automático de Mercadorias ─────────────
  async function abrirFotoNotaMercadorias(root, rawItems){
    const wrapId="sv-foto-nota-wrap";
    const existing=document.getElementById(wrapId);
    if(existing){existing.remove();return;}
    const container=document.createElement("div");
    container.id=wrapId;
    root.querySelector(".card")?.after(container)||root.prepend(container);

    container.innerHTML=`
      <div class="card" style="border-color:rgba(0,230,118,.2);background:rgba(0,230,118,.03);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div>
            <div style="font-size:14px;font-weight:700;">📸 Importar produtos por foto</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">Nota, orçamento ou tela de estoque</div>
          </div>
          <button id="fn-fechar" class="btn btn-ghost btn-icon">✕</button>
        </div>

        <!-- Dois botões separados: câmera e galeria -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <button id="fn-btn-camera" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 10px;
            background:var(--bg2);border:2px dashed rgba(0,230,118,.4);border-radius:12px;cursor:pointer;font-family:var(--font);">
            <span style="font-size:32px;">📷</span>
            <span style="font-size:13px;font-weight:600;color:var(--green);">Tirar foto</span>
            <span style="font-size:11px;color:var(--muted);">Câmera</span>
          </button>
          <button id="fn-btn-galeria" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 10px;
            background:var(--bg2);border:2px dashed var(--border-hi);border-radius:12px;cursor:pointer;font-family:var(--font);">
            <span style="font-size:32px;">🖼️</span>
            <span style="font-size:13px;font-weight:600;color:var(--text);">Selecionar</span>
            <span style="font-size:11px;color:var(--muted);">Galeria / arquivo</span>
          </button>
        </div>

        <!-- Inputs de arquivo ocultos — separados para evitar conflito -->
        <input type="file" id="fn-input-camera" accept="image/*" capture="environment" style="display:none;"/>
        <input type="file" id="fn-input-galeria" accept="image/*,application/pdf" style="display:none;"/>

        <!-- Preview -->
        <div id="fn-preview" style="display:none;">
          <img id="fn-img" style="width:100%;max-height:220px;border-radius:10px;object-fit:contain;background:#000;display:block;"/>
          <div id="fn-nome-arquivo" style="font-size:12px;color:var(--muted);margin-top:6px;text-align:center;"></div>
          <button id="fn-analisar" class="btn btn-primary" style="width:100%;margin-top:10px;">🤖 Analisar e importar produtos</button>
        </div>

        <div id="fn-status" style="display:none;font-size:13px;color:var(--muted);text-align:center;padding:8px 0;"></div>
        <div id="fn-resultado" style="display:none;margin-top:12px;"></div>
      </div>`;

    document.getElementById("fn-fechar")?.addEventListener("click",()=>container.remove());

    let base64Foto="", tipoFoto="image/jpeg";

    // Função que processa qualquer file selecionado
    function processarArquivo(file){
      if(!file) return;
      tipoFoto=file.type&&file.type!=="application/octet-stream"?file.type:"image/jpeg";
      const reader=new FileReader();
      reader.onload=ev=>{
        const src=String(ev.target.result||"");
        if(!src){toast("Erro ao ler arquivo.","error");return;}
        base64Foto=src.split(",")[1]||"";
        const preview=document.getElementById("fn-preview");
        const img=document.getElementById("fn-img");
        const nomeEl=document.getElementById("fn-nome-arquivo");
        if(preview) preview.style.display="block";
        if(img){
          if(tipoFoto.includes("image")) img.src=src;
          else{ img.src=""; img.style.display="none"; }
        }
        if(nomeEl) nomeEl.textContent=`${file.name||"foto"} · ${(file.size/1024).toFixed(0)} KB`;
      };
      reader.onerror=()=>toast("Não foi possível ler o arquivo.","error");
      reader.readAsDataURL(file);
    }

    // Câmera: botão → input separado
    document.getElementById("fn-btn-camera")?.addEventListener("click",()=>{
      document.getElementById("fn-input-camera")?.click();
    });
    document.getElementById("fn-input-camera")?.addEventListener("change",e=>{
      processarArquivo(e.target.files?.[0]);
      e.target.value="";
    });

    // Galeria: botão → input sem capture
    document.getElementById("fn-btn-galeria")?.addEventListener("click",()=>{
      document.getElementById("fn-input-galeria")?.click();
    });
    document.getElementById("fn-input-galeria")?.addEventListener("change",e=>{
      processarArquivo(e.target.files?.[0]);
      e.target.value="";
    });

    // Analisar com Tesseract.js (OCR gratuito no browser — sem API key)
    document.getElementById("fn-analisar")?.addEventListener("click",async()=>{
      if(!base64Foto){toast("Selecione uma imagem primeiro.","warning");return;}
      const btn=document.getElementById("fn-analisar");
      const statusEl=document.getElementById("fn-status");

      btn.disabled=true; btn.textContent="⏳ Lendo imagem...";
      if(statusEl){statusEl.style.display="block";statusEl.textContent="📖 Carregando leitor de texto...";}

      try{
        // Converter base64 para blob e usar helper rodarOCR com redimensionamento
        if(statusEl) statusEl.textContent="📖 Preparando imagem...";
        const byteChars=atob(base64Foto);
        const byteArr=new Uint8Array(byteChars.length);
        for(let i=0;i<byteChars.length;i++) byteArr[i]=byteChars.charCodeAt(i);
        const blob=new Blob([byteArr],{type:tipoFoto.includes("image")?tipoFoto:"image/jpeg"});
        const textoOCR=await rodarOCR(blob,pct=>{
          if(statusEl) statusEl.textContent=`🔍 Lendo... ${pct}%`;
        });
        if(!textoOCR||textoOCR.length<10) throw new Error("Não consegui ler texto na imagem. Tente foto mais nítida e bem iluminada.");

        if(statusEl) statusEl.textContent="🧩 Identificando produtos...";

        // Parser de texto → produtos
        const produtos=parsearTextoProdutos(textoOCR);
        if(!produtos.length) throw new Error("Nenhum produto identificado. Verifique se a imagem contém uma tabela ou lista de produtos.");

        if(statusEl) statusEl.style.display="none";
        mostrarTabelaResultado(produtos);

      }catch(e){
        const msg=String(e?.message||"Erro ao processar imagem");
        if(statusEl){statusEl.textContent="❌ "+msg;}
        toast(msg,"error",6000);
      }
      btn.disabled=false; btn.textContent="🤖 Analisar e importar produtos";
    });

    // ── Parser de texto OCR → array de produtos ──────────────────────────────
    function parsearTextoProdutos(texto){
      const linhas=texto.split("\n").map(l=>l.trim()).filter(l=>l.length>2);
      const produtos=[];

      // Regex auxiliares
      const reNumero=/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})\b|\b\d+[.,]\d{2}\b/g;
      const reSoNumero=/^\d+([.,]\d+)?$/;
      const reCodigoInicio=/^(\d{3,8})\s+/; // código numérico no início da linha

      // Detectar se é tabela estruturada (tem cabeçalho com palavras típicas)
      const textoUpper=texto.toUpperCase();
      const temCabecalho=/(CÓDIGO|DESCRI|UNITÁRIO|UNIT|QUANT|TOTAL|PRECO|VALOR)/i.test(textoUpper);

      // Palavras de cabeçalho para ignorar
      const reIgnorar=/^(código|codigo|descri|emb|embalagem|cf\s?ncm|ncm|um|unid|quant|qtd|unitário|unitario|unit|total|preco|valor|marca|categoria|item|ref|referência|produto|tipo|obs|data|nf|nota|empresa|cnpj|cpf|ie|fone|end|rua|bairro|cidade|uf|cep|fax)\b/i;

      // Juntar linhas quebradas: se uma linha não tem número, provavelmente continua a anterior
      const linhasJuntas=[];
      for(let i=0;i<linhas.length;i++){
        const l=linhas[i];
        if(reIgnorar.test(l)){linhasJuntas.push({texto:l,ignorar:true});continue;}
        // Linha começa com número (provável código de produto) → nova entrada
        if(reCodigoInicio.test(l)){
          linhasJuntas.push({texto:l,ignorar:false});
        } else if(linhasJuntas.length>0&&!linhasJuntas[linhasJuntas.length-1].ignorar){
          // Continuação da linha anterior (descrição quebrada em 2 linhas)
          linhasJuntas[linhasJuntas.length-1].texto+=" "+l;
        } else {
          linhasJuntas.push({texto:l,ignorar:false});
        }
      }

      for(const entrada of linhasJuntas){
        if(entrada.ignorar) continue;
        const linha=entrada.texto;

        // Extrair todos os valores numéricos da linha
        const numeros=[...linha.matchAll(reNumero)].map(m=>{
          const s=m[0].replace(/\./g,"").replace(",",".");
          return parseFloat(s)||0;
        }).filter(v=>v>0);

        if(!numeros.length) continue;

        // ── Estratégia de colunas ─────────────────────────────────────────────
        // Tabelas típicas: Código | Descrição | ... | Quant | Unitário | Total
        // O TOTAL é sempre o último número, UNITÁRIO é o penúltimo
        // A QUANTIDADE fica antes, mas geralmente é inteiro pequeno (< 10000)
        let valorVenda=0, valorCompra=0, estoque=0;

        if(numeros.length>=3){
          // Tem pelo menos 3 números: [... , quant, unitario, total]
          const total=numeros[numeros.length-1];
          const unitario=numeros[numeros.length-2];
          const quantCandidato=numeros[numeros.length-3];

          // Validar: unitario * quant ≈ total (tolerância 5%)
          if(quantCandidato>0&&Math.abs(unitario*quantCandidato-total)/total<0.05){
            valorVenda=unitario;
            estoque=Math.round(quantCandidato);
          } else if(Math.abs(unitario*1-total)/total<0.05){
            // quantidade = 1
            valorVenda=unitario;
            estoque=1;
          } else {
            // Não conseguiu validar — usar penúltimo como venda
            valorVenda=unitario;
          }
        } else if(numeros.length===2){
          // Dois números: provável [unitario, total] ou [quant, total]
          const [a,b]=numeros;
          if(a>0&&Math.abs(a-b)/b<0.01){
            // São iguais → qty=1
            valorVenda=a; estoque=1;
          } else if(b>a&&b/a===Math.round(b/a)){
            // b divisível por a → a=unitario, b=total
            valorVenda=a; estoque=Math.round(b/a);
          } else {
            valorVenda=a>1?a:b;
          }
        } else {
          valorVenda=numeros[0];
        }

        // ── Extrair código (primeiro token numérico do início) ────────────────
        const codMatch=linha.match(reCodigoInicio);
        const codigo=codMatch?codMatch[1]:"";

        // ── Extrair descrição (texto entre código e os números finais) ─────────
        let descricao=linha;
        // Remover código do início
        if(codigo) descricao=descricao.replace(reCodigoInicio,"").trim();
        // Remover os números do final (Total, Unitário, Quant, UM, NCM)
        // Estratégia: remover tokens que são só números a partir de certa posição
        const tokens=descricao.split(/\s+/);
        let fimDesc=tokens.length;
        let removidos=0;
        for(let i=tokens.length-1;i>=0;i--){
          const t=tokens[i].replace(",",".");
          if(reSoNumero.test(t)||/^(KG|PC|UN|MT|CX|LT|GL|RL|SC|M2|M3|KIT)$/i.test(t)||/^\d{2,}\d*$/.test(tokens[i])){
            fimDesc=i;
            removidos++;
            if(removidos>=4) break; // remover no máximo 4 tokens do final
          } else {
            break;
          }
        }
        // Remover também o embalagem (número logo após código, antes da descrição)
        let descTokens=tokens.slice(0,fimDesc);
        if(descTokens.length>0&&/^\d{1,3}$/.test(descTokens[0])) descTokens=descTokens.slice(1);

        descricao=descTokens.join(" ").toUpperCase().trim();

        // Limpar artefatos OCR comuns: pontos no início, espaços múltiplos
        // Remover sequências NCM (8 dígitos seguidos) e tokens só-numéricos soltos
        descricao=descricao
          .replace(/\b\d{8}\b/g,"")       // NCM de 8 dígitos
          .replace(/\b\d{6,}\b/g,"")      // qualquer sequência >= 6 dígitos
          .replace(/\b\d{1,3}\s+\d{8}\b/g,"") // "117 72292000" tipo CF NCM
          .replace(/^[.\-\s0-9]+/,"")     // lixo no início
          .replace(/\s{2,}/g," ")
          .trim();

        if(descricao.length<3) continue;
        if(valorVenda<=0&&estoque<=0) continue;
        // Ignorar linhas onde o nome parece ser só números/NCM
        if(/^\d+$/.test(descricao.replace(/\s/g,""))) continue;

        produtos.push({
          nome:descricao.slice(0,80),
          codigo,
          marca:"",
          categoria:"",
          valor_compra:valorCompra,
          valor_venda:valorVenda,
          estoque,
        });
      }

      // Remover duplicatas por nome
      const vistos=new Set();
      return produtos.filter(p=>{
        const chave=p.nome.slice(0,25).toUpperCase();
        if(vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      }).slice(0,60);
    }

    // ── Mostrar tabela de confirmação ─────────────────────────────────────────
    function mostrarTabelaResultado(produtos){
      const resDiv=document.getElementById("fn-resultado");
      resDiv.style.display="block";
      resDiv.innerHTML=`
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--green);">
          ✅ ${produtos.length} produto${produtos.length!==1?"s":""} identificado${produtos.length!==1?"s":""}
          <span style="font-weight:400;color:var(--muted);font-size:11px;"> — revise antes de importar</span>
        </div>
        <div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border);">
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="background:var(--bg3);">
              <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Produto</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">R$ Venda</th>
              <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Qtd</th>
              <th style="padding:8px;border-bottom:1px solid var(--border);text-align:center;">✓</th>
            </tr></thead>
            <tbody>
              ${produtos.map((p,i)=>`<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:8px;">
                  <div style="font-weight:600;font-size:12px;">${esc(p.nome)}</div>
                  ${p.codigo?`<div style="font-size:10px;color:var(--muted);">${esc(p.codigo)}</div>`:""}
                </td>
                <td style="padding:8px;text-align:right;font-weight:600;color:var(--green);white-space:nowrap;">
                  ${p.valor_venda>0?moneyBR(p.valor_venda):"—"}
                </td>
                <td style="padding:8px;text-align:right;">${p.estoque||"—"}</td>
                <td style="padding:8px;text-align:center;">
                  <input type="checkbox" data-fn-idx="${i}" checked style="width:16px;height:16px;accent-color:var(--green);cursor:pointer;"/>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--muted);">
          💡 O OCR pode cometer erros — revise nomes e preços antes de importar.
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button id="fn-importar-sel" class="btn btn-primary" style="flex:1;">💾 Importar selecionados</button>
          <button id="fn-cancelar-import" class="btn btn-ghost" style="width:auto;">Cancelar</button>
        </div>`;

      document.getElementById("fn-cancelar-import")?.addEventListener("click",()=>{resDiv.style.display="none";});
      document.getElementById("fn-importar-sel")?.addEventListener("click",async()=>{
        const selecionados=produtos.filter((_,i)=>resDiv.querySelector(`[data-fn-idx="${i}"]`)?.checked);
        if(!selecionados.length){toast("Selecione ao menos um produto.","warning");return;}
        await runWithUi(async()=>{
          let ok=0,erros=0;
          for(const p of selecionados){
            if(!p.nome) continue;
            const payload={
              nome:p.nome.toUpperCase(),produto:p.nome.toUpperCase(),
              codigo:String(p.codigo||"").toUpperCase(),sku:String(p.codigo||"").toUpperCase(),
              marca:"",categoria:"",
              valor_compra:Number(p.valor_compra)||0,valorCompra:Number(p.valor_compra)||0,
              valor_venda:Number(p.valor_venda)||0,valorVenda:Number(p.valor_venda)||0,
              estoque:Number(p.estoque)||0,estoqueAtual:Number(p.estoque)||0,estoqueMin:0,
            };
            try{
              const existente=rawItems.find(m=>String(m.nome||m.produto||"").toUpperCase()===payload.nome);
              if(existente) await DB.update("mercadorias",getId(existente),payload);
              else await DB.create("mercadorias",payload);
              ok++;
            }catch{erros++;}
          }
          await loadResource("mercadorias");
          container.remove();
          renderCurrent();
          toast(`✅ ${ok} produto${ok!==1?"s":""} importado${ok!==1?"s":""}${erros?` · ${erros} erro(s)`:""}`,ok?"success":"warning");
        },"Importando produtos...");
      });
    }
  }

  // ─── Porta-Cartão de Visitas ──────────────────────────────────────────────────
  async function renderCartoes(root){
    // ── Estado em memória — carregado da API, não do localStorage ──────────────
    let cartoes=[];

    async function carregarCartoes(){
      try{ cartoes=safeArray(await DB.request("/api/cartoes",{method:"GET"})); }
      catch(e){ cartoes=[]; console.warn("cartoes:",e?.message); }
    }

    function atualizarContador(){
      const el=document.getElementById("sv-cart-count"); if(!el) return;
      const n=cartoes.length;
      el.textContent=`${n} cartão${n!==1?"ões":""} cadastrado${n!==1?"s":""}`;
    }

    function renderLista(){
      const lista=document.getElementById("sv-cart-lista"); if(!lista) return;
      atualizarContador();
      const q=(document.getElementById("sv-cart-busca")?.value||"").trim().toLowerCase();
      const filtrados=q?cartoes.filter(c=>
        String(c.nome||"").toLowerCase().includes(q)||
        String(c.empresa||"").toLowerCase().includes(q)||
        String(c.telefone||"").toLowerCase().includes(q)
      ):cartoes;
      if(!filtrados.length){
        lista.innerHTML=`<div class="empty-state"><div class="empty-icon">🪪</div><div class="empty-text">${q?"Nenhum cartão encontrado.":"Nenhum cartão cadastrado ainda.\nToque em + Novo para escanear ou cadastrar."}</div></div>`;
        return;
      }
      lista.innerHTML=filtrados.map(c=>`
        <div class="list-item">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            ${c.foto?`<img src="${c.foto}" style="width:72px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid var(--border);"/>`:
              `<div style="width:72px;height:48px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">🪪</div>`}
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.nome||"")}</div>
              ${c.cargo?`<div style="font-size:12px;color:var(--muted);">${esc(c.cargo)}</div>`:""}
              ${c.empresa?`<div style="font-size:13px;font-weight:500;margin-top:2px;">🏢 ${esc(c.empresa)}</div>`:""}
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
                ${c.telefone?`<span style="font-size:12px;color:var(--muted);">📞 ${esc(c.telefone)}</span>`:""}
                ${c.email?`<span style="font-size:12px;color:var(--muted);">✉️ ${esc(c.email)}</span>`:""}
              </div>
            </div>
          </div>
          <div class="list-item-actions" style="margin-top:10px;">
            ${(()=>{const tel=String(c.telefone||"").replace(/\D/g,"");const wpp=encodeURIComponent("Olá, Willyam da Cefeq.");return tel.length>=10?`<a href="https://wa.me/55${tel}?text=${wpp}" target="_blank" class="btn btn-secondary" style="font-size:12px;padding:6px 12px;background:rgba(37,211,102,.1);border-color:rgba(37,211,102,.3);color:#25d366;text-decoration:none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#25d366" style="vertical-align:middle;margin-right:3px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp</a>`:"";})()}
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" data-cart-cli="${c.id||c._id}">👤 → Cliente</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" data-cart-edit="${c.id||c._id}">✏️</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--red);" data-cart-del="${c.id||c._id}">🗑️</button>
          </div>
        </div>`).join("");

      // Exportar para cliente
      lista.querySelectorAll("[data-cart-cli]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-cart-cli");
          const c=cartoes.find(x=>(x.id||x._id)===id);
          if(!c) return;
          if(!confirm(`Exportar "${c.nome}" para o cadastro de Clientes?`)) return;
          navigate("clientes");
          setTimeout(()=>{
            renderForm("clientes",null);
            setTimeout(()=>{
              const set=(name,val,upper=true)=>{
                if(!val) return;
                const el=document.querySelector("#sv-form-wrap [name='"+name+"']");
                if(!el) return;
                el.value=upper?String(val).toUpperCase():String(val);
              };
              set("nome",    c.empresa||c.nome);
              const d=String(c.telefone||"").replace(/\D/g,"").slice(0,11);
              if(d){
                let tel=d;
                if(d.length===11) tel=d.replace(/^(\d{2})(\d{5})(\d{4})$/,"($1) $2-$3");
                else if(d.length===10) tel=d.replace(/^(\d{2})(\d{4})(\d{4})$/,"($1) $2-$3");
                const el=document.querySelector("#sv-form-wrap [name='telefone']");
                if(el) el.value=tel;
              }
              set("email",   c.email, false);
              set("endereco",c.endereco);
              const obsVal=[c.nome,c.cargo].filter(Boolean).join(" — ");
              set("obs", obsVal);
              document.querySelector("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"});
            },350);
          },120);
        });
      });

      // Editar
      lista.querySelectorAll("[data-cart-edit]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-cart-edit");
          const c=cartoes.find(x=>(x.id||x._id)===id);
          if(!c) return;
          renderFormCartao(c);
        });
      });

      // Excluir
      lista.querySelectorAll("[data-cart-del]").forEach(btn=>{
        btn.addEventListener("click",async()=>{
          const id=btn.getAttribute("data-cart-del");
          const c=cartoes.find(x=>(x.id||x._id)===id);
          if(!confirm(`Excluir o cartão "${c?.nome||""}"?`)) return;
          await runWithUi(async()=>{
            await DB.request(`/api/cartoes/${encodeURIComponent(id)}`,{method:"DELETE"});
            cartoes=cartoes.filter(x=>(x.id||x._id)!==id);
            renderLista();
            toast("Cartão excluído.","info");
          },"Excluindo...");
        });
      });
    }

    function renderFormCartao(item=null){
      const fw=document.getElementById("sv-cart-form"); if(!fw) return;
      const isEdit=!!item;
      const inStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;text-transform:uppercase;`;
      fw.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"📷 Novo"} cartão</div>
            <button type="button" id="cart-fechar" class="btn btn-ghost btn-icon">✕</button>
          </div>
          <div style="margin-bottom:14px;">
            <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">FOTO DO CARTÃO</div>
            <div style="display:flex;gap:10px;margin-bottom:10px;">
              <button type="button" id="cart-btn-camera" style="flex:1;padding:12px;background:var(--bg2);border:2px dashed rgba(0,230,118,.4);border-radius:10px;cursor:pointer;font-family:var(--font);font-size:13px;color:var(--green);">📷 Câmera</button>
              <button type="button" id="cart-btn-galeria" style="flex:1;padding:12px;background:var(--bg2);border:2px dashed var(--border-hi);border-radius:10px;cursor:pointer;font-family:var(--font);font-size:13px;">🖼️ Galeria</button>
            </div>
            <input type="file" id="cart-input-camera" accept="image/*" capture="environment" style="display:none;"/>
            <input type="file" id="cart-input-galeria" accept="image/*" style="display:none;"/>
            <div id="cart-preview-wrap" style="${item?.foto?"":"display:none;"}margin-bottom:10px;text-align:center;">
              <img id="cart-img-preview" src="${item?.foto||""}" style="max-width:100%;max-height:150px;border-radius:10px;object-fit:contain;border:1px solid var(--border);"/>
              <button type="button" id="cart-ocr-btn" class="btn btn-secondary" style="margin-top:8px;font-size:12px;width:100%;">🤖 Ler dados do cartão automaticamente</button>
              <div id="cart-ocr-status" style="display:none;font-size:12px;color:var(--muted);margin-top:6px;text-align:center;"></div>
            </div>
          </div>
          <div class="form-grid">
            <div class="field"><label>Nome *</label><input id="cart-nome" type="text" value="${esc(item?.nome||"")}" placeholder="NOME COMPLETO" style="${inStyle}"/></div>
            <div class="field"><label>Cargo / Função</label><input id="cart-cargo" type="text" value="${esc(item?.cargo||"")}" placeholder="VENDEDOR, GERENTE..." style="${inStyle}"/></div>
            <div class="field"><label>Empresa</label><input id="cart-empresa" type="text" value="${esc(item?.empresa||"")}" placeholder="NOME DA EMPRESA" style="${inStyle}"/></div>
            <div class="field"><label>Telefone</label><input id="cart-tel" type="tel" inputmode="tel" value="${esc(item?.telefone||"")}" placeholder="(00) 00000-0000" style="${inStyle}text-transform:none;"/></div>
            <div class="field"><label>E-mail</label><input id="cart-email" type="email" inputmode="email" value="${esc(item?.email||"")}" placeholder="email@empresa.com" style="${inStyle}text-transform:none;"/></div>
            <div class="field"><label>Endereço</label><input id="cart-end" type="text" value="${esc(item?.endereco||"")}" placeholder="RUA, NÚMERO, CIDADE" style="${inStyle}"/></div>
            <div class="field"><label>Observações</label><textarea id="cart-obs" rows="2" style="${inStyle}resize:vertical;">${esc(item?.obs||"")}</textarea></div>
          </div>
          <div class="form-actions">
            <button type="button" id="cart-salvar" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Cadastrar"}</button>
            <button type="button" id="cart-cancelar" class="btn btn-ghost">Cancelar</button>
          </div>
        </div>`;

      setTimeout(()=>fw.scrollIntoView({behavior:"smooth",block:"start"}),60);
      setTimeout(()=>bindVozNoCampo(fw),120);

      document.getElementById("cart-fechar")?.addEventListener("click",()=>{fw.innerHTML="";});
      document.getElementById("cart-cancelar")?.addEventListener("click",()=>{fw.innerHTML="";});

      let fotoDataUrl=item?.foto||"";
      const mostrarPreview=(src)=>{
        fotoDataUrl=src;
        const pw=document.getElementById("cart-preview-wrap");
        const pi=document.getElementById("cart-img-preview");
        if(pw) pw.style.display="block";
        if(pi) pi.src=src;
      };
      const processarFotoCartao=(file)=>{
        if(!file) return;
        const r=new FileReader();
        r.onload=ev=>mostrarPreview(String(ev.target.result||""));
        r.readAsDataURL(file);
      };
      document.getElementById("cart-btn-camera")?.addEventListener("click",()=>{
        window._svFilePickerAt=Date.now(); // bloquear re-render enquanto câmera aberta
        document.getElementById("cart-input-camera")?.click();
      });
      document.getElementById("cart-btn-galeria")?.addEventListener("click",()=>{
        window._svFilePickerAt=Date.now();
        document.getElementById("cart-input-galeria")?.click();
      });
      document.getElementById("cart-input-camera")?.addEventListener("change",e=>{processarFotoCartao(e.target.files?.[0]);e.target.value="";});
      document.getElementById("cart-input-galeria")?.addEventListener("change",e=>{processarFotoCartao(e.target.files?.[0]);e.target.value="";});

      // OCR Tesseract
      document.getElementById("cart-ocr-btn")?.addEventListener("click",async(e)=>{
        e.preventDefault();
        e.stopPropagation();
        if(!fotoDataUrl){toast("Adicione uma foto do cartão primeiro.","warning");return;}

        // Guardar referências antes do await (o DOM pode mudar durante o async)
        const formWrap=document.getElementById("sv-cart-form");
        const btn=document.getElementById("cart-ocr-btn");
        const statusEl=document.getElementById("cart-ocr-status");

        if(!btn||!formWrap) return;
        btn.disabled=true; btn.textContent="⏳ Lendo...";
        if(statusEl){statusEl.style.display="block";statusEl.textContent="📖 Preparando imagem...";}

        try{
          const base64=fotoDataUrl.split(",")[1];
          if(!base64) throw new Error("Foto inválida. Tire a foto novamente.");

          const bytes=atob(base64);
          const arr=new Uint8Array(bytes.length);
          for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
          const blob=new Blob([arr],{type:"image/jpeg"});

          const txt=await rodarOCR(blob,pct=>{
            // Verificar se o elemento ainda está no DOM antes de atualizar
            const s=document.getElementById("cart-ocr-status");
            if(s) s.textContent=`🔍 Lendo cartão... ${pct}%`;
          });

          // Verificar se o form ainda está no DOM após o processamento async
          if(!document.getElementById("sv-cart-form")) return; // form foi fechado durante OCR

          if(!txt||txt.trim().length<5) throw new Error("Não consegui ler texto no cartão. Tente foto mais nítida.");

          const linhas=txt.split("\n").map(l=>l.trim()).filter(l=>l.length>2);
          const reEmail=/[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
          const reTel=/(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}/;
          let nome="",cargo="",empresa="",telefone="",email="",endereco="";
          for(const linha of linhas){
            const em=linha.match(reEmail); if(em&&!email){email=em[0];continue;}
            const te=linha.match(reTel); if(te&&!telefone){telefone=te[0];continue;}
            if(!cargo&&/\b(gerente|diretor|vendedor|representante|coord|analista|engenheir|técnico|socio|sócio|proprietári|ceo|cfo|cto|supervisor|consultor)\b/i.test(linha)){cargo=linha;continue;}
            if(!nome&&/^[A-ZÀ-Ú][a-zà-ú]/.test(linha)&&!/\d/.test(linha)&&linha.split(" ").length>=2){nome=linha;continue;}
            if(!empresa&&(/LTDA|EIRELI|S\.A\.|EPP|ME\b/i.test(linha)||linha===linha.toUpperCase()&&linha.length>4)){empresa=linha;continue;}
            if(!endereco&&/\b(rua|av|avenida|estrada|rod|rodovia|r\.|al\.|alameda)\b/i.test(linha)){endereco=linha;continue;}
          }

          // Preencher campos usando getElementById — mais robusto que querySelector após async
          const set=(id,val)=>{const el=document.getElementById(id);if(el&&val) el.value=String(val);};
          set("cart-nome",    nome?.toUpperCase());
          set("cart-cargo",   cargo?.toUpperCase());
          set("cart-empresa", empresa?.toUpperCase());
          set("cart-tel",     telefone);
          set("cart-email",   email?.toLowerCase());
          set("cart-end",     endereco?.toUpperCase());

          const s2=document.getElementById("cart-ocr-status");
          if(s2) s2.style.display="none";
          toast("✅ Dados extraídos! Revise antes de salvar.","success",4000);

        }catch(err){
          const msg=String(err?.message||"Erro ao ler cartão");
          const s3=document.getElementById("cart-ocr-status");
          if(s3){s3.style.display="block"; s3.textContent="❌ "+msg;}
          toast(msg,"error",5000);
        }

        const b2=document.getElementById("cart-ocr-btn");
        if(b2){b2.disabled=false; b2.textContent="🤖 Ler dados do cartão automaticamente";}
      });

      // Máscara telefone
      document.getElementById("cart-tel")?.addEventListener("input",e=>{
        let v=e.target.value.replace(/\D/g,"").slice(0,11);
        if(v.length<=10) v=v.replace(/^(\d{2})(\d{4})(\d{0,4})$/,"($1) $2-$3");
        else v=v.replace(/^(\d{2})(\d{5})(\d{0,4})$/,"($1) $2-$3");
        e.target.value=v.replace(/-$/,"");
      });

      // Salvar via API
      document.getElementById("cart-salvar")?.addEventListener("click",async()=>{
        const nome=document.getElementById("cart-nome")?.value?.trim()?.toUpperCase();
        if(!nome){toast("Nome é obrigatório.","warning");return;}
        const payload={
          id: item?.id||item?._id||("CN-"+Date.now()),
          nome,
          cargo:  document.getElementById("cart-cargo")?.value?.trim()?.toUpperCase()||"",
          empresa:document.getElementById("cart-empresa")?.value?.trim()?.toUpperCase()||"",
          telefone:document.getElementById("cart-tel")?.value?.trim()||"",
          email:  document.getElementById("cart-email")?.value?.trim()?.toLowerCase()||"",
          endereco:document.getElementById("cart-end")?.value?.trim()?.toUpperCase()||"",
          obs:    document.getElementById("cart-obs")?.value?.trim()?.toUpperCase()||"",
          foto:   fotoDataUrl||"",
        };
        await runWithUi(async()=>{
          if(isEdit){
            await DB.request(`/api/cartoes/${encodeURIComponent(payload.id)}`,{
              method:"PUT", body:JSON.stringify(payload)
            });
            cartoes=cartoes.map(x=>(x.id||x._id)===payload.id?{...x,...payload}:x);
          } else {
            const novo=await DB.request("/api/cartoes",{
              method:"POST", body:JSON.stringify(payload)
            });
            cartoes=[{...payload,...(novo||{})}, ...cartoes];
          }
          const fw2=document.getElementById("sv-cart-form");
          if(fw2) fw2.innerHTML="";
          renderLista();
          toast(`✅ Cartão ${isEdit?"atualizado":"cadastrado"}.`,"success");
        },isEdit?"Salvando...":"Cadastrando...");
      });
    }

    // Render principal
    root.innerHTML=`
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div class="card-title">🪪 Porta-Cartões</div>
          <div style="display:flex;gap:6px;">
            <button id="cart-novo-btn" class="btn btn-primary" style="width:auto;">+ Novo cartão</button>
            <button id="cart-refresh-btn" class="btn btn-secondary btn-icon" title="Atualizar">↻</button>
          </div>
        </div>
        <div class="search-wrap" style="margin-top:10px;">
          <span class="search-icon">🔍</span>
          <input id="sv-cart-busca" type="search" placeholder="Buscar por nome, empresa..." autocomplete="off"/>
        </div>
        <div id="sv-cart-count" style="margin-top:6px;font-size:12px;color:var(--muted);">Carregando...</div>
      </div>
      <div id="sv-cart-form"></div>
      <div id="sv-cart-lista"><div class="empty-state"><div class="empty-icon">🪪</div><div class="empty-text">Carregando cartões...</div></div></div>`;

    // Carregar da API
    await runWithUi(async()=>{
      await carregarCartoes();
      renderLista();
    },"Carregando cartões...");

    document.getElementById("cart-novo-btn")?.addEventListener("click",()=>renderFormCartao(null));
    document.getElementById("cart-refresh-btn")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{ await carregarCartoes(); renderLista(); toast("Atualizado.","success"); },"Atualizando...");
    });
    document.getElementById("sv-cart-busca")?.addEventListener("input",renderLista);
  }


  // ─── Aba Visitas ─────────────────────────────────────────────────────────────
  async function renderVisitas(root){
    // ── Dados carregados da API — visíveis para todos os usuários ──────────────
    let visitas=[];
    async function carregarVisitas(){
      try{ visitas=safeArray(await DB.request("/api/visitas",{method:"GET"})); }
      catch(e){ visitas=[]; console.warn("visitas:",e?.message); }
    }

    const inStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;`;

    if(!state._visFiltro) state._visFiltro="tudo";
    function renderLista(){
      const lista=document.getElementById("sv-vis-lista"); if(!lista) return;
      const q=String(document.getElementById("sv-vis-busca")?.value||"").toLowerCase();
      const hoje=new Date().toISOString().slice(0,10);
      const mesAtual=new Date().toISOString().slice(0,7);
      const semanaAtras=new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
      let filtradas=q?visitas.filter(v=>
        String(v.nome||"").toLowerCase().includes(q)||
        String(v.telefone||"").toLowerCase().includes(q)||
        String(v.obs||"").toLowerCase().includes(q)
      ):[...visitas];
      // Filtro de período
      if(state._visFiltro!=="tudo"){
        filtradas=filtradas.filter(v=>{
          const d=String(v.data||"").slice(0,10);
          if(!d) return false;
          if(state._visFiltro==="hoje")   return d===hoje;
          if(state._visFiltro==="semana") return d>=semanaAtras&&d<=hoje;
          if(state._visFiltro==="mes")    return d.startsWith(mesAtual);
          return true;
        });
      }
      if(!filtradas.length){
        lista.innerHTML=`<div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-text">${q?"Nenhuma visita encontrada.":"Nenhuma visita registrada ainda."}</div></div>`;
        return;
      }
      lista.innerHTML=filtradas.map((v,i)=>{
        const tel=String(v.telefone||"").replace(/\D/g,"");
        const wppMsg=encodeURIComponent("Olá, Willyam da Cefeq.");
        const wppHref=tel.length>=10?`https://wa.me/55${tel}?text=${wppMsg}`:"";
        return`<div class="list-item">
          <div class="list-item-top">
            <div><div class="list-item-title">${esc(v.nome||"")}</div>
              ${v.endereco?`<div style="font-size:12px;color:var(--muted);margin-top:2px;">📍 ${esc(v.endereco)}</div>`:""}
            </div>
            <div style="font-size:11px;color:var(--muted);text-align:right;">${v.data?dateFormatBR(v.data):""}</div>
          </div>
          ${v.telefone?`<div class="list-item-meta"><span class="meta-item">📞 ${esc(v.telefone)}</span></div>`:""}
          ${v.obs?`<div style="font-size:12px;color:var(--muted);margin-top:4px;padding:0 2px;">${esc(v.obs)}</div>`:""}
          <div class="list-item-actions">
            ${wppHref?`<a href="${wppHref}" target="_blank" class="btn btn-secondary" style="font-size:12px;padding:6px 12px;background:rgba(37,211,102,.1);border-color:rgba(37,211,102,.3);color:#25d366;text-decoration:none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#25d366" style="vertical-align:middle;margin-right:3px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp</a>`:""}
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" data-vis-cli="${v.id||v._id}">👤 → Cliente</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" data-vis-edit="${v.id||v._id}">✏️</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--red);" data-vis-del="${v.id||v._id}">🗑️</button>
          </div>
        </div>`;
      }).join("");

      // Exportar para cliente
      lista.querySelectorAll("[data-vis-cli]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-vis-cli");
          const v=visitas.find(x=>(x.id||x._id)===id); if(!v) return;
          if(!confirm(`Exportar "${v.nome}" para o cadastro de Clientes?`)) return;
          navigate("clientes");
          setTimeout(()=>{
            const fake={nome:v.nome,telefone:v.telefone||"",endereco:v.endereco||"",cidade:v.cidade||"",obs:v.obs||""};
            renderForm("clientes",null);
            setTimeout(()=>{
              Object.entries(fake).forEach(([k,val])=>{
                const el=$("#sv-form-wrap [name='"+k+"']");
                if(el) el.value=String(val||"").toUpperCase();
              });
              $("#sv-form-wrap")?.scrollIntoView({behavior:"smooth",block:"start"});
            },100);
          },80);
        });
      });
      // Editar
      lista.querySelectorAll("[data-vis-edit]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-vis-edit");
          const v=visitas.find(x=>(x.id||x._id)===id); if(!v) return;
          renderFormVisita(v);
        });
      });
      // Excluir
      lista.querySelectorAll("[data-vis-del]").forEach(btn=>{
        btn.addEventListener("click",async()=>{
          const id=btn.getAttribute("data-vis-del");
          if(!confirm("Excluir esta visita?")) return;
          await runWithUi(async()=>{
            await DB.request(`/api/visitas/${encodeURIComponent(id)}`,{method:"DELETE"});
            visitas=visitas.filter(x=>(x.id||x._id)!==id);
            renderLista();
            toast("Visita excluída.","info");
          },"Excluindo...");
        });
      });
    }

    function renderFormVisita(item=null){
      const fw=document.getElementById("sv-vis-form"); if(!fw) return;
      const isEdit=!!item;
      const RESULTADOS=["INTERESSADO","AGUARDANDO RETORNO","NÃO TINHA INTERESSE","PEDIDO REALIZADO","EM NEGOCIAÇÃO","VISITA AGENDADA","SEM CONTATO"];
      const ACOES=["ENVIAR ORÇAMENTO","RETORNAR EM 7 DIAS","RETORNAR EM 15 DIAS","RETORNAR EM 30 DIAS","FECHAR PEDIDO","SEM AÇÃO NECESSÁRIA","VISITA DE ACOMPANHAMENTO"];
      fw.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"➕ Nova"} visita</div>
            <button type="button" id="vis-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          <div class="form-grid">
            <div class="field"><label>Empresa / Nome *</label><input id="vis-nome" type="text" value="${esc(item?.nome||"")}" style="${inStyle}text-transform:uppercase;" placeholder="NOME DA EMPRESA"/></div>
            <div class="field"><label>Telefone</label><input id="vis-tel" type="tel" value="${esc(item?.telefone||"")}" style="${inStyle}" placeholder="(00) 00000-0000"/></div>
            <div class="field">
              <label style="display:flex;align-items:center;justify-content:space-between;">
                Endereço
                <button type="button" id="vis-geo" style="font-size:11px;padding:3px 8px;background:rgba(0,230,118,.1);border:1px solid rgba(0,230,118,.3);border-radius:6px;color:var(--green);cursor:pointer;font-family:var(--font);">📍 Localização</button>
              </label>
              <input id="vis-end" type="text" value="${esc(item?.endereco||"")}" style="${inStyle}text-transform:uppercase;" placeholder="RUA, NÚMERO, BAIRRO"/>
            </div>
            <div class="field"><label>Cidade</label><input id="vis-cid" type="text" value="${esc(item?.cidade||"")}" style="${inStyle}text-transform:uppercase;"/></div>
            <div class="field"><label>Data da visita</label><input id="vis-data" type="date" value="${esc(item?.data||new Date().toISOString().slice(0,10))}" style="${inStyle}"/></div>
            <div class="field">
              <label>Resultado</label>
              <select id="vis-resultado" style="${inStyle}">
                <option value="">Selecione...</option>
                ${RESULTADOS.map(r=>`<option value="${r}" ${item?.resultado===r?"selected":""}>${r}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Próxima ação</label>
              <select id="vis-acao" style="${inStyle}">
                <option value="">Selecione...</option>
                ${ACOES.map(a=>`<option value="${a}" ${item?.acao===a?"selected":""}>${a}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Observações</label><textarea id="vis-obs" rows="3" style="${inStyle}resize:vertical;text-transform:uppercase;">${esc(item?.obs||"")}</textarea></div>
          </div>
          <div class="form-actions">
            <button type="button" id="vis-salvar" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Registrar visita"}</button>
            <button type="button" id="vis-cancel" class="btn btn-ghost">Cancelar</button>
          </div>
        </div>`;

      document.getElementById("vis-close")?.addEventListener("click",()=>{fw.innerHTML="";});
      document.getElementById("vis-cancel")?.addEventListener("click",()=>{fw.innerHTML="";});

      document.getElementById("vis-geo")?.addEventListener("click",async()=>{
        const btn=document.getElementById("vis-geo");
        if(!navigator.geolocation){toast("Geolocalização indisponível.","warning");return;}
        btn.textContent="⏳..."; btn.disabled=true;
        navigator.geolocation.getCurrentPosition(async pos=>{
          const{latitude:lat,longitude:lng}=pos.coords;
          try{
            const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,{headers:{"User-Agent":"supervenda-app"}});
            const d=await r.json(); const a=d.address||{};
            const rua=a.road||a.pedestrian||""; const num=a.house_number||"";
            document.getElementById("vis-end").value=(rua+(num?" "+num:"")).toUpperCase();
            document.getElementById("vis-cid").value=(a.city||a.town||a.village||"").toUpperCase();
            toast("📍 Localização preenchida.","success");
          }catch{
            document.getElementById("vis-end").value=`LAT ${lat.toFixed(5)}, LNG ${lng.toFixed(5)}`;
          }
          btn.textContent="📍 Localização"; btn.disabled=false;
        },err=>{toast(err.message,"error");btn.textContent="📍 Localização";btn.disabled=false;},{enableHighAccuracy:true,timeout:8000});
      });

      document.getElementById("vis-tel")?.addEventListener("input",e=>{
        let v=e.target.value.replace(/\D/g,"").slice(0,11);
        if(v.length<=10) v=v.replace(/^(\d{2})(\d{4})(\d{0,4})$/,"($1) $2-$3");
        else v=v.replace(/^(\d{2})(\d{5})(\d{0,4})$/,"($1) $2-$3");
        e.target.value=v.replace(/-$/,"");
      });

      document.getElementById("vis-salvar")?.addEventListener("click",async()=>{
        const nome=document.getElementById("vis-nome")?.value?.trim()?.toUpperCase();
        if(!nome){toast("Informe o nome da empresa.","warning");return;}
        const payload={
          id: item?.id||item?._id||("VS-"+Date.now()),
          nome, telefone:document.getElementById("vis-tel")?.value||"",
          endereco:document.getElementById("vis-end")?.value?.toUpperCase()||"",
          cidade:document.getElementById("vis-cid")?.value?.toUpperCase()||"",
          data:document.getElementById("vis-data")?.value||new Date().toISOString().slice(0,10),
          resultado:document.getElementById("vis-resultado")?.value||"",
          acao:document.getElementById("vis-acao")?.value||"",
          obs:document.getElementById("vis-obs")?.value?.toUpperCase()||"",
        };
        await runWithUi(async()=>{
          if(isEdit){
            await DB.request(`/api/visitas/${encodeURIComponent(payload.id)}`,{method:"PUT",body:JSON.stringify(payload)});
            visitas=visitas.map(x=>(x.id||x._id)===payload.id?{...x,...payload}:x);
          } else {
            const nova=await DB.request("/api/visitas",{method:"POST",body:JSON.stringify(payload)});
            visitas=[{...payload,...(nova||{})}, ...visitas];
          }
          fw.innerHTML=""; renderLista();
          toast(`✅ Visita ${isEdit?"atualizada":"registrada"}.`,"success");
        },isEdit?"Salvando...":"Registrando...");
      });
      setTimeout(()=>fw.scrollIntoView({behavior:"smooth",block:"start"}),60);
      setTimeout(()=>bindVozNoCampo(fw),120);
    }

    // Exportar CSV
    function exportarVisitas(){
      if(!visitas.length){toast("Nenhuma visita para exportar.","warning");return;}
      const cols=["data","nome","telefone","endereco","cidade","resultado","acao","obs"];
      const hdrs=["Data","Empresa","Telefone","Endereço","Cidade","Resultado","Próxima Ação","Observações"];
      const csv="\uFEFF"+[hdrs.join(";"),...visitas.map(v=>cols.map(c=>{const x=c==="data"?dateFormatBR(v[c]):v[c]||"";return x.includes(";")?`"${x}"`:x;}).join(";"))].join("\n");
      const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"})),download:`visitas_${new Date().toISOString().slice(0,10)}.csv`});
      a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast(`${visitas.length} visitas exportadas.`,"success");
    }

    // Relatório de visitas — janela HTML imprimível
    function gerarRelatorioVisitas(){
      const hoje=new Date().toISOString().slice(0,10);
      const mes=new Date().toISOString().slice(0,7);
      // Filtrar pelo estado atual do filtro
      const filtradas=filtrarPorPeriodoGen(visitas,"data","_visFiltro");
      if(!filtradas.length){toast("Nenhuma visita no período selecionado.","warning");return;}

      const titulo=state._visFiltro==="hoje"?"Hoje":
                   state._visFiltro==="semana"?"Esta Semana":
                   state._visFiltro==="mes"?"Este Mês":"Todas as Visitas";

      const corResultado=r=>{
        if(!r) return "#888";
        if(/pedido|realizado/i.test(r)) return "#00a86b";
        if(/interesse|negoci/i.test(r)) return "#f59e0b";
        if(/não|sem contato/i.test(r)) return "#ef4444";
        return "#3b82f6";
      };

      const win=window.open("","_blank","width=900,height=700");
      if(!win){toast("Permita popups para gerar o relatório.","warning");return;}
      win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
        <title>Relatório de Visitas</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0;}
          body{font-family:Arial,sans-serif;font-size:12px;color:#222;background:#fff;padding:20px;}
          .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a2744;padding-bottom:12px;margin-bottom:16px;}
          .header h1{font-size:20px;color:#1a2744;}
          .header .sub{font-size:11px;color:#666;margin-top:4px;}
          .stats{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;}
          .stat-box{background:#f4f6fa;border-radius:8px;padding:10px 16px;flex:1;min-width:120px;text-align:center;}
          .stat-box .val{font-size:22px;font-weight:700;color:#1a2744;}
          .stat-box .lbl{font-size:10px;color:#666;margin-top:2px;}
          table{width:100%;border-collapse:collapse;font-size:11px;}
          thead th{background:#1a2744;color:#fff;padding:8px 10px;text-align:left;}
          tbody tr:nth-child(even){background:#f9fafb;}
          tbody td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
          .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;color:#fff;}
          .acao-cell{font-size:10px;color:#555;font-style:italic;}
          .footer{margin-top:20px;font-size:10px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:10px;}
          @media print{body{padding:10px;}.no-print{display:none;}}
        </style>
      </head><body>
        <div class="no-print" style="margin-bottom:12px;display:flex;gap:8px;">
          <button onclick="window.print()" style="padding:8px 16px;background:#1a2744;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">🖨️ Imprimir / Salvar PDF</button>
          <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px;">✕ Fechar</button>
        </div>
        <div class="header">
          <div>
            <h1>📋 Relatório de Visitas — ${esc(titulo)}</h1>
            <div class="sub">Gerado em ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} · CEFEQ Suprimentos Industriais</div>
          </div>
          <div style="text-align:right;font-size:11px;color:#666;">
            <strong>${filtradas.length}</strong> visita${filtradas.length!==1?"s":""}<br/>
            Período: ${esc(titulo)}
          </div>
        </div>

        <!-- Resumo estatístico -->
        <div class="stats">
          <div class="stat-box"><div class="val">${filtradas.length}</div><div class="lbl">Total de visitas</div></div>
          <div class="stat-box"><div class="val" style="color:#00a86b;">${filtradas.filter(v=>/pedido|realizado/i.test(v.resultado||"")).length}</div><div class="lbl">Pedidos realizados</div></div>
          <div class="stat-box"><div class="val" style="color:#f59e0b;">${filtradas.filter(v=>/interesse|negoci|aguard/i.test(v.resultado||"")).length}</div><div class="lbl">Em andamento</div></div>
          <div class="stat-box"><div class="val" style="color:#3b82f6;">${[...new Set(filtradas.map(v=>v.cidade).filter(Boolean))].length}</div><div class="lbl">Cidades</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:70px;">Data</th>
              <th>Empresa</th>
              <th style="width:110px;">Telefone</th>
              <th style="width:80px;">Cidade</th>
              <th>Resultado</th>
              <th>Próxima Ação</th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>
            ${filtradas.map(v=>`<tr>
              <td style="white-space:nowrap;">${dateFormatBR(v.data)}</td>
              <td><strong>${esc(v.nome||"")}</strong></td>
              <td>${esc(v.telefone||"")}</td>
              <td>${esc(v.cidade||"")}</td>
              <td>${v.resultado?`<span class="badge" style="background:${corResultado(v.resultado)};">${esc(v.resultado)}</span>`:""}</td>
              <td class="acao-cell">${esc(v.acao||"")}</td>
              <td style="font-size:10px;color:#444;">${esc(v.obs||"")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="footer">Desenvolvido por Willtech84 · SuperVenda</div>
      </body></html>`);
      win.document.close();
    }

    // Render principal
    root.innerHTML=`
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div class="card-title">🏢 Visitas</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button id="vis-nova-btn" class="btn btn-primary" style="width:auto;">+ Nova visita</button>
            <button id="vis-rel-btn" class="btn btn-secondary" style="font-size:12px;">📋 Relatório</button>
            <button id="vis-export-btn" class="btn btn-secondary" style="font-size:12px;">📤 CSV</button>
            <button id="vis-refresh-btn" class="btn btn-secondary btn-icon" title="Atualizar">↻</button>
          </div>
        </div>
        ${renderFiltroPeriodo("_visFiltro")}
        <div class="search-wrap" style="margin-top:10px;">
          <span class="search-icon">🔍</span>
          <input id="sv-vis-busca" type="search" placeholder="Buscar visitas..." autocomplete="off"/>
        </div>
        <div id="sv-vis-count" style="margin-top:6px;font-size:12px;color:var(--muted);">Carregando...</div>
      </div>
      <div id="sv-vis-form"></div>
      <div id="sv-vis-lista"><div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-text">Carregando visitas...</div></div></div>`;

    // Carregar da API
    await runWithUi(async()=>{
      await carregarVisitas();
      const cnt=document.getElementById("sv-vis-count");
      if(cnt) cnt.textContent=`${visitas.length} visita${visitas.length!==1?"s":""} registrada${visitas.length!==1?"s":""}`;
      renderLista();
    },"Carregando visitas...");

    document.getElementById("vis-nova-btn")?.addEventListener("click",()=>renderFormVisita(null));
    document.getElementById("vis-rel-btn")?.addEventListener("click",gerarRelatorioVisitas);
    document.getElementById("vis-export-btn")?.addEventListener("click",exportarVisitas);
    document.getElementById("vis-refresh-btn")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{ await carregarVisitas(); renderLista(); toast("Atualizado.","success"); },"Atualizando...");
    });
    document.getElementById("sv-vis-busca")?.addEventListener("input",renderLista);
    bindFiltroPeriodo("_visFiltro",renderLista);
  }

  // ─── Manuais ──────────────────────────────────────────────────────────────────
  async function renderManuais(root){
    const apiBase=DB.request.__proto__&&DB.apiBase?DB.apiBase():
      (window.CONFIG?.API_BASE||localStorage.getItem("supervenda_api_base")||"").replace(/\/+$/,"");

    // Carregar lista
    let manuais=[];
    try{ manuais=safeArray(await DB.request("/api/manuais",{method:"GET"})); }
    catch(e){ manuais=[]; }

    // Estado local de busca/filtro
    if(!state._manFiltro) state._manFiltro={q:"",cat:""};
    const F=state._manFiltro;

    // Categorias disponíveis
    const cats=[...new Set(manuais.map(m=>String(m.categoria||"").trim()).filter(Boolean))].sort();

    function filtraManuais(){
      const q=F.q.trim().toLowerCase();
      return manuais.filter(m=>{
        const matchQ=!q||
          String(m.nome||"").toLowerCase().includes(q)||
          String(m.descricao||"").toLowerCase().includes(q)||
          String(m.tags||"").toLowerCase().includes(q)||
          String(m.nome_arquivo||"").toLowerCase().includes(q)||
          String(m.categoria||"").toLowerCase().includes(q);
        const matchCat=!F.cat||String(m.categoria||"")===F.cat;
        return matchQ&&matchCat;
      });
    }

    function tamanhoFmt(bytes){
      if(!bytes) return "";
      const kb=bytes/1024;
      return kb<1024?`${kb.toFixed(0)} KB`:`${(kb/1024).toFixed(1)} MB`;
    }

    function renderLista(){
      const lista=document.getElementById("sv-man-lista"); if(!lista) return;
      const filtrados=filtraManuais();
      if(!filtrados.length){
        lista.innerHTML=`<div style="padding:32px;text-align:center;color:var(--muted);">
          <div style="font-size:40px;margin-bottom:8px;">📚</div>
          <div>${F.q||F.cat?"Nenhum manual encontrado para a busca.":"Nenhum manual cadastrado ainda."}</div>
        </div>`;
        return;
      }
      lista.innerHTML=filtrados.map(m=>{
        const tagList=String(m.tags||"").split(",").map(t=>t.trim()).filter(Boolean);
        return`<div class="list-item" style="gap:0;">
          <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;">
            <div style="font-size:36px;flex-shrink:0;line-height:1;">📄</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.nome||m.nome_arquivo||"")}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.nome_arquivo||"")}</div>
              ${m.descricao?`<div style="font-size:12px;color:var(--text);margin-top:4px;line-height:1.4;">${esc(m.descricao)}</div>`:""}
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center;">
                ${m.categoria?`<span style="background:rgba(68,136,255,.12);color:var(--blue);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">${esc(m.categoria)}</span>`:""}
                ${tagList.map(t=>`<span style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:11px;color:var(--muted);">#${esc(t)}</span>`).join("")}
                ${m.tamanho?`<span style="font-size:11px;color:var(--muted);margin-left:4px;">${tamanhoFmt(m.tamanho)}</span>`:""}
              </div>
            </div>
          </div>
          <div style="display:flex;gap:0;border-top:1px solid var(--border);">
            <button class="btn-man-abrir" data-man-id="${esc(m.id)}"
              style="flex:2;padding:9px;background:rgba(0,230,118,.07);border:none;border-right:1px solid var(--border);color:var(--green);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">
              👁️ Abrir PDF
            </button>
            <button class="btn-man-editar" data-man-id="${esc(m.id)}"
              style="flex:1;padding:9px;background:transparent;border:none;border-right:1px solid var(--border);color:var(--muted);font-family:var(--font);font-size:13px;cursor:pointer;">
              ✏️ Editar
            </button>
            <button class="btn-man-excluir" data-man-id="${esc(m.id)}" data-man-nome="${esc(m.nome||m.nome_arquivo||"")}"
              style="flex:1;padding:9px;background:transparent;border:none;color:var(--red);font-family:var(--font);font-size:13px;cursor:pointer;">
              🗑️
            </button>
          </div>
        </div>`;
      }).join("");

      // Abrir PDF
      lista.querySelectorAll(".btn-man-abrir").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-man-id");
          const url=`${apiBase}/api/manuais/download/${encodeURIComponent(id)}`;
          // Abrir em nova aba com token no header não funciona diretamente
          // Usar fetch + blob para abrir o PDF com autenticação
          toast("📄 Carregando PDF...","info",2500);
          fetch(url,{headers:{Authorization:`Bearer ${DB.getToken()}`}})
            .then(r=>{if(!r.ok) throw new Error("Erro ao carregar PDF");return r.blob();})
            .then(blob=>{
              const blobUrl=URL.createObjectURL(blob);
              window.open(blobUrl,"_blank");
              setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);
            })
            .catch(e=>toast(e?.message||"Falha ao abrir PDF","error"));
        });
      });

      // Editar metadados
      lista.querySelectorAll(".btn-man-editar").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const id=btn.getAttribute("data-man-id");
          const m=manuais.find(x=>String(x.id)===String(id));
          if(m) renderFormManual(m);
        });
      });

      // Excluir
      lista.querySelectorAll(".btn-man-excluir").forEach(btn=>{
        btn.addEventListener("click",async()=>{
          const id=btn.getAttribute("data-man-id");
          const nome=btn.getAttribute("data-man-nome");
          if(!confirm(`Excluir o manual "${nome}"?\nO arquivo será removido permanentemente.`)) return;
          await runWithUi(async()=>{
            await DB.request(`/api/manuais/${encodeURIComponent(id)}`,{method:"DELETE"});
            manuais=manuais.filter(x=>String(x.id)!==String(id));
            renderLista();
            toast("✅ Manual excluído.","success");
          },"Excluindo...");
        });
      });
    }

    function renderFormManual(item=null){
      const isEdit=!!item;
      const wrap=document.getElementById("sv-man-form-wrap"); if(!wrap) return;
      const inStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;`;
      wrap.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar manual":"📤 Enviar novo manual"}</div>
            <button id="man-form-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          ${!isEdit?`
          <div style="margin-bottom:14px;">
            <label style="font-size:13px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;">Arquivo PDF *</label>
            <label id="man-upload-label" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
              border:2px dashed var(--border-hi);border-radius:12px;padding:28px 16px;cursor:pointer;
              background:var(--bg2);text-align:center;transition:border-color .2s;">
              <span style="font-size:36px;">📄</span>
              <span style="font-size:14px;font-weight:600;">Toque para selecionar o PDF</span>
              <span style="font-size:12px;color:var(--muted);">Máximo 20 MB</span>
              <input type="file" id="man-file-input" accept=".pdf,application/pdf" style="display:none;"/>
            </label>
            <div id="man-file-info" style="font-size:12px;color:var(--green);margin-top:6px;text-align:center;"></div>
          </div>`:""}
          <div class="form-grid">
            <div class="field"><label>Nome / Título *</label><input id="man-nome" type="text" value="${esc(item?.nome||"")}" placeholder="Ex: Manual Motor XR-2000" style="${inStyle}text-transform:uppercase;"/></div>
            <div class="field"><label>Categoria</label><input id="man-cat" type="text" value="${esc(item?.categoria||"")}" placeholder="Ex: Motores, Hidráulicos, Elétrico..." style="${inStyle}text-transform:uppercase;" list="man-cat-list"/>
              <datalist id="man-cat-list">${cats.map(c=>`<option value="${esc(c)}">`).join("")}</datalist>
            </div>
            <div class="field"><label>Descrição</label><textarea id="man-desc" rows="2" placeholder="Breve descrição do conteúdo do manual..." style="${inStyle}resize:vertical;">${esc(item?.descricao||"")}</textarea></div>
            <div class="field">
              <label>Tags (separadas por vírgula)</label>
              <input id="man-tags" type="text" value="${esc(item?.tags||"")}" placeholder="Ex: martelete, compressor, marca abc, modelo 2022" style="${inStyle}text-transform:uppercase;"/>
              <div style="font-size:11px;color:var(--muted);margin-top:4px;">Use tags para facilitar a busca por palavra-chave</div>
            </div>
          </div>
          <div class="form-actions">
            <button type="button" id="man-salvar" class="btn btn-primary" style="width:auto;">
              ${isEdit?"💾 Salvar alterações":"📤 Enviar PDF"}
            </button>
            <button type="button" id="man-cancelar" class="btn btn-ghost">Cancelar</button>
          </div>
          <div id="man-progress" style="display:none;margin-top:10px;">
            <div style="background:var(--bg3);border-radius:8px;height:8px;overflow:hidden;">
              <div id="man-progress-bar" style="background:var(--green);height:100%;width:0%;transition:width .3s;border-radius:8px;"></div>
            </div>
            <div id="man-progress-txt" style="font-size:12px;color:var(--muted);margin-top:4px;text-align:center;">Enviando...</div>
          </div>
        </div>`;
      setTimeout(()=>wrap.scrollIntoView({behavior:"smooth",block:"start"}),60);

      document.getElementById("man-form-close")?.addEventListener("click",()=>{wrap.innerHTML="";});
      document.getElementById("man-cancelar")?.addEventListener("click",()=>{wrap.innerHTML="";});

      // Preview arquivo selecionado
      let arquivoSelecionado=null;
      if(!isEdit){
        const fileInput=document.getElementById("man-file-input");
        const fileInfo=document.getElementById("man-file-info");
        const uploadLabel=document.getElementById("man-upload-label");
        fileInput?.addEventListener("change",e=>{
          const f=e.target.files[0];
          if(!f) return;
          if(!f.type.includes("pdf")&&!f.name.toLowerCase().endsWith(".pdf")){
            toast("Apenas arquivos PDF são aceitos.","warning"); fileInput.value=""; return;
          }
          if(f.size>20*1024*1024){toast("Arquivo muito grande (máx. 20MB).","warning");fileInput.value="";return;}
          arquivoSelecionado=f;
          fileInfo.textContent=`✅ ${f.name} (${tamanhoFmt(f.size)})`;
          uploadLabel.style.borderColor="var(--green)";
          // Preencher nome automaticamente se vazio
          const nomeInput=document.getElementById("man-nome");
          if(nomeInput&&!nomeInput.value){
            nomeInput.value=f.name.replace(/\.pdf$/i,"").replace(/[-_]/g," ").toUpperCase();
          }
        });
      }

      // Salvar
      document.getElementById("man-salvar")?.addEventListener("click",async()=>{
        const nome=String(document.getElementById("man-nome")?.value||"").trim().toUpperCase();
        const cat=String(document.getElementById("man-cat")?.value||"").trim().toUpperCase();
        const desc=String(document.getElementById("man-desc")?.value||"").trim();
        const tags=String(document.getElementById("man-tags")?.value||"").trim().toUpperCase();

        if(!nome){toast("Informe o nome/título do manual.","warning");return;}

        if(isEdit){
          await runWithUi(async()=>{
            await DB.request(`/api/manuais/${encodeURIComponent(item.id)}`,{
              method:"PUT",body:JSON.stringify({nome,descricao:desc,tags,categoria:cat})
            });
            const idx=manuais.findIndex(x=>String(x.id)===String(item.id));
            if(idx>=0) manuais[idx]={...manuais[idx],nome,descricao:desc,tags,categoria:cat};
            wrap.innerHTML=""; renderLista();
            toast("✅ Manual atualizado.","success");
          },"Salvando...");
          return;
        }

        if(!arquivoSelecionado){toast("Selecione um arquivo PDF.","warning");return;}

        // Upload com XMLHttpRequest para ter progresso real
        const token=DB.getToken();
        const apiUrl=`${apiBase}/api/manuais`;
        const fd=new FormData();
        fd.append("arquivo",arquivoSelecionado,arquivoSelecionado.name);
        fd.append("nome",nome);
        fd.append("descricao",desc);
        fd.append("tags",tags);
        fd.append("categoria",cat);

        const prog=document.getElementById("man-progress");
        const progBar=document.getElementById("man-progress-bar");
        const progTxt=document.getElementById("man-progress-txt");
        if(prog) prog.style.display="block";

        const salvarBtn=document.getElementById("man-salvar");
        if(salvarBtn) salvarBtn.disabled=true;

        try{
          await new Promise((resolve,reject)=>{
            const xhr=new XMLHttpRequest();
            xhr.open("POST",apiUrl);
            xhr.setRequestHeader("Authorization",`Bearer ${token}`);
            xhr.upload.addEventListener("progress",e=>{
              if(e.lengthComputable){
                const pct=Math.round(e.loaded/e.total*100);
                if(progBar) progBar.style.width=pct+"%";
                if(progTxt) progTxt.textContent=`Enviando... ${pct}% (${tamanhoFmt(e.loaded)} de ${tamanhoFmt(e.total)})`;
              }
            });
            xhr.addEventListener("load",()=>{
              if(xhr.status>=200&&xhr.status<300){
                try{const novo=JSON.parse(xhr.responseText);manuais.unshift(novo);}catch{}
                resolve(null);
              } else {
                try{const e=JSON.parse(xhr.responseText);reject(new Error(e.error||`HTTP ${xhr.status}`));}
                catch{reject(new Error(`HTTP ${xhr.status}`));}
              }
            });
            xhr.addEventListener("error",()=>reject(new Error("Falha de conexão")));
            xhr.send(fd);
          });
          wrap.innerHTML=""; renderLista();
          toast("✅ Manual enviado com sucesso!","success");
        }catch(e){
          toast(e?.message||"Erro ao enviar PDF","error",6000);
          if(salvarBtn) salvarBtn.disabled=false;
          if(prog) prog.style.display="none";
        }
      });
    }

    // ── Render principal ──────────────────────────────────────────
    root.innerHTML=`
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div class="card-title">📚 Manuais & Instruções</div>
          <div style="display:flex;gap:6px;">
            <button id="btn-man-novo" class="btn btn-primary" style="width:auto;">📤 Enviar PDF</button>
            <button id="btn-man-refresh" class="btn btn-secondary btn-icon">↻</button>
          </div>
        </div>

        <!-- Busca -->
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <div class="search-wrap" style="flex:1;min-width:180px;">
            <span class="search-icon">🔍</span>
            <input id="man-search" type="search" placeholder="Buscar por nome, tag ou palavra-chave..." value="${esc(F.q)}" autocomplete="off"/>
          </div>
          ${cats.length?`<select id="man-filter-cat" style="padding:10px 12px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:13px;">
            <option value="">Todas as categorias</option>
            ${cats.map(c=>`<option value="${esc(c)}" ${F.cat===c?"selected":""}>${esc(c)}</option>`).join("")}
          </select>`:""}
        </div>

        <!-- Resultado -->
        <div style="margin-top:8px;font-size:12px;color:var(--muted);">
          ${filtraManuais().length} manual${filtraManuais().length!==1?"is":""} encontrado${filtraManuais().length!==1?"s":""}
          ${manuais.length&&F.q?` de ${manuais.length} total`:""}
        </div>
      </div>

      <div id="sv-man-form-wrap"></div>
      <div id="sv-man-lista"></div>
    `;

    renderLista();

    document.getElementById("man-search")?.addEventListener("input",e=>{
      F.q=e.target.value; renderLista();
      // atualizar contador
      const cont=root.querySelector("[style*='12px'][style*='muted']");
    });
    document.getElementById("man-filter-cat")?.addEventListener("change",e=>{
      F.cat=e.target.value; renderLista();
    });
    document.getElementById("btn-man-novo")?.addEventListener("click",()=>renderFormManual(null));
    document.getElementById("btn-man-refresh")?.addEventListener("click",async()=>{
      await runWithUi(async()=>{
        manuais=safeArray(await DB.request("/api/manuais",{method:"GET"}));
        renderManuais(root);
      },"Atualizando...");
    });
  }

  // ─── Vendas Diárias ───────────────────────────────────────────────────────────
  async function renderVendas(root){
    const KEY="sv_vendas_diarias";
    const lerVendas=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]");}catch{return[];}};
    const gravarVendas=v=>{try{localStorage.setItem(KEY,JSON.stringify(v));}catch{}};
    let vendas=lerVendas();

    if(!state._venFiltro) state._venFiltro="tudo";

    const inStyle=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;`;

    function totalFiltrado(lista){return lista.reduce((s,v)=>s+Number(v.valor||0),0);}

    function getVendasFiltradas(){
      return filtrarPorPeriodoGen(vendas,"data","_venFiltro");
    }

    function renderResumo(lista){
      const loja=lista.filter(v=>v.tipo==="LOJA").reduce((s,v)=>s+Number(v.valor||0),0);
      const ext=lista.filter(v=>v.tipo==="EXTERNA").reduce((s,v)=>s+Number(v.valor||0),0);
      const total=loja+ext;
      return`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:rgba(0,230,118,.08);border:1px solid rgba(0,230,118,.2);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:var(--green);">${moneyBR(total)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Total</div>
        </div>
        <div style="background:rgba(68,136,255,.08);border:1px solid rgba(68,136,255,.2);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:16px;font-weight:700;color:var(--blue);">${moneyBR(loja)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">🏪 Loja</div>
        </div>
        <div style="background:rgba(255,179,0,.08);border:1px solid rgba(255,179,0,.2);border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:16px;font-weight:700;color:var(--amber);">${moneyBR(ext)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">🚗 Externa</div>
        </div>
      </div>`;
    }

    function renderLista(){
      const lista=document.getElementById("sv-ven-lista"); if(!lista) return;
      const filtradas=getVendasFiltradas();
      const resumoEl=document.getElementById("sv-ven-resumo");
      if(resumoEl) resumoEl.innerHTML=renderResumo(filtradas);
      const cnt=document.getElementById("sv-ven-count");
      if(cnt) cnt.textContent=`${filtradas.length} lançamento${filtradas.length!==1?"s":""}`;
      if(!filtradas.length){
        lista.innerHTML=`<div class="empty-state"><div class="empty-icon">💵</div><div class="empty-text">Nenhum lançamento no período.</div></div>`;
        return;
      }
      lista.innerHTML=filtradas.map(v=>`
        <div class="list-item">
          <div class="list-item-top">
            <div>
              <div class="list-item-title">${moneyBR(v.valor||0)}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">${v.obs||""}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <span class="badge ${v.tipo==="LOJA"?"badge-blue":"badge-muted"}">${v.tipo==="LOJA"?"🏪 Loja":"🚗 Externa"}</span>
              <div style="font-size:12px;color:var(--muted);margin-top:4px;">${v.data?dateFormatBR(v.data):""}</div>
            </div>
          </div>
          <div class="list-item-actions">
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" data-ven-edit="${esc(v._id)}">✏️ Editar</button>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--red);" data-ven-del="${esc(v._id)}">🗑️</button>
          </div>
        </div>`).join("");

      lista.querySelectorAll("[data-ven-edit]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const v=vendas.find(x=>x._id===btn.getAttribute("data-ven-edit"));
          if(v) renderFormVenda(v);
        });
      });
      lista.querySelectorAll("[data-ven-del]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          if(!confirm("Excluir este lançamento?")) return;
          vendas=vendas.filter(x=>x._id!==btn.getAttribute("data-ven-del"));
          gravarVendas(vendas); renderLista();
          toast("Lançamento excluído.","info");
        });
      });
    }

    function renderFormVenda(item=null){
      const fw=document.getElementById("sv-ven-form"); if(!fw) return;
      const isEdit=!!item;
      fw.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:15px;font-weight:600;">${isEdit?"✏️ Editar":"➕ Novo"} lançamento</div>
            <button type="button" id="ven-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          <div class="form-grid">
            <div class="field"><label>Data *</label><input id="ven-data" type="date" value="${esc(item?.data||new Date().toISOString().slice(0,10))}" style="${inStyle}"/></div>
            <div class="field">
              <label>Canal *</label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
                <label style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--bg2);border:2px solid ${item?.tipo==="LOJA"?"var(--blue)":"var(--border)"};border-radius:10px;cursor:pointer;">
                  <input type="radio" name="ven-tipo" value="LOJA" ${(!item||item.tipo==="LOJA")?"checked":""} style="width:16px;height:16px;accent-color:var(--blue);"/>
                  <span style="font-size:14px;font-weight:600;">🏪 Loja</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--bg2);border:2px solid ${item?.tipo==="EXTERNA"?"var(--amber)":"var(--border)"};border-radius:10px;cursor:pointer;">
                  <input type="radio" name="ven-tipo" value="EXTERNA" ${item?.tipo==="EXTERNA"?"checked":""} style="width:16px;height:16px;accent-color:var(--amber);"/>
                  <span style="font-size:14px;font-weight:600;">🚗 Externa</span>
                </label>
              </div>
            </div>
            <div class="field"><label>Valor (R$) *</label><input id="ven-valor" type="text" inputmode="decimal" value="${esc(item?.valor?String(item.valor).replace(".",","):"")}" placeholder="0,00" style="${inStyle}text-align:right;"/></div>
            <div class="field"><label>Observação</label><input id="ven-obs" type="text" value="${esc(item?.obs||"")}" placeholder="Descrição opcional..." style="${inStyle}"/></div>
          </div>
          <div class="form-actions">
            <button type="button" id="ven-salvar" class="btn btn-primary" style="width:auto;">💾 ${isEdit?"Salvar":"Lançar"}</button>
            <button type="button" id="ven-cancel" class="btn btn-ghost">Cancelar</button>
          </div>
        </div>`;
      setTimeout(()=>fw.scrollIntoView({behavior:"smooth",block:"start"}),60);
      document.getElementById("ven-close")?.addEventListener("click",()=>{fw.innerHTML="";});
      document.getElementById("ven-cancel")?.addEventListener("click",()=>{fw.innerHTML="";});

      // Highlight dos radio ao mudar
      fw.querySelectorAll("[name='ven-tipo']").forEach(r=>{
        r.addEventListener("change",()=>{
          fw.querySelectorAll("[name='ven-tipo']").forEach(x=>{
            x.closest("label").style.borderColor=x.checked?(x.value==="LOJA"?"var(--blue)":"var(--amber)"):"var(--border)";
          });
        });
      });

      document.getElementById("ven-salvar")?.addEventListener("click",()=>{
        const data=document.getElementById("ven-data")?.value;
        const tipo=fw.querySelector("[name='ven-tipo']:checked")?.value||"LOJA";
        const valor=Number(String(document.getElementById("ven-valor")?.value||"0").replace(",",".").replace(/[^\d.]/g,""))||0;
        const obs=String(document.getElementById("ven-obs")?.value||"").trim();
        if(!data){toast("Informe a data.","warning");return;}
        if(!valor){toast("Informe o valor.","warning");return;}
        const novo={_id:item?._id||("VD-"+Date.now()),data,tipo,valor,obs};
        if(isEdit) vendas=vendas.map(x=>x._id===item._id?novo:x);
        else vendas.unshift(novo);
        gravarVendas(vendas); fw.innerHTML=""; renderLista();
        toast(`✅ Lançamento ${isEdit?"atualizado":"salvo"}.`,"success");
      });
    }

    // Exportar CSV
    function exportarVendas(){
      const filtradas=getVendasFiltradas();
      if(!filtradas.length){toast("Nenhum dado para exportar.","warning");return;}
      const csv="\uFEFF"+["Data;Canal;Valor;Observação",
        ...filtradas.map(v=>`${dateFormatBR(v.data)};${v.tipo};${String(v.valor||0).replace(".",",")};${v.obs||""}`)
      ].join("\n");
      const a=Object.assign(document.createElement("a"),{
        href:URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"})),
        download:`vendas_${new Date().toISOString().slice(0,10)}.csv`
      });
      a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }

    root.innerHTML=`
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div class="card-title">💵 Vendas Diárias</div>
          <div style="display:flex;gap:6px;">
            <button id="ven-novo-btn" class="btn btn-primary" style="width:auto;">+ Lançar venda</button>
            <button id="ven-export-btn" class="btn btn-secondary" style="font-size:12px;">📤 CSV</button>
          </div>
        </div>
        ${renderFiltroPeriodo("_venFiltro")}
        <div id="sv-ven-count" style="margin-top:6px;font-size:12px;color:var(--muted);"></div>
      </div>
      <div id="sv-ven-resumo"></div>
      <div id="sv-ven-form"></div>
      <div id="sv-ven-lista"></div>`;

    renderLista();
    document.getElementById("ven-novo-btn")?.addEventListener("click",()=>renderFormVenda(null));
    document.getElementById("ven-export-btn")?.addEventListener("click",exportarVendas);
    bindFiltroPeriodo("_venFiltro",renderLista);
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
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div style="font-size:13px;font-weight:600;">📁 Rotas salvas (${rotasSalvas.length})</div>
          <button id="btn-refresh-rotas" class="btn btn-secondary btn-icon" style="font-size:13px;">↻</button>
        </div>
        ${renderFiltroPeriodo("_rotFiltro")}
        <div id="sv-rotas-lista" style="margin-top:10px;">
        ${(()=>{
          if(!state._rotFiltro) state._rotFiltro="tudo";
          const hoje=new Date().toISOString().slice(0,10);
          const mesAtual=new Date().toISOString().slice(0,7);
          const semanaAtras=new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0,10);
          const filtradas=rotasSalvas.filter(r=>{
            if(state._rotFiltro==="tudo") return true;
            const d=String(r.data||"").slice(0,10);
            if(!d) return false;
            if(state._rotFiltro==="hoje")   return d===hoje;
            if(state._rotFiltro==="semana") return d>=semanaAtras&&d<=hoje;
            if(state._rotFiltro==="mes")    return d.startsWith(mesAtual);
            return true;
          });
          if(!filtradas.length) return`<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma rota encontrada.</div>`;
          return filtradas.map(r=>{
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
          }).join("");
        })()}
        </div>
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
    bindFiltroPeriodo("_rotFiltro",()=>renderRotas(root));

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

  // Users + Permissões + Logs
  async function renderUsersScreen(root){
    const user=DB.getUser();
    if(!user||user.role!=="admin"){root.innerHTML=`<div class="card"><div class="card-title">👤 Usuários</div><p style="color:var(--red);font-size:14px;margin-top:8px;">Acesso restrito ao administrador.</p></div>`;return;}
    let users=[];
    try{users=safeArray(await DB.listUsers());}catch(e){root.innerHTML=`<div class="card"><div class="card-title">👤 Usuários</div><p style="color:var(--red);font-size:14px;margin-top:8px;">${esc(e?.message||"Falha")}</p></div>`;return;}

    const base=`width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--border-hi);border-radius:9px;color:var(--text);font-family:var(--font);font-size:14px;-webkit-appearance:none;`;

    // Tabs: Usuários | Auditoria
    if(!state._userTab) state._userTab="usuarios";

    function chkStyle(on){return `display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:${on?"rgba(0,230,118,.1)":"var(--bg2)"};border:1px solid ${on?"rgba(0,230,118,.3)":"var(--border)"};border-radius:8px;cursor:pointer;font-size:13px;color:${on?"var(--green)":"var(--text)"};font-family:var(--font);`;}

    // Definição de recursos e ações
    const RECURSOS=[
      {key:"clientes",    label:"👥 Clientes",    acoes:["ver","criar","editar","excluir"]},
      {key:"mercadorias", label:"📦 Mercadorias", acoes:["ver","criar","editar","excluir"]},
      {key:"pedidos",     label:"🛒 Pedidos",     acoes:["ver","criar","editar","excluir"]},
      {key:"despesas",    label:"💸 Despesas",    acoes:["ver","criar","editar","excluir"]},
      {key:"lembretes",   label:"🔔 Lembretes",   acoes:["ver","criar","editar","excluir"]},
      {key:"anotacoes",   label:"📝 Anotações",   acoes:["ver","criar","editar","excluir"]},
      {key:"rotas",       label:"🗺️ Rotas",       acoes:["ver","criar","editar","excluir"]},
      {key:"financeiro",  label:"💰 Financeiro",  acoes:["ver"]},
      {key:"relatorios",  label:"📈 Relatórios",  acoes:["ver"]},
    ];

    function permChecked(perms,recurso,acao){
      if(!perms||Object.keys(perms).length===0) return true; // sem restrições = tudo liberado
      const r=perms[recurso];
      if(r===false) return false;
      if(typeof r==="object"&&r!==null) return r[acao]!==false;
      return true;
    }

    function renderPermissoes(u){
      const perms=u.permissions||{};
      const isSeller=u.role==="seller";
      if(!isSeller) return `<div style="font-size:12px;color:var(--muted);padding:8px;">Administradores têm acesso total a tudo.</div>`;
      return`<div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:var(--bg);">
            <th style="padding:8px;text-align:left;font-weight:600;border-bottom:1px solid var(--border);">Módulo</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Ver</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Criar</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Editar</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Excluir</th>
          </tr></thead>
          <tbody>
            ${RECURSOS.map(r=>`<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:8px;font-weight:500;">${r.label}</td>
              ${["ver","criar","editar","excluir"].map(a=>{
                const temAcao=r.acoes.includes(a);
                if(!temAcao) return`<td style="padding:8px;text-align:center;color:var(--muted);">—</td>`;
                const on=permChecked(perms,r.key,a);
                return`<td style="padding:8px;text-align:center;">
                  <input type="checkbox" data-perm-rec="${r.key}" data-perm-acao="${a}" ${on?"checked":""}
                    style="width:16px;height:16px;accent-color:var(--green);cursor:pointer;"/>
                </td>`;
              }).join("")}
            </tr>`).join("")}
          </tbody>
        </table>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;padding:4px;">
          ✅ Marcado = permitido · ☐ Desmarcado = bloqueado · Dados inseridos pelo vendedor ficam visíveis ao admin sempre
        </div>
      </div>`;
    }

    root.innerHTML=`
      <div class="card">
        <div class="card-header">
          <div class="card-title">👤 Usuários & Acesso</div>
          <div style="display:flex;gap:6px;">
            <button id="sv-user-new" class="btn btn-primary" style="width:auto;${state._userTab==="logs"?"display:none":""}">+ Novo</button>
            <button id="sv-user-refresh" class="btn btn-secondary btn-icon">↻</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="tab-usuarios" class="btn ${state._userTab==="usuarios"?"btn-primary":"btn-secondary"}" style="font-size:13px;">👥 Usuários</button>
          <button id="tab-logs" class="btn ${state._userTab==="logs"?"btn-primary":"btn-secondary"}" style="font-size:13px;">📋 Auditoria</button>
        </div>
      </div>
      <div id="sv-users-form-wrap"></div>
      <div id="sv-users-content"></div>`;

    const content=$("#sv-users-content");
    const fw=$("#sv-users-form-wrap");

    function renderTabUsuarios(){
      content.innerHTML=users.length?users.map(u=>`
        <div class="list-item">
          <div class="list-item-top">
            <div>
              <div class="list-item-title">${esc(u.name||"")}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">${esc(u.email||"")}</div>
            </div>
            <span class="badge ${u.role==="admin"?"badge-blue":"badge-muted"}">${u.role==="admin"?"Admin":"Vendedor"}</span>
          </div>
          <div class="list-item-meta">
            <span class="meta-item">Ativo: <strong style="color:${Number(u.active)?"var(--green)":"var(--red)"}">${Number(u.active)?"Sim":"Não"}</strong></span>
            ${u.created_at?`<span class="meta-item">Desde: <strong>${dateFormatBR(u.created_at)}</strong></span>`:""}
          </div>
          <div class="list-item-actions">
            <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-user-edit="${esc(u.id||"")}">✏️ Editar</button>
            <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-user-perm="${esc(u.id||"")}">🔐 Permissões</button>
            <button class="btn btn-secondary" style="font-size:13px;padding:7px 14px;" data-user-logs="${esc(u.id||"")}">📋 Logs</button>
          </div>
        </div>`).join(""):`<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-text">Nenhum usuário.</div></div>`;

      // Bind botões
      $$("[data-user-edit]",content).forEach(btn=>{
        btn.addEventListener("click",()=>{const id=btn.getAttribute("data-user-edit");const u=users.find(x=>String(x.id)===String(id));if(u)renderUserForm(u);});
      });
      $$("[data-user-perm]",content).forEach(btn=>{
        btn.addEventListener("click",()=>{const id=btn.getAttribute("data-user-perm");const u=users.find(x=>String(x.id)===String(id));if(u)renderPermForm(u);});
      });
      $$("[data-user-logs]",content).forEach(btn=>{
        btn.addEventListener("click",()=>{const id=btn.getAttribute("data-user-logs");const u=users.find(x=>String(x.id)===String(id));if(u)carregarLogs(id,u.name);});
      });
    }

    async function renderTabLogs(userId="",userName="Todos"){
      content.innerHTML=`<div class="card"><div style="font-size:13px;color:var(--muted);">Carregando logs...</div></div>`;
      try{
        const url=userId?`/api/logs?user_id=${encodeURIComponent(userId)}&limit=200`:"/api/logs?limit=200";
        const logs=safeArray(await DB.request(url,{method:"GET"}));
        const icoMap={login:"🔑",criar:"➕",editar:"✏️",excluir:"🗑️"};
        content.innerHTML=`
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
              <div style="font-size:14px;font-weight:600;">📋 Auditoria — ${esc(userName)} (${logs.length})</div>
              <div style="display:flex;gap:6px;">
                ${userId?`<button id="log-todos" class="btn btn-secondary" style="font-size:12px;">Ver todos</button>`:""}
                <select id="log-filtro-recurso" style="padding:7px 10px;background:var(--bg);border:1px solid var(--border-hi);border-radius:8px;color:var(--text);font-family:var(--font);font-size:12px;">
                  <option value="">Todos os módulos</option>
                  ${[...new Set(logs.map(l=>l.recurso))].map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div id="log-lista">
              ${logs.length?logs.map(l=>`
                <div class="log-item" data-recurso="${esc(l.recurso||"")}" style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--border);">
                  <div style="font-size:18px;flex-shrink:0;width:24px;text-align:center;">${icoMap[l.acao]||"📌"}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.detalhe||"")}</div>
                    <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                      <span style="font-weight:600;color:var(--blue);">${esc(l.user_name||"")}</span>
                      · ${esc(l.recurso||"")} · ${esc(l.acao||"")}
                    </div>
                  </div>
                  <div style="font-size:11px;color:var(--muted);flex-shrink:0;white-space:nowrap;">${l.created_at?new Date(l.created_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}</div>
                </div>`).join(""):`<div style="padding:24px;text-align:center;color:var(--muted);">Nenhum registro de atividade.</div>`}
            </div>
          </div>`;

        $("#log-todos")?.addEventListener("click",()=>carregarLogs("","Todos"));
        $("#log-filtro-recurso")?.addEventListener("change",e=>{
          const val=e.target.value;
          $$(".log-item",content).forEach(el=>{
            el.style.display=!val||el.getAttribute("data-recurso")===val?"":"none";
          });
        });
      }catch(e){content.innerHTML=`<div class="card"><p style="color:var(--red);">${esc(e?.message||"Erro ao carregar logs")}</p></div>`;}
    }

    async function carregarLogs(userId,userName){
      state._userTab="logs";
      await renderTabLogs(userId,userName);
    }

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
          toast(`✅ Usuário ${isEdit?"atualizado":"criado"}.`,"success");fw.innerHTML="";await renderUsersScreen(root);
        },isEdit?"Salvando...":"Criando...");
      });
    }

    function renderPermForm(u){
      const perms=u.permissions||{};
      fw.innerHTML=`
        <div class="form-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            <div>
              <div style="font-size:15px;font-weight:600;">🔐 Permissões — ${esc(u.name||"")}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px;">Controle o que este usuário pode ver e fazer</div>
            </div>
            <button id="sv-perm-close" class="btn btn-ghost btn-icon">✕</button>
          </div>
          ${u.role==="admin"?`<div style="padding:12px;background:rgba(68,136,255,.08);border:1px solid rgba(68,136,255,.2);border-radius:10px;font-size:13px;color:var(--blue);">
            Este usuário é <strong>Administrador</strong> e tem acesso total a todos os módulos.
            Para restringir acesso, mude o perfil para <strong>Vendedor</strong> primeiro.
          </div>`:`
          <div id="sv-perm-table">${renderPermissoes(u)}</div>
          <div style="margin-top:6px;padding:10px;background:rgba(255,179,0,.06);border:1px solid rgba(255,179,0,.2);border-radius:9px;font-size:12px;color:var(--muted);">
            ⚠️ Todos os dados inseridos pelo vendedor (pedidos, clientes, etc.) ficam visíveis ao administrador, independente das permissões.
          </div>
          <div class="form-actions">
            <button type="button" id="btn-salvar-perm" class="btn btn-primary" style="width:auto;">💾 Salvar permissões</button>
            <button type="button" id="btn-liberar-tudo" class="btn btn-secondary" style="font-size:13px;">✅ Liberar tudo</button>
            <button type="button" id="btn-bloquear-tudo" class="btn btn-secondary" style="font-size:13px;">🚫 Bloquear tudo</button>
            <button type="button" id="sv-perm-cancel" class="btn btn-ghost">Cancelar</button>
          </div>`}
        </div>`;
      setTimeout(()=>fw?.scrollIntoView({behavior:"smooth",block:"start"}),60);
      $("#sv-perm-close")?.addEventListener("click",()=>{fw.innerHTML="";});
      $("#sv-perm-cancel")?.addEventListener("click",()=>{fw.innerHTML="";});

      if(u.role==="seller"){
        const lerPerms=()=>{
          const novas={};
          $$("[data-perm-rec]",fw).forEach(chk=>{
            const rec=chk.getAttribute("data-perm-rec"),acao=chk.getAttribute("data-perm-acao");
            if(!novas[rec]) novas[rec]={};
            novas[rec][acao]=chk.checked;
          });
          return novas;
        };
        $("#btn-liberar-tudo")?.addEventListener("click",()=>{$$("[data-perm-rec]",fw).forEach(chk=>{chk.checked=true;});});
        $("#btn-bloquear-tudo")?.addEventListener("click",()=>{$$("[data-perm-rec]",fw).forEach(chk=>{chk.checked=false;});});
        $("#btn-salvar-perm")?.addEventListener("click",async()=>{
          const novas=lerPerms();
          await runWithUi(async()=>{
            await DB.updateUser(u.id,{permissions:novas});
            toast("✅ Permissões salvas.","success");fw.innerHTML="";await renderUsersScreen(root);
          },"Salvando permissões...");
        });
      }
    }

    // Renderizar tab atual
    if(state._userTab==="logs") await renderTabLogs();
    else renderTabUsuarios();

    // Tab switchers
    $("#tab-usuarios")?.addEventListener("click",()=>{state._userTab="usuarios";renderTabUsuarios();$("#sv-user-new").style.display="";});
    $("#tab-logs")?.addEventListener("click",()=>{state._userTab="logs";renderTabLogs();$("#sv-user-new").style.display="none";});
    $("#sv-user-new")?.addEventListener("click",()=>renderUserForm(null));
    $("#sv-user-refresh")?.addEventListener("click",async()=>{await runWithUi(()=>renderUsersScreen(root),"Atualizando...");});
  }

  // Verificar permissão local antes de navegar (bloqueio no front)
  function temPermissaoLocal(recurso,acao="ver"){
    const u=DB.getUser(); if(!u) return false;
    if(u.role==="admin") return true;
    const perms=u.permissions||{};
    if(!perms||Object.keys(perms).length===0) return true;
    const r=perms[recurso];
    if(r===false) return false;
    if(typeof r==="object"&&r!==null) return r[acao]!==false;
    return true;
  }

  // Shell
  function bindShell(){
    $("#menu-toggle")?.addEventListener("click",()=>{$("#app-sidebar")?.classList.add("mobile-open");const b=$("#sidebar-backdrop");if(b)b.style.display="block";});
    $("#sidebar-backup-btn")?.addEventListener("click",doBackup);
    // Sync manual — atualiza todos os dados do servidor
    $("#btn-sync-manual")?.addEventListener("click",async()=>{
      if(window._svSync) await window._svSync();
    });
    $("#sidebar-restore-btn")?.addEventListener("click",()=>$("#sidebar-restore-file")?.click());
    $("#sidebar-restore-file")?.addEventListener("change",async e=>{
      const file=e.target.files[0]; if(!file) return;
      e.target.value="";
      if(!confirm("⚠️ Restaurar backup irá sobrescrever dados existentes.\n\nDeseja continuar?")) return;
      await runWithUi(async()=>{
        const text=await file.text();
        let bk;
        try{ bk=JSON.parse(text); }
        catch{ toast("Arquivo inválido. Use um backup .json gerado pelo sistema.","error"); return; }

        // Suportar formato {data:{tables:{...}}} ou {tables:{...}}
        const tables=bk?.data?.tables||bk?.tables||bk?.data||null;
        if(!tables||typeof tables!=="object"){ toast("Formato de backup inválido.","error"); return; }

        const recursos={
          clientes:"clientes", produtos:"mercadorias", pedidos:"pedidos",
          despesas:"despesas", lembretes:"lembretes", rotas:"rotas", notas:"notas",
        };
        let ok=0, erros=0;
        for(const [tabela,resource] of Object.entries(recursos)){
          const rows=safeArray(tables[tabela]||tables[resource]);
          if(!rows.length) continue;
          for(const row of rows){
            try{
              // Normalizar campos comuns
              const payload={...row};
              delete payload.vendor_id; delete payload.updated_at; delete payload.created_at;
              await DB.create(resource,payload);
              ok++;
            }catch(e2){
              // Se já existe (conflito de ID), tentar update
              try{
                const id=row.id||row._id;
                if(id){ await DB.update(resource,id,row); ok++; }
              }catch{ erros++; }
            }
          }
        }
        await preloadAll();
        renderCurrent();
        toast(`✅ Restore concluído: ${ok} registros restaurados${erros?` · ${erros} erros`:""}`,ok?"success":"warning",6000);
      },"Restaurando backup...");
    });
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
      await runWithUi(async()=>{
        await DB.login(email,senha);
        // Sempre buscar /api/me após login para garantir permissions atualizado
        try{
          const meData=await DB.me();
          // Garantir que permissions está no user salvo
          const u=DB.getUser();
          if(u&&!u.permissions){
            const permsFromMe=meData?.user?.permissions||meData?.permissions||{};
            DB.setUser({...u,permissions:permsFromMe});
          }
        }catch(e){console.warn("me() falhou:",e);}
        syncLoginWorkspace();bindShell();renderNav();
        await preloadAll();
        renderCurrent();showLembretesPopupIfNeeded();
        toast("✅ Login realizado!","success");
      },"Entrando...");
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
  // ── Migração única: dados do localStorage → API ───────────────────────────────
  async function migrarLocalStorageParaAPI(){
    const FLAG="sv_migrado_v29";
    if(localStorage.getItem(FLAG)) return; // já migrado

    let migrou=false;

    // Migrar Cartões
    try{
      const cartoes=JSON.parse(localStorage.getItem("sv_cartoes")||"[]");
      if(cartoes.length>0){
        const toast_id="mig-cart";
        toast(`📦 Migrando ${cartoes.length} cartão${cartoes.length!==1?"ões":""} para o servidor...`,"info",8000);
        let ok=0;
        for(const c of cartoes){
          try{
            await DB.request("/api/cartoes",{
              method:"POST",
              body:JSON.stringify({
                id: c._id||c.id||("CN-"+Date.now()+"-"+Math.random().toString(36).slice(2,5)),
                nome:     c.nome||"",
                cargo:    c.cargo||"",
                empresa:  c.empresa||"",
                telefone: c.telefone||"",
                email:    c.email||"",
                endereco: c.endereco||"",
                obs:      c.obs||"",
                foto:     c.foto||"",
              })
            });
            ok++;
          }catch(e){ console.warn("Erro migrar cartão:",e?.message); }
        }
        if(ok>0){
          toast(`✅ ${ok} cartão${ok!==1?"ões":""} migrado${ok!==1?"s":""} com sucesso!`,"success",4000);
          migrou=true;
        }
      }
    }catch(e){ console.warn("Migração cartões:",e?.message); }

    // Migrar Visitas
    try{
      const visitas=JSON.parse(localStorage.getItem("sv_visitas")||"[]");
      if(visitas.length>0){
        toast(`📦 Migrando ${visitas.length} visita${visitas.length!==1?"s":""} para o servidor...`,"info",8000);
        let ok=0;
        for(const v of visitas){
          try{
            await DB.request("/api/visitas",{
              method:"POST",
              body:JSON.stringify({
                id:       v._id||v.id||("VS-"+Date.now()+"-"+Math.random().toString(36).slice(2,5)),
                nome:     v.nome||"",
                telefone: v.telefone||"",
                endereco: v.endereco||"",
                cidade:   v.cidade||"",
                data:     v.data||"",
                resultado:v.resultado||"",
                acao:     v.acao||"",
                obs:      v.obs||"",
              })
            });
            ok++;
          }catch(e){ console.warn("Erro migrar visita:",e?.message); }
        }
        if(ok>0){
          toast(`✅ ${ok} visita${ok!==1?"s":""} migrada${ok!==1?"s":""} com sucesso!`,"success",4000);
          migrou=true;
        }
      }
    }catch(e){ console.warn("Migração visitas:",e?.message); }

    // Marcar como migrado e limpar localStorage antigo
    try{
      localStorage.setItem(FLAG,"1");
      // Manter backup dos dados originais por segurança (com sufixo _bak)
      if(localStorage.getItem("sv_cartoes")){
        localStorage.setItem("sv_cartoes_bak",localStorage.getItem("sv_cartoes")||"");
        localStorage.removeItem("sv_cartoes");
      }
      if(localStorage.getItem("sv_visitas")){
        localStorage.setItem("sv_visitas_bak",localStorage.getItem("sv_visitas")||"");
        localStorage.removeItem("sv_visitas");
      }
    }catch{}

    if(migrou){
      console.log("✅ Migração localStorage → API concluída.");
    }
  }

  async function init(){
    try{if(localStorage.getItem("sv_theme")==="light") document.body.classList.add("light-mode");}catch{}

    bindAuthForms();
    if(DB.getToken()){
      try{
        // Buscar /api/me para garantir permissions atualizadas
        let meOk=false;
        try{
          const meData=await DB.me();
          // me() já chama setUser internamente via db.js
          // Mas garantir que permissions está mesclado corretamente
          const u=DB.getUser();
          if(u){
            const permsFromServer=meData?.user?.permissions||meData?.permissions;
            if(permsFromServer!==undefined){
              DB.setUser({...u, permissions:permsFromServer});
            }
          }
          meOk=true;
        }catch(meErr){
          // Se for 401/403 = sessão inválida, deslogar
          if(meErr?.status===401||meErr?.status===403){
            DB.clearSession(); syncLoginWorkspace(); return;
          }
          // Erro de rede = continuar com dados do localStorage
          console.warn("me() falhou (rede?), usando dados locais:", meErr?.message);
        }

        syncLoginWorkspace(); bindShell();
        renderNav();
        await runWithUi(preloadAll,"Carregando dados...");

        // ── Migração única: localStorage → API (Cartões + Visitas) ────────────
        await migrarLocalStorageParaAPI();

        const hash=(location.hash||"#dashboard").replace("#","")||"dashboard";
        state.route=getRoute(hash).id;
        renderNav(); renderCurrent();
        showLembretesPopupIfNeeded();
      }catch(e){
        if(e?.status===401||e?.status===403){
          console.warn("Sessão inválida:",e);
          DB.clearSession(); syncLoginWorkspace();
        } else {
          console.warn("Erro de inicialização (não crítico):",e?.message);
          // Tentar continuar mesmo assim
          try{syncLoginWorkspace();bindShell();renderNav();renderCurrent();}catch{}
        }
      }
    }else{syncLoginWorkspace();}

    window.addEventListener("hashchange",()=>{
      const h=(location.hash||"#dashboard").replace("#","")||"dashboard";
      state.route=getRoute(h).id; state.ui.search=""; renderNav(); renderCurrent();
    });

    // ── Sync multi-usuário ──────────────────────────────────────────────────────
    // Recursos que precisam de sync (excluir notas que são pessoais)
    const SYNC_RECURSOS=["clientes","mercadorias","pedidos","despesas","lembretes","rotas"];

    // Flag global — true quando form está aberto (inclui file picker da câmera)
    window._svFormAberto=()=>{
      // Form explicitamente aberto
      if(document.querySelector(".form-card, #sv-cart-form:not(:empty), #sv-vis-form:not(:empty), #sv-users-form-wrap:not(:empty), #sv-form-wrap:not(:empty)")) return true;
      // File picker foi ativado nos últimos 60s (câmera/galeria)
      if(window._svFilePickerAt&&Date.now()-window._svFilePickerAt<60000) return true;
      return false;
    };

    // Marcar quando qualquer input file é clicado (câmera/galeria)
    document.addEventListener("click",e=>{
      if(e.target.type==="file"||e.target.closest("[id$='-camera'],[id$='-galeria'],[id$='-file']")){
        window._svFilePickerAt=Date.now();
      }
    },true);

    // 1. Ao voltar para o app — NÃO re-renderiza se form aberto
    let ultimoSync=Date.now();
    document.addEventListener("visibilitychange",async()=>{
      if(document.hidden) return;
      const agora=Date.now();
      if(agora-ultimoSync<30000) return; // menos de 30s fora → ignorar
      ultimoSync=agora;
      try{
        await Promise.allSettled(SYNC_RECURSOS.map(r=>loadResource(r)));
        if(!window._svFormAberto()) renderCurrent(); // só re-renderiza se sem form
      }catch{}
    });

    // 2. Polling a cada 90s — nunca re-renderiza com form aberto
    setInterval(async()=>{
      if(document.hidden||!DB.getToken()||window._svFormAberto()) return;
      ultimoSync=Date.now();
      const recursoAtual=getRoute(state.route)?.resource;
      const recursos=recursoAtual
        ?[recursoAtual,...SYNC_RECURSOS.filter(r=>r!==recursoAtual)]
        :SYNC_RECURSOS;
      try{
        await loadResource(recursos[0]);
        if(!window._svFormAberto()) renderCurrent();
        Promise.allSettled(recursos.slice(1).map(r=>loadResource(r)));
      }catch{}
    },90000);

    // 3. Sync manual pelo botão ⟳
    function mostrarIndicadorSync(){
      const hora=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
      const el=document.getElementById("sv-sync-indicator");
      if(el) el.textContent=`⟳ ${hora}`;
    }
    window._svSync=async()=>{
      if(window._svFormAberto()){toast("Feche o formulário antes de sincronizar.","warning",2500);return;}
      await Promise.allSettled(SYNC_RECURSOS.map(r=>loadResource(r)));
      mostrarIndicadorSync();
      renderCurrent();
      toast("✅ Dados atualizados.","success",2000);
    };
  }

  window.SuperVendaApp={state,navigate};
  init();
})();
