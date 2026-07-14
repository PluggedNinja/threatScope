// Camada de persistência em JavaScript puro (sem dependências nativas).
// Guarda as tentativas em memória e persiste num arquivo JSON, com escrita
// atômica, backup automático e auto-recuperação de bases em locais antigos.
// Mantém a mesma API que o restante do servidor consome.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

let store = { attempts: [], nextId: 1, registry: [], users: [], removalRequests: [] };
let filePath = null;
let saveTimer = null;
// Diagnóstico de inicialização (exposto por initStatus() para o log da central).
let initInfo = { filePath: null, loaded: 0, recoveredFrom: null, restoredFromBackup: false };

// Status de execução dos agentes registrados (em memória): id -> { online, lastSeen, cursor, error, selfId }
const agentRuntime = new Map();

function dataFile(dbPath) {
  // Usa o caminho informado, mas como arquivo JSON (sem módulo nativo).
  if (dbPath.endsWith('.json')) return dbPath;
  return dbPath.replace(/\.(db|sqlite|sqlite3)$/i, '') + '.json';
}

// Lê e valida um arquivo de base. Retorna store normalizado ou null.
function readStoreFrom(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || !Array.isArray(raw.attempts)) return null;
    const attempts = raw.attempts;
    const nextId = raw.nextId || (attempts.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1);
    const registry = Array.isArray(raw.registry) ? raw.registry : [];
    const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const users = Array.isArray(raw.users) ? raw.users : [];
    const removalRequests = Array.isArray(raw.removalRequests) ? raw.removalRequests : [];
    return { attempts, nextId, registry, settings, users, removalRequests };
  } catch {
    return null; // corrompido ou formato antigo (ex: SQLite binário)
  }
}

// Locais alternativos onde uma base pode ter ficado em versões/execuções anteriores.
// Usados só quando a base canônica está vazia — evita "perder tudo" por caminho trocado.
function recoveryCandidates(canonical) {
  const cwd = process.cwd();
  const list = [
    canonical + '.bak',
    path.join(cwd, 'data', 'sshoney.json'),
    path.join(cwd, 'sshoney.json'),
    path.join(cwd, 'server', 'data', 'sshoney.json'),
    path.join(cwd, '..', 'server', 'data', 'sshoney.json'),
    path.join(os.homedir(), '.sshoney', 'sshoney.json'),
  ];
  // remove duplicados e o próprio arquivo canônico
  const seen = new Set([path.resolve(canonical)]);
  return list.filter((p) => {
    const r = path.resolve(p);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

export function initDb(dbPath) {
  filePath = dataFile(dbPath);
  initInfo = { filePath, loaded: 0, recoveredFrom: null, restoredFromBackup: false };
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 1) tenta a base canônica; se corromper, cai para o backup .bak
  let loaded = readStoreFrom(filePath);
  let healFromBackup = false;
  if (!loaded) {
    const bak = readStoreFrom(filePath + '.bak');
    if (bak) { loaded = bak; initInfo.restoredFromBackup = true; healFromBackup = true; }
  }
  if (loaded) store = loaded;
  // se restaurou do backup, regrava o arquivo canônico para curá-lo do estado corrompido
  if (healFromBackup) writeStoreSync();

  // 2) auto-recuperação: base canônica vazia/ausente -> procura em locais alternativos
  //    e importa a mais rica encontrada, migrando-a para o local canônico.
  if (!store.attempts.length) {
    let best = null;
    for (const c of recoveryCandidates(filePath)) {
      const s = readStoreFrom(c);
      if (s && s.attempts.length > (best?.store.attempts.length || 0)) best = { path: c, store: s };
    }
    if (best) {
      store = best.store;
      initInfo.recoveredFrom = best.path;
      writeStoreSync(); // grava imediatamente no caminho canônico
    }
  }

  if (!Array.isArray(store.registry)) store.registry = [];
  if (!Array.isArray(store.users)) store.users = [];
  if (!Array.isArray(store.removalRequests)) store.removalRequests = [];
  if (!store.settings || typeof store.settings !== 'object') store.settings = {};
  initInfo.loaded = store.attempts.length;
  return store;
}

// Status de inicialização para o log da central.
export function initStatus() { return { ...initInfo }; }

// Escrita atômica + backup: grava .tmp, faz backup do arquivo bom, e renomeia por cima.
// O rename é atômico (POSIX e Windows via MoveFileEx), então nunca deixa um JSON pela metade.
function writeStoreSync() {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, filePath + '.bak'); } catch {}
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error('[db] falha ao salvar:', e.message);
  }
}

// Flush síncrono imediato — usado no desligamento (SIGINT/SIGTERM) para não perder nada.
export function flushNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeStoreSync();
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeStoreSync();
  }, 400);
}

export function insertAttempt(a) {
  const kind = a.kind === 'web' ? 'web' : a.kind === 'net' ? 'net' : 'ssh';
  const row = {
    id: store.nextId++,
    kind,
    ts: a.ts ?? new Date().toISOString(),
    ip: a.ip,
    port: a.port ?? null,
    username: a.username ?? '',
    password: a.password ?? '',
    method: a.method ?? (kind === 'web' ? 'GET' : 'password'),
    client: a.client ?? '',
    agent: a.agent ?? '',
  };
  if (kind === 'web') {
    // campos específicos de tráfego web (honeypot de logs)
    row.wmethod = a.wmethod ?? a.method ?? 'GET';
    row.path = a.path ?? '';
    row.status = a.status ?? 0;
    row.bytes = a.bytes ?? 0;
    row.ua = a.ua ?? '';
    row.referer = a.referer ?? '';
    row.host = a.host ?? '';
    row.site = a.site ?? a.host ?? '';
    row.score = typeof a.score === 'number' ? a.score : 0;
    row.category = a.category ?? 'benign';
    row.label = a.label ?? '';
    row.isBot = !!a.isBot;
    row.hit = !!a.hit;
  } else if (kind === 'net') {
    // conexão de rede capturada pelo sensor tcpdump
    row.srcPort = a.srcPort ?? null;
    row.dstPort = a.dstPort ?? null;
    row.proto = a.proto ?? 'tcp';
    row.service = a.service ?? '';
    row.score = typeof a.score === 'number' ? a.score : 0;
    row.category = a.category ?? 'probe';
    row.label = a.label ?? '';
    row.scan = !!a.scan;
    row.ports = a.ports ?? 0;
  }
  store.attempts.push(row);
  scheduleSave();
  return row;
}

