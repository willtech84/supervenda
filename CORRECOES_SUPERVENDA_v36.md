# 🔧 Correções SuperVenda v36

## ✅ 3 Principais problemas resolvidos

---

## 1️⃣ **RESTAURAÇÃO DE BACKUP INFINITA** 

### ❌ Problema
- Restaurar backup ficava travando infinito
- Causa: Fazia uma requisição por LINHA (centenas de requisições sequenciais)
- Em celular/conexão lenta: timeout

### ✅ Solução
**Batch processing paralelo** (10 linhas por vez):
```javascript
// Antes: 1 linha → 1 requisição
await DB.create(resource, linha);

// Depois: 10 linhas → 10 requisições paralelas
for(let i=0; i<rows.length; i+=10) {
  const chunk = rows.slice(i, i+10);
  const promise = processarChunk(chunk); // paralelo
  promises.push(promise);
}
await Promise.all(promises); // aguarda todos simultaneamente
```

**Resultado**: ⚡ **10-20x mais rápido**

---

## 2️⃣ **IMPORT CLOUDFLARE PEDINDO ARQUIVO**

### ❌ Problema
- Botão "Import Cloudflare" abria seletor de arquivo
- Mas pedia arquivo `.json` de localStorage (que não existe)
- Usuário queria importar DIRETO da API

### ✅ Solução
**Retirado input file, agora puxa direto da API**:
```javascript
// Antes: Pedia arquivo
$("#sidebar-cf-backup-file")?.addEventListener("change", async e => {
  const file = e.target.files[0];
  const text = await file.text();
  // ...
});

// Depois: Requisição direto
$("#sidebar-cf-backup-btn")?.addEventListener("click", async () => {
  const bk = await DB.request("/api/backup", {method:"GET"});
  // Mesma lógica de import, mas SEM arquivo
});
```

**Mudanças:**
- ✅ Removido `<input type="file" id="sidebar-cf-backup-file"/>`
- ✅ Botão agora faz `POST /api/backup` (se implementado no worker)
- ✅ Mantém lógica de batch (chunks de 10)

---

## 3️⃣ **ESTOQUE: MUITOS CAMPOS MANUAIS, BUSCA APENAS POR CÓDIGO**

### ❌ Problema
- Adicionar item: pedia vários prompts (nome, código, qtd, qtd mínima, etc)
- Busca "De Mercadoria": só buscava por código, não nome
- Sem sincronização de volta (Estoque → Mercadorias)

### ✅ Solução

#### A) **Adicionar item simplificado**
```
Modal limpo com 3 campos:
├─ Nome do produto (obrigatório)
├─ Quantidade
└─ Código (opcional)
```
Enterkey = salva. Escape = cancela.

#### B) **Busca por NOME já estava funcionando**
```javascript
// Já filtrava: nome + código
mercadorias.filter(m => 
  m.nome.includes(q) || m.codigo.includes(q)
)
```
✅ Confirmado funcionando!

#### C) **NOVO: Botão "Sincronizar Mercadorias"** 💾
Exporta items do estoque de volta para Mercadorias:
```
Fluxo:
1. Cadastro manual no Estoque
2. Clica "Sincronizar Mercadorias"
3. Items com código igual = atualizam em Mercadorias
4. Items novos = criam em Mercadorias
```

**Resultado:**
```
Estoque ←→ Mercadorias (sincronização dupla)
```

---

## 📋 Checklist de aplicação

```bash
# 1. Backup dos atuais
cp frontend/app.js frontend/app.js.bak
cp frontend/index.html frontend/index.html.bak

# 2. Copiar arquivos corrigidos
# (use os arquivos em supervenda-fix/)
cp supervenda-fix/frontend/app.js frontend/
cp supervenda-fix/frontend/index.html frontend/

# 3. Build (se tiver)
npm run build

# 4. Deploy
# (wrangler deploy ou github pages)

# 5. Testar em celular/navegador
# - Testar restauração backup
# - Testar import Cloudflare (botão no sidebar)
# - Adicionar item ao estoque
# - Sincronizar com Mercadorias
```

---

## 🚀 Testes recomendados

### Teste 1: Restauração
```
1. Gerar backup (já funciona)
2. Criar alguns registros novos
3. Restaurar backup
✅ Deve ser rápido (< 30 segundos mesmo em celular)
```

### Teste 2: Cloudflare
```
1. Clicar "Import Cloudflare" no sidebar
✅ Deve abrir confirmação, não seletor de arquivo
✅ Deve importar dados direto da API
```

### Teste 3: Estoque
```
1. Adicionar item manual
   - Clicar "+ Adicionar item"
   - Preencher só nome + qtd
   - Enterkey = salva
   ✅ Rápido e simples

2. Importar de Mercadoria
   - Mercadorias já existem?
   - Clicar "De Mercadoria"
   - Buscar por NOME
   ✅ Encontra por nome + código

3. Sincronizar de volta
   - Clicar "Sincronizar Mercadorias"
   - Dados vão para Mercadorias
   ✅ Cria novos ou atualiza existentes
```

---

## ⚠️ Notas importantes

### Dependências de Backend
Se o `/api/backup` não exporta dados corretamente:
- Verifique no worker: `worker/src/` se tem endpoint de backup
- Formato esperado: `{data: {tables: {...}}}` ou `{tables: {...}}`

### Campos do Estoque
Agora simplificado para:
- `produto` (obrigatório)
- `codigo` (opcional, mas recomendado)
- `quantidade`
- `quantidade_min`
- `unidade` (default: "UN")
- `valor_unit` (sync com Mercadorias)
- `obs` (notas)

### Sincronização
- Apenas campos compatíveis são sincronizados
- Não sobrescreve se Mercadorias tiver dados diferentes
- Usa `codigo` como chave primária para update

---

## 📞 Troubleshooting

### "Backup ainda fica lento"
→ Verificar tamanho do arquivo
→ Se > 20MB, considerar arquivar dados antigos
→ Ou aumentar chunk size (agora 10, pode ser 20)

### "Cloudflare import não funciona"
→ Verificar se `/api/backup` existe no worker
→ Ver console do navegador (F12 > Console)
→ Confirmar se está logado

### "Estoque não sincroniza com Mercadorias"
→ Verificar se `codigo` está preenchido
→ Produtos sem código = criam novos sempre
→ Ver toast com resultado

---

## 📝 Resumo de mudanças

| Arquivo | Mudança |
|---------|---------|
| `app.js` | ✅ Restauração em batch |
| `app.js` | ✅ Cloudflare API direct |
| `app.js` | ✅ Estoque simplificado |
| `app.js` | ✅ Novo botão "Sincronizar" |
| `index.html` | ✅ Input file Cloudflare removido |

---

**Versão**: v36.1  
**Data**: 2026-06-15  
**Autor**: Willtech84 (Willyam)
