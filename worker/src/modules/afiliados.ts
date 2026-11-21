interface AfiliadosEnv {
  DB: D1Database;
}

type ProdutoInput = {
  nome?: unknown;
  marca?: unknown;
  categoria?: unknown;
  descricao?: unknown;
  produto_url?: unknown;
  affiliate_url?: unknown;
  imagem_url?: unknown;
  preco_atual?: unknown;
  percentual_comissao?: unknown;
  avaliacao?: unknown;
  quantidade_avaliacoes?: unknown;
  status?: unknown;
  observacoes?: unknown;
};

type Produto = {
  id: string;
  vendor_id: string;
  nome: string;
  marca: string;
  categoria: string;
  descricao: string;
  produto_url: string;
  affiliate_url: string;
  imagem_url: string;
  preco_atual: number;
  percentual_comissao: number;
  comissao_estimada: number;
  avaliacao: number;
  quantidade_avaliacoes: number;
  status: "ativo" | "pausado" | "arquivado";
  observacoes: string;
  created_at: string;
  updated_at: string;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization",
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 400): Response {
  return response({ error: message }, status);
}

function text(value: unknown, max = 2000): string {
  return String(value ?? "").trim().slice(0, max);
}

function numberValue(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validHttpUrl(value: string, required = false): boolean {
  if (!value) return !required;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalize(input: ProdutoInput, current?: Produto): Omit<Produto, "id" | "vendor_id" | "created_at" | "updated_at"> | null {
  const nome = text(input.nome ?? current?.nome, 180);
  const categoria = text(input.categoria ?? current?.categoria, 100);
  const produto_url = text(input.produto_url ?? current?.produto_url, 1000);
  const marca = text(input.marca ?? current?.marca, 120);
  const descricao = text(input.descricao ?? current?.descricao, 4000);
  const affiliate_url = text(input.affiliate_url ?? current?.affiliate_url, 1500);
  const imagem_url = text(input.imagem_url ?? current?.imagem_url, 1500);
  const observacoes = text(input.observacoes ?? current?.observacoes, 2000);
  const preco_atual = numberValue(input.preco_atual, current?.preco_atual ?? 0);
  const percentual_comissao = numberValue(input.percentual_comissao, current?.percentual_comissao ?? 0);
  const avaliacao = numberValue(input.avaliacao, current?.avaliacao ?? 0);
  const quantidade_avaliacoes = numberValue(input.quantidade_avaliacoes, current?.quantidade_avaliacoes ?? 0);
  const status = text(input.status ?? current?.status ?? "ativo", 20) as Produto["status"];

  if (!nome || !categoria || !produto_url) return null;
  if (!validHttpUrl(produto_url, true) || !validHttpUrl(affiliate_url) || !validHttpUrl(imagem_url)) return null;
  if (![preco_atual, percentual_comissao, avaliacao, quantidade_avaliacoes].every(Number.isFinite)) return null;
  if (preco_atual < 0 || percentual_comissao < 0 || percentual_comissao > 100) return null;
  if (avaliacao < 0 || avaliacao > 5 || quantidade_avaliacoes < 0 || !Number.isInteger(quantidade_avaliacoes)) return null;
  if (!["ativo", "pausado", "arquivado"].includes(status)) return null;

  return {
    nome, marca, categoria, descricao, produto_url, affiliate_url, imagem_url,
    preco_atual, percentual_comissao,
    comissao_estimada: Number((preco_atual * percentual_comissao / 100).toFixed(2)),
    avaliacao, quantidade_avaliacoes, status, observacoes,
  };
}

/**
 * Rotas:
 * GET    /api/afiliados/produtos
 * POST   /api/afiliados/produtos
 * PUT    /api/afiliados/produtos/:id
 * DELETE /api/afiliados/produtos/:id
 *
 * vendorId deve vir exclusivamente do JWT validado pelo Worker principal.
 */
export async function handleAfiliados(
  req: Request,
  env: AfiliadosEnv,
  path: string[],
  vendorId: string,
): Promise<Response | null> {
  if (path[1] !== "afiliados") return null;
  if (path[2] !== "produtos") return error("Rota de afiliados não encontrada.", 404);

  if (!vendorId) return error("Usuário não identificado.", 401);

  try {
    if (req.method === "GET" && path.length === 3) {
      const url = new URL(req.url);
      const q = text(url.searchParams.get("q"), 180);
      const categoria = text(url.searchParams.get("categoria"), 100);
      const status = text(url.searchParams.get("status"), 20);
      const clauses = ["vendor_id = ?"];
      const values: (string | number)[] = [vendorId];

      if (q) {
        clauses.push("(nome LIKE ? OR marca LIKE ? OR descricao LIKE ?)");
        const like = `%${q}%`;
        values.push(like, like, like);
      }
      if (categoria) {
        clauses.push("categoria = ?");
        values.push(categoria);
      }
      if (status && ["ativo", "pausado", "arquivado"].includes(status)) {
        clauses.push("status = ?");
        values.push(status);
      }

      const result = await env.DB.prepare(
        `SELECT * FROM afiliados_produtos WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`,
      ).bind(...values).all<Produto>();

      return response(result.results ?? []);
    }

    if (req.method === "POST" && path.length === 3) {
      const body = (await req.json().catch(() => ({}))) as ProdutoInput;
      const produto = normalize(body);
      if (!produto) {
        return error("Dados inválidos. Informe nome, categoria, URL válida e valores dentro dos limites.");
      }

      const id = `AFP-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO afiliados_produtos (
          id, vendor_id, nome, marca, categoria, descricao, produto_url,
          affiliate_url, imagem_url, preco_atual, percentual_comissao,
          comissao_estimada, avaliacao, quantidade_avaliacoes, status,
          observacoes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, vendorId, produto.nome, produto.marca, produto.categoria,
        produto.descricao, produto.produto_url, produto.affiliate_url,
        produto.imagem_url, produto.preco_atual, produto.percentual_comissao,
        produto.comissao_estimada, produto.avaliacao,
        produto.quantidade_avaliacoes, produto.status, produto.observacoes,
        now, now,
      ).run();

      const created = await env.DB.prepare(
        "SELECT * FROM afiliados_produtos WHERE id = ? AND vendor_id = ?",
      ).bind(id, vendorId).first<Produto>();

      return response(created, 201);
    }

    if ((req.method === "PUT" || req.method === "DELETE") && path.length === 4) {
      const id = text(path[3], 100);
      const current = await env.DB.prepare(
        "SELECT * FROM afiliados_produtos WHERE id = ? AND vendor_id = ?",
      ).bind(id, vendorId).first<Produto>();

      if (!current) return error("Produto não encontrado.", 404);

      if (req.method === "DELETE") {
        await env.DB.prepare(
          "DELETE FROM afiliados_produtos WHERE id = ? AND vendor_id = ?",
        ).bind(id, vendorId).run();
        return response({ ok: true, id });
      }

      const body = (await req.json().catch(() => ({}))) as ProdutoInput;
      const produto = normalize(body, current);
      if (!produto) return error("Dados inválidos. Revise os campos e os valores informados.");

      const now = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE afiliados_produtos SET
          nome = ?, marca = ?, categoria = ?, descricao = ?, produto_url = ?,
          affiliate_url = ?, imagem_url = ?, preco_atual = ?,
          percentual_comissao = ?, comissao_estimada = ?, avaliacao = ?,
          quantidade_avaliacoes = ?, status = ?, observacoes = ?, updated_at = ?
         WHERE id = ? AND vendor_id = ?`,
      ).bind(
        produto.nome, produto.marca, produto.categoria, produto.descricao,
        produto.produto_url, produto.affiliate_url, produto.imagem_url,
        produto.preco_atual, produto.percentual_comissao,
        produto.comissao_estimada, produto.avaliacao,
        produto.quantidade_avaliacoes, produto.status, produto.observacoes,
        now, id, vendorId,
      ).run();

      const updated = await env.DB.prepare(
        "SELECT * FROM afiliados_produtos WHERE id = ? AND vendor_id = ?",
      ).bind(id, vendorId).first<Produto>();

      return response(updated);
    }

    return error("Método ou rota não suportado.", 405);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/unique constraint/i.test(message)) return error("Este produto já está cadastrado com esta URL.", 409);
    console.error("Erro no módulo de afiliados:", message);
    return error("Não foi possível processar a operação de afiliados.", 500);
  }
}
