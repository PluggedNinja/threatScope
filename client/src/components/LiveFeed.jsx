import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Hint from './Hint.jsx';
import Pagination from './Pagination.jsx';
import IpName from './IpName.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

function rel(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return new Date(ts).toLocaleString('pt-BR');
}

export default function LiveFeed({ rows, newIds }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [blk, setBlk] = useState({}); // ip -> 'busy' | 'ok' | 'err'

  // Bloqueio rápido (todas as portas) no(s) agente(s) que viram este IP.
  const quickBlock = async (ip, agent) => {
    if (!ip || blk[ip] === 'busy') return;
    setBlk((s) => ({ ...s, [ip]: 'busy' })); sfx.click();
    try {
      const r = await api.blockIp(ip, agent ? [agent] : null, null);
      const ok = (r.results || []).some((x) => x.ok);
      setBlk((s) => ({ ...s, [ip]: ok ? 'ok' : 'err' }));
      ok ? sfx.success() : sfx.alert();
    } catch { setBlk((s) => ({ ...s, [ip]: 'err' })); }
  };

  const total = rows.length;
  useEffect(() => {
    const pc = Math.max(1, Math.ceil(total / pageSize));
    if (page > pc) setPage(pc);
  }, [total, pageSize, page]);

  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return (
    <div className="panel">
      <h2>Feed ao vivo <Hint>Cada linha é uma tentativa capturada. Novas tentativas piscam em vermelho e tocam um beep. Novas chegam sempre no topo da primeira página.</Hint></h2>
      <div className="table-wrap" style={{ height: 540 }}>
        <table>
          <thead>
            <tr>
              <th>Quando</th><th>Servidor</th><th>IP origem</th>
              <th>Usuário</th><th>Senha</th><th>Método</th><th>Cliente</th><th></th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {pageRows.map((r) => (
                <motion.tr
                  key={r.id}
                  className={newIds.has(r.id) ? 'row-new' : ''}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <td className="tiny" title={r.ts}>{rel(r.ts)}</td>
                  <td className="tiny" style={{ color: 'var(--green)' }} title={r.agent}>{r.agent || '—'}</td>
                  <td><IpName ip={r.ip} /></td>
                  <td className="cred">{r.username || <span className="muted">∅</span>}</td>
                  <td className="cred">{r.password || <span className="muted">∅</span>}</td>
                  <td className="tiny">{r.method}</td>
                  <td className="tiny muted" title={r.client}>{(r.client || '').slice(0, 26) || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className={'lf-blk' + (blk[r.ip] === 'ok' ? ' ok' : blk[r.ip] === 'err' ? ' err' : '')}
                      disabled={blk[r.ip] === 'busy' || blk[r.ip] === 'ok'}
                      title={blk[r.ip] === 'ok' ? 'IP bloqueado' : blk[r.ip] === 'err' ? 'falha ao bloquear' : `Bloquear ${r.ip} (todas as portas) em ${r.agent || 'todos'}`}
                      onClick={() => quickBlock(r.ip, r.agent)}
                    >
                      {blk[r.ip] === 'busy' ? '…' : blk[r.ip] === 'ok' ? '✓' : blk[r.ip] === 'err' ? '✗' : '🚫'}
                    </button>
                  </td>
                </motion.tr>
              ))}
              {total === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  Aguardando o primeiro ataque… o perímetro está armado. 🪤
                </td></tr>
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
      )}
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('lf-blk-styles')) {
  const el = document.createElement('style'); el.id = 'lf-blk-styles';
  el.textContent = `
    .lf-blk { background:none; border:1px solid transparent; border-radius:4px; cursor:pointer; font-size:12px; line-height:1; padding:2px 5px; opacity:0.55; transition:opacity .12s, border-color .12s; }
    tr:hover .lf-blk { opacity:1; }
    .lf-blk:hover { border-color:var(--red); }
    .lf-blk.ok { color:var(--green); opacity:1; cursor:default; }
    .lf-blk.err { color:var(--amber); opacity:1; }
    .lf-blk:disabled { cursor:default; }
  `;
  document.head.appendChild(el);
}
