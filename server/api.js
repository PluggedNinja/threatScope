import express from 'express';
import cors from 'cors';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as db from './db.js';
import { buildAgentZip, agentBundleAvailable, agentVersion, agentSourceFiles } from './agentBundle.js';

// Cache de DNS reverso (PTR) + GeoIP em memória.
const rdnsCache = new Map(); // ip -> { ts, data }
const RDNS_TTL = 6 * 60 * 60 * 1000; // 6h
// ===== Cache de GeoIP por FAIXA (/24) persistido em disco =====
// Chave = rede (ex.: "203.0.113" p/ IPv4, ou prefixo IPv6). Assim, ao resolver
// UM ip de uma faixa, todos os IPs vizinhos vêm do disco — quase nunca vai à internet.
let geoTtlDays = 30; // validade (dias) do cache por faixa — sincronizado da config em createApi()
const GEO_FAIL_TTL = 60 * 60 * 1000;            // faixa sem resposta: re-tenta em 1h
const GEO_CACHE_FILE = process.env.GEO_CACHE || (() => {
  const home = os.homedir();
  const nu = path.join(home, '.threatscope', 'geoip-cache.json');
  const old = path.join(home, '.sshoney', 'geoip-cache.json');
  try { if (!fs.existsSync(nu) && fs.existsSync(old)) return old; } catch {}
  return nu;
})();
const geoNet = new Map();                       // netKey -> { ts, geo }

function netKey(ip) {
  const s = String(ip || '');
  if (s.includes(':')) return s.split(':').slice(0, 4).join(':'); // IPv6: /64 aprox
  const p = s.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}` : s;          // IPv4: /24
}

(function loadGeoCache() {
  try {
    if (fs.existsSync(GEO_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8'));
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) {
        if (k === '__ttlDays') { if (Number.isFinite(v)) geoTtlDays = v; continue; }
        if (v && typeof v === 'object') geoNet.set(k, v);
      }
      console.log(`🌍  Cache de GeoIP: ${geoNet.size} faixa(s) carregada(s) de ${GEO_CACHE_FILE} (validade ${geoTtlDays}d)`);
    }
  } catch (e) { console.warn('[geo] não consegui ler o cache:', e.message); }
})();

let geoSaveTimer = null;
function scheduleGeoSave() {
  if (geoSaveTimer) return;
  geoSaveTimer = setTimeout(() => {
    geoSaveTimer = null;
    try {
      const dir = path.dirname(GEO_CACHE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = { __ttlDays: geoTtlDays }; for (const [k, v] of geoNet) obj[k] = v;
      const tmp = GEO_CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, GEO_CACHE_FILE);
    } catch (e) { console.error('[geo] falha ao salvar cache:', e.message); }
  }, 5000);
}
function geoCacheGet(ip) { return geoNet.get(netKey(ip)); }
function geoCacheSet(ip, geo) { geoNet.set(netKey(ip), { ts: Date.now(), geo }); scheduleGeoSave(); }

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

// Anti-SSRF: um host é interno se for/resolver para loopback, privado, link-local
// ou metadata de nuvem. Usado para impedir que tenants apontem o coletor para a
// rede interna (o coletor envia o token de coleta ao host — não pode ser interno).
async function hostIsInternal(host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return isPrivateIp(h);
  try {
    const addrs = await dns.lookup(h, { all: true });
    return !addrs.length || addrs.some((a) => isPrivateIp(a.address));
  } catch { return true; } // não resolveu = não deixa registrar
}

// GeoIP via serviço gratuito (ipwho.is), sem chave. Desligue com GEOIP_DISABLE=1.
async function fetchGeo(ip) {
  if (db.getConfig().geoipDisable || isPrivateIp(ip)) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,city,latitude,longitude,flag,connection`, { signal: controller.signal });
    const j = await r.json();
    if (!j || j.success === false) return {};
    return {
      country: j.country || null,
      countryCode: j.country_code || null,
      city: j.city || null,
      lat: typeof j.latitude === 'number' ? j.latitude : null,
      lon: typeof j.longitude === 'number' ? j.longitude : null,
      flag: (j.flag && j.flag.emoji) || null,
      asn: (j.connection && j.connection.asn) || null,
      org: (j.connection && (j.connection.org || j.connection.isp)) || null,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

// Resolve geo de um IP com cache (compartilhado entre os mapas SSH e WEB).
// Bandeira emoji a partir do código de país (ip-api não devolve emoji).
function flagFromCC(cc) {
  if (!cc || cc.length !== 2) return null;
  try { return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)); } catch { return null; }
}

// GeoIP em LOTE via ip-api.com — até 100 IPs por requisição, sem chave e com
// limite alto (~45 req/min). Resolver 1 a 1 estourava a cota do ipwho.is e
// esvaziava o mapa; em lote, um mapa inteiro cabe em 1-2 requisições.
async function fetchGeoBatch(ips) {
  const out = new Map();
  if (db.getConfig().geoipDisable) return out;
  for (let i = 0; i < ips.length; i += 100) {
    const chunk = ips.slice(i, i + 100);
    const body = chunk.map((q) => ({ query: q, fields: 'query,status,country,countryCode,city,lat,lon,org,isp,as' }));
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch('http://ip-api.com/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (r.ok) {
        const arr = await r.json();
        for (const x of (Array.isArray(arr) ? arr : [])) {
          if (x && x.status === 'success' && typeof x.lat === 'number') {
            out.set(x.query, { country: x.country || null, countryCode: x.countryCode || null, city: x.city || null, lat: x.lat, lon: x.lon, flag: flagFromCC(x.countryCode), org: x.org || x.isp || null, asn: (String(x.as || '').match(/AS(\d+)/) || [])[1] || null });
          } else if (x && x.query) { out.set(x.query, {}); }
        }
      }
    } catch { /* rede/timeout: tenta no próximo ciclo */ } finally { clearTimeout(t); }
  }
  return out;
}

const geoFresh = (c) => c && (Date.now() - c.ts) < (typeof c.geo.lat === 'number' ? geoTtlDays * 86400000 : GEO_FAIL_TTL);

async function geoFor(ip) {
  const c = geoCacheGet(ip);
  if (geoFresh(c)) return c.geo;
  if (isPrivateIp(ip)) { geoCacheSet(ip, {}); return {}; }
  const geo = (await fetchGeoBatch([ip])).get(ip) || {};
  geoCacheSet(ip, geo);
  return geo;
}

// Resolve lat/lon dos grupos usando o cache POR FAIXA; só o que falta vai à
// internet, e UM ip por faixa desconhecida (o resto da faixa reaproveita).
async function buildGeoPoints(groups, decorate = () => ({})) {
  const need = new Map(); // netKey -> um ip de amostra da faixa
  for (const g of groups) {
    if (isPrivateIp(g.ip)) continue;
    if (!geoFresh(geoCacheGet(g.ip))) need.set(netKey(g.ip), g.ip);
  }
  if (need.size) {
    const resolved = await fetchGeoBatch([...need.values()]);
    const now = Date.now();
    for (const [nk, ip] of need) geoNet.set(nk, { ts: now, geo: resolved.get(ip) || {} });
    scheduleGeoSave();
  }
  const out = [];
  for (const g of groups) {
    const geo = (geoCacheGet(g.ip) || { geo: {} }).geo || {};
    if (typeof geo.lat === 'number' && typeof geo.lon === 'number') {
      out.push({
        ip: g.ip, last_seen: g.last_seen, lat: geo.lat, lon: geo.lon,
        country: geo.country || null, countryCode: geo.countryCode || null,
        city: geo.city || null, flag: geo.flag || null, org: geo.org || null,
        ...decorate(g),
      });
    }
  }
  return out;
}

