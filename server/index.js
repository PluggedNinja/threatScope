import 'dotenv/config';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { createApi } from './api.js';
import { agentVersion, agentSourceFiles } from './agentBundle.js';

// Base fica no diretório do usuário. Instalações novas usam ~/.threatscope; se já
// existir a base antiga (~/.sshoney) e não houver a nova, seguimos usando a antiga
// para NÃO perder os dados de honeypot já coletados.
// DB_PATH é o ÚNICO parâmetro que fica no ambiente (a config vive DENTRO da base,
// então precisamos saber onde a base está antes de lê-la). Todo o resto foi para a UI.
function defaultDbPath() {
  const home = os.homedir();
  const nu = path.join(home, '.threatscope', 'threatscope.db');
  const old = path.join(home, '.sshoney', 'sshoney.db');
  try { if (!fs.existsSync(nu) && fs.existsSync(old)) return old; } catch {}
  return nu;
}
const DB_PATH = process.env.DB_PATH || defaultDbPath();

const BOOT = `
\x1b[36m
   ████████╗██╗  ██╗██████╗ ███████╗ █████╗ ████████╗
   ╚══██╔══╝██║  ██║██╔══██╗██╔════╝██╔══██╗╚══██╔══╝
      ██║   ███████║██████╔╝█████╗  ███████║   ██║
      ██║   ██╔══██║██╔══██╗██╔══╝  ██╔══██║   ██║
      ██║   ██║  ██║██║  ██║███████╗██║  ██║   ██║
      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝  \x1b[32mSCOPE\x1b[0m
\x1b[0m   THREATSCOPE · THREAT INTEL MAPPING — MANAGER (CENTRAL DE COMANDO)
`;
console.log(BOOT);

// 1) Armazenamento (precisa vir antes da config: a config mora dentro da base)
db.initDb(DB_PATH);
db.seedConfigFromEnv(process.env);   // migra o .env para a base na 1ª vez
const cfg0 = db.getConfig();

// Leitura AO VIVO da config (a UI pode mudar em runtime; refletimos sem reiniciar).
const token = () => db.getConfig().ingestToken;
const API_PORT = cfg0.apiPort;       // porta exige reiniciar para mudar
if (token() === 'troque-este-token') {
  console.warn('\x1b[33m[!] Token de coleta ainda é o padrão. Defina um token forte em CONFIG (⚙) no dashboard e use o MESMO nos agentes.\x1b[0m');
}

const dbInfo = db.initStatus();
console.log(`💾  Dados: ${dbInfo.filePath}`);
console.log(`📦  Base carregada: ${dbInfo.loaded} tentativa(s) em memória.`);
if (dbInfo.recoveredFrom) {
  console.log(`\x1b[33m♻️   Recuperação automática: a base canônica estava vazia; importei ${dbInfo.loaded} registro(s) de:\x1b[0m`);
  console.log(`     ${dbInfo.recoveredFrom}`);
  console.log(`     -> migrados para o caminho canônico acima. Nada foi perdido. 🫡`);
}
if (dbInfo.restoredFromBackup) {
  console.log(`\x1b[33m🛟  Arquivo principal corrompido — restaurado a partir do backup (.bak).\x1b[0m`);
}

// 1b) Conta ADMIN (multi-tenant). Semeada na 1ª execução; o token é estável e
// serve para logar no painel quando a central estiver PÚBLICA (atrás de proxy).
const { admin, created } = db.seedAdmin({ email: process.env.ADMIN_EMAIL || 'admin@plugged.ninja', name: process.env.ADMIN_NAME || 'Admin' });
if (created) {
  console.log('\x1b[35m════════════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[35m👑  Conta ADMIN criada. GUARDE este token de API (login do painel):\x1b[0m');
  console.log(`\x1b[36m    ${admin.token}\x1b[0m`);
  console.log(`\x1b[35m    (conta: ${admin.email}) — regenerável no painel do admin.\x1b[0m`);
  console.log('\x1b[35m════════════════════════════════════════════════════════════════\x1b[0m');
} else {
  console.log(`👑  Admin: ${admin.email}. Token de API já definido (veja o painel do admin > sua conta).`);
}
if (db.getConfig().trustProxy || process.env.TRUST_PROXY === '1') {
  console.log('\x1b[33m🔒  TRUST_PROXY ativo: bypass de admin-localhost DESLIGADO — use o token de admin para logar.\x1b[0m');
} else if (db.getConfig().localhostAdmin === true) {
  console.log('\x1b[41m\x1b[37m ⚠  ATENÇÃO SEGURANÇA \x1b[0m\x1b[33m Conexões de localhost agem como ADMIN (conveniência local LIGADA — INSEGURO se exposto).');
  console.log('    ANTES de expor via proxy (pluggedninja), ATIVE trustProxy (ou TRUST_PROXY=1), senão');
  console.log('    o proxy — que fala com a central por localhost — daria admin a qualquer visitante.\x1b[0m');
}

