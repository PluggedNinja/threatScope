import 'dotenv/config';
import http from 'node:http';
import os from 'node:os';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { startHoneypot } from './honeypot.js';
import { startWebLogMonitor, discoverLogs } from './weblog.js';
import { classifyRequest, classifyConn } from './classify.js';
// netcap é importado sob demanda (dinâmico) para o agente NUNCA cair se o
// arquivo faltar por uma atualização parcial.
import { AGENT_VERSION } from './version.js';
import { applyUpdate, restart } from './updater.js';

const AUTO_UPDATE = process.env.AUTO_UPDATE === '1'; // auto-update DESLIGADO por padrao (seguranca): /agent/update grava+executa codigo. So habilite com AUTO_UPDATE=1 e a porta do agente liberada APENAS para o IP da central.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.AGENT_CONFIG || path.join(__dirname, 'agent-config.json');

const INGEST_TOKEN = process.env.INGEST_TOKEN || 'troque-este-token';
const AGENT_ID = process.env.AGENT_ID || os.hostname();
const AGENT_PORT = Number(process.env.AGENT_PORT || 4000);
const HONEYPOT_PORT = Number(process.env.HONEYPOT_PORT || 22);
const BANNER = process.env.BANNER || 'SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1';
const MAX_AUTH_TRIES = Number(process.env.MAX_AUTH_TRIES || 6);
const MAX_BUFFER = Number(process.env.MAX_BUFFER || 20000);
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP || 30);   // conexões SSH simultâneas por IP
const MAX_CONN_TOTAL = Number(process.env.MAX_CONN_TOTAL || 5000);   // conexões SSH simultâneas no total
// Sanitiza só a SAÍDA de log (remove ESC/ANSI e outros controles); o dado capturado fica intacto.
const safeLog = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '·');

// Configuração RUNTIME (persistida em agent-config.json). Defaults vêm do .env,
// mas o que a central manda pela interface é salvo aqui e ganha precedência.
// modo aceita: ssh | web | net | both(=ssh+web) | all(=ssh+web+net) ou combos "ssh,net".
function normalizeMode(m) {
  const s = String(m || 'ssh').toLowerCase();
  const set = new Set();
  if (s === 'both') { set.add('ssh'); set.add('web'); }
  else if (s === 'all') { set.add('ssh'); set.add('web'); set.add('net'); }
  else s.split(/[,+\s]+/).forEach((x) => { if (['ssh', 'web', 'net'].includes(x)) set.add(x); });
  if (!set.size) set.add('ssh');
  return set;
}
function validMode(m) { return normalizeMode(m).size > 0 && String(m).split(/[,+\s]+/).every((x) => ['ssh', 'web', 'net', 'both', 'all', ''].includes(String(x).toLowerCase())); }

function defaultConfig() {
  return {
    mode: (process.env.AGENT_MODE || 'ssh').toLowerCase(),
    webLogs: process.env.WEB_LOGS || '',
    webIgnore: process.env.WEB_IGNORE || '127.0.0.1,::1',
    netIface: process.env.NET_IFACE || 'any',
    netFilter: process.env.NET_FILTER || '',
    netIgnore: process.env.NET_IGNORE || '127.0.0.1,::1',
  };
}
function loadConfig() {
  const cfg = defaultConfig();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (saved && typeof saved === 'object') {
        if (typeof saved.mode === 'string' && validMode(saved.mode)) cfg.mode = saved.mode;
        for (const k of ['webLogs', 'webIgnore', 'netIface', 'netFilter', 'netIgnore']) if (typeof saved[k] === 'string') cfg[k] = saved[k];
      }
    }
  } catch (e) { console.warn('[cfg] não consegui ler', CONFIG_FILE, '-', e.message); }
  return cfg;
}
function saveConfig(cfg) {
  try {
    const tmp = CONFIG_FILE + '.tmp';
    const pick = (({ mode, webLogs, webIgnore, netIface, netFilter, netIgnore }) => ({ mode, webLogs, webIgnore, netIface, netFilter, netIgnore }))(cfg);
    fs.writeFileSync(tmp, JSON.stringify(pick, null, 2));
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) { console.error('[cfg] falha ao salvar:', e.message); }
}

let cfg = loadConfig();

