import ssh2 from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Server } = ssh2;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Gera (ou reaproveita) uma host key RSA para o handshake SSH.
function loadOrCreateHostKey() {
  const keyPath = path.join(__dirname, 'host.key');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return privateKey;
}

/**
 * Sobe o honeypot SSH. Para cada tentativa de autenticação, chama onAttempt({...}).
 * Nenhuma credencial é aceita de verdade — o objetivo é só coletar.
 */
export function startHoneypot({ port, banner, maxAuthTries = 6, onAttempt, log = console.log, maxConnPerIp = 30, maxConnTotal = 5000 }) {
  const hostKey = loadOrCreateHostKey();
  // Limite de conexões SIMULTÂNEAS (anti-flood): por IP e no total.
  const perIp = new Map();
  let activeTotal = 0;
  const MAX_CONN_PER_IP = Number(maxConnPerIp) || 30;
  const MAX_CONN_TOTAL = Number(maxConnTotal) || 5000;

  const server = new Server(
    {
      hostKeys: [hostKey],
      banner: '', // banner de boas-vindas vazio; o ident string é o que engana os bots
      ident: banner?.replace(/^SSH-2\.0-/, '') || 'OpenSSH_8.9p1 Ubuntu-3ubuntu0.1',
    },
    (client, info) => {
      const ip = info?.ip || 'desconhecido';
      const srcPort = info?.port || null;
      // Anti-flood: barra quem abre conexões DEMAIS ao mesmo tempo (brute-force normal
      // é sequencial, então não perdemos capturas legítimas). Fecha antes do handshake.
      if (activeTotal >= MAX_CONN_TOTAL || (perIp.get(ip) || 0) >= MAX_CONN_PER_IP) {
        try { client.end(); } catch {}
        return;
      }
      activeTotal++;
      perIp.set(ip, (perIp.get(ip) || 0) + 1);
      let released = false;
      const release = () => {
        if (released) return; released = true;
        activeTotal = Math.max(0, activeTotal - 1);
        const n = (perIp.get(ip) || 1) - 1;
        if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
      };
      client.on('close', release);
      const clientBanner = info?.header?.identRaw || info?.header?.versions?.client || '';
      let tries = 0;

      // Métodos que anunciamos como "disponíveis" ao rejeitar. É ISSO que faz
      // o bot (que sonda com "none" primeiro) prosseguir e ENVIAR a senha.
      const OFFER = ['password', 'keyboard-interactive'];

      client.on('authentication', (ctx) => {
        tries += 1;
        const base = {
          ip,
          port: srcPort,
          username: ctx.username || '',
          method: ctx.method,
          client: clientBanner,
          ts: new Date().toISOString(),
        };

        try {
          if (ctx.method === 'password') {
            // captura usuário + senha reais
            onAttempt({ ...base, password: ctx.password || '' });
          } else if (ctx.method === 'keyboard-interactive') {
            // muitos bots respondem a senha via prompt interativo
            return ctx.prompt(
              [{ prompt: 'Password: ', echo: false }],
              (answers) => {
                onAttempt({ ...base, method: 'keyboard-interactive', password: (answers && answers[0]) || '' });
                if (tries >= maxAuthTries) return ctx.reject();
                return ctx.reject(OFFER);
              }
            );
          }
          // 'none' / 'publickey' / 'hostbased' são apenas sondagem: NÃO registramos
          // (senão o feed enche de linhas sem senha). Só rejeitamos oferecendo
          // 'password' para o bot mandar a credencial na sequência.
        } catch (e) {
          log('erro ao processar tentativa:', e.message);
        }

        if (tries >= maxAuthTries) return ctx.reject();
        return ctx.reject(OFFER); // NUNCA aceita — mas convida a tentar senha
      });

      client.on('ready', () => client.end());     // não deveria acontecer (sempre rejeitamos)
      client.on('error', () => {});                // bots derrubam a conexão à vontade
      client.on('end', release);
    }
  );

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      log(`\n[!] Permissão negada na porta ${port}. Portas <1024 exigem root (use sudo) ou escolha HONEYPOT_PORT=2222.\n`);
    } else if (err.code === 'EADDRINUSE') {
      log(`\n[!] Porta ${port} já está em uso. Mova o sshd real ou troque HONEYPOT_PORT.\n`);
    } else {
      log('[!] Erro do honeypot:', err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    log(`\x1b[32m[HONEYPOT]\x1b[0m SSH escutando na porta ${port} (ident: ${banner})`);
  });

  return server;
}
