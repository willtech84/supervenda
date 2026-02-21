# Vendas Externas Pro (Cloudflare) — pacote completo

Este pacote tem:
- `frontend/` (PWA estático) — hospeda no Cloudflare Pages
- `worker/` (API + Login por vendedor + D1 + Backups no R2)

## Hospedar o FRONTEND (Cloudflare Pages)
1. Suba esta pasta no GitHub
2. Cloudflare Pages → Create a project → conecte o repositório
3. Build command: (vazio)
4. Output directory: `frontend`

Depois de publicar, abra o site e, no login, clique em **“Trocar URL da API”** e cole a URL do Worker.

## Hospedar a API (Worker)
Veja `worker/README.md`.