// trata registros antigos (sem campo kind) como SSH.
function kindOf(a) { return a.kind === 'web' ? 'web' : a.kind === 'net' ? 'net' : 'ssh'; }

export function getAttempt(id) {
  return store.attempts.find((a) => a.id === id);
}

// ----- filtros (equivalente ao WHERE da versão SQL) -----
function matches(a, q) {
  const inc = (hay, needle) => String(hay ?? '').toLowerCase().includes(String(needle).toLowerCase());
  if (q.kind && kindOf(a) !== q.kind) return false;
  if (q.ip && !inc(a.ip, q.ip)) return false;
  if (q.username && !inc(a.username, q.username)) return false;
  if (q.password && !inc(a.password, q.password)) return false;
  if (q.agent && !inc(a.agent, q.agent)) return false;
  // Escopo multi-tenant: se q.agents (array) vier, a captura só passa se pertencer
  // a um sensor permitido. Array vazio => nada passa (tenant sem sensores vê zero).
  if (Array.isArray(q.agents) && !q.agents.includes(a.agent)) return false;
  if ((q.withpass === '1' || q.withpass === 1 || q.withpass === true) && !a.password) return false;
  if (q.from && !(a.ts >= q.from)) return false;
  if (q.to && !(a.ts <= q.to)) return false;
  // ----- filtros específicos de tráfego web -----
  if (q.path && !inc(a.path, q.path)) return false;
  if (q.site && !inc(a.site, q.site)) return false;
  if (q.category && a.category !== q.category) return false;
  if (q.ua && !inc(a.ua, q.ua)) return false;
  if (q.status && String(a.status) !== String(q.status)) return false;
  if (q.minscore && !(Number(a.score || 0) >= Number(q.minscore))) return false;
  if (q.dstport && String(a.dstPort) !== String(q.dstport)) return false;
  if (q.service && !inc(a.service, q.service)) return false;
  if (q.proto && a.proto !== q.proto) return false;
  if ((q.scan === '1' || q.scan === 1 || q.scan === true) && !a.scan) return false;
  if ((q.hit === '1' || q.hit === 1 || q.hit === true) && !a.hit) return false;
  if (q.bot === '1' && !a.isBot) return false;
  if (q.bot === '0' && a.isBot) return false;
  if (q.search) {
    const s = String(q.search).toLowerCase();
    const found = inc(a.ip, s) || inc(a.username, s) || inc(a.password, s) || inc(a.client, s) ||
      inc(a.agent, s) || inc(a.path, s) || inc(a.ua, s) || inc(a.category, s) || inc(a.site, s) ||
      inc(a.service, s) || inc(a.dstPort, s);
    if (!found) return false;
  }
  if (q.ips && Array.isArray(q.ips) && q.ips.length && !q.ips.includes(a.ip)) return false;
  return true;
}

function filtered(q = {}) {
  return store.attempts.filter((a) => matches(a, q));
}

export function listAttempts(q = {}) {
  const all = filtered(q).sort((a, b) => b.id - a.id);
  const total = all.length;
  const limit = Math.min(Number(q.limit) || 1000, 50000);
  const offset = Number(q.offset) || 0;
  const rows = all.slice(offset, offset + limit);
  return { rows, total };
}

