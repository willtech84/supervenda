export const CONFIG = {
  // Troque para a URL do seu Worker em produção:
  // ex.: https://vendas-externas-api.seuusuario.workers.dev
  API_BASE: localStorage.getItem("API_BASE") || "http://localhost:8787",
};
