import React, { useState } from 'react';

const sevColor = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');
function ago(ts) {
  const d = Date.now() - Date.parse(ts); if (!Number.isFinite(d)) return '';
  const s = Math.round(d / 1000); if (s < 60) return s + 's'; const m = Math.round(s / 60);
  if (m < 60) return m + 'min'; const h = Math.round(m / 60); if (h < 24) return h + 'h'; return Math.round(h / 24) + 'd';
}

const WT_STR = new Set(['ip', 'category']); // colunas de texto (ordenam alfabético)
const wtVal = (g, k) => {
  switch (k) {
    case 'ip': return g.ip || '';
    case 'category': return g.categoryLabel || g.category || '';
    case 'requests': return g.requests || 0;
    case 'paths': return g.paths || 0;
    case 'hits': return g.hits || 0;
    case 'last': return Date.parse(g.last_seen) || 0;
    default: return g.maxScore || 0;
  }
};

export default function WebTable({ groups = [], onOpen }) {
  const [sort, setSort] = useState({ key: 'maxScore', dir: 'desc' });
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? groups.filter((g) => [g.ip, g.category, g.categoryLabel, g.ua].some((x) => String(x || '').toLowerCase().includes(q)))
    : groups;
  const sorted = [...filtered].sort((a, b) => {
    const va = wtVal(a, sort.key), vb = wtVal(b, sort.key);
    let cmp;
    if (WT_STR.has(sort.key)) cmp = String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
    else cmp = va - vb;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const toggle = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: WT_STR.has(k) ? 'asc' : 'desc' }));
  const Th = ({ k, children, w }) => (
    <th style={{ width: w, cursor: 'pointer' }} onClick={() => toggle(k)} className={sort.key === k ? 'wt-sorted' : ''}>
      {children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </th>
  );
  return (
    <div className="panel webtable">
      <div className="wt-head">
        <h2 style={{ margin: 0 }}>🎯 Atacantes por IP · ranking de ameaça</h2>
        <input className="wt-filter" placeholder="🔍 filtrar ip, categoria, ua…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="wt-scroll">
        <table className="wt">
          <thead>
            <tr>
              <Th k="maxScore" w="58px">Risco</Th>
              <Th k="ip">IP de origem</Th>
              <Th k="category">Categoria</Th>
              <Th k="requests" w="60px">Req</Th>
              <Th k="paths" w="56px">Paths</Th>
              <Th k="hits" w="52px">Hits</Th>
              <Th k="last" w="60px">Visto</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={7} className="muted tiny" style={{ padding: 16, textAlign: 'center' }}>Nenhum atacante web registrado ainda.</td></tr>}
            {sorted.slice(0, 200).map((g) => {
              const c = sevColor(g.maxScore);
              return (
                <tr key={g.ip} className={g.hits > 0 ? 'wt-hit' : ''} onClick={() => onOpen && onOpen(g.ip)} title="abrir dossiê deste IP">
                  <td>
                    <span className="wt-score" style={{ color: c, borderColor: c }}>{g.maxScore}</span>
                  </td>
                  <td className="wt-ip">{g.ip} {g.bot && <span className="wt-bot">bot</span>}</td>
                  <td style={{ color: c }} className="wt-cat">{g.categoryLabel || g.category}</td>
                  <td>{g.requests}</td>
                  <td>{g.paths}</td>
                  <td>{g.hits > 0 ? <span className="wt-hits">🎯 {g.hits}</span> : <span className="muted">0</span>}</td>
                  <td className="muted">{ago(g.last_seen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('webtable-styles')) {
  const el = document.createElement('style'); el.id = 'webtable-styles';
  el.textContent = `
    .wt-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
    .wt-filter { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:5px 9px; font:inherit; font-size:11px; min-width:180px; }
    .wt-filter:focus { outline:none; border-color:var(--cyan); }
    .webtable .wt-scroll { max-height:420px; overflow:auto; }
    table.wt { width:100%; border-collapse:collapse; font-size:11px; }
    table.wt th { position:sticky; top:0; background:var(--panel-solid); color:var(--text-dim); text-align:left;
      padding:6px 8px; font-size:10px; letter-spacing:1px; border-bottom:1px solid var(--green-deep); }
    table.wt th.wt-sorted { color:var(--cyan); }
    table.wt td { padding:5px 8px; border-bottom:1px solid rgba(var(--accent-rgb),0.06); color:var(--text); }
    table.wt tbody tr { cursor:pointer; }
    table.wt tbody tr:hover { background:rgba(var(--accent-rgb),0.06); }
    table.wt tr.wt-hit { background:rgba(255,59,92,0.06); }
    .wt-score { display:inline-block; min-width:30px; text-align:center; font-weight:bold; border:1px solid; border-radius:3px; padding:1px 4px; }
    .wt-ip { color:var(--cyan); }
    .wt-bot { color:var(--text-dim); font-size:8.5px; border:1px solid var(--green-deep); border-radius:2px; padding:0 3px; }
    .wt-cat { font-size:10px; }
    .wt-hits { color:#ff3b5c; font-weight:bold; }
  `;
  document.head.appendChild(el);
}
