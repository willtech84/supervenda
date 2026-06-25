export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

async function auth(req: Request, env: Env) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token) return null;
  
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env) {
    if (req.method === "OPTIONS") {
      return new Response("OK", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "content-type,authorization",
        },
      });
    }

    const path = new URL(req.url).pathname;

    if (path === "/api/sync" && req.method === "POST") {
      const claim = await auth(req, env);
      if (!claim) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      let payload = {};
      try {
        payload = await req.json();
      } catch {}

      return new Response(
        JSON.stringify({
          status: "success",
          device_id: (payload as any).device_id || "unknown",
          timestamp: Date.now(),
          operacoes_processadas: ((payload as any).operacoes || []).length,
          dados: {
            clientes: [],
            pedidos: [],
            vendas: [],
            visitas: [],
            estoque_itens: [],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
};
