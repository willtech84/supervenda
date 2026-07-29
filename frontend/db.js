(function () {
  const C = window.CONFIG || {};
  const ENDPOINTS = (C && C.ENDPOINTS) || {};
  const KEYS = (C && C.STORAGE_KEYS) || {
    TOKEN: "supervenda_token",
    USER: "supervenda_user",
    API_BASE: "supervenda_api_base",
  };

  // ── Fila offline (IndexedDB) ──────────────────────────────────────────────
  const _ODB = 'sv_offline', _OST = 'queue';
  let _idb = null;

  async function _openIDB() {
    if (_idb) return _idb;
    return new Promise((res, rej) => {
      const r = indexedDB.open(_ODB, 1);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(_OST))
          db.createObjectStore(_OST, { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = e => { _idb = e.target.result; res(_idb); };
      r.onerror = () => rej(r.error);
    });
  }

  async function _enqueue(op) {
    try {
      const db = await _openIDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(_OST, 'readwrite');
        const req = tx.objectStore(_OST).add({ ...op, ts: Date.now() });
        req.onsuccess = res;
        req.onerror = () => rej(req.error);
      });
      // Atualizar badge
      _updateBadge();
    } catch(e) { console.warn('offline enqueue:', e); }
  }

  async function _readQueue() {
    try {
      const db = await _openIDB();
      return await new Promise((res, rej) => {
        const tx = db.transaction(_OST, 'readonly');
        const req = tx.objectStore(_OST).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch { return []; }
  }

  async function _removeFromQueue(id) {
    try {
      const db = await _openIDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(_OST, 'readwrite');
        const req = tx.objectStore(_OST).delete(id);
        req.onsuccess = res;
        req.onerror = () => rej(req.error);
      });
    } catch {}
  }

  function _updateBadge() {
    _readQueue().then(fila => {
      const badge = document.getElementById('sv-offline-badge');
      if (!badge) return;
      if (fila.length > 0) {
        badge.style.display = 'inline-flex';
        badge.textContent = fila.length;
      } else {
        badge.style.display = 'none';
      }
    });
  }

  function _showOfflineBar(show) {
    const el = document.getElementById('sv-online-status');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  // ── Processar fila ao reconectar ─────────────────────────────────────────
  async function processQueue(silent = false) {
    const fila = await _readQueue();
    if (!fila.length) { _updateBadge(); return; }

    if (!silent && window.toast)
      window.toast(`📡 Sincronizando ${fila.length} operação${fila.length !== 1 ? 'ões' : ''}...`, 'info', 5000);

    let ok = 0, erros = 0;
    for (const op of fila) {
      try {
        const res = await fetch(op.url, {
          method: op.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`,
          },
          body: op.body || undefined,
        });
        if (res.ok || res.status < 500) {
          await _removeFromQueue(op.id);
          ok++;
        } else {
          erros++;
          break;
        }
      } catch {
        erros++; break; // ainda sem conexão
      }
    }

    _updateBadge();
    if (ok > 0) {
      if (window.toast)
        window.toast(`✅ ${ok} operação${ok !== 1 ? 'ões' : ''} sincronizada${ok !== 1 ? 's' : ''}!`, 'success', 4000);
      // Recarregar dados
      if (window._svReloadAll) window._svReloadAll();
    }
    if (erros > 0 && !silent && window.toast)
      window.toast(`⚠️ ${erros} item${erros !== 1 ? 'ns' : ''} ainda pendente${erros !== 1 ? 's' : ''}.`, 'warning', 3000);
  }

  // Monitorar conexão
  window.addEventListener('online', () => {
    _showOfflineBar(false);
    if (window.toast) window.toast('📶 Conexão restaurada!', 'success', 2500);
    setTimeout(() => processQueue(false), 1500);
  });
  window.addEventListener('offline', () => {
    _showOfflineBar(true);
    if (window.toast) window.toast('⚡ Sem internet — trabalhando offline.', 'warning', 4000);
  });

  // Inicializar estado
  document.addEventListener('DOMContentLoaded', () => {
    _showOfflineBar(!navigator.onLine);
    _updateBadge();
  });

  // ── Helpers de auth ──────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem(KEYS.TOKEN) || ''; }
  function setToken(t) { if (t) localStorage.setItem(KEYS.TOKEN, t); else localStorage.removeItem(KEYS.TOKEN); }
  function getUser() { try { return JSON.parse(localStorage.getItem(KEYS.USER) || 'null'); } catch { return null; } }
  function setUser(u) { if (u) localStorage.setItem(KEYS.USER, JSON.stringify(u)); else localStorage.removeItem(KEYS.USER); }
  function clearSession() { setToken(''); setUser(null); }

  function apiBase() {
    const b = (window.CONFIG && window.CONFIG.API_BASE) || localStorage.getItem(KEYS.API_BASE) || '';
    return String(b).replace(/\/+$/, '');
  }
  function joinUrl(base, path) {
    return `${String(base||'').replace(/\/+$/,'')}/${String(path||'').replace(/^\/+/,'')}`;
  }

  // ── Request com suporte offline ──────────────────────────────────────────
  async function request(path, opts = {}) {
    const url = joinUrl(apiBase(), path);
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const method = (opts.method || 'GET').toUpperCase();
    const isWrite = method !== 'GET';

    // Se offline e é escrita → enfileirar imediatamente
    if (!navigator.onLine && isWrite) {
      await _enqueue({ url, method, body: opts.body || null });
      const err = new Error('💾 Salvo offline — será sincronizado ao reconectar.');
      err.offline = true;
      throw err;
    }

    let res;
    try {
      res = await fetch(url, { ...opts, headers });
    } catch (e) {
      // Falha de rede durante escrita → enfileirar
      if (isWrite) {
        await _enqueue({ url, method, body: opts.body || null });
        const err = new Error('💾 Salvo offline — será sincronizado ao reconectar.');
        err.offline = true;
        throw err;
      }
      // Leitura sem rede → retornar null silenciosamente
      return null;
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let data = null;
    try {
      data = ct.includes('application/json') ? await res.json() : await res.text();
    } catch {}

    if (!res.ok) {
      const errMsg = (typeof data === 'object' && data?.error) ? String(data.error) :
                     (typeof data === 'string' && data) ? data : `Erro HTTP ${res.status}`;
      const err = new Error(errMsg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function requestAny(paths, opts = {}) {
    let lastErr = null;
    for (const p of paths) {
      try { return { data: await request(p, opts), path: p }; }
      catch (e) { lastErr = e; if (e?.status === 404) continue; throw e; }
    }
    throw lastErr || new Error('Rota não encontrada.');
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  async function login(email, senha) {
    const data = await request(ENDPOINTS.login || '/api/login', {
      method: 'POST', body: JSON.stringify({ email, senha }),
    });
    const token = data?.token || data?.access_token || data?.jwt || '';
    const user = data?.user || data?.vendor || null;
    if (!token) throw new Error('Login retornou sem token.');
    setToken(token);
    if (user) setUser(user);
    return data;
  }

  async function register(payload) {
    const data = await request(ENDPOINTS.register || '/api/register', {
      method: 'POST', body: JSON.stringify(payload || {}),
    });
    const token = data?.token || '';
    const user = data?.user || data?.vendor || null;
    if (token) { setToken(token); if (user) setUser(user); }
    return data;
  }

  async function me() {
    const data = await request(ENDPOINTS.me || '/api/me', { method: 'GET' });
    const user = data?.user || (data?.id ? data : null);
    if (user) setUser(user);
    return data;
  }

  async function bootstrap() {
    return await request(ENDPOINTS.bootstrap || '/api/bootstrap', { method: 'GET' });
  }

  async function health() {
    return await request(ENDPOINTS.health || '/api/health', { method: 'GET' });
  }

  // ── Users ────────────────────────────────────────────────────────────────
  async function listUsers() {
    const data = await request(ENDPOINTS.users || '/api/users', { method: 'GET' });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.users)) return data.users;
    return [];
  }
  async function createUser(p) {
    return await request(ENDPOINTS.users || '/api/users', { method: 'POST', body: JSON.stringify(p || {}) });
  }
  async function updateUser(id, p) {
    return await request(`${ENDPOINTS.users || '/api/users'}/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(p || {}),
    });
  }

  // ── Backup ───────────────────────────────────────────────────────────────
  async function backup(salvarR2 = true) {
    try {
      const qs = salvarR2 ? '' : '?salvar_r2=0';
      const data = await request((ENDPOINTS.backup || '/api/backup') + qs, { method: 'GET' });
      return { mode: 'remote', data };
    } catch (err) { if (err?.status && err.status !== 404) throw err; }
    const payload = { exportedAt: new Date().toISOString(), apiBase: apiBase(), user: getUser(), data: {} };
    const resources = ['clientes','mercadorias','pedidos','rotas','despesas','lembretes'];
    for (const r of resources) {
      try { payload.data[r] = await list(r); }
      catch (e) { payload.data[r] = { _error: e.message || 'Falha' }; }
    }
    return { mode: 'local', data: payload };
  }

  // ── CRUD genérico ────────────────────────────────────────────────────────
  const resourcePaths = {
    clientes:     [ENDPOINTS.clientes    || '/api/clientes'],
    mercadorias:  [ENDPOINTS.mercadorias || '/api/mercadorias', ENDPOINTS.produtos || '/api/produtos'],
    produtos:     [ENDPOINTS.produtos    || '/api/produtos'],
    pedidos:      [ENDPOINTS.pedidos     || '/api/pedidos'],
    rotas:        [ENDPOINTS.rotas       || '/api/rotas'],
    despesas:     [ENDPOINTS.despesas    || '/api/despesas'],
    lembretes:    [ENDPOINTS.lembretes   || '/api/lembretes'],
    notas:        [ENDPOINTS.notas       || '/api/notas'],
  };

  function getResourcePaths(resource) {
    const paths = resourcePaths[resource];
    if (!paths) throw new Error(`Recurso inválido: ${resource}`);
    return paths.filter(Boolean);
  }

  async function list(resource) {
    const { data } = await requestAny(getResourcePaths(resource), { method: 'GET' });
    // data===null significa falha de rede/timeout silenciosa (ver request()).
    // Isso NÃO é "lista vazia" — lançar erro pra quem chamou manter o cache antigo
    // em vez de sobrescrever com [] e o usuário ver os itens sumirem.
    if (data === null) {
      const err = new Error('Falha de rede ao carregar dados.');
      err.network = true;
      throw err;
    }
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  }
  async function create(resource, payload) {
    const { data } = await requestAny(getResourcePaths(resource), {
      method: 'POST', body: JSON.stringify(payload || {}),
    });
    return data;
  }
  async function update(resource, id, payload) {
    const paths = getResourcePaths(resource).map(p => `${p}/${encodeURIComponent(id)}`);
    const { data } = await requestAny(paths, { method: 'PUT', body: JSON.stringify(payload || {}) });
    return data;
  }
  async function remove(resource, id) {
    const paths = getResourcePaths(resource).map(p => `${p}/${encodeURIComponent(id)}`);
    const { data } = await requestAny(paths, { method: 'DELETE' });
    return data;
  }

  window.DB = {
    getToken, setToken, getUser, setUser, clearSession,
    request, health, login, register, me, bootstrap,
    listUsers, createUser, updateUser,
    list, create, update, remove, backup,
    processQueue, // expor para uso externo
  };
})();
