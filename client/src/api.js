// Cliente da API PluggedNinja ThreatScope. Usa proxy do Vite (/api -> :4000).
// Autenticação por TOKEN DE CONTA (multi-tenant): o token vai no header
// Authorization e, em downloads/WS, como ?token=. O admin pode escolher um
// tenant (?tenant=) para ver os sensores de outra conta.

// Prefixo do app para deploy sob subpath no nginx (ex.: /threatscope). Vem do base
// do Vite no build (import.meta.env.BASE_URL). Em '/' vira '' (sem prefixo) — dev igual.
const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

const TOKEN_KEY = 'ts-account-token';
const TENANT_KEY = 'ts-admin-tenant';

export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }
export function clearToken() { setToken(''); setTenant(''); }
export function getTenant() { try { return localStorage.getItem(TENANT_KEY) || ''; } catch { return ''; } }
export function setTenant(id) { try { id ? localStorage.setItem(TENANT_KEY, id) : localStorage.removeItem(TENANT_KEY); } catch {} }

function authHeaders(extra = {}) {
  const t = getToken();
  return t ? { Authorization: 'Bearer ' + t, ...extra } : { ...extra };
}
// Anexa ?tenant= (seleção do admin) a uma URL já com/sem query.
function withTenant(url) {
  const t = getTenant();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'tenant=' + encodeURIComponent(t);
}
// URL para download via navegador (window.open) — token e tenant vão na query,
// pois window.open/anchor não enviam headers.
function dl(url) {
  const t = getToken();
  let u = base + withTenant(url);
  if (t) u += (u.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
  return u;
}

async function j(url, opts = {}) {
  const merged = { ...opts, headers: authHeaders(opts.headers || {}) };
  const r = await fetch(base + withTenant(url), merged);
  if (r.status === 401) { const e = new Error('não autenticado'); e.code = 401; throw e; }
  if (r.status === 403) { const e = new Error('sem permissão'); e.code = 403; throw e; }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const jj = await r.json(); if (jj && jj.error) msg = jj.error; } catch {}
    const e = new Error(msg); e.code = r.status; throw e;
  }
  return r.json();
}

function qs(params = {}) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === '') return;
    u.set(k, Array.isArray(v) ? v.join(',') : v);
  });
  const s = u.toString();
  return s ? `?${s}` : '';
}

