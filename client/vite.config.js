import { defineConfig, createLogger } from 'vite';
import react from '@vitejs/plugin-react';

// O barulho "[vite] ws proxy socket error: write ECONNABORTED" é impresso pelo
// LOGGER INTERNO do Vite quando o backend (:4000) reinicia ou o socket fecha no
// meio de uma escrita. Não é um bug do app — o cliente já reconecta sozinho.
// Um handler de erro no proxy roda EM PARALELO ao log do Vite, então não basta:
// aqui filtramos o próprio logger para engolir só essas linhas ruidosas.
const RUIDO = ['ws proxy socket error', 'http proxy error', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED'];
const logger = createLogger();
const baseError = logger.error.bind(logger);
let avisou = 0;
logger.error = (msg, opts) => {
  const txt = typeof msg === 'string' ? msg : String(msg);
  if (RUIDO.some((r) => txt.includes(r))) {
    // no máximo 1 aviso curto a cada 5s, sem stack trace
    const agora = Date.now();
    if (agora - avisou > 5000) {
      avisou = agora;
      console.log('\x1b[33m[proxy] backend :4000 indisponível no momento — reconectando quando voltar…\x1b[0m');
    }
    return;
  }
  baseError(msg, opts);
};

// Handler extra no proxy: evita que um erro não tratado derrube o dev server.
function quietProxy(proxy) {
  proxy.on('error', () => { /* silenciado: o logger acima cuida do aviso */ });
}

export default defineConfig({
  // build web + ssh dashboard
  customLogger: logger,
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure: (proxy) => quietProxy(proxy),
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        configure: (proxy) => quietProxy(proxy),
      },
    },
  },
});
