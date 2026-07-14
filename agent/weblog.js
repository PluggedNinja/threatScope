// Monitor de logs de acesso web para o AGENTE WEBHONEY.
// Formatos: combined/common (nginx/apache), JSON (Caddy/Traefik) e W3C Extended (IIS).
// Fontes: ARQUIVO, DIRETÓRIO (segue o .log mais novo — IIS) ou GLOB com '*'
//   (ex.: /var/www/*/logs/access.log — monitora os 100+ sites de uma vez).
// Cada requisição leva o SITE de origem: do header Host do log, ou do nome do
// diretório capturado pelo '*' (útil em layout /var/www/<site>/logs/access.log).
// Só LÊ os arquivos — nunca escreve nada.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATHS = [
  '/var/log/nginx/access.log',
  '/var/log/apache2/access.log',
  '/var/log/httpd/access_log',
  '/var/log/apache2/other_vhosts_access.log',
  './access.log',
  'C:/inetpub/logs/LogFiles/W3SVC1',
  'C:/inetpub/logs/LogFiles/W3SVC2',
  'C:/inetpub/logs/LogFiles',
];

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseClfDate(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/.exec(s || '');
  if (!m) return new Date().toISOString();
  const [, d, mon, y, hh, mm, ss, tz] = m;
  const month = MONTHS[mon] ?? 0;
  if (tz) {
    const sign = tz[0] === '-' ? -1 : 1;
    const offMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    return new Date(Date.UTC(+y, month, +d, +hh, +mm, +ss) - offMin * 60000).toISOString();
  }
  return new Date(Date.UTC(+y, month, +d, +hh, +mm, +ss)).toISOString();
}

const CLF = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\d+|-)(?:\s+"([^"]*)"\s+"([^"]*)")?/;
// vhost_combined do Apache: começa com o host antes do IP. Ex.: site.com:80 1.2.3.4 - - [..] "..."
const VHOST = /^(\S+?)(?::\d+)?\s+(\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+".*)$/;

function parseLine(line) {
  let raw = line.trim();
  if (!raw || raw[0] === '#') return null; // '#' = diretiva W3C (tratada no monitor)

  if (raw[0] === '{') {
    try {
      const j = JSON.parse(raw);
      const req = j.request || j;
      const ip = j.remote_ip || j.client_ip || j.remoteIP || (req && req.remote_ip) || j.ip || j.ClientAddr || '';
      const method = (req && (req.method || req.Method)) || j.method || 'GET';
      const uri = (req && (req.uri || req.URI || req.path)) || j.uri || j.path || j.request_uri || '/';
      const status = j.status || j.Status || (j.response && j.response.status) || (j.DownstreamStatus) || 0;
      const ua = (req && req.headers && (req.headers['User-Agent'] || req.headers['user-agent'])) || j.user_agent || j.http_user_agent || '';
      const host = (req && (req.host || req.Host)) || j.host || j.server_name || '';
      const referer = (req && req.headers && (req.headers.Referer || req.headers.referer)) || j.referer || '';
      const bytes = j.size || j.bytes || j.body_bytes_sent || (j.response && j.response.size) || 0;
      const ts = j.ts ? new Date(typeof j.ts === 'number' ? j.ts * 1000 : j.ts).toISOString()
        : (j.time || j.timestamp || j.StartUTC) ? new Date(j.time || j.timestamp || j.StartUTC).toISOString() : new Date().toISOString();
      if (!ip) return null;
      return { ts, ip: String(ip).replace(/:\d+$/, ''), wmethod: String(method).toUpperCase(), path: String(uri || '/'), status: Number(status) || 0, bytes: Number(bytes) || 0, ua: Array.isArray(ua) ? ua[0] : String(ua || ''), referer: String(referer || ''), host: String(host || '') };
    } catch { return null; }
  }

  // vhost_combined: extrai o host do começo e segue com o resto no CLF
  let vhost = '';
  const vm = VHOST.exec(raw);
  if (vm && /^[a-z0-9.-]+$/i.test(vm[1]) && vm[1].includes('.')) { vhost = vm[1]; raw = vm[2]; }

  const m = CLF.exec(raw);
  if (!m) return null;
  const [, ip, date, request, status, bytes, referer, ua] = m;
  const rp = request.split(/\s+/);
  return {
    ts: parseClfDate(date), ip, wmethod: (rp[0] || 'GET').toUpperCase(),
    path: rp[1] || (request.startsWith('/') ? request : '/'),
    status: Number(status) || 0, bytes: bytes === '-' ? 0 : Number(bytes) || 0,
    referer: referer && referer !== '-' ? referer : '', ua: ua || '', host: vhost,
  };
}

function parseW3C(fields, line) {
  const parts = line.trim().split(/\s+/);
  const get = (name) => { const i = fields.indexOf(name); return i >= 0 && i < parts.length ? parts[i] : ''; };
  const ip = get('c-ip');
  if (!ip || ip === '-') return null;
  const stem = get('cs-uri-stem') || '/';
  const query = get('cs-uri-query');
  let ua = get('cs(User-Agent)'); ua = ua && ua !== '-' ? ua.replace(/\+/g, ' ') : '';
  let referer = get('cs(Referer)'); referer = referer && referer !== '-' ? referer.replace(/\+/g, ' ') : '';
  const host = (() => { const h = get('cs-host'); return h && h !== '-' ? h : ''; })();
  const date = get('date'), tm = get('time');
  let ts;
  try { ts = date && tm ? new Date(`${date}T${tm}Z`).toISOString() : new Date().toISOString(); } catch { ts = new Date().toISOString(); }
  return {
    ts, ip, wmethod: (get('cs-method') || 'GET').toUpperCase(),
    path: stem + (query && query !== '-' ? (stem.includes('?') ? '&' : '?') + query : ''),
    status: Number(get('sc-status')) || 0, bytes: Number(get('sc-bytes')) || 0, referer, ua, host,
  };
}

function safeMtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFileOrDir(p) { try { const s = fs.statSync(p); return s.isFile() || s.isDirectory(); } catch { return false; } }
function joinp(base, name) { return base === '/' ? '/' + name : base.replace(/\/$/, '') + '/' + name; }

function newestLogInDir(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /\.log$/i.test(f))
      .map((f) => ({ p: path.join(dir, f), m: safeMtime(path.join(dir, f)) })).sort((a, b) => b.m - a.m);
    return files.length ? files[0].p : null;
  } catch { return null; }
}

