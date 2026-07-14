import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { WORLD_PATH, WORLD_VIEWBOX } from '../worldPath.js';

// Projeção equirectangular (bate com o viewBox 0 0 1000 500 do worldPath).
const W = 1000, H = 500;
const project = (lat, lon) => ({ x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H });

// Posto de comando: servidores do operador ficam no Brasil (domínios azzi).
const COMMAND = { lat: -15.8, lon: -47.9, label: 'COMANDO' };

// Janela ao vivo: ataque some do mapa X após a última tentativa daquele IP (configurável).
const WINDOW_OPTS = [
  { label: '1 min', ms: 60 * 1000 },
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 h', ms: 60 * 60 * 1000 },
  { label: '6 h', ms: 6 * 60 * 60 * 1000 },
  { label: '24 h', ms: 24 * 60 * 60 * 1000 },
];
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1h (SSH é mais esparso que o sensor de rede)
const FRESH_MS = 18 * 1000;   // "acontecendo agora"
const POLL_MS = 8 * 1000;     // frequência de varredura
const SPAWN_MS = 1800;        // duração do "impacto" ao surgir

const THREAT = [
  { name: 'CALMO', min: 0, color: 'var(--green)' },
  { name: 'VIGIA', min: 6, color: 'var(--cyan)' },
  { name: 'ELEVADO', min: 20, color: 'var(--amber)' },
  { name: 'ALERTA', min: 45, color: '#ff8c38' },
  { name: 'CRÍTICO', min: 90, color: 'var(--red)' },
];
function levelFor(rate) { let i = 0; for (let k = 0; k < THREAT.length; k++) if (rate >= THREAT[k].min) i = k; return i; }

// Cor por RECÊNCIA: vermelho = agora, esfria para âmbar/verde e apaga ao envelhecer.
function coolColor(freshness) {
  if (freshness > 0.94) return '#ff4d6d';
  if (freshness > 0.6) return 'var(--amber)';
  if (freshness > 0.3) return 'var(--green)';
  return 'var(--green-dim)';
}
const idFor = (ip) => 'arc-' + String(ip).replace(/[^a-zA-Z0-9]/g, '-');

function arcPath(s, cmd) {
  const mx = (s.x + cmd.x) / 2, my = (s.y + cmd.y) / 2;
  const dx = cmd.x - s.x, dy = cmd.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(len * 0.22, 70);
  const cX = mx + (-dy / len) * bow, cY = my + (dx / len) * bow;
  return `M${s.x},${s.y} Q${cX},${cY} ${cmd.x},${cmd.y}`;
}

// Injeta os estilos do mapa uma vez, direto no <head> (robusto a re-render).
function useMapStyles() {
  useEffect(() => {
    if (document.getElementById('atk-styles')) return;
    const el = document.createElement('style');
    el.id = 'atk-styles';
    el.textContent = MAP_CSS;
    document.head.appendChild(el);
  }, []);
}