export function groupedByIp(q = {}) {
  const map = new Map();
  for (const a of filtered(q)) {
    let g = map.get(a.ip);
    if (!g) {
      g = { ip: a.ip, attempts: 0, _users: new Set(), _pass: new Set(), first_seen: a.ts, last_seen: a.ts, client: a.client || '' };
      map.set(a.ip, g);
    }
    g.attempts += 1;
    g._users.add(a.username);
    g._pass.add(a.password);
    if (a.ts < g.first_seen) g.first_seen = a.ts;
    if (a.ts > g.last_seen) { g.last_seen = a.ts; if (a.client) g.client = a.client; }
  }
  return Array.from(map.values())
    .map((g) => ({
      ip: g.ip, attempts: g.attempts, users: g._users.size, passwords: g._pass.size,
      first_seen: g.first_seen, last_seen: g.last_seen, client: g.client,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

export function attemptsForIp(ip) {
  return store.attempts.filter((a) => a.ip === ip).sort((a, b) => b.id - a.id);
}

// Agrupa por (IP de origem, AGENTE) — para o mapa desenhar cada ataque indo para
// o agente que ele realmente atingiu (um IP que bate em 2 agentes vira 2 arcos).
export function mapGroups(q = {}) {
  const map = new Map();
  for (const a of filtered(q)) {
    const key = a.ip + ' ' + (a.agent || '');
    let g = map.get(key);
    if (!g) { g = { ip: a.ip, agent: a.agent || '', attempts: 0, first_seen: a.ts, last_seen: a.ts }; map.set(key, g); }
    g.attempts += 1;
    if (a.ts < g.first_seen) g.first_seen = a.ts;
    if (a.ts > g.last_seen) g.last_seen = a.ts;
  }
  return Array.from(map.values()).sort((a, b) => b.attempts - a.attempts);
}

function topBy(rows, key, n = 10) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return Array.from(m.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export function stats(q = {}) {
  const rows = filtered(q);
  const total = rows.length;
  const uniqueIps = new Set(rows.map((r) => r.ip)).size;
  const uniqueUsers = new Set(rows.map((r) => r.username)).size;
  const uniquePass = new Set(rows.map((r) => r.password)).size;
  const uniqueAgents = new Set(rows.map((r) => r.agent).filter(Boolean)).size;

  const topUsers = topBy(rows, 'username');
  const topPasswords = topBy(rows, 'password');
  const topIps = topBy(rows, 'ip');

  // timeline por hora (chave "YYYY-MM-DDTHH")
  const buckets = new Map();
  for (const r of rows) {
    const hour = String(r.ts).slice(0, 13);
    buckets.set(hour, (buckets.get(hour) || 0) + 1);
  }
  const timeline = Array.from(buckets.entries())
    .map(([hour, value]) => ({ hour, value }))
    .sort((a, b) => (a.hour < b.hour ? -1 : 1))
    .slice(-168);

  return { total, uniqueIps, uniqueUsers, uniquePass, uniqueAgents, topUsers, topPasswords, topIps, timeline };
}

// ============ ESTATÍSTICAS / AGRUPAMENTO DO TRÁFEGO WEB ============
const CATEGORY_LABELS = {
  'env-leak': 'Vazamento de segredo', 'rce-shell': 'RCE / Webshell', 'sqli': 'SQL Injection',
  'xss': 'Cross-Site Scripting', 'admin-probe': 'Painel administrativo', 'wp-scan': 'Recon WordPress',
  'cms-exploit': 'Exploit de CMS', 'path-scan': 'Fuzzing de caminhos', 'proxy-abuse': 'Abuso de proxy',
  'enum': 'Enumeração de rota', 'scanner': 'Scanner de vulnerabilidade', 'automation': 'Cliente automatizado',
  'suspicious': 'Requisição suspeita', 'benign': 'Tráfego comum',
};

export function webStats(q = {}) {
  const rows = filtered({ ...q, kind: 'web' });
  const total = rows.length;
  const uniqueIps = new Set(rows.map((r) => r.ip)).size;
  const uniquePaths = new Set(rows.map((r) => r.path)).size;
  const uniqueAgents = new Set(rows.map((r) => r.agent).filter(Boolean)).size;
  const bots = rows.filter((r) => r.isBot).length;
  const humans = total - bots;
  const hits = rows.filter((r) => r.hit).length;
  const critical = rows.filter((r) => (r.score || 0) >= 85).length;
  const avgScore = total ? Math.round(rows.reduce((m, r) => m + (r.score || 0), 0) / total) : 0;

  const topPaths = topBy(rows, 'path');
  const topIps = topBy(rows, 'ip');
  const topUas = topBy(rows, 'ua').map((u) => ({ ...u, label: u.label || '∅' }));
  const topStatuses = topBy(rows, 'status');

  // categorias com rótulo legível
  const catMap = new Map();
  for (const r of rows) catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
  const topCategories = Array.from(catMap.entries())
    .map(([cat, value]) => ({ label: CATEGORY_LABELS[cat] || cat, category: cat, value }))
    .sort((a, b) => b.value - a.value).slice(0, 12);

  // distribuição de severidade
  const sev = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of rows) {
    const s = r.score || 0;
    if (s >= 85) sev.critical++; else if (s >= 60) sev.high++;
    else if (s >= 35) sev.medium++; else if (s >= 10) sev.low++; else sev.info++;
  }

  // timeline por hora
  const buckets = new Map();
  for (const r of rows) {
    const hour = String(r.ts).slice(0, 13);
    buckets.set(hour, (buckets.get(hour) || 0) + 1);
  }
  const timeline = Array.from(buckets.entries())
    .map(([hour, value]) => ({ hour, value }))
    .sort((a, b) => (a.hour < b.hour ? -1 : 1)).slice(-168);

  return {
    total, uniqueIps, uniquePaths, uniqueAgents, bots, humans, hits, critical, avgScore,
    botPct: total ? Math.round((bots / total) * 100) : 0,
    topPaths, topIps, topUas, topStatuses, topCategories, severity: sev, timeline,
  };
}

export function webGroupedByIp(q = {}) {
  const map = new Map();
  for (const a of filtered({ ...q, kind: 'web' })) {
    let g = map.get(a.ip);
    if (!g) {
      g = { ip: a.ip, requests: 0, _paths: new Set(), maxScore: 0, hits: 0, bot: false,
        _cats: new Map(), first_seen: a.ts, last_seen: a.ts, ua: a.ua || '', agent: a.agent || '' };
      map.set(a.ip, g);
    }
    g.requests += 1;
    g._paths.add(a.path);
    g.maxScore = Math.max(g.maxScore, a.score || 0);
    if (a.hit) g.hits += 1;
    if (a.isBot) g.bot = true;
    g._cats.set(a.category, (g._cats.get(a.category) || 0) + 1);
    if (a.ts < g.first_seen) g.first_seen = a.ts;
    if (a.ts > g.last_seen) { g.last_seen = a.ts; if (a.ua) g.ua = a.ua; }
  }
  return Array.from(map.values()).map((g) => {
    let topCat = 'benign', best = -1;
    for (const [c, n] of g._cats) if (n > best) { best = n; topCat = c; }
    return {
      ip: g.ip, requests: g.requests, attempts: g.requests, paths: g._paths.size,
      maxScore: g.maxScore, hits: g.hits, bot: g.bot, category: topCat,
      categoryLabel: CATEGORY_LABELS[topCat] || topCat,
      first_seen: g.first_seen, last_seen: g.last_seen, ua: g.ua, agent: g.agent,
    };
  }).sort((a, b) => (b.maxScore - a.maxScore) || (b.requests - a.requests));
}

// Como webGroupedByIp, mas separando por (IP, AGENTE) para os arcos do mapa web.
export function webMapGroups(q = {}) {
  const map = new Map();
  for (const a of filtered({ ...q, kind: 'web' })) {
    const key = a.ip + ' ' + (a.agent || '');
    let g = map.get(key);
    if (!g) { g = { ip: a.ip, agent: a.agent || '', requests: 0, _paths: new Set(), maxScore: 0, hits: 0, bot: false, _cats: new Map(), last_seen: a.ts, ua: a.ua || '' }; map.set(key, g); }
    g.requests += 1; g._paths.add(a.path); g.maxScore = Math.max(g.maxScore, a.score || 0);
    if (a.hit) g.hits += 1; if (a.isBot) g.bot = true;
    g._cats.set(a.category, (g._cats.get(a.category) || 0) + 1);
    if (a.ts > g.last_seen) g.last_seen = a.ts;
  }
  return Array.from(map.values()).map((g) => {
    let topCat = 'benign', best = -1;
    for (const [c, n] of g._cats) if (n > best) { best = n; topCat = c; }
    return { ip: g.ip, agent: g.agent, requests: g.requests, attempts: g.requests, paths: g._paths.size,
      maxScore: g.maxScore, hits: g.hits, bot: g.bot, category: topCat, categoryLabel: CATEGORY_LABELS[topCat] || topCat,
      last_seen: g.last_seen, ua: g.ua };
  }).sort((a, b) => (b.maxScore - a.maxScore) || (b.requests - a.requests));
}

// eventos web recentes (para o REPLAY cinematográfico): enxuto, ordenado no tempo.
export function webEvents(q = {}) {
  const limit = Math.min(Number(q.limit) || 3000, 20000);
  const rows = filtered({ ...q, kind: 'web' })
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
  const sliced = rows.length > limit ? rows.slice(rows.length - limit) : rows;
  return sliced.map((r) => ({
    id: r.id, ts: r.ts, ip: r.ip, score: r.score || 0, category: r.category,
    path: r.path, wmethod: r.wmethod, status: r.status, hit: !!r.hit, agent: r.agent,
  }));
}

// ============ ESTATÍSTICAS / AGRUPAMENTO DO SENSOR DE REDE (tcpdump) ============
const NET_CAT_LABELS = {
  'port-scan': 'Varredura de portas', 'rdp': 'RDP', 'smb': 'SMB', 'database': 'Banco de dados',
  'docker': 'Docker/API', 'telnet': 'Telnet/IoT', 'ssh-probe': 'Sondagem SSH', 'vnc': 'VNC',
  'ics': 'ICS/SCADA', 'iot': 'IoT', 'web': 'Web', 'mail': 'E-mail', 'vpn': 'VPN', 'c2': 'C2/Malware',
  'proxy': 'Proxy', 'probe': 'Sondagem', 'dns': 'DNS', 'directory': 'LDAP', 'snmp': 'SNMP',
};

export function netStats(q = {}) {
  const rows = filtered({ ...q, kind: 'net' });
  const total = rows.length;
  const uniqueIps = new Set(rows.map((r) => r.ip)).size;
  const uniquePorts = new Set(rows.map((r) => r.dstPort)).size;
  const uniqueAgents = new Set(rows.map((r) => r.agent).filter(Boolean)).size;
  const scanners = new Set(rows.filter((r) => r.scan).map((r) => r.ip)).size;
  const critical = rows.filter((r) => (r.score || 0) >= 85).length;
  const avgScore = total ? Math.round(rows.reduce((m, r) => m + (r.score || 0), 0) / total) : 0;

  const topPorts = topBy(rows, 'dstPort').map((p) => ({ ...p, label: String(p.label) }));
  const topServices = topBy(rows, 'service');
  const topIps = topBy(rows, 'ip');
  const catMap = new Map();
  for (const r of rows) catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
  const topCategories = Array.from(catMap.entries())
    .map(([cat, value]) => ({ label: NET_CAT_LABELS[cat] || cat, category: cat, value }))
    .sort((a, b) => b.value - a.value).slice(0, 12);

  const sev = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of rows) { const s = r.score || 0; if (s >= 85) sev.critical++; else if (s >= 60) sev.high++; else if (s >= 35) sev.medium++; else if (s >= 10) sev.low++; else sev.info++; }

  const buckets = new Map();
  for (const r of rows) { const hour = String(r.ts).slice(0, 13); buckets.set(hour, (buckets.get(hour) || 0) + 1); }
  const timeline = Array.from(buckets.entries()).map(([hour, value]) => ({ hour, value })).sort((a, b) => (a.hour < b.hour ? -1 : 1)).slice(-168);

  return { total, uniqueIps, uniquePorts, uniqueAgents, scanners, critical, avgScore, topPorts, topServices, topIps, topCategories, severity: sev, timeline };
}

function netAggregate(rows) {
  const map = new Map();
  for (const a of rows) {
    let g = map.get(a.ip);
    if (!g) { g = { ip: a.ip, connections: 0, _ports: new Map(), maxScore: 0, scan: false, _cats: new Map(), _svc: new Map(), first_seen: a.ts, last_seen: a.ts, service: a.service || '', _agents: new Set() }; map.set(a.ip, g); }
    g.connections += 1;
    g._ports.set(a.dstPort, (g._ports.get(a.dstPort) || 0) + 1);
    g.maxScore = Math.max(g.maxScore, a.score || 0);
    if (a.scan) g.scan = true;
    g._cats.set(a.category, (g._cats.get(a.category) || 0) + 1);
    if (a.service) g._svc.set(a.service, (g._svc.get(a.service) || 0) + 1);
    if (a.agent) g._agents.add(a.agent);
    if (a.ts < g.first_seen) g.first_seen = a.ts;
    if (a.ts > g.last_seen) { g.last_seen = a.ts; if (a.service) g.service = a.service; }
  }
  return map;
}

export function netGroupedByIp(q = {}) {
  const map = netAggregate(filtered({ ...q, kind: 'net' }));
  return Array.from(map.values()).map((g) => {
    let topCat = 'probe', best = -1;
    for (const [c, n] of g._cats) if (n > best) { best = n; topCat = c; }
    const topPorts = Array.from(g._ports.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([port, n]) => ({ port, n }));
    return { ip: g.ip, connections: g.connections, attempts: g.connections, ports: g._ports.size, topPorts,
      maxScore: g.maxScore, scan: g.scan, category: topCat, categoryLabel: NET_CAT_LABELS[topCat] || topCat,
      service: g.service, agents: Array.from(g._agents), first_seen: g.first_seen, last_seen: g.last_seen };
  }).sort((a, b) => (b.maxScore - a.maxScore) || (b.connections - a.connections));
}

export function netMapGroups(q = {}) {
  const map = new Map();
  for (const a of filtered({ ...q, kind: 'net' })) {
    const key = a.ip + ' ' + (a.agent || '');
    let g = map.get(key);
    if (!g) { g = { ip: a.ip, agent: a.agent || '', connections: 0, _ports: new Set(), maxScore: 0, scan: false, last_seen: a.ts }; map.set(key, g); }
    g.connections += 1; g._ports.add(a.dstPort); g.maxScore = Math.max(g.maxScore, a.score || 0);
    if (a.scan) g.scan = true;
    if (a.ts > g.last_seen) g.last_seen = a.ts;
  }
  return Array.from(map.values()).map((g) => ({ ip: g.ip, agent: g.agent, connections: g.connections, attempts: g.connections, ports: g._ports.size, maxScore: g.maxScore, scan: g.scan, hits: g.scan ? 1 : 0, last_seen: g.last_seen }))
    .sort((a, b) => (b.maxScore - a.maxScore) || (b.connections - a.connections));
}

export function netEvents(q = {}) {
  const limit = Math.min(Number(q.limit) || 3000, 20000);
  const rows = filtered({ ...q, kind: 'net' }).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id - b.id));
  const sliced = rows.length > limit ? rows.slice(rows.length - limit) : rows;
  return sliced.map((r) => ({ id: r.id, ts: r.ts, ip: r.ip, score: r.score || 0, dstPort: r.dstPort, service: r.service, scan: !!r.scan, hit: !!r.scan, agent: r.agent }));
}

// ----- registro de agentes (modelo pull: a central conecta no agente) -----
// A "tag" usada para marcar as capturas de um agente é o nome informado, ou o host.
export function agentTag(entry) { return entry.name || entry.host; }

export function listAgents() { return store.registry; }

export function addAgent({ host, port = 4000, name = '', owner = null } = {}) {
  host = String(host || '').trim();
  port = Number(port) || 4000;
  if (!host) return null;
  const id = `${host}:${port}`;
  const existing = store.registry.find((a) => a.id === id);
  if (!existing) {
    store.registry.push({ id, host, port, name: String(name || '').trim(), owner: owner || null, addedAt: new Date().toISOString() });
    scheduleSave();
  } else if (owner && !existing.owner) {
    // primeiro dono a reivindicar um sensor já existente
    existing.owner = owner; scheduleSave();
  }
  return store.registry.find((a) => a.id === id);
}

// Define/limpa o tenant dono de um sensor (usado pelo admin).
export function setAgentOwner(id, owner) {
  const a = store.registry.find((x) => x.id === id);
  if (!a) return null;
  a.owner = owner || null;
  scheduleSave();
  return a;
}

export function removeAgent(id) {
  store.registry = store.registry.filter((a) => a.id !== id);
  agentRuntime.delete(id);
  scheduleSave();
  return true;
}

export function getAgent(id) { return store.registry.find((a) => a.id === id) || null; }

// Local manual do agente no mapa (sobrepõe a geo automática). null = volta ao automático.
export function setAgentLocation(id, loc) {
  const a = store.registry.find((x) => x.id === id);
  if (!a) return null;
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) a.loc = { lat: loc.lat, lon: loc.lon };
  else delete a.loc;
  scheduleSave();
  return a.loc || null;
}