// Nome do site a partir do caminho: .../<site>/logs/access.log -> <site>
function siteFromPath(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop(); // filename
  let d = parts.pop() || '';
  if (/^logs?$/i.test(d)) d = parts.pop() || d;
  return d;
}

// Expande um padrão com '*' em arquivos/dirs reais, capturando o que o '*' casou (para o site).
function expandGlobs(pattern) {
  const norm = String(pattern).replace(/\\/g, '/');
  const segs = norm.split('/');
  let cur;
  if (segs[0] === '') { cur = [{ path: '/', caps: [] }]; segs.shift(); }
  else if (/^[A-Za-z]:$/.test(segs[0])) { cur = [{ path: segs[0] + '/', caps: [] }]; segs.shift(); }
  else cur = [{ path: '.', caps: [] }];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]; if (seg === '') continue;
    const isLast = i === segs.length - 1;
    const next = [];
    for (const node of cur) {
      if (!seg.includes('*')) { next.push({ path: joinp(node.path, seg), caps: node.caps }); continue; }
      const rx = new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      let entries = []; try { entries = fs.readdirSync(node.path); } catch {}
      for (const name of entries) {
        if (!rx.test(name)) continue;
        const full = joinp(node.path, name);
        if (!isLast && !isDir(full)) continue;
        next.push({ path: full, caps: [...node.caps, name] });
      }
    }
    cur = next.length > 800 ? next.slice(0, 800) : next;
  }
  return cur.filter((n) => isFileOrDir(n.path))
    .map((n) => ({ file: n.path, site: n.caps.length ? n.caps.join('/') : siteFromPath(n.path) }));
}

// Resolve um padrão (glob, dir ou arquivo) em fontes concretas [{file, site}].
function expandAll(pattern) {
  if (pattern.includes('*')) return expandGlobs(pattern);
  if (isFileOrDir(pattern)) return [{ file: pattern, site: siteFromPath(pattern) }];
  return [];
}

function lastLineSample(p, max = 3072) {
  try {
    const size = fs.statSync(p).size;
    const start = Math.max(0, size - max);
    const fd = fs.openSync(p, 'r'); const len = size - start; const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').map((l) => l.trim()).filter((l) => l && l[0] !== '#');
    const last = lines[lines.length - 1] || '';
    return last.length > 180 ? last.slice(0, 179) + '…' : last;
  } catch { return ''; }
}

