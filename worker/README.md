# Backend (Cloudflare Workers + D1 + R2) — Login por vendedor

## 1) Pré-requisitos
- Node.js (LTS)
- Conta Cloudflare
- Wrangler instalado via npm (já vem no package.json)

## 2) Criar D1 e importar o schema
Dentro da pasta `worker/`:

```bash
npm install
npx wrangler d1 create vendas_pro
```

Copie o `database_id` retornado e cole no `wrangler.toml` em `database_id`.

Depois, aplique o schema:
```bash
npx wrangler d1 execute vendas_pro --file=./schema.sql
```

## 3) Criar o bucket R2 (backups)
```bash
npx wrangler r2 bucket create vendas-pro-backups
```

## 4) Definir o segredo do token
```bash
npx wrangler secret put JWT_SECRET
```

## 5) Criar o primeiro vendedor (admin via SQL)
No D1, rode:

```bash
# Gere um SALT e HASH (sha256Hex = SHA256(salt + senha)) usando o node:
node -e "const crypto=require('crypto'); const salt=crypto.randomBytes(16).toString('hex'); const pass='SUA_SENHA'; const hash=crypto.createHash('sha256').update(salt+pass).digest('hex'); console.log({salt,hash});"
```

Depois insira no banco (troque os valores):
```bash
npx wrangler d1 execute vendas_pro --command="INSERT INTO vendors (id,email,name,password_salt,password_hash,created_at) VALUES ('VD-000001','vendedor@exemplo.com','Vendedor 1','SEU_SALT','SEU_HASH',datetime('now'));"
```

## 6) Rodar localmente
```bash
npx wrangler dev
```

API local: `http://localhost:8787`

## 7) Deploy
```bash
npx wrangler deploy
```

A URL do Worker será algo como:
`https://vendas-externas-api.seuusuario.workers.dev`