// Geolocaliza cada agente registrado pelo IP/host do servidor — são os nós de
// DESTINO no mapa (cada ataque é desenhado indo para o agente que atingiu).
async function resolveAgentNodes(allowedTags = null) {
  const agents = db.agentsView().filter((a) => !Array.isArray(allowedTags) || allowedTags.includes(a.tag));
  const nodes = [];
  for (const a of agents) {
    let ip = String(a.host || '').trim();
    // hostname -> IP (o GeoIP precisa de IP)
    if (ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.includes(':')) {
      try { const r = await dns.lookup(ip); if (r && r.address) ip = r.address; } catch {}
    }
    const geo = ip ? await geoFor(ip) : {};
    const manual = a.loc && Number.isFinite(a.loc.lat) && Number.isFinite(a.loc.lon);
    const lat = manual ? a.loc.lat : (typeof geo.lat === 'number' ? geo.lat : null);
    const lon = manual ? a.loc.lon : (typeof geo.lon === 'number' ? geo.lon : null);
    const located = Number.isFinite(lat) && Number.isFinite(lon);
    nodes.push({
      tag: a.tag, name: a.name || a.host, host: a.host, online: !!a.online,
      lat, lon,
      country: geo.country || null, countryCode: geo.countryCode || null,
      city: geo.city || null, flag: geo.flag || null,
      located, manual: !!manual,
      reason: located ? null : (isPrivateIp(ip) ? 'IP privado/interno — posicione manualmente pelo ⚙' : 'GeoIP indisponível — posicione manualmente pelo ⚙'),
    });
  }
  return nodes;
}

// ----- Reputação do IP: DNSBLs (grátis, sem chave) + AbuseIPDB opcional -----
const DNSBL_ZONES = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'bl.spamcop.net', name: 'SpamCop' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda' },
  { zone: 'dnsbl.dronebl.org', name: 'DroneBL' },
  { zone: 'all.s5h.net', name: 's5h.net' },
];
const rejectAfter = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
function reverseIp(ip) { const p = String(ip).split('.'); return p.length === 4 && p.every((n) => n !== '') ? p.reverse().join('.') : null; }

async function checkDnsbl(ip) {
  const rev = reverseIp(ip);
  if (!rev) return []; // IPv6/DNSBL não suportado aqui
  return Promise.all(DNSBL_ZONES.map(async (z) => {
    try {
      const a = await Promise.race([dns.resolve4(`${rev}.${z.zone}`), rejectAfter(3500)]);
      return { name: z.name, listed: Array.isArray(a) && a.length > 0, codes: Array.isArray(a) ? a : [] };
    } catch (e) {
      // NXDOMAIN/ENODATA = realmente não listado; outros erros = indeterminado (resolver bloqueado, timeout)
      if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) return { name: z.name, listed: false };
      return { name: z.name, listed: false, unknown: true };
    }
  }));
}

async function checkAbuseIpdb(ip) {
  const key = db.getConfig().abuseipdbKey;
  if (!key) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`, {
      headers: { Key: key, Accept: 'application/json' }, signal: controller.signal,
    });
    if (!r.ok) return { error: `AbuseIPDB HTTP ${r.status}` };
    const j = await r.json(); const d = j.data || {};
    return {
      score: d.abuseConfidenceScore, totalReports: d.totalReports, lastReportedAt: d.lastReportedAt,
      countryCode: d.countryCode, isp: d.isp, domain: d.domain, usageType: d.usageType,
      isTor: d.isTor, isWhitelisted: d.isWhitelisted, numDistinctUsers: d.numDistinctUsers,
    };
  } catch (e) { return { error: e.name === 'AbortError' ? 'timeout' : (e.message || 'erro') }; }
  finally { clearTimeout(t); }
}

function internalRep(ip, allowedTags = null) {
  const rows = db.attemptsForIp(ip).filter((r) => !Array.isArray(allowedTags) || allowedTags.includes(r.agent));
  const ssh = rows.filter((r) => (r.kind || 'ssh') === 'ssh');
  const web = rows.filter((r) => r.kind === 'web');
  const agents = [...new Set(rows.map((r) => r.agent).filter(Boolean))];
  const ts = rows.map((r) => r.ts).filter(Boolean).sort();
  return {
    total: rows.length, ssh: ssh.length, web: web.length, agents,
    hits: web.filter((r) => r.hit).length, maxScore: web.reduce((m, r) => Math.max(m, r.score || 0), 0),
    first: ts[0] || null, last: ts[ts.length - 1] || null,
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// ----- WHOIS via RDAP (JSON, sem whois binário) -----
// Extrai os campos de um vcardArray (["vcard", [ ["fn",{},"text","..."], ... ]]).
function vcardMap(vcardArray) {
  const out = {};
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return out;
  for (const entry of vcardArray[1]) {
    if (!Array.isArray(entry)) continue;
    const key = entry[0];
    const val = entry[3];
    if (key && val != null && out[key] === undefined) out[key] = val;
  }
  return out;
}
// Percorre entidades (recursivo) e junta contatos com papel, nome e e-mail.
function collectContacts(entities, acc = []) {
  if (!Array.isArray(entities)) return acc;
  for (const e of entities) {
    const vc = vcardMap(e.vcardArray);
    acc.push({
      handle: e.handle || null,
      roles: Array.isArray(e.roles) ? e.roles : [],
      name: vc.fn || null,
      email: vc.email || null,
    });
    if (Array.isArray(e.entities)) collectContacts(e.entities, acc);
  }
  return acc;
}
// Extrai os campos úteis de uma resposta RDAP (JSON).
function parseRdap(j) {
  const contacts = collectContacts(j.entities);
  const abuse = contacts.find((c) => c.roles.includes('abuse') && c.email)
    || contacts.find((c) => c.email && /abuse/i.test(c.handle || ''));
  const registrant = contacts.find((c) => c.roles.includes('registrant'))
    || contacts.find((c) => c.roles.includes('administrative'));
  let range = null;
  if (j.startAddress && j.endAddress) range = `${j.startAddress} – ${j.endAddress}`;
  else if (Array.isArray(j.cidr0_cidrs) && j.cidr0_cidrs[0]) {
    const c = j.cidr0_cidrs[0];
    const pfx = c.v4prefix || c.v6prefix;
    if (pfx) range = `${pfx}/${c.length}`;
  }
  const rir = String(j.port43 || '').replace(/^whois\./, '').split('.')[0].toUpperCase() || null;
  return {
    network: { name: j.name || null, handle: j.handle || null, type: j.type || null, range, country: j.country || null },
    abuseEmail: abuse ? abuse.email : null,
    registrant: registrant ? (registrant.name || registrant.handle) : null,
    contacts: contacts.filter((c) => c.email || c.name).slice(0, 8),
    rir,
  };
}

// Uma tentativa de RDAP contra um endpoint, com timeout próprio.
async function rdapTry(url, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/rdap+json, application/json' },
      signal: controller.signal, redirect: 'follow',
    });
    if (!r.ok) return { error: `RDAP HTTP ${r.status}` };
    const j = await r.json();
    return { ok: parseRdap(j) };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : (e.message || 'erro de rede') };
  } finally {
    clearTimeout(timer);
  }
}

// WHOIS via RDAP com FALLBACK entre vários endpoints (rdap.org e bootstraps dos RIRs).
// Assim uma indisponibilidade/rate-limit de um provedor não derruba a consulta.
async function fetchRdap(ip) {
  if (isPrivateIp(ip)) return { error: 'IP privado/reservado (sem WHOIS)' };
  const enc = encodeURIComponent(ip);
  const endpoints = [
    `https://rdap.org/ip/${enc}`,
    `https://rdap-bootstrap.arin.net/bootstrap/ip/${enc}`,
    `https://rdap.arin.net/registry/ip/${enc}`,
    `https://rdap.db.ripe.net/ip/${enc}`,
  ];
  let lastErr = 'WHOIS indisponível';
  for (const url of endpoints) {
    const res = await rdapTry(url);
    if (res.ok) return res.ok;
    lastErr = res.error || lastErr;
  }
  return { error: `RDAP falhou (${lastErr})` };
}