// Descoberta para a UI. Globs viram UMA linha-resumo com a contagem de matches.
export function discoverLogs(configured = '') {
  const list = (configured || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of Array.from(new Set([...list, ...DEFAULT_PATHS]))) {
    if (p.includes('*')) {
      const matches = expandGlobs(p);
      const first = matches[0] ? (isDir(matches[0].file) ? newestLogInDir(matches[0].file) : matches[0].file) : null;
      out.push({ path: p, isGlob: true, matches: matches.length, exists: matches.length > 0, readable: matches.length > 0,
        sample: first ? lastLineSample(first) : '', sites: matches.slice(0, 8).map((m) => m.site), configured: list.includes(p) });
      continue;
    }
    let exists = false, dir = false, file = false, readable = false, size = 0, sample = '', active = null;
    try { const st = fs.statSync(p); exists = true; dir = st.isDirectory(); file = st.isFile(); if (file) size = st.size; } catch {}
    if (dir) { active = newestLogInDir(p); if (active) { try { size = fs.statSync(active).size; } catch {} } }
    const target = dir ? active : p;
    if (target) { try { fs.accessSync(target, fs.constants.R_OK); readable = true; } catch {} }
    if (readable && size > 0 && target) sample = lastLineSample(target);
    out.push({ path: p, exists, isFile: file, isDir: dir, active, readable, size, sample, configured: list.includes(p) });
  }
  return out;
}

export function startWebLogMonitor({ logs = '', pollMs = 1000, onEntry, log = console.log } = {}) {
  let patterns = (logs || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!patterns.length) patterns = DEFAULT_PATHS;

  const initial = patterns.flatMap(expandAll);
  if (!initial.length) log(`\x1b[33m[!] Nenhum log casou com: ${patterns.join(', ')}. Ajuste WEB_LOGS.\x1b[0m`);
  else log(`\x1b[36m[WEBLOG]\x1b[0m Monitorando ${initial.length} fonte(s) de log: ${initial.slice(0, 6).map((s) => s.file).join(', ')}${initial.length > 6 ? ` ... (+${initial.length - 6})` : ''}`);

  const fileState = new Map(); // arquivo concreto -> { pos, rem, fields, isW3C, site }
  let booting = true;

  function readFile(fp, site) {
    let st = fileState.get(fp);
    if (!st) { st = { pos: booting ? (() => { try { return fs.statSync(fp).size; } catch { return 0; } })() : 0, rem: '', fields: null, isW3C: false, site }; fileState.set(fp, st); }
    st.site = site;
    let size; try { size = fs.statSync(fp).size; } catch { return; }
    if (size < st.pos) { st.pos = 0; st.rem = ''; log(`\x1b[36m[WEBLOG]\x1b[0m ${fp} rotacionou.`); }
    if (size === st.pos) return;
    let fd;
    try {
      fd = fs.openSync(fp, 'r'); const len = size - st.pos; const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.pos); st.pos = size;
      const lines = (st.rem + buf.toString('utf8')).split('\n'); st.rem = lines.pop();
      for (const line of lines) {
        const t = line.trim(); if (!t) continue;
        if (t[0] === '#') { const mf = /^#Fields:\s*(.+)$/i.exec(t); if (mf) { st.fields = mf[1].trim().split(/\s+/); st.isW3C = true; } continue; }
        const entry = (st.isW3C && st.fields) ? parseW3C(st.fields, t) : parseLine(t);
        if (entry && entry.ip) { entry.site = st.site || ''; try { onEntry(entry); } catch (e) { log('erro no onEntry:', e.message); } }
      }
    } catch (e) { log(`[!] erro lendo ${fp}: ${e.message}`); }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  }

  function tick() {
    const seen = new Set();
    for (const pattern of patterns) {
      for (const { file, site } of expandAll(pattern)) {
        const concrete = isDir(file) ? newestLogInDir(file) : file;
        if (!concrete || seen.has(concrete)) continue;
        seen.add(concrete);
        readFile(concrete, site);
      }
    }
    booting = false;
  }
  tick();
  const iv = setInterval(tick, pollMs);
  return { stop() { clearInterval(iv); }, files: initial.map((s) => s.file) };
}

export { parseLine, parseW3C, expandGlobs, siteFromPath };
export default { startWebLogMonitor, parseLine, parseW3C, discoverLogs };