export default function AttackMap({ filters, pings = 0 }) {
  useMapStyles();
  const [raw, setRaw] = useState({ points: [], geoDisabled: false, resolved: 0, ips: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [hover, setHover] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [rate, setRate] = useState(0);
  const [windowMs, setWindowMs] = useState(() => {
    try { return Number(localStorage.getItem('threatscope-atk-window2')) || DEFAULT_WINDOW_MS; } catch { return DEFAULT_WINDOW_MS; }
  });
  const windowLabel = (WINDOW_OPTS.find((o) => o.ms === windowMs) || { label: '1 h' }).label;
  useEffect(() => { try { localStorage.setItem('threatscope-atk-window2', String(windowMs)); } catch {} }, [windowMs]);

  const pingTimes = useRef([]);
  const firstSeen = useRef(new Map()); // ip -> timestamp em que apareceu no mapa
  const lastFetch = useRef(0);
  const fkey = JSON.stringify(filters || {});

  const load = React.useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const since = new Date(Date.now() - windowMs).toISOString();
      const d = await api.geo({ ...(filters || {}), from: since });
      setRaw(d); setErr(false);
    } catch { setErr(true); }
    finally { setLoading(false); }
  }, [fkey, windowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // varredura periódica + quando os filtros mudam
  useEffect(() => { load(); const iv = setInterval(load, POLL_MS); return () => clearInterval(iv); }, [load]);

  // um ataque novo chegou pelo WebSocket -> varre logo (com trava de 3s)
  useEffect(() => {
    if (!pings) return;
    pingTimes.current.push(Date.now());
    if (Date.now() - lastFetch.current > 3000) load();
  }, [pings]); // eslint-disable-line react-hooks/exhaustive-deps

  // relógio do mapa (recalcula idades, esfria e remove aos 5 min)
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  // taxa de ataques/min (janela de 60s)
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      pingTimes.current = pingTimes.current.filter((x) => t - x < 60000);
      setRate(pingTimes.current.length);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const cmd = project(COMMAND.lat, COMMAND.lon);

  // pontos ativos (dentro da janela), enriquecidos com idade/frescor
  const points = useMemo(() => {
    const list = [];
    const seenNow = new Set();
    for (const p of (raw.points || [])) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const last = Date.parse(p.last_seen);
      if (!last) continue;
      const age = now - last;
      if (age > windowMs) continue;
      const key = p.ip + '|' + (p.agent || '');
      seenNow.add(key);
      if (!firstSeen.current.has(key)) firstSeen.current.set(key, now);
      const freshness = Math.max(0, 1 - age / windowMs);
      const s = project(p.lat, p.lon);
      list.push({
        ...p, key, s, age, freshness,
        hot: age <= FRESH_MS,
        spawnAge: now - (firstSeen.current.get(key) || now),
      });
    }
    // limpa chaves que saíram da janela (pra o "spawn" tocar de novo se voltarem)
    for (const k of firstSeen.current.keys()) if (!seenNow.has(k)) firstSeen.current.delete(k);
    return list.sort((a, b) => b.freshness - a.freshness).slice(0, 160);
  }, [raw, now, windowMs]);

  // Nós de destino: cada AGENTE no seu lugar no mapa (geo do IP do servidor).
  const agentNodes = useMemo(() => (raw.agents || [])
    .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
    .map((a) => ({ ...a, ...project(a.lat, a.lon) })), [raw.agents]);
  const nodeByTag = useMemo(() => { const m = new Map(); agentNodes.forEach((n) => m.set(n.tag, n)); return m; }, [agentNodes]);
  // fallback quando o agente do ponto não tem geo: centroide dos agentes, ou o comando padrão.
  const homeFallback = useMemo(() => {
    if (agentNodes.length) {
      const x = agentNodes.reduce((s, n) => s + n.x, 0) / agentNodes.length;
      const y = agentNodes.reduce((s, n) => s + n.y, 0) / agentNodes.length;
      return { x, y };
    }
    return project(COMMAND.lat, COMMAND.lon);
  }, [agentNodes]);
  const destFor = React.useCallback((p) => nodeByTag.get(p.agent) || homeFallback, [nodeByTag, homeFallback]);

  const happeningNow = points.filter((p) => p.hot).length;
  const hotPoints = points.filter((p) => p.hot).slice(0, 24); // projéteis só nos quentes
  const maxAtt = points.reduce((m, p) => Math.max(m, p.attempts), 0);

  const countries = useMemo(() => {
    const m = new Map();
    for (const p of points) {
      const key = p.country || '—';
      const g = m.get(key) || { country: key, flag: p.flag, attempts: 0, hosts: 0 };
      g.attempts += p.attempts; g.hosts += 1; m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.attempts - a.attempts).slice(0, 6);
  }, [points]);

  const lvl = levelFor(rate);
  const threat = THREAT[lvl];

  return (
    <div className="panel atk-wrap">
      <div className="atk-head">
        <h2 style={{ margin: 0 }}>🌐 Mapa de ameaças · ao vivo</h2>
        <select className="atk-window" value={windowMs} title="Janela de amostragem"
          onChange={(e) => setWindowMs(Number(e.target.value))}>
          {WINDOW_OPTS.map((o) => <option key={o.ms} value={o.ms}>⏱ {o.label}</option>)}
        </select>
        <div className="atk-counts">
          <span className="atk-live"><span className="atk-live-dot" />{happeningNow} agora</span>
          <span className="atk-active">{points.length} ativos</span>
        </div>
        <div className="atk-threat">
          <span className="atk-threat-label">NÍVEL</span>
          <div className="atk-threat-bars">
            {THREAT.map((t, i) => (
              <span key={t.name} className={'atk-seg' + (i <= lvl ? ' on' : '')}
                style={{ background: i <= lvl ? threat.color : 'transparent', borderColor: threat.color }} />
            ))}
          </div>
          <span className="atk-threat-name" style={{ color: threat.color, textShadow: `0 0 8px ${threat.color}` }}>{threat.name}</span>
          <span className="atk-rate">{rate}/min</span>
        </div>
      </div>

      <div className="atk-map">
        <svg viewBox={WORLD_VIEWBOX} preserveAspectRatio="xMidYMid meet" className="atk-svg">
          <defs>
            <radialGradient id="atkOcean" cx="50%" cy="35%" r="75%">
              <stop offset="0%" stopColor="rgba(var(--accent-rgb),0.10)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id="atkGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="url(#atkOcean)" />
          <g stroke="rgba(var(--accent-rgb),0.06)" strokeWidth="0.6">
            {[...Array(11)].map((_, i) => <line key={'v' + i} x1={i * 100} y1="0" x2={i * 100} y2={H} />)}
            {[...Array(6)].map((_, i) => <line key={'h' + i} x1="0" y1={i * 100} x2={W} y2={i * 100} />)}
          </g>
          <path d={WORLD_PATH} className="atk-land" />

          {/* arcos ataque -> AGENTE que ele atingiu (id p/ os projéteis seguirem) */}
          <g fill="none">
            {points.map((p) => (
              <path key={'a' + p.key} id={idFor(p.key)} d={arcPath(p.s, destFor(p))}
                className={'atk-arc' + (p.hot ? ' hot' : '')}
                style={{ stroke: coolColor(p.freshness), opacity: 0.12 + p.freshness * 0.5 }} />
            ))}
          </g>

          {/* projéteis viajando pela linha (só ataques acontecendo agora) */}
          <g>
            {hotPoints.map((p) => (
              <circle key={'j' + p.key} r="2.6" fill="#fff" className="atk-jet">
                <animateMotion dur="1.5s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                  <mpath href={'#' + idFor(p.key)} />
                </animateMotion>
              </circle>
            ))}
          </g>

          {/* pontos de origem */}
          <g>
            {points.map((p) => {
              const r = Math.min(2 + Math.sqrt(p.attempts) * 0.7, 7);
              const c = coolColor(p.freshness);
              const spawning = p.spawnAge < SPAWN_MS;
              return (
                <g key={'p' + p.key} transform={`translate(${p.s.x},${p.s.y})`}
                  onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  {/* impacto ao surgir (uma vez, guiado por CSS) */}
                  {spawning && <circle r={r} className="atk-spawn" style={{ stroke: c }} />}
                  {/* pulso contínuo enquanto está "quente" */}
                  {p.hot && <circle r={r + 7} className="atk-ping" style={{ stroke: c }} />}
                  <circle r={r} fill={c} filter="url(#atkGlow)" style={{ opacity: 0.35 + p.freshness * 0.65 }} />
                  {p.hot && <circle r={Math.max(1.2, r - 1.6)} fill="#fff" opacity="0.9" />}
                </g>
              );
            })}
          </g>

          {/* AGENTES — cada servidor no seu lugar no mapa (destino dos ataques) */}
          <g>
            {agentNodes.length === 0 && (
              <g transform={`translate(${homeFallback.x},${homeFallback.y})`}>
                <circle r="14" className={'atk-cmd-ring' + (happeningNow ? ' busy' : '')} />
                <circle r="3.4" fill="var(--cyan)" filter="url(#atkGlow)" />
              </g>
            )}
            {agentNodes.map((n) => (
              <g key={'n' + n.tag} transform={`translate(${n.x},${n.y})`}
                onMouseEnter={() => setHover({ agentNode: n, s: n })} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                <circle r="13" className={'atk-cmd-ring' + (happeningNow ? ' busy' : '')} style={{ stroke: n.online ? 'var(--cyan)' : 'var(--text-dim)' }} />
                <circle r="8" className={'atk-cmd-ring' + (happeningNow ? ' busy' : '')} style={{ animationDelay: '0.6s', stroke: n.online ? 'var(--cyan)' : 'var(--text-dim)' }} />
                <circle r="3.2" fill={n.online ? 'var(--cyan)' : 'var(--text-dim)'} filter="url(#atkGlow)" />
                <path d="M0,-6 L0,6 M-6,0 L6,0" stroke={n.online ? 'var(--cyan)' : 'var(--text-dim)'} strokeWidth="0.8" opacity="0.85" />
                <text x="0" y="-16" textAnchor="middle" className="atk-node-label">{n.flag ? n.flag + ' ' : ''}{n.name}</text>
              </g>
            ))}
          </g>
        </svg>

        {loading && <div className="atk-msg">🛰️ triangulando origens…</div>}
        {!loading && raw.geoDisabled && <div className="atk-msg">🔒 GeoIP desligado (GEOIP_DISABLE=1). Ligue para ver o mapa.</div>}
        {!loading && !raw.geoDisabled && !err && points.length === 0 &&
          <div className="atk-msg">Sem ataques nos últimos {windowLabel}. Aumente a janela ⏱ (no topo do mapa) para ver o histórico. 🛡️</div>}
        {!loading && err && <div className="atk-msg">Sem conexão com a central (:4000).</div>}

        {hover && hover.agentNode && (
          <div className="atk-tip" style={{ left: `${(hover.s.x / W) * 100}%`, top: `${(hover.s.y / H) * 100}%` }}>
            <div className="atk-tip-ip" style={{ color: 'var(--cyan)' }}>🛡️ {hover.agentNode.name}</div>
            <div className="atk-tip-row">{[hover.agentNode.city, hover.agentNode.country].filter(Boolean).join(', ') || hover.agentNode.host}</div>
            <div className="atk-tip-row">{hover.agentNode.online ? 'online' : 'offline'} · destino dos ataques a este servidor</div>
          </div>
        )}
        {hover && !hover.agentNode && (
          <div className="atk-tip" style={{ left: `${(hover.s.x / W) * 100}%`, top: `${(hover.s.y / H) * 100}%` }}>
            <div className="atk-tip-ip">{hover.flag ? hover.flag + ' ' : ''}{hover.ip}
              {hover.hot && <span className="atk-tip-now"> ● AGORA</span>}</div>
            <div className="atk-tip-row">{[hover.city, hover.country].filter(Boolean).join(', ') || 'origem desconhecida'}</div>
            <div className="atk-tip-row"><b style={{ color: 'var(--amber)' }}>{hover.attempts}</b> tentativas → <b style={{ color: 'var(--cyan)' }}>{hover.agent || '—'}</b> · há {Math.max(0, Math.round(hover.age / 1000))}s</div>
            {hover.org && <div className="atk-tip-org">{hover.org}</div>}
          </div>
        )}
      </div>

      <div className="atk-foot">
        <div className="atk-legend">
          {countries.length === 0
            ? <span className="atk-dim">nenhuma origem ativa</span>
            : countries.map((c) => (
              <span key={c.country} className="atk-chip" title={`${c.hosts} host(s)`}>
                {c.flag ? c.flag + ' ' : ''}{c.country} <b>{c.attempts}</b>
              </span>
            ))}
        </div>
        <div className="atk-dim atk-count">
          {(() => {
            const unplaced = (raw.agents || []).filter((a) => !a.located);
            return unplaced.length ? (
              <span title={unplaced.map((a) => `${a.name}: ${a.reason}`).join('\n')} style={{ color: 'var(--amber)' }}>
                ⚠ {unplaced.length} sem localização ({unplaced.map((a) => a.name).join(', ')})
              </span>
            ) : null;
          })()}
          <span style={{ marginLeft: 8 }}>janela de {windowLabel} · {agentNodes.length || '—'} agente(s) no mapa</span>
        </div>
      </div>
    </div>
  );
}

