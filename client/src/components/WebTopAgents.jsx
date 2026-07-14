import React from 'react';

// TOP agentes que mais recebem requisições web (barra horizontal por servidor).
export default function WebTopAgents({ agents = [] }) {
  const list = [...agents]
    .map((a) => ({ name: a.name || a.host, req: a.webAttempts || 0, hits: a.webHits || 0, online: a.online }))
    .filter((a) => a.req > 0)
    .sort((a, b) => b.req - a.req)
    .slice(0, 10);
  const max = Math.max(1, ...list.map((a) => a.req));

  return (
    <div className="panel wta">
      <h2>🎯 TOP agentes mais atacados <span className="tiny muted">(requisições web)</span></h2>
      {list.length === 0 && <div className="muted tiny" style={{ padding: 12 }}>Sem requisições web registradas ainda.</div>}
      <div className="wta-list">
        {list.map((a) => (
          <div key={a.name} className="wta-row" title={`${a.req.toLocaleString('pt-BR')} requisições · ${a.hits} hit(s)`}>
            <span className="wta-name">
              <span className={'wta-dot ' + (a.online ? 'on' : 'off')} /> {a.name}
            </span>
            <span className="wta-bar-wrap">
              <span className="wta-bar" style={{ width: `${(a.req / max) * 100}%` }} />
            </span>
            <span className="wta-val">{a.req.toLocaleString('pt-BR')}{a.hits > 0 && <b className="wta-hits"> · {a.hits}🎯</b>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('wta-styles')) {
  const el = document.createElement('style'); el.id = 'wta-styles';
  el.textContent = `
    .wta-list { display:flex; flex-direction:column; gap:7px; margin-top:8px; }
    .wta-row { display:grid; grid-template-columns: minmax(90px,150px) minmax(0,1fr) auto; align-items:center; gap:10px; font-size:11px; }
    .wta-name { color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:6px; }
    .wta-dot { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
    .wta-dot.on { background:var(--green); box-shadow:0 0 6px var(--green); } .wta-dot.off { background:var(--red); }
    .wta-bar-wrap { height:12px; background:rgba(var(--accent-rgb),0.06); border:1px solid var(--green-deep); border-radius:3px; overflow:hidden; }
    .wta-bar { display:block; height:100%; background:linear-gradient(90deg, rgba(44,232,255,0.5), #2ce8ff); box-shadow:0 0 8px rgba(44,232,255,0.4); transition:width .5s ease; }
    .wta-val { color:var(--cyan); font-weight:bold; white-space:nowrap; text-align:right; }
    .wta-hits { color:#ff3b5c; font-weight:bold; }
  `;
  document.head.appendChild(el);
}
