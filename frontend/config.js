// config.js - Configuração do SuperVenda
// Altere API_BASE para a URL do seu Cloudflare Worker
// config.js
window.CONFIG = {
  API_BASE: "vendas-externas-api.krasinskyekuroli.workers.dev",
  STORAGE_KEYS: {
    TOKEN: "supervenda_token",
    USER: "supervenda_user",
    API_BASE: "supervenda_api_base"
  },
  ENDPOINTS: {
    health: "/api/health",
    login: "/api/login",
    register: "/api/register",
    users: "/api/users",
    me: "/api/me",
    bootstrap: "/api/bootstrap",
    backup: "/api/backup",

    clientes: "/api/clientes",
    mercadorias: "/api/mercadorias",
    produtos: "/api/produtos",
    pedidos: "/api/pedidos",
    rotas: "/api/rotas",
    despesas: "/api/despesas",
    lembretes: "/api/lembretes",
    notas: "/api/notas"
  }
};