// Guarda a última config desejada de um agente (modo/logs) para exibir mesmo offline.
export function setAgentConfig(id, config) {
  const a = store.registry.find((x) => x.id === id);
  if (!a) return null;
  a.config = {
    mode: config.mode ?? a.config?.mode ?? null,
    webLogs: config.webLogs ?? a.config?.webLogs ?? '',
    webIgnore: config.webIgnore ?? a.config?.webIgnore ?? '',
    updatedAt: new Date().toISOString(),
  };
  scheduleSave();
  return a.config;
}

export function setAgentStatus(id, patch) {
  agentRuntime.set(id, { ...(agentRuntime.get(id) || { cursor: 0 }), ...patch });
}

export function getAgentRuntime(id) {
  return agentRuntime.get(id) || { cursor: 0 };
}

export function agentsView() {
  return store.registry
    .map((a) => {
      const rt = agentRuntime.get(a.id) || {};
      const tag = agentTag(a);
      const rows = store.attempts.filter((x) => x.agent === tag);
      const web = rows.filter((r) => kindOf(r) === 'web');
      const ssh = rows.filter((r) => kindOf(r) === 'ssh');
      const net = rows.filter((r) => kindOf(r) === 'net');
      return {
        id: a.id,
        host: a.host,
        port: a.port,
        name: a.name,
        owner: a.owner || null,
        tag,
        agent: tag, // compatibilidade com o painel
        online: !!rt.online,
        version: rt.version || null,
        loc: a.loc || null,
        last_seen: rt.lastSeen ? new Date(rt.lastSeen).toISOString() : null,
        error: rt.error || null,
        attempts: rows.length,
        sshAttempts: ssh.length,
        webAttempts: web.length,
        webHits: web.filter((r) => r.hit).length,
        netAttempts: net.length,
        netScans: net.filter((r) => r.scan).length,
        ips: new Set(rows.map((r) => r.ip)).size,
        users: new Set(ssh.map((r) => r.username)).size,
        passwords: new Set(ssh.map((r) => r.password)).size,
      };
    })
    .sort((a, b) => b.attempts - a.attempts);
}

