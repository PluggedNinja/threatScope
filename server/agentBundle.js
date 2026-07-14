// Gera um .zip do agente sob demanda, em JavaScript puro (método "store",
// sem compressão e sem dependências). O operador baixa e copia para os servidores.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(__dirname, '../agent');
const FILES = ['agent.js', 'honeypot.js', 'weblog.js', 'netcap.js', 'classify.js', 'version.js', 'updater.js', 'package.json', '.env.example', '.npmrc', 'start-agent.bat'];
// Arquivos de CÓDIGO enviados no auto-update (sem .env.example — o agente preserva o .env).
const SOURCE_FILES = ['agent.js', 'honeypot.js', 'weblog.js', 'netcap.js', 'classify.js', 'version.js', 'updater.js', 'package.json', '.npmrc'];

// Versão do agente que esta central distribui (lida de agent/version.js).
export function agentVersion() {
  try {
    const src = fs.readFileSync(path.join(AGENT_DIR, 'version.js'), 'utf8');
    const m = src.match(/AGENT_VERSION\s*=\s*(\d+)/);
    return m ? Number(m[1]) : 1;
  } catch { return 1; }
}

// Conteúdo dos arquivos de código, para o agente puxar e aplicar na atualização.
export function agentSourceFiles() {
  const files = {};
  for (const f of SOURCE_FILES) {
    const p = path.join(AGENT_DIR, f);
    if (fs.existsSync(p)) files[f] = fs.readFileSync(p, 'utf8');
  }
  return files;
}

const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);   // método: store
    lh.writeUInt16LE(0, 10);  // hora
    lh.writeUInt16LE(0x21, 12); // data (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, centralBuf, eocd]);
}

export function agentBundleAvailable() {
  return fs.existsSync(path.join(AGENT_DIR, 'agent.js'));
}

export function buildAgentZip({ readme, envFile } = {}) {
  const entries = [];
  for (const f of FILES) {
    const p = path.join(AGENT_DIR, f);
    if (fs.existsSync(p)) entries.push({ name: `agent/${f}`, data: fs.readFileSync(p) });
  }
  // .env já preenchido (token + URL da central) para rodar sem configurar nada.
  if (envFile) entries.push({ name: 'agent/.env', data: envFile });
  if (readme) entries.push({ name: 'agent/LEIA-ME.txt', data: readme });
  return zipStore(entries);
}
