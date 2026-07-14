import React, { useState } from 'react';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

// Serviços comuns oferecidos como atalho de porta.
const SERVICES = [
  { port: 22, label: 'SSH' }, { port: 80, label: 'HTTP' }, { port: 443, label: 'HTTPS' },
  { port: 21, label: 'FTP' }, { port: 23, label: 'Telnet' }, { port: 25, label: 'SMTP' },
  { port: 3389, label: 'RDP' }, { port: 3306, label: 'MySQL' }, { port: 5432, label: 'Postgres' },
  { port: 6379, label: 'Redis' }, { port: 445, label: 'SMB' }, { port: 5900, label: 'VNC' },
];

// Botão de bloqueio de IP no firewall do agente (ufw se ativo, senão iptables).
// Permite escolher TODAS as portas ou serviços/portas específicas.
export default function BlockIpButton({ ip, tags = [], suggestedPorts = [] }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [scope, setScope] = useState('');
  const [mode, setMode] = useState('all');           // 'all' | 'ports'
  const [sel, setSel] = useState(() => new Set(suggestedPorts)); // portas marcadas
  const [custom, setCustom] = useState('');

  const gatherPorts = () => {
    if (mode === 'all') return null;
    const extra = custom.split(/[\s,;]+/).map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
    const all = [...new Set([...sel, ...extra])];
    return all.length ? all : null; // sem porta marcada = cai para todas
  };
  const toggle = (p) => setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const doBlock = async (allAgents) => {
    setBusy(true); sfx.click();
    const ports = gatherPorts();
    try {
      const r = await api.blockIp(ip, allAgents ? null : (tags.length ? tags : null), ports);
      setRes(r.results || []); setScope(allAgents ? 'all' : 'hit');
      if ((r.results || []).some((x) => x.ok)) sfx.success();
    } catch (e) { setRes([{ agent: '—', ok: false, error: e.message }]); }
    finally { setBusy(false); }
  };

  return (
    <div className="blk">
      {!res && (
        <div className="blk-form">
          <div className="blk-mode">
            <label><input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> Todas as portas</label>
            <label><input type="radio" checked={mode === 'ports'} onChange={() => setMode('ports')} /> Serviços/portas específicas</label>
          </div>
          {mode === 'ports' && (
            <div className="blk-ports">
              <div className="blk-svc">
                {SERVICES.map((s) => (
                  <button key={s.port} type="button" className={'blk-chip' + (sel.has(s.port) ? ' on' : '')} onClick={() => toggle(s.port)}>
                    {s.label} <span className="muted">{s.port}</span>
                  </button>
                ))}
              </div>
              <input className="blk-custom" placeholder="portas extras: 8080, 2222…" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </div>
          )}
          <button className="tiny danger" disabled={busy} onClick={() => doBlock(false)}>
            {busy ? <><span className="spinner" /> bloqueando…</> : `🚫 Bloquear IP (${mode === 'all' ? 'todas as portas' : 'portas selecionadas'})`}
          </button>
        </div>
      )}
      {res && (
        <div className="blk-res">
          <div className="tiny muted">Bloqueio em {scope === 'all' ? 'TODOS os agentes' : (tags.length ? 'agentes atingidos' : 'todos os agentes')}:</div>
          {res.length === 0 && <div className="tiny muted">nenhum agente alvo.</div>}
          {res.map((x, i) => (
            <div key={i} className="blk-line" style={{ color: x.ok ? 'var(--green)' : 'var(--amber)' }}>
              {x.ok ? '✓' : '✗'} {x.agent}{x.error ? ` — ${x.error}` : (x.ok ? ` bloqueado${x.ports && x.ports.length ? ` (portas ${x.ports.join(',')})` : ''}${x.method ? ` [${x.method}]` : ''}` : '')}
              {x.note && <div className="tiny" style={{ color: 'var(--amber)', marginLeft: 14 }}>⚠ {x.note}</div>}
            </div>
          ))}
          {scope === 'hit' && tags.length > 0 && (
            <button className="tiny danger" disabled={busy} onClick={() => doBlock(true)}>
              {busy ? <><span className="spinner" /> …</> : '🚫 Bloquear também em TODOS os agentes'}
            </button>
          )}
          <button className="tiny" onClick={() => setRes(null)}>↺ novo bloqueio</button>
        </div>
      )}
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('blk-styles')) {
  const el = document.createElement('style'); el.id = 'blk-styles';
  el.textContent = `
    .blk { display:inline-flex; flex-direction:column; gap:5px; }
    .blk-form { display:flex; flex-direction:column; gap:6px; }
    .blk-mode { display:flex; flex-direction:column; gap:2px; font-size:11.5px; color:var(--text); }
    .blk-mode label { display:flex; align-items:center; gap:6px; cursor:pointer; }
    .blk-ports { display:flex; flex-direction:column; gap:5px; }
    .blk-svc { display:flex; flex-wrap:wrap; gap:4px; }
    .blk-chip { font-size:10.5px; padding:2px 7px; border-radius:11px; border:1px solid var(--green-deep); background:var(--bg-0); color:var(--text-dim); cursor:pointer; }
    .blk-chip.on { color:var(--red); border-color:var(--red); background:rgba(255,59,92,0.08); }
    .blk-chip .muted { opacity:0.55; }
    .blk-custom { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:4px 7px; font:inherit; font-size:11px; }
    .blk-res { display:flex; flex-direction:column; gap:3px; border:1px solid var(--red-deep,#5a1620); border-radius:3px; padding:6px 9px; background:rgba(255,59,92,0.05); }
    .blk-line { font-size:11px; }
  `;
  document.head.appendChild(el);
}