export function clearAttempts() {
  store.attempts = [];
  store.nextId = 1;
  scheduleSave();
  return true;
}

// Configurações da central (persistidas com a base). Ex.: política de auto-bloqueio.
export function getSettings() { return store.settings || {}; }
export function setSettings(patch) { store.settings = { ...(store.settings || {}), ...patch }; scheduleSave(); return store.settings; }

// ---- Configuração da central (movida do .env para a interface web) ----------
// A config vive em store.settings.config (persistida com a base). O .env só serve
// de SEMENTE na primeira execução; depois disso a interface é a fonte da verdade.
export const CONFIG_DEFAULTS = {
  apiPort: 4000,
  pollMs: 5000,
  corsOrigin: '*',
  ingestToken: 'troque-este-token',
  geoipDisable: false,
  geoTtlDays: 30,
  abuseipdbKey: '',
  autoblockAvailable: true,
  publicUrl: '',
  trustProxy: false,     // ative quando a central ficar atrás de um proxy reverso (pluggedninja)
  localhostAdmin: false, // SEGURO por padrão: exige token de admin mesmo em loopback. Ligue (UI ⚙ ou LOCALHOST_ADMIN=1) só em uso local de confiança.
};
export function getConfig() { return { ...CONFIG_DEFAULTS, ...((store.settings && store.settings.config) || {}) }; }
export function setConfig(patch) {
  const next = { ...getConfig(), ...(patch || {}) };
  next.apiPort = Math.min(65535, Math.max(1, Number(next.apiPort) || CONFIG_DEFAULTS.apiPort));
  next.pollMs = Math.max(1000, Number(next.pollMs) || CONFIG_DEFAULTS.pollMs);
  next.geoTtlDays = Math.max(0, Number(next.geoTtlDays) || 0);
  next.corsOrigin = String(next.corsOrigin || '*');
  next.ingestToken = String(next.ingestToken || '');
  next.abuseipdbKey = String(next.abuseipdbKey || '');
  next.publicUrl = String(next.publicUrl || '');
  next.geoipDisable = !!next.geoipDisable;
  next.autoblockAvailable = next.autoblockAvailable !== false;
  next.trustProxy = !!next.trustProxy;
  next.localhostAdmin = next.localhostAdmin === true; // padrão seguro: só liga com valor explicitamente true
  setSettings({ config: next });
  return getConfig();
}
// Semeia a config pelo ambiente só se ainda não existir (1ª execução / migração).
export function seedConfigFromEnv(env = {}) {
  if (store.settings && store.settings.config) return getConfig();
  setSettings({ config: {
    apiPort: Number(env.API_PORT) || CONFIG_DEFAULTS.apiPort,
    pollMs: Number(env.POLL_MS) || CONFIG_DEFAULTS.pollMs,
    corsOrigin: env.CORS_ORIGIN || CONFIG_DEFAULTS.corsOrigin,
    ingestToken: env.INGEST_TOKEN || CONFIG_DEFAULTS.ingestToken,
    geoipDisable: env.GEOIP_DISABLE === '1' || env.GEOIP_DISABLE === 'true',
    geoTtlDays: Number(env.GEO_TTL_DAYS) || CONFIG_DEFAULTS.geoTtlDays,
    abuseipdbKey: env.ABUSEIPDB_KEY || '',
    autoblockAvailable: env.DISABLE_AUTOBLOCK !== '1',
    publicUrl: env.PUBLIC_URL || '',
    trustProxy: env.TRUST_PROXY === '1',
    localhostAdmin: env.LOCALHOST_ADMIN === '1' || env.LOCALHOST_ADMIN === 'true',
  } });
  return getConfig();
}

