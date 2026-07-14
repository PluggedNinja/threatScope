import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

const sevColor = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');
function time(ts) { try { return new Date(ts).toLocaleTimeString('pt-BR'); } catch { return ''; } }

export default function WebFeed({ rows = [], newIds, silencedCount = 0, onOpenSilenced, onAddRule }) {
  const [filter, setFilter] = useState('');
  const [custom, setCustom] = useState('');
  const [blk, setBlk] = useState({}); // ip -> 'busy' | 'ok' | 'err'
  const add = () => { const v = custom.trim(); if (!v) return; onAddRule?.(v); setCustom(''); };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.ip, r.path, r.ua, r.site, r.host, r.category, r.label]
      .some((x) => String(x || '').toLowerCase().includes(q)));
  }, [rows, filter]);

  // Bloqueio rápido (todas as portas) no agente que recebeu esta requisição.
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

  return (
    <div className="panel webfeed">
      <div className="wf-head">
        <h2 style={{ margin: 0 }}>📡 Feed ao vivo · requisições WEB</h2>
        <button className="tiny" onClick={onOpenSilenced} title="Gerenciar padrões silenciados">🔇 silenciados ({silencedCount})</button>
      </div>

      <div className="wf-controls">
        <input className="wf-filter" placeholder="🔍 filtrar ip, uri, site, palavra…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="wf-ig-add">
          <input placeholder="🔇 silenciar padrão…" value={custom}
            onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="tiny" onClick={add}>silenciar</button>
        </span>
      </div>

      <div className="table-wrap wf2-wrap" style={{ height: 460 }}>
        <table className="wf2">
          <colgroup>
            <col style={{ width: 74 }} /><col style={{ width: 44 }} /><col style={{ width: 52 }} />
            <col style={{ width: 140 }} /><col /><col style={{ width: 136 }} />
            <col style={{ width: 160 }} /><col style={{ width: 56 }} /><col style={{ width: 32 }} /><col style={{ width: 30 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Hora</th><th>Risco</th><th>Método</th><th>Site atacado</th><th>Caminho</th>
              <th>Origem</th><th>Classificação</th><th>Status</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {shown.map((r) => {
                const c = sevColor(r.score || 0);
                const isNew = newIds && newIds.has(r.id);
                const site = r.host || r.site;
                const st = blk[r.ip];
                return (
                  <motion.tr key={r.id} className={(isNew ? 'row-new ' : '') + (r.hit ? 'wf2-hit' : '')}
                    initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                    <td className="tiny muted" title={r.ts}>{time(r.ts)}</td>
                    <td><span className="wf2-score" style={{ background: c, color: '#0a0f0b' }}>{r.score ?? 0}</span></td>
                    <td className={'wf2-method m-' + (r.wmethod || r.method || '')}>{r.wmethod || r.method}</td>
                    <td className="wf2-site" title={site || ''}>{site ? <span className="wf2-sitechip">{site}</span> : <span className="muted">—</span>}</td>
                    <td className="wf2-path" title={r.path}>{r.path}</td>
                    <td className="wf2-ip" title={r.ip}>{r.ip}{r.isBot && <b className="wf2-bot">bot</b>}</td>
                    <td className="wf2-cat" style={{ color: c }} title={r.label || r.category}>{r.label || r.category || '—'}</td>
                    <td className={'wf2-status s' + String(r.status || 0)[0]}>{r.hit && <span className="wf2-hitdot" title="alvo atingido">🎯</span>}{r.status || '—'}</td>
                    <td>
                      <button className={'wf2-blk' + (st === 'ok' ? ' ok' : st === 'err' ? ' err' : '')}
                        disabled={st === 'busy' || st === 'ok'}
                        title={st === 'ok' ? 'IP bloqueado' : st === 'err' ? 'falha ao bloquear' : `Bloquear ${r.ip} em ${r.agent || 'todos'}`}
                        onClick={() => quickBlock(r.ip, r.agent)}>
                        {st === 'busy' ? '…' : st === 'ok' ? '✓' : st === 'err' ? '✗' : '🚫'}
                      </button>
                    </td>
                    <td><button className="wf2-mute" title={`silenciar ${r.path}`} onClick={() => onAddRule?.(r.path)}>🔇</button></td>
                  </motion.tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 26 }}>
                  {rows.length ? 'nenhuma linha casa com o filtro.' : 'Aguardando requisições dos agentes web…'}
                </td></tr>
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('webfeed-styles')) {
  const el = document.createElement('style'); el.id = 'webfeed-styles';
  el.textContent = `
    .wf-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .wf-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:8px 0; padding-bottom:8px; border-bottom:1px solid var(--green-deep); }
    .wf-filter { flex:1; min-width:150px; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:5px 9px; font:inherit; font-size:11px; }
    .wf-filter:focus { outline:none; border-color:var(--cyan); }
    .wf-ig-add { display:inline-flex; gap:4px; }
    .wf-ig-add input { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:5px 8px; font:inherit; font-size:10.5px; width:150px; }
    .wf-ig-add input:focus { outline:none; border-color:var(--amber); }
    .webfeed { min-width:0; max-width:100%; }

    table.wf2 { width:100%; table-layout:fixed; border-collapse:collapse; }
    table.wf2 th, table.wf2 td { padding:7px 9px; text-align:left; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    table.wf2 th { font-size:9.5px; letter-spacing:1px; text-transform:uppercase; color:var(--text-dim); }
    table.wf2 tbody tr { border-top:1px solid rgba(var(--accent-rgb),0.08); }
    table.wf2 tbody tr:hover { background:rgba(var(--accent-rgb),0.07); }
    table.wf2 tbody tr.wf2-hit { background:rgba(255,59,92,0.06); box-shadow: inset 3px 0 0 #ff3b5c; }
    .wf2-score { display:inline-block; min-width:26px; text-align:center; font-weight:bold; border-radius:3px; padding:2px 5px; font-size:10.5px; }
    .wf2-method { font-weight:bold; font-size:10.5px; color:var(--text-dim); }
    .wf2-method.m-POST { color:var(--amber); } .wf2-method.m-GET { color:var(--green); }
    .wf2-site .wf2-sitechip { color:var(--green); font-size:10px; border:1px solid var(--green-deep); border-radius:2px; padding:1px 5px; }
    .wf2-path { color:var(--text); }
    .wf2-ip { color:var(--cyan); font-size:11px; }
    .wf2-bot { color:var(--text-dim); font-size:8px; font-weight:normal; border:1px solid var(--green-deep); border-radius:2px; padding:0 3px; margin-left:5px; }
    .wf2-cat { font-size:10.5px; }
    .wf2-status { font-size:10.5px; font-weight:bold; }
    .wf2-status.s2 { color:#39ff89; } .wf2-status.s3 { color:#39d0ff; } .wf2-status.s4 { color:var(--amber); } .wf2-status.s5 { color:#ff3b5c; }
    .wf2-hitdot { margin-right:3px; }
    .wf2-blk, .wf2-mute { background:none; border:1px solid transparent; border-radius:4px; cursor:pointer; font-size:12px; line-height:1; padding:2px 4px; opacity:0.5; transition:opacity .12s, border-color .12s; }
    tr:hover .wf2-blk, tr:hover .wf2-mute { opacity:1; }
    .wf2-blk:hover { border-color:var(--red); }
    .wf2-blk.ok { color:var(--green); opacity:1; cursor:default; }
    .wf2-blk.err { color:var(--amber); opacity:1; }
    .wf2-mute { filter:grayscale(1); }
    .wf2-mute:hover { filter:none; }
    @media (max-width: 1000px) { table.wf2 col:nth-child(1), table.wf2 col:nth-child(7) { width:0; } table.wf2 th:nth-child(1), table.wf2 td:nth-child(1), table.wf2 th:nth-child(7), table.wf2 td:nth-child(7) { display:none; } }
  `;
  document.head.appendChild(el);
}