export function createApi({ broadcast = () => {}, onAgentAdded = () => {}, autoblock = {} }) {
  // CORS, token e disponibilidade do auto-bloqueio são lidos AO VIVO da config
  // (db.getConfig), então mudanças feitas na interface valem sem reiniciar.
  const token = () => db.getConfig().ingestToken;
  geoTtlDays = db.getConfig().geoTtlDays || 30; // sincroniza validade do cache com a config
  const abFeature = {
    get available() { return db.getConfig().autoblockAvailable !== false; },
    sessionCount: typeof autoblock.sessionCount === 'function' ? autoblock.sessionCount : () => 0,
    resetSession: typeof autoblock.resetSession === 'function' ? autoblock.resetSession : () => {},
  };
  const app = express();
  app.disable('x-powered-by');
  // Atrás de um proxy reverso (pluggedninja), confie no 1º hop p/ obter o IP real
  // (necessário para rate-limit e para desligar o bypass de admin-localhost).
  const trustingProxy = () => process.env.TRUST_PROXY === '1' || !!db.getConfig().trustProxy;
  if (trustingProxy()) app.set('trust proxy', 1);
  app.use(cors({ origin: (origin, cb) => { const o = db.getConfig().corsOrigin || '*'; cb(null, o === '*' ? true : o); } }));
  app.use(express.json({ limit: '8mb' }));
  // Cabeçalhos de segurança básicos (sem depender de libs externas).
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  // ===== Rate limit simples em memória (por IP + balde) =======================
  const rlHits = new Map();
  function rateLimit(req, bucket, max, windowMs) {
    const key = bucket + ':' + (req.ip || 'unknown');
    const now = Date.now();
    let e = rlHits.get(key);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; rlHits.set(key, e); }
    e.count++;
    return e.count <= max;
  }
  const rlTimer = setInterval(() => { const now = Date.now(); for (const [k, e] of rlHits) if (now > e.reset) rlHits.delete(k); }, 60000);
  if (rlTimer.unref) rlTimer.unref();

  // ===== Autenticação por token de conta + escopo multi-tenant ================
  function isLoopback(req) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
  function bearer(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) return String(m[1]).trim();
    // ?token= só é aceito em GET (downloads pelo navegador, que não mandam header).
    // Nunca em POST/DELETE — evita token na URL de ações que mudam estado (vaza em logs).
    const qTok = req.method === 'GET' ? req.query.token : '';
    return String(req.headers['x-account-token'] || qTok || '').trim();
  }
  // Resolve o usuário da requisição (token de conta; ou admin-localhost em uso local).
  function authOf(req) {
    const tok = bearer(req);
    const u = tok ? db.findUserByToken(tok) : null;
    if (u) return u;
    // Conveniência LOCAL: sem proxy, conexões de loopback agem como admin.
    // Atrás de um proxy (TRUST_PROXY), isso é DESATIVADO — exige token de admin.
    if (!trustingProxy() && db.getConfig().localhostAdmin !== false && isLoopback(req)) {
      return db.seedAdmin().admin;
    }
    return null;
  }
  // Tags de sensores que o requester pode ver. Admin: todos (ou ?tenant=<id>).
  // Retorna null = SEM restrição (admin vê tudo); array = restrito a essas tags.
  function scopeTagsFor(req) {
    const u = req.user;
    if (u && u.role === 'admin') {
      const t = req.query.tenant || req.query.owner;
      return t ? db.tagsForOwner(String(t)) : null;
    }
    return db.tagsForOwner(u.id);
  }
  // Rotas públicas (sem token). O resto de /api/* exige conta aprovada.
  function isPublicPath(p) {
    if (p === '/api/health') return true;
    if (p === '/api/public-info') return true;
    if (p === '/api/blocklist') return true;
    if (p === '/api/lookup' || p.startsWith('/api/lookup/')) return true;
    if (p.startsWith('/api/public/')) return true;
    // O agente puxa seu próprio código-fonte daqui usando o INGEST_TOKEN
    // (autenticação própria, na rota). Não pode exigir token de conta.
    if (p === '/api/agent-source') return true;
    return false;
  }
  // Guard de admin usável dentro de um handler (a gate já populou req.user).
  const adminOnly = (req, res) => {
    if (!req.user || req.user.role !== 'admin') { res.status(403).json({ error: 'ação restrita ao admin' }); return false; }
    return true;
  };
  // Agentes que o requester pode acionar (bloquear/desbloquear): só os seus (admin: todos/tenant).
  const scopedAgents = (req) => {
    const all = db.listAgents();
    return Array.isArray(req.scopeTags) ? all.filter((a) => req.scopeTags.includes(a.name || a.host)) : all;
  };
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (isPublicPath(req.path)) return next();
    const u = authOf(req);
    if (!u) return res.status(401).json({ error: 'token de conta ausente ou inválido' });
    req.user = u;
    req.scopeTags = scopeTagsFor(req); // null = admin vê tudo; array = restrito
    next();
  });

  // parse de filtros vindos da query string (com escopo multi-tenant embutido).
  const parseQ = (req) => {
    const q = { ...req.query };
    delete q.agents; // nunca confie num ?agents forjado pelo cliente
    if (typeof q.ips === 'string') q.ips = q.ips.split(',').filter(Boolean);
    if (Array.isArray(req.scopeTags)) q.agents = req.scopeTags; // restringe aos sensores do tenant
    return q;
  };

  // Capturas de um IP, já restritas aos sensores do tenant (admin vê todas).
  const scopedAttemptsForIp = (req, ip) => {
    const rows = db.attemptsForIp(ip);
    return Array.isArray(req.scopeTags) ? rows.filter((a) => req.scopeTags.includes(a.agent)) : rows;
  };
  // Busca um agente garantindo que o requester possa gerenciá-lo (dono ou admin).
  // Em caso de erro já responde e retorna null (o handler deve dar `return`).
  const getOwnedAgent = (req, res) => {
    const entry = db.getAgent(req.params.id);
    if (!entry) { res.status(404).json({ error: 'agente não registrado' }); return null; }
    if (req.user.role !== 'admin' && entry.owner !== req.user.id) {
      res.status(403).json({ error: 'este sensor não pertence à sua conta' }); return null;
    }
    return entry;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // ----- gestão do cache de GeoIP (por faixa, persistido) -----
  app.get('/api/geo-cache', (_req, res) => {
    let withGeo = 0, empty = 0, oldest = Infinity, newest = 0; const now = Date.now();
    let stale = 0; const ttl = geoTtlDays * 86400000;
    const byCountry = new Map(); const byAsn = new Map();
    for (const v of geoNet.values()) {
      const has = typeof v.geo?.lat === 'number';
      if (has) withGeo++; else empty++;
      if (now - v.ts > (has ? ttl : GEO_FAIL_TTL)) stale++;
      if (v.ts < oldest) oldest = v.ts; if (v.ts > newest) newest = v.ts;
      if (!has) continue;
      const ck = v.geo.countryCode || v.geo.country || '—';
      const c = byCountry.get(ck) || { code: v.geo.countryCode || null, country: v.geo.country || '—', flag: v.geo.flag || null, ranges: 0 };
      c.ranges++; byCountry.set(ck, c);
      const ak = v.geo.asn ? ('AS' + v.geo.asn) : (v.geo.org || '—');
      const a = byAsn.get(ak) || { asn: v.geo.asn ? ('AS' + v.geo.asn) : null, org: v.geo.org || '—', flag: v.geo.flag || null, ranges: 0 };
      a.ranges++; byAsn.set(ak, a);
    }
    const topCountries = [...byCountry.values()].sort((a, b) => b.ranges - a.ranges).slice(0, 12);
    const topAsns = [...byAsn.values()].sort((a, b) => b.ranges - a.ranges).slice(0, 12);
    let fileSize = 0; try { fileSize = fs.statSync(GEO_CACHE_FILE).size; } catch {}
    res.json({
      ranges: geoNet.size, withGeo, empty, stale, ttlDays: geoTtlDays,
      file: GEO_CACHE_FILE, fileSize, geoDisabled: db.getConfig().geoipDisable,
      oldest: oldest === Infinity ? null : new Date(oldest).toISOString(),
      newest: newest ? new Date(newest).toISOString() : null,
      topCountries, topAsns,
    });
  });
  app.post('/api/geo-cache/ttl', (req, res) => {
    if (!adminOnly(req, res)) return;
    const d = Number(req.body?.days);
    if (!Number.isFinite(d) || d < 0 || d > 3650) return res.status(400).json({ error: 'days inválido (0-3650)' });
    geoTtlDays = d; scheduleGeoSave();
    res.json({ ok: true, ttlDays: geoTtlDays });
  });
  app.delete('/api/geo-cache', (req, res) => {
    if (!adminOnly(req, res)) return;
    const now = Date.now(); const ttl = geoTtlDays * 86400000; let removed = 0;
    if (req.query.failed === '1') { for (const [k, v] of geoNet) if (typeof v.geo?.lat !== 'number') { geoNet.delete(k); removed++; } }
    else if (req.query.stale === '1') { for (const [k, v] of geoNet) if (now - v.ts > (typeof v.geo?.lat === 'number' ? ttl : GEO_FAIL_TTL)) { geoNet.delete(k); removed++; } }
    else { removed = geoNet.size; geoNet.clear(); }
    scheduleGeoSave();
    res.json({ ok: true, removed, ranges: geoNet.size });
  });

  // DNS reverso (PTR) + GeoIP (país/ASN) de um IP de origem, com cache.
  app.get('/api/rdns/:ip', async (req, res) => {
    const ip = String(req.params.ip || '').trim();
    const cached = rdnsCache.get(ip);
    if (cached && (Date.now() - cached.ts) < RDNS_TTL) return res.json(cached.data);

    const [ptr, geo] = await Promise.all([
      dns.reverse(ip)
        .then((names) => ({ names, host: names[0] || null }))
        .catch((e) => ({ names: [], host: null, error: e.code || 'sem PTR' })),
      fetchGeo(ip),
    ]);
    const data = { ip, ...ptr, ...geo };
    rdnsCache.set(ip, { ts: Date.now(), data });
    res.json(data);
  });

  // WHOIS/RDAP de um IP: ASN, provedor, faixa de rede, RIR, e-mail de abuse e contatos.
  const whoisCache = new Map();
  const WHOIS_TTL = 12 * 60 * 60 * 1000; // 12h
  app.get('/api/whois/:ip', async (req, res) => {
    const ip = String(req.params.ip || '').trim();
    const cached = whoisCache.get(ip);
    if (cached && (Date.now() - cached.ts) < WHOIS_TTL) return res.json(cached.data);

    const [geo, rdap] = await Promise.all([fetchGeo(ip), fetchRdap(ip)]);
    // Sempre expõe o que o GeoIP trouxe (ASN/provedor/país), MESMO que o RDAP falhe.
    const data = {
      ip,
      asn: geo.asn || null,
      org: geo.org || null,
      city: geo.city || null,
      country: geo.country || (rdap.network && rdap.network.country) || null,
      countryCode: geo.countryCode || null,
      flag: geo.flag || null,
    };
    if (rdap && !rdap.error) {
      // RDAP ok: adiciona rede, abuse, registrante, contatos, RIR.
      Object.assign(data, rdap);
    } else {
      // RDAP falhou: nota suave (não apaga os dados de GeoIP acima).
      data.rdapNote = (rdap && rdap.error) || 'WHOIS/RDAP indisponível';
    }
    // Só é erro "duro" se não temos NADA útil (nem GeoIP, nem RDAP).
    const hasAny = data.asn || data.org || data.country || (data.network && data.network.name);
    if (!hasAny) data.error = data.rdapNote || 'sem dados de WHOIS para este IP';

    // Só cacheia resultados úteis — falha total pode ser transitória, permite retry.
    if (hasAny) whoisCache.set(ip, { ts: Date.now(), data });
    res.json(data);
  });

  // Geolocalização dos IPs atacantes para o MAPA DE AMEAÇAS (lat/lon + contagem).
  // Resolve só os N maiores IPs (respeitando os filtros), com cache e paralelismo limitado.
  app.get('/api/geo', async (req, res) => {
    const q = parseQ(req);
    const limit = Math.min(Number(q.limit) || 200, 600);
    const groups = db.mapGroups(q).slice(0, limit);
    const [out, agents] = await Promise.all([
      buildGeoPoints(groups, (g) => ({ agent: g.agent, attempts: g.attempts })),
      resolveAgentNodes(req.scopeTags),
    ]);
    res.json({ points: out, agents, geoDisabled: db.getConfig().geoipDisable, resolved: out.length, ips: groups.length });
  });

  // ================= ROTAS DO TRÁFEGO WEB (honeypot de logs) =================
  app.get('/api/web/stats', (req, res) => res.json(db.webStats(parseQ(req))));
  app.get('/api/web/grouped', (req, res) => res.json(db.webGroupedByIp(parseQ(req))));
  app.get('/api/web/attempts', (req, res) => res.json(db.listAttempts({ ...parseQ(req), kind: 'web' })));
  app.get('/api/web/events', (req, res) => res.json({ events: db.webEvents(parseQ(req)) }));
  app.get('/api/web/ip/:ip', (req, res) => res.json(scopedAttemptsForIp(req, req.params.ip).filter((a) => a.kind === 'web')));

  // Geo do MAPA WEB: carrega score/categoria/hits por IP para colorir os arcos.
  app.get('/api/web/geo', async (req, res) => {
    const q = parseQ(req);
    const limit = Math.min(Number(q.limit) || 200, 600);
    const groups = db.webMapGroups(q).slice(0, limit);
    const [out, agents] = await Promise.all([
      buildGeoPoints(groups, (g) => ({
        agent: g.agent, requests: g.requests, attempts: g.requests, maxScore: g.maxScore,
        hits: g.hits, bot: g.bot, category: g.category, categoryLabel: g.categoryLabel, paths: g.paths, ua: g.ua,
      })),
      resolveAgentNodes(req.scopeTags),
    ]);
    res.json({ points: out, agents, geoDisabled: db.getConfig().geoipDisable, resolved: out.length, ips: groups.length });
  });

  app.get('/api/web/export', (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const { rows } = db.listAttempts({ ...parseQ(req), kind: 'web', limit: 50000 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="webhoney-${stamp}.csv"`);
      return res.send(toCsv(rows));
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="webhoney-${stamp}.json"`);
    res.send(JSON.stringify(rows, null, 2));
  });

  // Reputação do IP: blocklists públicas (sem chave) + AbuseIPDB (se ABUSEIPDB_KEY) + histórico interno.
  const repCache = new Map(); const REP_TTL = 30 * 60 * 1000;
  app.get('/api/reputation/:ip', async (req, res) => {
    const ip = String(req.params.ip || '').trim();
    const cached = repCache.get(ip);
    if (cached && (Date.now() - cached.ts) < REP_TTL) return res.json({ ...cached.data, internal: internalRep(ip, req.scopeTags) });
    if (isPrivateIp(ip)) {
      return res.json({ ip, private: true, dnsbl: [], listedCount: 0, abuseConfigured: !!db.getConfig().abuseipdbKey, internal: internalRep(ip, req.scopeTags) });
    }
    const [dnsbl, abuseipdb] = await Promise.all([checkDnsbl(ip), checkAbuseIpdb(ip)]);
    const data = { ip, dnsbl, listedCount: dnsbl.filter((d) => d.listed).length, abuseipdb, abuseConfigured: !!db.getConfig().abuseipdbKey };
    repCache.set(ip, { ts: Date.now(), data });
    res.json({ ...data, internal: internalRep(ip, req.scopeTags) });
  });

  // Reporta o IP diretamente na API v2 do AbuseIPDB (exige ABUSEIPDB_KEY no server/.env).
  // Limite do serviço: 1 report do mesmo IP a cada 15 min por conta; comment máx ~1024 chars (sem PII).
  app.post('/api/report/abuseipdb', async (req, res) => {
    const { ip, categories, comment, timestamp } = req.body || {};
    if (!ip || isPrivateIp(String(ip))) return res.json({ ok: false, error: 'IP inválido ou privado' });
    const key = db.getConfig().abuseipdbKey;
    if (!key) return res.json({ ok: false, error: 'ABUSEIPDB_KEY não configurada no server/.env', noKey: true });
    const cats = (Array.isArray(categories) ? categories : String(categories || '').split(','))
      .map((c) => Number(c)).filter((c) => c >= 1 && c <= 23);
    if (!cats.length) return res.json({ ok: false, error: 'categorias inválidas' });
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const body = new URLSearchParams({ ip: String(ip), categories: cats.join(','), comment: String(comment || '').slice(0, 1024) });
      if (timestamp) body.set('timestamp', new Date(timestamp).toISOString());
      const r = await fetch('https://api.abuseipdb.com/api/v2/report', {
        method: 'POST', headers: { Key: key, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(), signal: controller.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = j && j.errors && j.errors[0] && j.errors[0].detail;
        return res.json({ ok: false, error: detail || `AbuseIPDB HTTP ${r.status}` });
      }
      repCache.delete(String(ip)); // invalida cache de reputação — o score pode mudar
      res.json({ ok: true, score: j.data ? j.data.abuseConfidenceScore : null });
    } catch (e) {
      res.json({ ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'erro') });
    } finally { clearTimeout(t); }
  });

  // ================= ROTAS DO SENSOR DE REDE (tcpdump) =================
  app.get('/api/net/stats', (req, res) => res.json(db.netStats(parseQ(req))));
  app.get('/api/net/grouped', (req, res) => res.json(db.netGroupedByIp(parseQ(req))));
  app.get('/api/net/attempts', (req, res) => res.json(db.listAttempts({ ...parseQ(req), kind: 'net' })));
  app.get('/api/net/events', (req, res) => res.json({ events: db.netEvents(parseQ(req)) }));
  app.get('/api/net/ip/:ip', (req, res) => res.json(scopedAttemptsForIp(req, req.params.ip).filter((a) => a.kind === 'net')));
  app.get('/api/net/geo', async (req, res) => {
    const q = parseQ(req);
    const limit = Math.min(Number(q.limit) || 200, 600);
    const groups = db.netMapGroups(q).slice(0, limit);
    const [out, agents] = await Promise.all([
      buildGeoPoints(groups, (g) => ({ agent: g.agent, connections: g.connections, requests: g.connections, attempts: g.connections, maxScore: g.maxScore, scan: g.scan, hits: g.hits, ports: g.ports })),
      resolveAgentNodes(req.scopeTags),
    ]);
    res.json({ points: out, agents, geoDisabled: db.getConfig().geoipDisable, resolved: out.length, ips: groups.length });
  });
  app.get('/api/net/export', (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const { rows } = db.listAttempts({ ...parseQ(req), kind: 'net', limit: 50000 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="nethoney-${stamp}.csv"`); return res.send(toCsv(rows)); }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', `attachment; filename="nethoney-${stamp}.json"`); res.send(JSON.stringify(rows, null, 2));
  });

  // TOP PAÍSES de origem: agrega a geo dos maiores IPs por país (SSH ou WEB via ?kind).
  app.get('/api/countries', async (req, res) => {
    const q = parseQ(req);
    const groups = (q.kind === 'web' ? db.webGroupedByIp(q) : q.kind === 'net' ? db.netGroupedByIp(q) : db.groupedByIp(q)).slice(0, 250);
    const pts = await buildGeoPoints(groups, (g) => ({ n: g.attempts || g.requests || 0 }));
    const m = new Map();
    for (const p of pts) {
      const key = p.countryCode || p.country || '—';
      const g = m.get(key) || { country: p.country || '—', code: p.countryCode || null, flag: p.flag || null, value: 0, ips: 0 };
      g.value += p.n || 0; g.ips += 1; m.set(key, g);
    }
    const countries = Array.from(m.values()).sort((a, b) => b.value - a.value).slice(0, 12)
      .map((g) => ({ label: (g.flag ? g.flag + ' ' : '') + (g.country || '—'), country: g.country, flag: g.flag, code: g.code, value: g.value, ips: g.ips }));
    res.json({ countries, geoDisabled: db.getConfig().geoipDisable, resolved: pts.length });
  });

  app.get('/api/attempts', (req, res) => {
    res.json(db.listAttempts(parseQ(req)));
  });

  app.get('/api/grouped', (req, res) => {
    res.json(db.groupedByIp(parseQ(req)));
  });

  // Lista os agentes registrados (o tenant vê só os seus; admin vê todos ou de ?tenant).
  app.get('/api/agents', (req, res) => {
    const all = db.agentsView();
    res.json(Array.isArray(req.scopeTags) ? all.filter((a) => req.scopeTags.includes(a.tag)) : all);
  });

  // Registra um agente pelo IP/host. A central passa a buscar as capturas nele.
  app.post('/api/agents', async (req, res) => {
    const { host, port, name, owner } = req.body || {};
    if (!host || !String(host).trim()) return res.status(400).json({ error: 'informe o host/IP do agente' });
    // ANTI-SSRF: tenant (não-admin) não pode apontar o coletor para rede interna/
    // loopback/metadata — senão a central entregaria o token de coleta a esse host.
    // O admin (você) continua podendo registrar sensores em IPs internos da sua rede.
    if (req.user.role !== 'admin' && await hostIsInternal(host)) {
      return res.status(400).json({ error: 'host inválido: use o IP público do seu servidor (endereços privados/loopback/metadata não são permitidos)' });
    }
    // não-admin: o sensor nasce vinculado à PRÓPRIA conta. admin: pode indicar o tenant (owner) ou deixar sem dono.
    const ownerId = req.user.role === 'admin' ? (owner || null) : req.user.id;
    const entry = db.addAgent({ host, port, name, owner: ownerId });
    if (!entry) return res.status(400).json({ error: 'host inválido' });
    onAgentAdded(entry); // dispara uma coleta imediata
    res.json({ ok: true, agent: entry });
  });

  // Remove um agente do registro (só o dono ou admin).
  app.delete('/api/agents/:id', (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    db.removeAgent(req.params.id);
    res.json({ ok: true });
  });

  // ----- configuração remota do agente (proxy autenticado central -> agente) -----
  async function agentFetch(entry, pathname, { method = 'GET', body } = {}, ms = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(`http://${entry.host}:${entry.port}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout ao falar com o agente' : (e.message || 'erro de rede') };
    } finally { clearTimeout(timer); }
  }

  // Estado atual do agente (modo, logs em uso, o que está rodando). Cai para a
  // última config conhecida se o agente estiver offline.
  app.get('/api/agents/:id/config', async (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    const r = await agentFetch(entry, '/agent/config');
    if (r.ok) return res.json({ online: true, ...r.json });
    res.json({ online: false, error: r.error || `agente respondeu ${r.status}`, stored: entry.config || null,
      mode: entry.config?.mode || null, webLogs: entry.config?.webLogs || '', webIgnore: entry.config?.webIgnore || '' });
  });

  // Aplica config no agente (ao vivo) e guarda como última desejada.
  app.post('/api/agents/:id/config', async (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    const { mode, webLogs, webIgnore, netIface, netFilter, netIgnore } = req.body || {};
    const modeOk = (m) => String(m).split(/[,+\s]+/).every((x) => ['ssh', 'web', 'net', 'both', 'all', ''].includes(String(x).toLowerCase()));
    if (mode !== undefined && !modeOk(mode)) return res.status(400).json({ error: 'modo inválido' });
    const r = await agentFetch(entry, '/agent/config', { method: 'POST', body: { mode, webLogs, webIgnore, netIface, netFilter, netIgnore } });
    if (!r.ok) return res.status(502).json({ error: r.error || `agente respondeu ${r.status}`, online: false });
    db.setAgentConfig(entry.id, { mode: r.json.mode, webLogs: r.json.webLogs, webIgnore: r.json.webIgnore });
    res.json({ ok: true, online: true, ...r.json });
  });

  // Posição manual do agente no mapa (o usuário clica no mini-mapa).
  app.post('/api/agents/:id/location', (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    const { lat, lon, clear } = req.body || {};
    if (clear) return res.json({ ok: true, loc: db.setAgentLocation(entry.id, null) });
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      return res.status(400).json({ error: 'lat/lon inválidos' });
    }
    res.json({ ok: true, loc: db.setAgentLocation(entry.id, { lat: la, lon: lo }) });
  });

  // Bloqueia um IP no ufw de UM agente.
  app.post('/api/agents/:id/block', async (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    if (db.isAllowlisted(req.body?.ip)) return res.status(409).json({ error: 'IP está na allowlist (protegido) — não foi bloqueado', allowlisted: true });
    const r = await agentFetch(entry, '/agent/block', { method: 'POST', body: { ip: req.body?.ip, ports: req.body?.ports } }, 12000);
    if (!r.ok) return res.status(502).json({ error: r.error || `agente respondeu ${r.status}` });
    res.json({ agent: entry.name || entry.host, ...r.json });
  });

  // Bloqueia um IP em VÁRIOS agentes (tags = nomes/hosts; sem tags = todos).
  app.post('/api/block', async (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (db.isAllowlisted(ip)) return res.status(409).json({ ip, error: 'IP está na allowlist (protegido) — não foi bloqueado', allowlisted: true });
    const ports = Array.isArray(req.body?.ports) ? req.body.ports : null;
    const tags = Array.isArray(req.body?.tags) && req.body.tags.length ? req.body.tags : null;
    const list = scopedAgents(req).filter((a) => !tags || tags.includes(a.name || a.host));
    const results = await Promise.all(list.map(async (a) => {
      const r = await agentFetch(a, '/agent/block', { method: 'POST', body: { ip, ports } }, 12000);
      return {
        agent: a.name || a.host, id: a.id,
        ok: !!(r.ok && r.json && r.json.ok),
        method: r.json && r.json.method || null,
        ports: r.json && r.json.ports || null,
        note: r.json && r.json.note || null,
        error: r.error || (r.json && r.json.error) || null,
      };
    }));
    res.json({ ip, results });
  });

  // Política de auto-bloqueio (persistida).
  const AUTOBLOCK_DEFAULT = { enabled: false, sshAttempts: 100, blockScanners: true, blockWebHits: true, scope: 'all', allowlist: [] };
  const parseAllow = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
  const abPayload = () => ({
    ...AUTOBLOCK_DEFAULT,
    ...(db.getSettings().autoblock || {}),
    available: abFeature.available,
    sessionBlocked: abFeature.sessionCount(),
  });
  app.get('/api/autoblock', (_req, res) => res.json(abPayload()));
  // Zera a memória de auto-bloqueio da sessão (permite rebloquear IPs já processados).
  app.post('/api/autoblock/reset', (req, res) => { if (!adminOnly(req, res)) return; abFeature.resetSession(); res.json({ ok: true, ...abPayload() }); });
  app.post('/api/autoblock', (req, res) => {
    if (!adminOnly(req, res)) return;
    if (!abFeature.available) return res.status(403).json({ error: 'auto-bloqueio desativado nesta instalação (DISABLE_AUTOBLOCK=1)' });
    const b = req.body || {};
    const cur = { ...AUTOBLOCK_DEFAULT, ...(db.getSettings().autoblock || {}) };
    const next = {
      enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
      sshAttempts: b.sshAttempts !== undefined ? Math.max(0, Number(b.sshAttempts) || 0) : cur.sshAttempts,
      blockScanners: b.blockScanners !== undefined ? !!b.blockScanners : cur.blockScanners,
      blockWebHits: b.blockWebHits !== undefined ? !!b.blockWebHits : cur.blockWebHits,
      scope: b.scope === 'hit' ? 'hit' : 'all',
      allowlist: b.allowlist !== undefined ? parseAllow(b.allowlist) : (cur.allowlist || []),
    };
    db.setSettings({ autoblock: next });
    res.json({ ok: true, ...abPayload() });
  });

  // IPs bloqueados + estado do firewall em cada agente (ufw ativo? qual mecanismo aplica?).
  app.get('/api/blocked', async (req, res) => {
    const per = await Promise.all(scopedAgents(req).map(async (a) => {
      const r = await agentFetch(a, '/agent/blocked', {}, 10000);
      const j = r.json || {};
      return {
        agent: a.name || a.host, id: a.id, online: r.ok,
        blocked: (r.ok && j.blocked) || [],
        firewall: r.ok ? (j.firewall || null) : null,   // 'ufw' | 'ufw-inativo→iptables' | 'iptables'
        ufwActive: r.ok ? !!j.ufwActive : null,           // true/false/null(offline)
        error: r.error || j.error || null,
      };
    }));
    res.json({ agents: per });
  });

  // Desbloqueia um IP em VÁRIOS agentes (tags = nomes/hosts; sem tags = todos).
  app.post('/api/unblock', async (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    const ports = Array.isArray(req.body?.ports) ? req.body.ports : null;
    const tags = Array.isArray(req.body?.tags) && req.body.tags.length ? req.body.tags : null;
    const list = scopedAgents(req).filter((a) => !tags || tags.includes(a.name || a.host));
    const results = await Promise.all(list.map(async (a) => {
      const r = await agentFetch(a, '/agent/unblock', { method: 'POST', body: { ip, ports } }, 12000);
      return { agent: a.name || a.host, id: a.id, ok: !!(r.ok && r.json && r.json.ok), error: r.error || (r.json && r.json.error) || null };
    }));
    res.json({ ip, results });
  });

  // Descoberta de arquivos de log no servidor do agente (para a UI escolher).
  app.get('/api/agents/:id/logs', async (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    const r = await agentFetch(entry, '/agent/logs');
    if (!r.ok) return res.status(502).json({ error: r.error || `agente respondeu ${r.status}`, logs: [] });
    res.json(r.json);
  });

  // ----- auto-update: código-fonte do agente (o agente puxa daqui) -----
  app.get('/api/agent-source', (req, res) => {
    const h = req.headers.authorization || '';
    if (h.replace(/^Bearer\s+/i, '').trim() !== token()) return res.status(401).json({ error: 'token inválido' });
    res.json({ version: agentVersion(), files: agentSourceFiles() });
  });

  // Força a atualização de um agente agora (a central empurra o código novo).
  app.post('/api/agents/:id/update', async (req, res) => {
    const entry = getOwnedAgent(req, res);
    if (!entry) return;
    const r = await agentFetch(entry, '/agent/update', { method: 'POST', body: { version: agentVersion(), files: agentSourceFiles() } }, 15000);
    if (!r.ok) return res.status(502).json({ error: r.error || `agente respondeu ${r.status}` });
    res.json({ ok: true, ...r.json });
  });

  // ===== Configuração da central (antes ficava no .env; agora vem da interface) =====
  const BOOT_PORT = db.getConfig().apiPort; // porta em que a central subiu de fato
  app.get('/api/config', (req, res) => {
    if (!adminOnly(req, res)) return; // expõe o ingestToken — só admin
    res.json({ ...db.getConfig(), bootPort: BOOT_PORT });
  });
  app.post('/api/config', (req, res) => {
    if (!adminOnly(req, res)) return;
    const before = db.getConfig();
    const c = db.setConfig(req.body || {});
    if (Number.isFinite(c.geoTtlDays)) { geoTtlDays = c.geoTtlDays; scheduleGeoSave(); }
    res.json({ ok: true, ...c, bootPort: BOOT_PORT, restartNeeded: c.apiPort !== BOOT_PORT });
  });

  // ===== Consulta PÚBLICA de reputação de IP (para ferramentas externas) ========
  // Read-only, sem token. PRIVACIDADE: expõe APENAS ip, razão e data de adesão à
  // lista — NUNCA o nome do sensor que capturou, nem credenciais.
  //   GET  /api/lookup/1.2.3.4          -> reputação de um IP
  //   POST /api/lookup { "ips": [...] } -> lote (até 200)
  //   GET  /api/blocklist?format=txt    -> lista de IPs (feed de ameaças)
  const publicCors = (res) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Cache-Control', 'public, max-age=60'); };
  app.get('/api/lookup/:ip', (req, res) => {
    publicCors(res);
    if (!rateLimit(req, 'lookup', 120, 60000)) return res.status(429).json({ error: 'muitas consultas — tente em 1 min' });
    res.json(db.publicLookup(req.params.ip));
  });
  app.post('/api/lookup', (req, res) => {
    publicCors(res);
    if (!rateLimit(req, 'lookup', 60, 60000)) return res.status(429).json({ error: 'muitas consultas — tente em 1 min' });
    const ips = Array.isArray(req.body?.ips) ? req.body.ips.slice(0, 200) : [];
    res.json({ results: ips.map((ip) => db.publicLookup(ip)) });
  });
  app.get('/api/blocklist', (req, res) => {
    publicCors(res);
    if (!rateLimit(req, 'blocklist', 60, 60000)) return res.status(429).json({ error: 'muitas consultas — tente em 1 min' });
    const feed = db.publicThreatFeed({
      since: req.query.since || null,
      minEvents: Math.max(1, Number(req.query.minEvents) || 1),
      limit: Math.min(50000, Number(req.query.limit) || 5000),
    });
    if (String(req.query.format).toLowerCase() === 'txt') {
      res.type('text/plain').send(feed.map((e) => e.ip).join('\n') + (feed.length ? '\n' : ''));
    } else {
      res.json({ count: feed.length, generated: new Date().toISOString(), source: 'pluggedninja-threatscope', threats: feed });
    }
  });

  // ===== Endpoints PÚBLICOS da landing (cadastro, remoção, info) ================
  // Cadastro: cria conta PENDENTE (o admin aprova e gera o token de download).
  app.post('/api/public/register', (req, res) => {
    if (!rateLimit(req, 'register', 5, 60 * 60000)) return res.status(429).json({ error: 'muitas solicitações — tente mais tarde' });
    const r = db.registerUser({ name: req.body?.name, email: req.body?.email });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: r.status || 'pending', message: 'Cadastro recebido. Após a aprovação do admin você poderá baixar os sensores.' });
  });
  // Dono de IP pede remoção da lista (após corrigir o problema).
  app.post('/api/public/removal', (req, res) => {
    if (!rateLimit(req, 'removal', 5, 60 * 60000)) return res.status(429).json({ error: 'muitas solicitações — tente mais tarde' });
    const r = db.createRemovalRequest({ ip: req.body?.ip, email: req.body?.email, message: req.body?.message });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, id: r.id, message: 'Pedido de remoção recebido. Vamos revisar e retornar por e-mail.' });
  });
  // Números agregados e seguros para a landing (sem nada sensível).
  app.get('/api/public-info', (_req, res) => {
    const feed = db.publicThreatFeed({ limit: 50000 });
    res.json({
      project: 'PluggedNinja ThreatScope',
      maliciousIps: feed.length,
      sensors: db.listAgents().length,
      agentVersion: agentVersion(),
      apiExample: '/api/blocklist?format=txt',
    });
  });

  // Info para o guia de instalação de agentes no dashboard.
  app.get('/api/manager-info', (_req, res) => {
    res.json({
      apiPort: db.getConfig().apiPort,
      tokenConfigured: !!token() && token() !== 'troque-este-token',
      bundleAvailable: agentBundleAvailable(),
      agentVersion: agentVersion(),
      autoblockAvailable: abFeature.available,
    });
  });

  // Download do agente empacotado (.zip), JÁ com .env preenchido (token embutido).
  // O agente sobe uma API em 0.0.0.0; depois é só registrar o IP dele na central.
  app.get('/api/agent-bundle', (req, res) => {
    if (!agentBundleAvailable()) {
      return res.status(404).json({ error: 'pasta agent/ não encontrada ao lado do server/' });
    }
    const agentId = typeof req.query.id === 'string' ? req.query.id : '';
    const agentPort = Number(req.query.port) || 4000;
    const rawMode = String(req.query.mode || 'ssh').toLowerCase();
    const modeOk = rawMode.split(/[,+\s]+/).every((x) => ['ssh', 'web', 'net', 'both', 'all', ''].includes(x));
    const mode = modeOk ? rawMode : 'ssh';

    let envFile, readme, filename;

    if (mode === 'ssh') {
      envFile = [
        '# Gerado automaticamente pela central THREATSCOPE — pronto para rodar.',
        `INGEST_TOKEN=${token()}`,
        `AGENT_ID=${agentId}`,
        `AGENT_PORT=${agentPort}`,
        'AGENT_MODE=ssh',
        'HONEYPOT_PORT=22',
        'BANNER=SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1',
        'MAX_AUTH_TRIES=6',
        'MAX_BUFFER=20000',
        '',
      ].join('\n');
      readme = [
        'THREATSCOPE — AGENTE DE CAMPO SSH (pré-configurado)',
        '===================================================',
        '',
        'Este pacote já vem com o .env preenchido (token embutido).',
        '',
        '1) Instale o Node.js 18+ neste servidor.',
        '2) Nesta pasta:  npm install    (o .npmrc incluso pula deps nativas opcionais)',
        '3) Suba:         sudo npm start   (sudo por causa da porta 22)',
        `4) Na central, adicione o IP deste servidor (porta ${agentPort}).`,
        '',
        `IMPORTANTE: libere a porta ${agentPort}/tcp no firewall para o IP da central.`,
      ].join('\n');
      filename = 'threatscope-agent-ssh.zip';
    } else {
      // modo WEB (ou both): monitora os logs de acesso do servidor web.
      envFile = [
        '# Gerado automaticamente pela central WEBHONEY — pronto para rodar.',
        `INGEST_TOKEN=${token()}`,
        `AGENT_ID=${agentId}`,
        `AGENT_PORT=${agentPort}`,
        `AGENT_MODE=${mode}`,
        '# Caminhos dos logs de acesso (auto-detecta nginx/apache/JSON). Separe por vírgula.',
        '# Deixe em branco para tentar os padrões comuns automaticamente.',
        'WEB_LOGS=',
        '# Ignore o próprio IP da central e ranges internos (CIDR/substring), separados por vírgula.',
        'WEB_IGNORE=127.0.0.1,::1',
        '# --- modo NET (sensor tcpdump; exige tcpdump + root) ---',
        'NET_IFACE=any',
        'NET_FILTER=',
        'NET_IGNORE=127.0.0.1,::1',
        'MAX_BUFFER=20000',
        /ssh|both|all/.test(mode) ? 'HONEYPOT_PORT=22\nBANNER=SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1' : '',
        '',
      ].join('\n');
      readme = [
        'WEBHONEY — AGENTE DE CAMPO WEB (pré-configurado)',
        '================================================',
        '',
        'Este agente MONITORA os logs de acesso do seu servidor web (nginx/apache),',
        'classifica cada requisição (scanner, RCE, SQLi, recon WP, etc.) e reporta',
        'à central — que mostra tudo num mapa-múndi ao vivo.',
        '',
        '1) Instale o Node.js 18+ neste servidor web.',
        '2) Ajuste o .env: aponte WEB_LOGS para o(s) access.log (ou deixe em branco',
        '   para autodetecção). O agente precisa de permissão de leitura nos logs',
        '   (rode com um usuário no grupo adm/www-data, ou via sudo).',
        '3) Nesta pasta:  npm install',
        '4) Suba:         npm start   (ou: sudo npm start, se os logs exigirem root)',
        `5) Na central, aba WEB, adicione o IP deste servidor (porta ${agentPort}).`,
        '',
        'Caminhos autodetectados quando WEB_LOGS está vazio:',
        '   /var/log/nginx/access.log     /var/log/apache2/access.log',
        '   /var/log/httpd/access_log     ./access.log',
        '',
        `IMPORTANTE: libere a porta ${agentPort}/tcp no firewall para o IP da central.`,
        'O agente só LÊ os logs — não altera nada no servidor.',
      ].join('\n');
      filename = 'webhoney-agent.zip';
    }

    const zip = buildAgentZip({ readme, envFile });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zip);
  });

  app.get('/api/ip/:ip', (req, res) => {
    res.json(scopedAttemptsForIp(req, req.params.ip));
  });

  app.get('/api/stats', (req, res) => {
    res.json(db.stats(parseQ(req)));
  });

  app.get('/api/export', (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const { rows } = db.listAttempts({ ...parseQ(req), limit: 50000 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="threatscope-${stamp}.csv"`);
      return res.send(toCsv(rows));
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="threatscope-${stamp}.json"`);
    res.send(JSON.stringify(rows, null, 2));
  });

  app.delete('/api/attempts', (req, res) => {
    if (!adminOnly(req, res)) return;
    db.clearAttempts();
    res.json({ ok: true });
  });

  // ===== Conta do usuário logado ==============================================
  app.get('/api/me', (req, res) => {
    res.json({ user: db.publicUser(req.user, { withToken: true }), isAdmin: req.user.role === 'admin' });
  });

  // ===== Painel do admin: contas, tenants, remoções, atribuição de sensores ===
  app.get('/api/admin/users', (req, res) => {
    if (!adminOnly(req, res)) return;
    res.json({ users: db.listUsers().map((u) => db.publicUser(u)) });
  });
  // Lista enxuta para o seletor de tenant (id + nome + nº de sensores).
  app.get('/api/admin/tenants', (req, res) => {
    if (!adminOnly(req, res)) return;
    res.json({ tenants: db.listUsers().filter((u) => u.approved).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, sensors: db.agentsForOwner(u.id).length })) });
  });
  app.post('/api/admin/users/:id/approve', (req, res) => {
    if (!adminOnly(req, res)) return;
    const u = db.approveUser(req.params.id);
    if (!u) return res.status(404).json({ error: 'conta não encontrada' });
    res.json({ ok: true, user: db.publicUser(u, { withToken: true }) });
  });
  app.post('/api/admin/users/:id/disable', (req, res) => {
    if (!adminOnly(req, res)) return;
    const u = db.setUserDisabled(req.params.id, req.body?.disabled !== false);
    if (!u) return res.status(404).json({ error: 'conta não encontrada' });
    res.json({ ok: true, user: db.publicUser(u) });
  });
  app.post('/api/admin/users/:id/regen-token', (req, res) => {
    if (!adminOnly(req, res)) return;
    const u = db.regenUserToken(req.params.id);
    if (!u) return res.status(404).json({ error: 'conta não encontrada' });
    res.json({ ok: true, user: db.publicUser(u, { withToken: true }) });
  });
  app.delete('/api/admin/users/:id', (req, res) => {
    if (!adminOnly(req, res)) return;
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'não é possível apagar a própria conta' });
    const ok = db.deleteUser(req.params.id);
    if (!ok) return res.status(400).json({ error: 'não foi possível remover (conta admin ou inexistente)' });
    res.json({ ok: true });
  });
  // Admin define qual TENANT enxerga um sensor (owner = id do usuário; vazio = sem dono).
  app.post('/api/admin/agents/:id/owner', (req, res) => {
    if (!adminOnly(req, res)) return;
    const owner = req.body?.owner ? String(req.body.owner) : null;
    if (owner && !db.findUserById(owner)) return res.status(400).json({ error: 'tenant inexistente' });
    const a = db.setAgentOwner(req.params.id, owner);
    if (!a) return res.status(404).json({ error: 'sensor não encontrado' });
    res.json({ ok: true, agent: a });
  });
  // Solicitações de remoção de IP: listar e resolver.
  app.get('/api/admin/removals', (req, res) => {
    if (!adminOnly(req, res)) return;
    res.json({ removals: db.listRemovalRequests(req.query.status || null) });
  });
  app.post('/api/admin/removals/:id/resolve', (req, res) => {
    if (!adminOnly(req, res)) return;
    const status = ['resolved', 'rejected', 'pending'].includes(req.body?.status) ? req.body.status : 'resolved';
    const r = db.resolveRemovalRequest(req.params.id, status);
    if (!r) return res.status(404).json({ error: 'solicitação não encontrada' });
    // Se resolvido e pediram purga, remove as capturas do IP (sai da blocklist).
    let purged = 0;
    if (status === 'resolved' && req.body?.purge) purged = db.purgeIp(r.ip);
    res.json({ ok: true, removal: r, purged });
  });

  return app;
}
