# SuperVenda — Correções e Deploy

## O que foi corrigido

### Backend (`src/index.ts`) — Problemas críticos resolvidos:
1. **Faltavam todas as rotas GET** — o worker não tinha `GET /api/clientes`, `GET /api/produtos` etc. Agora todas existem.
2. **Faltavam todas as rotas PUT** — editar registros retornava 404. Corrigido.
3. **Faltavam endpoints de usuários** (`GET /api/users`, `POST /api/users`, `PUT /api/users/:id`) — impossível criar/gerenciar usuários.
4. **O login retornava `vendor` mas o frontend esperava `user`** — agora retorna ambos.
5. **Token não carregava o campo `role`** — usuário nunca era reconhecido como admin.
6. **Endpoint `/api/register`** agora funciona para criar o primeiro admin.

### Frontend — Problemas resolvidos:
1. **`db.js`** — `login()` agora salva o `user` corretamente (antes salvava `vendor` sem mapear).
2. **`app.js`** — Reescrito: inicialização correta, nav funcional, formulários funcionando.
3. **`index.html`** — Tela de cadastro (primeiro acesso) adicionada.
4. **`sw.js`** — Service Worker corrigido para **nunca** cachear chamadas de API e limpar caches antigos.

### Schema (`schema.sql`) — Atualizado:
- Coluna `role` adicionada à tabela `vendors`
- Coluna `active` adicionada à tabela `vendors`

---

## Deploy — Passo a passo

### 1. Atualizar o banco D1 (adicionar colunas novas)

Se o banco já existia, rode estes comandos para adicionar as colunas:

```bash
npx wrangler d1 execute vendas_pro --command="ALTER TABLE vendors ADD COLUMN role TEXT NOT NULL DEFAULT 'seller';"
npx wrangler d1 execute vendas_pro --command="ALTER TABLE vendors ADD COLUMN active INTEGER NOT NULL DEFAULT 1;"
```

Se o banco é novo, aplique o schema completo:
```bash
npx wrangler d1 execute vendas_pro --file=./schema.sql
```

### 2. Deploy do Worker

```bash
cd worker/   # ou onde está o src/index.ts
npm install
npx wrangler deploy
```

### 3. Deploy do Frontend (Cloudflare Pages)

Faça upload dos arquivos da pasta `frontend/`:
- `index.html`
- `config.js`
- `db.js`
- `app.js`
- `sw.js`

Via dashboard do Cloudflare Pages ou via CLI:
```bash
npx wrangler pages deploy ./frontend --project-name supervenda
```

### 4. Primeiro acesso

1. Acesse o site
2. Clique em **"Criar conta admin"**
3. Preencha nome, e-mail e senha
4. Entre normalmente

> Após o primeiro admin criado, novos usuários só podem ser criados pelo admin no menu **Usuários**.

### 5. Forçar atualização do Service Worker no navegador

Se o site ainda mostrar a versão antiga:
- Abra DevTools (F12) → Application → Service Workers → clique "Unregister"
- Recarregue a página com `Ctrl+Shift+R`

---

## Estrutura dos arquivos

```
├── src/
│   └── index.ts          ← Worker (backend) corrigido
├── schema.sql            ← Schema D1 atualizado
├── frontend/
│   ├── index.html        ← HTML com tela de login + cadastro
│   ├── config.js         ← URL da API
│   ├── db.js             ← Camada de acesso à API
│   ├── app.js            ← Lógica do app (reescrito)
│   └── sw.js             ← Service Worker corrigido
└── README.md
```

---

## Configurar JWT_SECRET (se ainda não fez)

```bash
npx wrangler secret put JWT_SECRET
# digite uma chave aleatória longa e segura
```