// Download autenticado: baixa via fetch (com header) e salva o blob — mantém o
// token fora da URL. Usado quando quisermos evitar ?token=.
export async function authedDownload(url, filename) {
  const r = await fetch(base + withTenant(url), { headers: authHeaders() });
  if (!r.ok) throw new Error(`${r.status}`);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const api = {
  health: () => j('/api/health'),
  attempts: (f) => j('/api/attempts' + qs(f)),
  grouped: (f) => j('/api/grouped' + qs(f)),
  agents: () => j('/api/agents'),
  addAgent: (body) => j('/api/agents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  removeAgent: (id) => j('/api/agents/' + encodeURIComponent(id), { method: 'DELETE' }),
  agentConfig: (id) => j('/api/agents/' + encodeURIComponent(id) + '/config'),
  setAgentConfig: (id, body) => j('/api/agents/' + encodeURIComponent(id) + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  agentLogs: (id) => j('/api/agents/' + encodeURIComponent(id) + '/logs'),
  setAgentLocation: (id, body) => j('/api/agents/' + encodeURIComponent(id) + '/location', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  updateAgent: (id) => j('/api/agents/' + encodeURIComponent(id) + '/update', { method: 'POST' }),
  managerInfo: () => j('/api/manager-info'),
  geoCache: () => j('/api/geo-cache'),
  setGeoTtl: (days) => j('/api/geo-cache/ttl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) }),
  clearGeoCache: (mode) => j('/api/geo-cache' + (mode ? `?${mode}=1` : ''), { method: 'DELETE' }),
  ip: (ip) => j('/api/ip/' + encodeURIComponent(ip)),
  stats: (f) => j('/api/stats' + qs(f)),
  countries: (f) => j('/api/countries' + qs({ ...f, limit: 250 })),
  geo: (f) => j('/api/geo' + qs({ ...f, limit: 150 })),
  rdns: (ip) => j('/api/rdns/' + encodeURIComponent(ip)),
  whois: (ip) => j('/api/whois/' + encodeURIComponent(ip)),
  reputation: (ip) => j('/api/reputation/' + encodeURIComponent(ip)),
  reportAbuseIpdb: (body) => j('/api/report/abuseipdb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  blockIp: (ip, tags, ports) => j('/api/block', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, tags, ports: ports || null }) }),
  unblockIp: (ip, tags, ports) => j('/api/unblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, tags, ports: ports || null }) }),
  blockedList: () => j('/api/blocked'),
  getAutoblock: () => j('/api/autoblock'),
  setAutoblock: (body) => j('/api/autoblock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  resetAutoblockSession: () => j('/api/autoblock/reset', { method: 'POST' }),
  managerConfig: () => j('/api/config'),
  setManagerConfig: (body) => j('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  clear: () => j('/api/attempts', { method: 'DELETE' }),
  exportUrl: (format, f) => dl('/api/export' + qs({ ...f, format })),
  agentBundleUrl: (mode) => dl('/api/agent-bundle' + qs({ mode })),

  // ---- tráfego web (honeypot de logs) ----
  webStats: (f) => j('/api/web/stats' + qs(f)),
  webGrouped: (f) => j('/api/web/grouped' + qs(f)),
  webAttempts: (f) => j('/api/web/attempts' + qs(f)),
  webEvents: (f) => j('/api/web/events' + qs(f)),
  webIp: (ip) => j('/api/web/ip/' + encodeURIComponent(ip)),
  webGeo: (f) => j('/api/web/geo' + qs({ ...f, limit: 200 })),
  webExportUrl: (format, f) => dl('/api/web/export' + qs({ ...f, format })),

  // ---- sensor de rede (tcpdump) ----
  netStats: (f) => j('/api/net/stats' + qs(f)),
  netGrouped: (f) => j('/api/net/grouped' + qs(f)),
  netAttempts: (f) => j('/api/net/attempts' + qs(f)),
  netEvents: (f) => j('/api/net/events' + qs(f)),
  netGeo: (f) => j('/api/net/geo' + qs({ ...f, limit: 120 })),
  netIp: (ip) => j('/api/net/ip/' + encodeURIComponent(ip)),
  netExportUrl: (format, f) => dl('/api/net/export' + qs({ ...f, format })),

  // ---- conta / multi-tenant ----
  me: () => j('/api/me'),
  publicInfo: () => j('/api/public-info'),
  register: (name, email) => j('/api/public/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) }),
  requestRemoval: (ip, email, message) => j('/api/public/removal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, email, message }) }),

  // ---- admin ----
  adminUsers: () => j('/api/admin/users'),
  adminTenants: () => j('/api/admin/tenants'),
  approveUser: (id) => j('/api/admin/users/' + encodeURIComponent(id) + '/approve', { method: 'POST' }),
  disableUser: (id, disabled) => j('/api/admin/users/' + encodeURIComponent(id) + '/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled }) }),
  regenUserToken: (id) => j('/api/admin/users/' + encodeURIComponent(id) + '/regen-token', { method: 'POST' }),
  deleteUser: (id) => j('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }),
  setAgentOwner: (id, owner) => j('/api/admin/agents/' + encodeURIComponent(id) + '/owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner }) }),
  adminRemovals: (status) => j('/api/admin/removals' + (status ? qs({ status }) : '')),
  resolveRemoval: (id, status, purge) => j('/api/admin/removals/' + encodeURIComponent(id) + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, purge }) }),
};

// WebSocket de tempo real com reconexão automática (token vai na query p/ escopo).
export function connectWs(onMessage, onStatus) {
  let ws, alive = true, retry = 0;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const tok = getToken();
  const url = `${proto}://${location.host}${base}/ws${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 0; onStatus?.(true); };
    ws.onclose = () => { onStatus?.(false); if (alive) setTimeout(open, Math.min(1000 * ++retry, 6000)); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
  }
  open();
  return () => { alive = false; try { ws.close(); } catch {} };
}