// IP está na allowlist do auto-bloqueio? (match exato ou por prefixo de faixa)
export function isAllowlisted(ip) {
  const list = (getSettings().autoblock && getSettings().autoblock.allowlist) || [];
  const s = String(ip || '');
  return list.some((e) => { const p = String(e).trim(); return p && (s === p || s.startsWith(p)); });
}

// ===== Consulta pública de reputação de IP (threat intel) =====================
// Permite que ferramentas externas consultem um IP visto pelos honeypots.
function topVals(arr, n = 8) {
  const m = new Map();
  for (const v of arr) { const s = String(v ?? '').trim(); if (!s) continue; m.set(s, (m.get(s) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
}
function summarizeEvent(r) {
  const kind = r.kind || 'ssh';
  if (kind === 'web') return { ts: r.ts, kind, summary: `${r.wmethod || r.method || 'GET'} ${String(r.path || '').slice(0, 80)} → ${r.status || '?'}${r.hit ? ' (ALVO ATINGIDO)' : ''}${r.label ? ` [${r.label}]` : ''}` };
  if (kind === 'net') return { ts: r.ts, kind, summary: `conexão ${r.proto || 'tcp'}/${r.dstPort || '?'}${r.service ? ` (${r.service})` : ''}${r.scan ? ' — PORT SCAN' : ''}` };
  return { ts: r.ts, kind, summary: `SSH brute-force user="${r.username ?? ''}" pass="${r.password ?? ''}" (${r.method || ''})` };
}
// Dossiê de um IP: primeiro/último evento e o que foi detectado (por tipo).
export function lookupIp(ipRaw) {
  const ip = String(ipRaw || '').trim();
  const rows = store.attempts.filter((a) => a.ip === ip);
  if (!rows.length) return { ip, found: false, malicious: false, source: 'threatscope-honeypot' };
  rows.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const first = rows[0], last = rows[rows.length - 1];
  const kindOf = (r) => r.kind || 'ssh';
  const ssh = rows.filter((r) => kindOf(r) === 'ssh');
  const web = rows.filter((r) => r.kind === 'web');
  const net = rows.filter((r) => r.kind === 'net');
  const detected = {};
  if (ssh.length) detected.ssh = { attempts: ssh.length, topUsernames: topVals(ssh.map((r) => r.username)), topPasswords: topVals(ssh.map((r) => r.password)) };
  if (web.length) detected.web = { requests: web.length, hits: web.filter((r) => r.hit).length, topPaths: topVals(web.map((r) => r.path)), categories: [...new Set(web.map((r) => r.label || r.category).filter(Boolean))].slice(0, 10) };
  if (net.length) detected.net = { connections: net.length, ports: [...new Set(net.map((r) => r.dstPort).filter(Boolean))].sort((a, b) => a - b).slice(0, 40), portScan: net.some((r) => r.scan) };
  return {
    ip, found: true, malicious: true,
    firstSeen: first.ts, lastSeen: last.ts,
    lastEvent: summarizeEvent(last),
    totalEvents: rows.length,
    kinds: [...new Set(rows.map(kindOf))],
    agents: [...new Set(rows.map((r) => r.agent).filter(Boolean))],
    categories: [...new Set(rows.map((r) => r.label || r.category).filter(Boolean))].slice(0, 12),
    detected,
    source: 'threatscope-honeypot',
  };
}
// Feed de todos os IPs vistos (para ferramentas puxarem a lista inteira).
export function threatFeed({ since = null, minEvents = 1, kind = null, limit = 5000 } = {}) {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const map = new Map();
  for (const a of store.attempts) {
    if (kind && (a.kind || 'ssh') !== kind) continue;
    const t = new Date(a.ts).getTime();
    if (sinceMs && t < sinceMs) continue;
    let e = map.get(a.ip);
    if (!e) { e = { ip: a.ip, events: 0, lastSeen: a.ts, lastMs: 0, kinds: new Set() }; map.set(a.ip, e); }
    e.events++; e.kinds.add(a.kind || 'ssh');
    if (t > e.lastMs) { e.lastMs = t; e.lastSeen = a.ts; }
  }
  return [...map.values()]
    .filter((e) => e.events >= minEvents)
    .sort((a, b) => b.lastMs - a.lastMs)
    .slice(0, limit)
    .map((e) => ({ ip: e.ip, events: e.events, lastSeen: e.lastSeen, kinds: [...e.kinds] }));
}

export function getStore() { return store; }

// ============================================================================
// Contas, tokens de API e multi-tenant
// ============================================================================
function genToken() { return 'tsk_' + crypto.randomBytes(24).toString('hex'); }
function genId() { return crypto.randomBytes(8).toString('hex'); }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function listUsers() { return store.users; }
// Versão segura para expor (nunca vaza o token de outra conta).
export function publicUser(u, { withToken = false } = {}) {
  if (!u) return null;
  const out = {
    id: u.id, name: u.name, email: u.email, role: u.role,
    approved: !!u.approved, disabled: !!u.disabled,
    createdAt: u.createdAt, approvedAt: u.approvedAt || null,
    sensors: agentsForOwner(u.id).length,
  };
  if (withToken) out.token = u.token || null;
  return out;
}
export function findUserById(id) { return store.users.find((u) => u.id === id) || null; }
export function findUserByEmail(email) { const e = normEmail(email); return store.users.find((u) => normEmail(u.email) === e) || null; }
// Comparacao de token em tempo constante (evita timing-attack).
function safeEqualTok(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
export function findUserByToken(tok) {
  const t = String(tok || '').trim();
  if (!t) return null;
  const u = store.users.find((x) => x.token && safeEqualTok(x.token, t));
  return u && u.approved && !u.disabled ? u : null;
}

// Cadastro público: cria conta PENDENTE (sem token até o admin aprovar).
export function registerUser({ name, email }) {
  const nm = String(name || '').trim().slice(0, 120);
  const em = normEmail(email);
  if (!nm || !em) return { error: 'nome e email são obrigatórios' };
  if (!EMAIL_RE.test(em)) return { error: 'email inválido' };
  const existing = findUserByEmail(em);
  if (existing) return { ok: true, already: true, status: existing.approved ? 'approved' : 'pending' };
  store.users.push({ id: genId(), name: nm, email: em, role: 'user', approved: false, disabled: false, token: null, createdAt: new Date().toISOString(), approvedAt: null });
  scheduleSave();
  return { ok: true, status: 'pending' };
}

// Admin aprova uma conta -> gera o token de API dela.
export function approveUser(id) {
  const u = findUserById(id);
  if (!u) return null;
  if (!u.approved) { u.approved = true; u.approvedAt = new Date().toISOString(); }
  if (!u.token) u.token = genToken();
  u.disabled = false;
  scheduleSave();
  return u;
}
export function setUserDisabled(id, disabled) { const u = findUserById(id); if (!u) return null; u.disabled = !!disabled; scheduleSave(); return u; }
export function regenUserToken(id) { const u = findUserById(id); if (!u) return null; u.token = genToken(); scheduleSave(); return u; }
export function deleteUser(id) {
  const u = findUserById(id); if (!u) return false;
  if (u.role === 'admin') return false; // nunca apaga o admin por aqui
  for (const a of store.registry) if (a.owner === id) a.owner = null; // desvincula sensores
  store.users = store.users.filter((x) => x.id !== id);
  scheduleSave(); return true;
}

// Semeia a conta admin na 1ª execução (token estável, impresso no boot).
export function seedAdmin({ email = 'admin@plugged.ninja', name = 'Admin' } = {}) {
  let admin = store.users.find((u) => u.role === 'admin');
  if (!admin) {
    admin = { id: genId(), name, email: normEmail(email), role: 'admin', approved: true, disabled: false, token: genToken(), createdAt: new Date().toISOString(), approvedAt: new Date().toISOString() };
    store.users.push(admin); scheduleSave();
    return { admin, created: true };
  }
  if (!admin.token) { admin.token = genToken(); scheduleSave(); }
  return { admin, created: false };
}

// Sensores de um tenant. Retorna as TAGS (usadas para filtrar os dados coletados).
export function agentsForOwner(ownerId) { return store.registry.filter((a) => a.owner === ownerId); }
export function tagsForOwner(ownerId) { return agentsForOwner(ownerId).map((a) => agentTag(a)); }

// ============================================================================
// Solicitações de remoção de IP da lista
// ============================================================================
export function listRemovalRequests(status = null) {
  const list = store.removalRequests;
  return status ? list.filter((r) => r.status === status) : list;
}
export function createRemovalRequest({ ip, email, message }) {
  const cleanIp = String(ip || '').trim().slice(0, 60);
  const em = normEmail(email);
  if (!cleanIp) return { error: 'informe o IP' };
  if (!EMAIL_RE.test(em)) return { error: 'email inválido' };
  const r = { id: genId(), ip: cleanIp, email: em, message: String(message || '').slice(0, 1000), status: 'pending', createdAt: new Date().toISOString(), resolvedAt: null };
  store.removalRequests.unshift(r); scheduleSave();
  return { ok: true, id: r.id };
}
export function resolveRemovalRequest(id, status) {
  const r = store.removalRequests.find((x) => x.id === id);
  if (!r) return null;
  if (['resolved', 'rejected', 'pending'].includes(status)) r.status = status;
  r.resolvedAt = status === 'pending' ? null : new Date().toISOString();
  scheduleSave();
  return r;
}
// Remove um IP das capturas (quando o dono comprova a correção). Retorna a qtde removida.
export function purgeIp(ipRaw) {
  const ip = String(ipRaw || '').trim();
  if (!ip) return 0;
  const before = store.attempts.length;
  store.attempts = store.attempts.filter((a) => a.ip !== ip);
  const removed = before - store.attempts.length;
  if (removed) scheduleSave();
  return removed;
}

// ============================================================================
// Feed/lookup PÚBLICO — só ip, razão e data de adesão (SEM nome de sensor)
// ============================================================================
function reasonForIp(rows) {
  const kinds = new Set(rows.map((r) => r.kind || 'ssh'));
  const cats = [...new Set(rows.map((r) => r.label || r.category).filter(Boolean))];
  const parts = [];
  if (kinds.has('ssh')) parts.push('SSH brute-force');
  if (kinds.has('web')) parts.push(rows.some((r) => r.kind === 'web' && r.hit) ? 'Web: alvo sensível atingido' : 'Web: varredura/scanner');
  if (kinds.has('net')) parts.push(rows.some((r) => r.kind === 'net' && r.scan) ? 'Port scan' : 'Conexões suspeitas');
  const label = parts.join(' + ') || 'Atividade hostil';
  return cats.length ? `${label} (${cats.slice(0, 3).join(', ')})` : label;
}
export function publicThreatFeed({ since = null, minEvents = 1, limit = 5000 } = {}) {
  const sinceMs = since ? new Date(since).getTime() : 0;
  const map = new Map();
  for (const a of store.attempts) {
    const t = new Date(a.ts).getTime();
    if (sinceMs && t < sinceMs) continue;
    let e = map.get(a.ip);
    if (!e) { e = { ip: a.ip, rows: [], firstMs: t || Infinity, lastMs: t || 0 }; map.set(a.ip, e); }
    e.rows.push(a);
    if (t && t < e.firstMs) e.firstMs = t;
    if (t && t > e.lastMs) e.lastMs = t;
  }
  return [...map.values()]
    .filter((e) => e.rows.length >= minEvents)
    .sort((a, b) => b.lastMs - a.lastMs)
    .slice(0, limit)
    .map((e) => ({
      ip: e.ip,
      reason: reasonForIp(e.rows),
      listedSince: Number.isFinite(e.firstMs) ? new Date(e.firstMs).toISOString() : null, // data de adesão
      lastSeen: e.lastMs ? new Date(e.lastMs).toISOString() : null,
      events: e.rows.length,
    }));
}
export function publicLookup(ipRaw) {
  const ip = String(ipRaw || '').trim();
  const rows = store.attempts.filter((a) => a.ip === ip);
  if (!rows.length) return { ip, found: false, malicious: false, source: 'pluggedninja-threatscope' };
  const ts = rows.map((r) => new Date(r.ts).getTime()).filter(Boolean).sort((a, b) => a - b);
  return {
    ip, found: true, malicious: true,
    reason: reasonForIp(rows),
    listedSince: ts.length ? new Date(ts[0]).toISOString() : null,
    lastSeen: ts.length ? new Date(ts[ts.length - 1]).toISOString() : null,
    events: rows.length,
    kinds: [...new Set(rows.map((r) => r.kind || 'ssh'))],
    source: 'pluggedninja-threatscope',
  };
}