console.log(`
\x1b[36m   +--[ THREATSCOPE - AGENTE DE CAMPO ]----------------------+\x1b[0m
     id        : ${AGENT_ID}   -   versao ${AGENT_VERSION}${AUTO_UPDATE ? '  (auto-update ON)' : ''}
     modo      : ${cfg.mode.toUpperCase()}   (configuravel pela central)
     API/coleta: 0.0.0.0:${AGENT_PORT}   (a central conecta e configura aqui)
\x1b[36m   +--------------------------------------------------------+\x1b[0m
`);
if (INGEST_TOKEN === 'troque-este-token') {
  console.warn('\x1b[33m[!] INGEST_TOKEN é o padrão. Baixe o agente já pré-configurado pela central ou defina um token.\x1b[0m');
}

// Buffer em memória das capturas deste agente (SSH e/ou WEB).
let attempts = [];
let nextId = 1;
function pushRow(row) {
  row.id = nextId++;
  attempts.push(row);
  if (attempts.length > MAX_BUFFER) attempts = attempts.slice(-MAX_BUFFER);
  return row;
}

function onSshAttempt(a) {
  const row = pushRow({ kind: 'ssh', ...a });
  console.log(`\x1b[31m[SSH]\x1b[0m ${row.ts}  ${row.ip}:${row.port}  user="${safeLog(row.username)}" pass="${safeLog(row.password ?? '')}" (${row.method})`);
}
function ignored(ip) {
  const list = String(cfg.webIgnore || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((n) => ip === n || ip.startsWith(n));
}
function onWebEntry(e) {
  if (!e.ip || ignored(e.ip)) return;
  const c = classifyRequest({ path: e.path, ua: e.ua, method: e.wmethod, status: e.status });
  const row = pushRow({
    kind: 'web', ts: e.ts, ip: e.ip, wmethod: e.wmethod, method: e.wmethod,
    path: e.path, status: e.status, bytes: e.bytes, ua: e.ua, referer: e.referer, host: e.host,
    site: e.host || e.site || '', // site: Host do log, ou nome do diretório (/var/www/<site>/…)
    score: c.score, category: c.category, label: c.label, isBot: c.isBot, hit: c.hit,
  });
  const col = c.score >= 85 ? '\x1b[31m' : c.score >= 60 ? '\x1b[33m' : c.score >= 35 ? '\x1b[36m' : '\x1b[90m';
  console.log(`${col}[WEB ${String(c.score).padStart(3)}]\x1b[0m ${row.ip}  ${row.wmethod} ${safeLog(String(row.path).slice(0, 60))}  ${row.status}  ${c.label}${c.hit ? ' \x1b[31m>> HIT\x1b[0m' : ''}`);
}

// ---- sensor de rede (tcpdump): cada conexão -> registro kind 'net' ----
function netIgnored(ip) {
  const list = String(cfg.netIgnore || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.some((n) => ip === n || ip.startsWith(n));
}
function onNetEvent(e) {
  if (!e.ip || netIgnored(e.ip)) return;
  const c = classifyConn({ dstPort: e.dstPort, proto: e.proto, isScan: e.isScan });
  const row = pushRow({
    kind: 'net', ts: e.ts, ip: e.ip, srcPort: e.srcPort, dstPort: e.dstPort, proto: e.proto,
    service: c.service, score: c.score, category: c.category, label: c.label, scan: !!e.isScan, ports: e.distinctPorts || 0,
  });
  const col = c.score >= 85 ? '\x1b[31m' : c.score >= 60 ? '\x1b[33m' : c.score >= 35 ? '\x1b[36m' : '\x1b[90m';
  console.log(`${col}[NET ${String(c.score).padStart(3)}]\x1b[0m ${row.ip} -> ${e.proto}/${e.dstPort} (${c.service})${e.isScan ? ' \x1b[31m>> SCAN\x1b[0m' : ''}`);
}

// ---- reconciliação: liga/desliga honeypot, monitor de logs e sensor de rede ----
let webMon = null, sshServer = null, netMon = null, netStarting = false, currentWebLogs = null, currentNetKey = null;
const wantSsh = () => normalizeMode(cfg.mode).has('ssh');
const wantWeb = () => normalizeMode(cfg.mode).has('web');
const wantNet = () => normalizeMode(cfg.mode).has('net');

// Import DINÂMICO do netcap: se o módulo faltar, loga e segue (não derruba o agente).
async function startNet() {
  netStarting = true;
  try {
    const { startNetCapture } = await import('./netcap.js');
    const ignore = String(cfg.netIgnore || '').split(',').map((s) => s.trim()).filter(Boolean);
    netMon = startNetCapture({ iface: cfg.netIface || 'any', filter: cfg.netFilter || '', ignore, onEvent: onNetEvent, log: console.log });
  } catch (e) {
    console.error('\x1b[31m[net] netcap indisponível (segue sem o sensor de rede):\x1b[0m', e.message);
    netMon = null;
  } finally { netStarting = false; }
}

function reconcile() {
  // WEB
  if (wantWeb()) {
    if (!webMon || currentWebLogs !== cfg.webLogs) {
      if (webMon) { try { webMon.stop(); } catch {} }
      currentWebLogs = cfg.webLogs;
      webMon = startWebLogMonitor({ logs: cfg.webLogs, onEntry: onWebEntry, log: console.log });
    }
  } else if (webMon) { try { webMon.stop(); } catch {} webMon = null; currentWebLogs = null; }

  // SSH
  if (wantSsh()) {
    if (!sshServer) sshServer = startHoneypot({ port: HONEYPOT_PORT, banner: BANNER, maxAuthTries: MAX_AUTH_TRIES, onAttempt: onSshAttempt, maxConnPerIp: MAX_CONN_PER_IP, maxConnTotal: MAX_CONN_TOTAL });
  } else if (sshServer) { try { sshServer.close(); } catch {} sshServer = null; }

  // NET — reinicia se ligou ou se iface/filtro mudaram (import dinâmico do netcap)
  const netKey = `${cfg.netIface}|${cfg.netFilter}`;
  if (wantNet()) {
    if ((!netMon && !netStarting) || currentNetKey !== netKey) {
      if (netMon) { try { netMon.stop(); } catch {} netMon = null; }
      currentNetKey = netKey;
      startNet();
    }
  } else if (netMon || netStarting) { if (netMon) { try { netMon.stop(); } catch {} } netMon = null; currentNetKey = null; }
}
reconcile();

// ---- auto-update ----
let managerBase = null;      // aprendido pelo IP de quem conecta + header X-Manager-Port
let updating = false;
let lastUpdateAttempt = 0;

async function pullUpdate(base, remoteVersion) {
  if (updating || !AUTO_UPDATE) return;
  if (Date.now() - lastUpdateAttempt < 15000) return;   // anti-loop
  updating = true; lastUpdateAttempt = Date.now();
  try {
    console.log(`\x1b[35m[update]\x1b[0m versão ${remoteVersion} disponível (tenho ${AGENT_VERSION}). Puxando de ${base}…`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const r = await fetch(`${base}/api/agent-source`, { headers: { Authorization: `Bearer ${INGEST_TOKEN}` }, signal: controller.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (!(Number(data.version || 0) > AGENT_VERSION)) { updating = false; return; }
    const { wrote, pkgChanged } = applyUpdate(data.files || {});
    if (wrote.length) { console.log('\x1b[35m[update]\x1b[0m gravado:', wrote.join(', ')); restart({ pkgChanged }); }
    else updating = false;
  } catch (e) { console.error('\x1b[35m[update]\x1b[0m pull falhou:', e.message); updating = false; }
}

// atualização EMPURRADA pela central (fallback quando o agente não alcança a central)
function applyPushedUpdate(body) {
  if (!AUTO_UPDATE) return { ok: false, disabled: true, version: AGENT_VERSION };
  const v = Number(body?.version || 0);
  if (!(v > AGENT_VERSION)) return { ok: true, upToDate: true, version: AGENT_VERSION };
  const { wrote, pkgChanged } = applyUpdate(body.files || {});
  if (wrote.length) { console.log('\x1b[35m[update]\x1b[0m recebido da central:', wrote.join(', ')); setTimeout(() => restart({ pkgChanged }), 150); return { ok: true, applying: true, wrote, version: v }; }
  return { ok: false, error: 'nada aplicado', version: AGENT_VERSION };
}

// aprende como alcançar a central e dispara o pull se houver versão nova
function noteManager(req) {
  const mp = Number(req.headers['x-manager-port'] || 0);
  const mv = Number(req.headers['x-manager-version'] || 0);
  if (mp) { const rip = String(req.socket.remoteAddress || '').replace('::ffff:', ''); if (rip) managerBase = `http://${rip}:${mp}`; }
  if (mv > AGENT_VERSION && managerBase) pullUpdate(managerBase, mv);
}

function configState() {
  return {
    agent: AGENT_ID,
    version: AGENT_VERSION,
    updating,
    mode: cfg.mode,
    webLogs: cfg.webLogs,
    webIgnore: cfg.webIgnore,
    netIface: cfg.netIface,
    netFilter: cfg.netFilter,
    netIgnore: cfg.netIgnore,
    honeypotPort: HONEYPOT_PORT,
    running: { ssh: !!sshServer, web: !!webMon, net: !!netMon },
    files: (webMon && webMon.files) || [],
    count: attempts.length,
  };
}

// --- API HTTP que a central (manager) consulta e CONFIGURA ---
// Comparacao em tempo constante (evita timing-attack) via digest de tamanho fixo.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function authorized(req) {
  const h = req.headers.authorization || '';
  const tok = h.replace(/^Bearer\s+/i, '').trim();
  return !!tok && safeEqual(tok, INGEST_TOKEN);
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}
function maxId() { return attempts.length ? attempts[attempts.length - 1].id : 0; }

// Validação estrita do IP antes de passar ao firewall (execFile já evita shell-injection).
function isValidIp(ip) {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip.split('.').every((o) => Number(o) <= 255);
  return /^[0-9a-fA-F:]{2,45}$/.test(ip);
}

// ---- Firewall real -----------------------------------------------------------
// Problema clássico: `ufw deny` grava a regra mesmo com o ufw INATIVO — parece que
// bloqueou, mas nada é aplicado e o `ufw status` não lista nada. Então:
//  • se o ufw estiver ATIVO, usamos ufw (integra e persiste em reboot);
//  • se estiver inativo/ausente, caímos para `iptables -I INPUT` (aplica NA HORA);
//  • para IPv6 usamos ip6tables.
// Sempre reportamos o método e se de fato está sendo aplicado.
function ip6(ip) { return ip.includes(':'); }
function ipt(ip) { return ip6(ip) ? 'ip6tables' : 'iptables'; }
function cleanPorts(ports) {
  return Array.isArray(ports) ? [...new Set(ports.map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))] : [];
}
// Executa uma lista de comandos [bin, args[]] em sequência; acumula erros reais.
function runSeq(cmds, cb) {
  const errs = []; let i = 0;
  const next = () => {
    if (i >= cmds.length) return cb(errs);
    const [bin, args] = cmds[i++];
    execFile(bin, args, { timeout: 10000 }, (err, so, se) => {
      const out = (String(so || '') + String(se || '')).trim();
      if (err && !/existing|skipping/i.test(out)) errs.push((out || err.message || '').slice(0, 160));
      next();
    });
  };
  next();
}
function ufwState(cb) {
  execFile('ufw', ['status'], { timeout: 8000 }, (err, stdout) => {
    if (err) return cb({ installed: false, active: false, status: '' });
    const out = String(stdout || '');
    cb({ installed: true, active: /Status:\s*active/i.test(out), status: out });
  });
}
// Bloqueia um IP. ports vazio = TODAS as portas; senão bloqueia só as portas TCP dadas.
function fwBlock(ip, ports, cb) {
  const ps = cleanPorts(ports);
  ufwState((u) => {
    const useUfw = u.installed && u.active;
    const t = ipt(ip);
    const cmds = [];
    if (useUfw) {
      if (ps.length) for (const p of ps) cmds.push(['ufw', ['insert', '1', 'deny', 'proto', 'tcp', 'from', ip, 'to', 'any', 'port', String(p)]]);
      else cmds.push(['ufw', ['insert', '1', 'deny', 'from', ip]]);
    } else if (ps.length) {
      for (const p of ps) cmds.push([t, ['-I', 'INPUT', '-s', ip, '-p', 'tcp', '--dport', String(p), '-j', 'DROP']]);
    } else {
      cmds.push([t, ['-I', 'INPUT', '-s', ip, '-j', 'DROP']]);
    }
    runSeq(cmds, (errs) => {
      const method = useUfw ? 'ufw' : t;
      if (errs.length) return cb({ ok: false, method, ports: ps, error: errs.join(' | ').slice(0, 220) });
      cb({
        ok: true, method, enforced: true, ports: ps,
        note: useUfw ? undefined : (u.installed
          ? 'ufw estava inativo - apliquei via iptables (nao persiste em reboot; rode `ufw enable`)'
          : 'ufw ausente - apliquei via iptables (nao persiste em reboot)'),
      });
    });
  });
}
function fwUnblock(ip, ports, cb) {
  const ps = cleanPorts(ports);
  const t = ipt(ip);
  const cmds = [];
  if (ps.length) {
    for (const p of ps) {
      cmds.push(['ufw', ['delete', 'deny', 'proto', 'tcp', 'from', ip, 'to', 'any', 'port', String(p)]]);
      cmds.push([t, ['-D', 'INPUT', '-s', ip, '-p', 'tcp', '--dport', String(p), '-j', 'DROP']]);
    }
  } else {
    cmds.push(['ufw', ['delete', 'deny', 'from', ip]]);
    cmds.push([t, ['-D', 'INPUT', '-s', ip, '-j', 'DROP']]);
  }
  runSeq(cmds, () => cb({ ok: true, ip, ports: ps }));
}
// Lista bloqueios por IP, agrupando as portas. all=true significa "todas as portas".
function fwList(cb) {
  const map = new Map(); // ip -> Set(porta:number | 'all')
  const add = (ip, port) => { let s = map.get(ip); if (!s) { s = new Set(); map.set(ip, s); } s.add(port); };
  ufwState((u) => {
    if (u.installed && u.active && u.status) {
      for (const line of u.status.split('\n')) {
        if (!/DENY/i.test(line)) continue;
        const ips = line.match(/\d{1,3}(?:\.\d{1,3}){3}|(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F:]*/g);
        if (!ips || !ips.length) continue;
        const col = line.trim().split(/\s{2,}/)[0] || '';       // "Anywhere" | "22/tcp" | "22"
        const pm = col.match(/^(\d{1,5})/);
        add(ips[ips.length - 1], /^anywhere/i.test(col) ? 'all' : (pm ? Number(pm[1]) : 'all'));
      }
    }
    execFile('iptables', ['-S', 'INPUT'], { timeout: 8000 }, (err, stdout) => {
      if (!err && stdout) {
        for (const line of String(stdout).split('\n')) {
          if (!/^-A INPUT/.test(line) || !/-j DROP/.test(line)) continue;
          const im = line.match(/-s (\d{1,3}(?:\.\d{1,3}){3})/);
          if (!im) continue;
          const dp = line.match(/--dport (\d{1,5})/);
          add(im[1], dp ? Number(dp[1]) : 'all');
        }
      }
      const blocked = [...map.entries()].map(([ip, s]) => {
        const ports = [...s].filter((x) => x !== 'all').sort((a, b) => a - b);
        return { ip, all: s.has('all') || ports.length === 0, ports };
      });
      const firewall = u.installed ? (u.active ? 'ufw' : 'ufw-inativo->iptables') : 'iptables';
      cb({ ok: true, blocked, firewall, ufwActive: u.active });
    });
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://agent'); } catch { return sendJson(res, 400, { error: 'url' }); }
  if (!authorized(req)) return sendJson(res, 401, { error: 'token inválido' });
  noteManager(req); // aprende a central + dispara auto-update se houver versão nova

  if (url.pathname === '/agent/info') {
    return sendJson(res, 200, { ok: true, agent: AGENT_ID, version: AGENT_VERSION, mode: cfg.mode, count: attempts.length, maxId: maxId(), running: { ssh: !!sshServer, web: !!webMon } });
  }
  if (url.pathname === '/agent/attempts') {
    const after = Number(url.searchParams.get('after') || 0);
    return sendJson(res, 200, { agent: AGENT_ID, version: AGENT_VERSION, mode: cfg.mode, attempts: attempts.filter((a) => a.id > after), maxId: maxId() });
  }
  if (url.pathname === '/agent/update' && req.method === 'POST') {
    let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    return sendJson(res, 200, applyPushedUpdate(body));
  }
  if (url.pathname === '/agent/config' && req.method === 'GET') {
    return sendJson(res, 200, configState());
  }
  if (url.pathname === '/agent/config' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const next = { ...cfg };
    if (body.mode !== undefined) {
      if (!validMode(body.mode)) return sendJson(res, 400, { error: 'modo inválido (ssh|web|net|both|all ou combos)' });
      next.mode = body.mode;
    }
    if (body.webLogs !== undefined) next.webLogs = String(body.webLogs || '');
    if (body.webIgnore !== undefined) next.webIgnore = String(body.webIgnore || '');
    if (body.netIface !== undefined) next.netIface = String(body.netIface || 'any');
    if (body.netFilter !== undefined) next.netFilter = String(body.netFilter || '');
    if (body.netIgnore !== undefined) next.netIgnore = String(body.netIgnore || '');
    cfg = next;
    saveConfig(cfg);
    reconcile();
    console.log(`\x1b[35m[CONFIG]\x1b[0m modo=${cfg.mode} logs="${cfg.webLogs || '(auto)'}" ssh=${!!sshServer} web=${!!webMon}`);
    return sendJson(res, 200, { ok: true, ...configState() });
  }
  if (url.pathname === '/agent/logs' && req.method === 'GET') {
    return sendJson(res, 200, { logs: discoverLogs(cfg.webLogs) });
  }
  if (url.pathname === '/agent/block' && req.method === 'POST') {
    let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const ip = String(body.ip || '').trim();
    if (!isValidIp(ip)) return sendJson(res, 400, { error: 'ip inválido' });
    fwBlock(ip, body.ports, (r) => {
      const scope = (r.ports && r.ports.length) ? `portas ${r.ports.join(',')}` : 'todas as portas';
      if (r.ok) console.log(`\x1b[31m[BLOCK]\x1b[0m ${ip} (${scope}) via ${r.method}${r.note ? ' - ' + r.note : ''}`);
      else console.log(`\x1b[31m[BLOCK]\x1b[0m falhou ${ip}: ${r.error}`);
      sendJson(res, 200, { ip, ...r });
    });
    return;
  }
  if (url.pathname === '/agent/unblock' && req.method === 'POST') {
    let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const ip = String(body.ip || '').trim();
    if (!isValidIp(ip)) return sendJson(res, 400, { error: 'ip inválido' });
    fwUnblock(ip, body.ports, (r) => sendJson(res, 200, r));
    return;
  }
  if (url.pathname === '/agent/blocked' && req.method === 'GET') {
    fwList((r) => sendJson(res, 200, r));
    return;
  }
  sendJson(res, 404, { error: 'rota desconhecida' });
});

// Ao auto-atualizar, a instância NOVA sobe enquanto a ANTIGA ainda segura a porta
// por alguns ms -> EADDRINUSE. Em vez de desistir (o que deixava o agente vivo mas
// SEM API, "parando de reportar"), re-tentamos o bind até a porta liberar.
let listenTries = 0;
const MAX_LISTEN_TRIES = 40; // ~20s
function startApi() {
  server.listen(AGENT_PORT, '0.0.0.0', () => {
    listenTries = 0;
    console.log(`\x1b[36m[API]\x1b[0m agente ouvindo em 0.0.0.0:${AGENT_PORT} (Bearer token exigido).`);
    console.log(`\x1b[36m[OK]\x1b[0m  Registre o IP deste servidor na central - da pra configurar modo e logs por la.\n`);
  });
}
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    if (listenTries++ < MAX_LISTEN_TRIES) {
      if (listenTries === 1 || listenTries % 5 === 0) console.warn(`\x1b[33m[!] Porta ${AGENT_PORT} ocupada (provável reinício/atualização) - re-tentando o bind... (${listenTries}/${MAX_LISTEN_TRIES})\x1b[0m`);
      setTimeout(startApi, 500);
    } else {
      console.error(`[!] Porta ${AGENT_PORT} segue ocupada após ${MAX_LISTEN_TRIES} tentativas. Encerrando para o supervisor/reinício assumir.`);
      process.exit(1);
    }
  } else {
    console.error('[!] Erro na API do agente:', err.message);
  }
});
startApi();

process.on('SIGINT', () => { console.log('\n[EXIT] Agente desarmado.'); process.exit(0); });