const MAP_CSS = `
  .atk-wrap { overflow: hidden; }
  .atk-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
  .atk-counts { display:flex; gap:10px; align-items:center; font-size:11px; letter-spacing:1px; }
  .atk-live { display:inline-flex; align-items:center; gap:6px; color:#ff4d6d; font-weight:bold; }
  .atk-live-dot { width:8px; height:8px; border-radius:50%; background:#ff4d6d; box-shadow:0 0 8px #ff4d6d; animation: atkBlink 1s infinite; }
  @keyframes atkBlink { 0%,100%{opacity:1;} 50%{opacity:.25;} }
  .atk-active { color: var(--text-dim); }
  .atk-window { background: var(--bg-0); border:1px solid var(--green-deep); color: var(--text); border-radius:3px;
    padding:3px 6px; font:inherit; font-size:10.5px; cursor:pointer; }
  .atk-window:focus { outline:none; border-color: var(--cyan); }
  .atk-threat { display:flex; align-items:center; gap:8px; font-size:10px; letter-spacing:1px; }
  .atk-threat-label { color: var(--text-dim); }
  .atk-threat-bars { display:flex; gap:3px; }
  .atk-seg { width:16px; height:9px; border:1px solid var(--green-dim); border-radius:1px; transition: background .3s; }
  .atk-seg.on { box-shadow: 0 0 6px currentColor; }
  .atk-threat-name { font-weight:bold; letter-spacing:2px; }
  .atk-rate { color: var(--text-dim); }
  .atk-map { position:relative; width:100%; aspect-ratio: 2 / 1; overflow:hidden; border-radius:3px;
    border:1px solid var(--green-deep);
    background: radial-gradient(120% 100% at 50% 0%, rgba(var(--accent-rgb),0.05), transparent 60%), var(--bg-0); }
  .atk-svg { display:block; width:100%; height:100%; }
  .atk-land { fill: rgba(var(--accent-rgb),0.07); stroke: rgba(var(--accent-rgb),0.5); stroke-width:0.5; }
  .atk-arc { stroke-width:0.9; stroke-dasharray: 6 180; stroke-dashoffset: 186; animation: atkTracer 3.4s linear infinite; }
  .atk-arc.hot { stroke-width:1.3; stroke-dasharray: 10 90; animation-duration: 1.6s; }
  @keyframes atkTracer { to { stroke-dashoffset: 0; } }
  .atk-jet { filter: drop-shadow(0 0 4px #fff); }
  .atk-ping { fill:none; stroke-width:1; opacity:0; transform-box: fill-box; transform-origin:center; animation: atkPing 2.4s ease-out infinite; }
  @keyframes atkPing { 0%{opacity:.9; transform:scale(0.35);} 70%{opacity:0;} 100%{opacity:0; transform:scale(1.7);} }
  .atk-spawn { fill:none; stroke-width:1.4; opacity:.9; transform-box: fill-box; transform-origin:center; animation: atkSpawn 1.8s ease-out forwards; }
  @keyframes atkSpawn { 0%{opacity:1; transform:scale(0.2);} 100%{opacity:0; transform:scale(6);} }
  .atk-cmd-ring { fill:none; stroke: var(--cyan); stroke-width:1; opacity:0; transform-box: fill-box; transform-origin:center; animation: atkCmd 2.4s ease-out infinite; }
  .atk-cmd-ring.busy { stroke:#ff4d6d; animation-duration: 1.1s; }
  .atk-node-label { fill: var(--cyan); font-size:8px; font-family: inherit; letter-spacing:0.5px;
    paint-order: stroke; stroke: rgba(0,0,0,0.7); stroke-width:2px; }
  @keyframes atkCmd { 0%{opacity:.85; transform:scale(0.4);} 80%{opacity:0;} 100%{opacity:0; transform:scale(1.5);} }
  .atk-msg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center;
    padding:20px; color: var(--text-dim); font-size:12px; letter-spacing:1px; background: rgba(6,10,7,0.35); }
  .atk-tip { position:absolute; transform: translate(-50%, calc(-100% - 12px)); z-index:5; pointer-events:none;
    background: var(--panel-solid); border:1px solid var(--green-dim); border-radius:3px; padding:7px 9px;
    min-width:150px; box-shadow: 0 0 18px rgba(0,0,0,0.7); }
  .atk-tip-ip { color: var(--green); font-size:12px; font-weight:bold; margin-bottom:2px; }
  .atk-tip-now { color:#ff4d6d; font-weight:bold; animation: atkBlink 1s infinite; }
  .atk-tip-row { color: var(--text); font-size:10.5px; line-height:1.5; }
  .atk-tip-org { color: var(--text-dim); font-size:9.5px; margin-top:3px; max-width:190px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .atk-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:10px; }
  .atk-legend { display:flex; gap:6px; flex-wrap:wrap; }
  .atk-chip { font-size:10px; color: var(--text); border:1px solid var(--green-deep); border-radius:2px; padding:2px 7px; background: rgba(var(--accent-rgb),0.05); }
  .atk-chip b { color: var(--amber); }
  .atk-dim { color: var(--text-dim); font-size:10px; }
  .atk-count { text-align:right; }
`;
