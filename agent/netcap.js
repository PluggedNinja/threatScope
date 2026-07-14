// Sensor de rede do AGENTE: roda `tcpdump` e capta cada tentativa de conexão
// (SYN de entrada em QUALQUER porta), detecta varredura de portas e emite eventos.
// Precisa de tcpdump instalado e privilégio (root/CAP_NET_RAW). Só observa — não injeta.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

// Linha do tcpdump (-nn): "IP 1.2.3.4.5555 > 10.0.0.5.3389: Flags [S], ..."
const LINE = /IP6?\s+(\d{1,3}(?:\.\d{1,3}){3})\.(\d+)\s+>\s+(\d{1,3}(?:\.\d{1,3}){3})\.(\d+):/;

export function parseTcpdumpLine(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const proto = /UDP|udp/.test(line) ? 'udp' : 'tcp';
  return { ip: m[1], srcPort: Number(m[2]), dstIp: m[3], dstPort: Number(m[4]), proto };
}

// Detector de port-scan: um IP tocando muitas portas distintas numa janela curta.
export function makeScanDetector({ windowMs = 60000, threshold = 10 } = {}) {
  const state = new Map(); // ip -> { ports: Map(port->ts), scanUntil }
  return function mark(ip, dstPort, now = Date.now()) {
    let s = state.get(ip);
    if (!s) { s = { ports: new Map(), scanUntil: 0 }; state.set(ip, s); }
    for (const [p, ts] of s.ports) if (now - ts > windowMs) s.ports.delete(p);
    s.ports.set(dstPort, now);
    if (s.ports.size >= threshold) s.scanUntil = now + windowMs;
    // limpeza preguiçosa do mapa global
    if (state.size > 5000) for (const [k, v] of state) if (now - (v.scanUntil || 0) > windowMs * 2 && v.ports.size === 0) state.delete(k);
    return { isScan: now < s.scanUntil, distinctPorts: s.ports.size };
  };
}

/**
 * Inicia a captura. Retorna { stop() }.
 * opts: { iface, filter, ignore[], onEvent, log }
 */
export function startNetCapture({ iface = 'any', filter = '', ignore = [], onEvent, log = console.log } = {}) {
  const expr = filter && filter.trim()
    ? filter.trim()
    : 'tcp[tcpflags] & (tcp-syn|tcp-ack) == tcp-syn'; // só SYN de conexão nova
  const args = ['-l', '-nn', '-Q', 'in', '-i', iface, expr];

  const ignored = (ip) => ignore.some((n) => n && (ip === n || ip.startsWith(n)));
  const scan = makeScanDetector();
  const dedupe = new Map(); // "ip:port" -> ts (colapsa retransmissões de SYN)

  let proc;
  try {
    proc = spawn('tcpdump', args);
  } catch (e) {
    log(`\x1b[31m[net] não consegui iniciar tcpdump: ${e.message}\x1b[0m`);
    return { stop() {} };
  }

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    const e = parseTcpdumpLine(line);
    if (!e || !e.ip || ignored(e.ip)) return;
    const now = Date.now();
    const key = e.ip + ':' + e.dstPort;
    if (now - (dedupe.get(key) || 0) < 2000) return; // mesma origem+porta em <2s: ignora
    dedupe.set(key, now);
    if (dedupe.size > 20000) dedupe.clear();
    const { isScan, distinctPorts } = scan(e.ip, e.dstPort, now);
    try {
      onEvent({
        ts: new Date(now).toISOString(),
        ip: e.ip, srcPort: e.srcPort, dstPort: e.dstPort, proto: e.proto,
        isScan, distinctPorts,
      });
    } catch (err) { log('[net] erro no onEvent:', err.message); }
  });

  let hint = '';
  proc.stderr.on('data', (d) => {
    const s = String(d);
    hint += s;
    if (/listening on/i.test(s)) log(`\x1b[36m[NETCAP]\x1b[0m Sensor de rede ativo (tcpdump em ${iface}).`);
  });
  proc.on('error', (e) => {
    if (e.code === 'ENOENT') log('\x1b[31m[net] tcpdump não encontrado. Instale: apt install tcpdump (ou yum/apk).\x1b[0m');
    else log('\x1b[31m[net] erro no tcpdump:', e.message, '\x1b[0m');
  });
  proc.on('exit', (code) => {
    if (code && code !== 0) {
      log(`\x1b[31m[net] tcpdump saiu (code ${code}).\x1b[0m ${/permission|denied|not permitted/i.test(hint) ? 'Rode o agente como root (sudo) para capturar pacotes.' : hint.slice(0, 200)}`);
    }
  });

  return { stop() { try { rl.close(); } catch {} try { proc.kill('SIGTERM'); } catch {} } };
}

export default { startNetCapture, parseTcpdumpLine, makeScanDetector };