// 2) WebSocket + broadcast (com ESCOPO multi-tenant: cada conexão só recebe os
//    eventos dos SEUS sensores; admin recebe tudo).
const httpServer = http.createServer();
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
function wsIsLoopback(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
// Resolve as tags permitidas de uma conexão: null = tudo (admin), array = restrito, false = negado.
function wsScope(req) {
  let tok = '';
  try { tok = new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch {}
  const user = tok ? db.findUserByToken(tok) : null;
  if (user) return user.role === 'admin' ? null : db.tagsForOwner(user.id);
  const cfg = db.getConfig();
  if (!cfg.trustProxy && process.env.TRUST_PROXY !== '1' && cfg.localhostAdmin !== false && wsIsLoopback(req)) return null;
  return false; // sem token e não-local => sem dados ao vivo
}
function broadcast(type, payload) {
  const now = new Date().toISOString();
  wss.clients.forEach((c) => {
    if (c.readyState !== 1 || c._scope === false) return;
    const tags = c._scope; // null = tudo; array = restrito
    if (Array.isArray(tags)) {
      if (type === 'attempt' && !tags.includes(payload.agent)) return;
      if (type === 'autoblock' && !((payload.agents || []).some((a) => tags.includes(a)))) return;
    }
    c.send(JSON.stringify({ type, payload, ts: now }));
  });
}
wss.on('connection', (ws, req) => {
  ws._scope = wsScope(req);
  ws.send(JSON.stringify({ type: 'hello', payload: { msg: 'conectado ao comando THREATSCOPE', scoped: Array.isArray(ws._scope), denied: ws._scope === false } }));
});

// 3) Coletor (pull): a central busca as capturas em cada agente registrado.
async function pollAgent(entry) {
  const base = `http://${entry.host}:${entry.port}`;
  const after = db.getAgentRuntime(entry.id).cursor || 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(`${base}/agent/attempts?after=${after}`, {
      headers: {
        Authorization: `Bearer ${token()}`,
        // O agente usa estes cabeçalhos para se auto-atualizar (puxa o código novo daqui).
        'X-Manager-Version': String(agentVersion()),
        'X-Manager-Port': String(API_PORT),
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'token recusado (401)' : `HTTP ${r.status}`);
    const data = await r.json();
    const tag = entry.name || entry.host;
    const list = Array.isArray(data.attempts) ? data.attempts : [];
    for (const a of list) {
      // repassa TODOS os campos do agente (SSH e/ou WEB), sobrescrevendo o agent.
      const saved = db.insertAttempt({ ...a, id: undefined, agent: tag });
      broadcast('attempt', saved);
    }
    const agentMax = Number(data.maxId || 0);
    // se o agente reiniciou (maxId menor que o cursor), recomeça do zero.
    const cursor = agentMax < after ? 0 : agentMax;
    const agentVer = Number(data.version || 1);
    db.setAgentStatus(entry.id, { online: true, lastSeen: Date.now(), error: null, selfId: data.agent, cursor, version: agentVer });
    if (list.length) console.log(`\x1b[32m[COLETA]\x1b[0m ${tag} (${entry.host}:${entry.port}) +${list.length} capturas`);
    // Fallback de auto-update: se o agente ficou pra trás e não conseguiu puxar
    // sozinho (sem rota de volta até a central), a central EMPURRA o código novo.
    if (agentVer < agentVersion()) pushUpdate(entry);
  } catch (e) {
    db.setAgentStatus(entry.id, { online: false, error: String(e.name === 'AbortError' ? 'timeout' : (e.message || e)) });
  } finally {
    clearTimeout(timer);
  }
}
// Empurra o código novo para um agente desatualizado (fallback do auto-update).
async function pushUpdate(entry) {
  const rt = db.getAgentRuntime(entry.id);
  if (Date.now() - (rt.updatePushAt || 0) < 30000) return; // cooldown, dá tempo do pull do agente
  db.setAgentStatus(entry.id, { updatePushAt: Date.now() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(`http://${entry.host}:${entry.port}/agent/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: agentVersion(), files: agentSourceFiles() }),
      signal: controller.signal,
    });
    if (r.ok) console.log(`\x1b[35m[UPDATE]\x1b[0m ${entry.name || entry.host}: código v${agentVersion()} enviado.`);
  } catch { /* sem rota até o agente agora; tenta de novo no próximo ciclo */ }
  finally { clearTimeout(timer); }
}

function pollAll() { for (const entry of db.listAgents()) pollAgent(entry); }
// Auto-agendado (em vez de setInterval fixo) para pegar mudanças do intervalo na UI.
function schedulePoll() {
  setTimeout(() => { pollAll(); schedulePoll(); }, Math.max(1000, db.getConfig().pollMs));
}
schedulePoll();

// ===== Auto-bloqueio: aplica a política definida no dashboard (bloqueia IPs abusivos no ufw) =====
// Recurso opcional: em CONFIG (⚙) no dashboard dá para desligar totalmente o motor.
const autoBlocked = new Set();
async function blockAgent(host, port, ip) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    await fetch(`http://${host}:${port}/agent/block`, {
      method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }), signal: controller.signal,
    });
  } catch {} finally { clearTimeout(t); }
}
async function evalAutoBlock() {
  if (!db.getConfig().autoblockAvailable) return;
  const s = db.getSettings().autoblock;
  if (!s || !s.enabled) return;
  const scope = s.scope === 'hit' ? 'hit' : 'all';
  const cand = new Set();
  if (Number(s.sshAttempts) > 0) for (const g of db.groupedByIp({ kind: 'ssh' })) if (g.attempts >= s.sshAttempts) cand.add(g.ip);
  if (s.blockScanners) for (const g of db.netGroupedByIp({})) if (g.scan) cand.add(g.ip);
  if (s.blockWebHits) for (const g of db.webGroupedByIp({})) if ((g.hits || 0) > 0) cand.add(g.ip);

  let agentsByIp = null;
  if (scope === 'hit') {
    agentsByIp = new Map();
    for (const g of db.mapGroups({})) { if (!g.agent) continue; let se = agentsByIp.get(g.ip); if (!se) { se = new Set(); agentsByIp.set(g.ip, se); } se.add(g.agent); }
  }
  const agents = db.listAgents();
  let done = 0;
  for (const ip of cand) {
    if (autoBlocked.has(ip) || done >= 60) continue;
    if (db.isAllowlisted(ip)) continue; // IP protegido pela allowlist — nunca bloqueia
    autoBlocked.add(ip); done++;
    const targets = (scope === 'hit' && agentsByIp) ? agents.filter((a) => agentsByIp.get(ip) && agentsByIp.get(ip).has(a.name || a.host)) : agents;
    for (const a of targets) blockAgent(a.host, a.port, ip);
    console.log(`\x1b[31m[AUTO-BLOCK]\x1b[0m ${ip} → ${targets.map((a) => a.name || a.host).join(', ') || 'ninguém'}`);
    broadcast('autoblock', { ip, agents: targets.map((a) => a.name || a.host) });
  }
}
setInterval(evalAutoBlock, 30000);

// 4) API HTTP — CORS, token e disponibilidade do auto-bloqueio são lidos AO VIVO
// da config (db.getConfig) dentro do api.js, então mudanças na UI valem na hora.
const app = createApi({
  broadcast,
  onAgentAdded: (entry) => pollAgent(entry), // coleta imediata ao registrar
  autoblock: {
    sessionCount: () => autoBlocked.size,
    resetSession: () => autoBlocked.clear(),
  },
});

// 4b) Servir o cliente já compilado (client/dist), se existir — a central entrega
// TUDO numa única origem (ideal para expor via pluggedninja: um proxy só). O
// landing público e o painel ficam em /, e /api + /ws na mesma origem.
const distCandidates = [
  path.join(process.cwd(), '..', 'client', 'dist'),
  path.join(process.cwd(), 'client', 'dist'),
];
const distDir = distCandidates.find((p) => { try { return fs.existsSync(path.join(p, 'index.html')); } catch { return false; } });
if (distDir) {
  app.use(express.static(distDir));
  // SPA fallback: GET que não seja /api/* nem /ws serve o index.html do painel.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/ws') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`🌐  Cliente servido de ${distDir} (mesma origem da API).`);
} else {
  console.log('🌐  client/dist não encontrado — rode "npm run build" no client para servir o painel pela própria central.');
}

httpServer.on('request', app);

httpServer.listen(API_PORT, () => {
  console.log(`📡  API + WebSocket em http://localhost:${API_PORT}  (ws: /ws)`);
  console.log(`🛰️   Coletor ativo: buscando capturas nos agentes a cada ${db.getConfig().pollMs} ms (ajustável em CONFIG).`);
  console.log(`➕  Registre agentes pelo dashboard (botão "AGENTE") ou POST /api/agents.\n`);
  pollAll();
});

// Desligamento gracioso: grava a base ANTES de sair, para não perder o que estava
// no buffer de autosave (debounce). Cobre Ctrl+C (SIGINT), kill (SIGTERM) e saída normal.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { db.flushNow(); } catch {}
  console.log(`\nManager desligando (${signal})... base salva com segurança. Até logo. 🫡`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// rede de segurança: garante flush se o processo terminar por outro motivo
process.on('beforeExit', () => { try { db.flushNow(); } catch {} });
