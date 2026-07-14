// Auto-update do agente: grava os arquivos de código novos (preservando .env e
// agent-config.json) e re-executa o processo para rodar a versão nova.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Só estes arquivos podem ser sobrescritos por uma atualização (nunca .env / config).
const ALLOW = new Set(['agent.js', 'honeypot.js', 'weblog.js', 'netcap.js', 'classify.js', 'version.js', 'updater.js', 'package.json', '.npmrc']);

function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// Grava os arquivos recebidos (whitelist + sem path traversal). Retorna o que mudou.
export function applyUpdate(files = {}) {
  const wrote = [];
  let pkgChanged = false;
  const oldPkg = safeRead(path.join(__dirname, 'package.json'));
  for (const [name, content] of Object.entries(files)) {
    const base = path.basename(String(name)); // trava traversal
    if (!ALLOW.has(base) || typeof content !== 'string') continue;
    const dest = path.join(__dirname, base);
    try {
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, dest);
      wrote.push(base);
      if (base === 'package.json' && content.trim() !== oldPkg.trim()) pkgChanged = true;
    } catch (e) { console.error('[update] falha ao gravar', base, e.message); }
  }
  return { wrote, pkgChanged };
}

// Reinicia o agente para carregar o código novo.
// AGENT_UPDATE_MODE=respawn (padrão): sobe um novo processo e sai.
// AGENT_UPDATE_MODE=exit: apenas sai (para quem roda sob systemd/pm2 com restart).
export function restart({ pkgChanged } = {}) {
  if (pkgChanged) {
    try {
      console.log('\x1b[35m[update]\x1b[0m package.json mudou — rodando npm install…');
      spawnSync('npm', ['install', '--omit=optional'], { cwd: __dirname, stdio: 'inherit', shell: process.platform === 'win32' });
    } catch (e) { console.error('[update] npm install falhou (segue mesmo assim):', e.message); }
  }
  const mode = (process.env.AGENT_UPDATE_MODE || 'respawn').toLowerCase();
  if (mode === 'exit') {
    console.log('\x1b[35m[update]\x1b[0m saindo para o supervisor reiniciar com a versão nova…');
    setTimeout(() => process.exit(0), 200);
    return;
  }
  console.log('\x1b[35m[update]\x1b[0m re-executando o agente com a versão nova…');
  try {
    const child = spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), detached: true, stdio: 'inherit' });
    child.unref();
  } catch (e) { console.error('[update] falha ao re-executar:', e.message); }
  setTimeout(() => process.exit(0), 300);
}

export default { applyUpdate, restart };
