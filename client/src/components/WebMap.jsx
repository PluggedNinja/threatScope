import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORLD_PATH } from '../worldPath.js';

// Espaço virtual = viewBox do worldPath (0..1000 x 0..500). Projeção equirectangular.
const VW = 1000, VH = 500;
const project = (lat, lon) => ({ x: ((lon + 180) / 360) * VW, y: ((90 - lat) / 180) * VH });
const COMMAND = { lat: -15.8, lon: -47.9 }; // posto de comando no Brasil

// Cor por severidade do score (0-100).
function sevColor(score) {
  if (score >= 85) return '#ff3b5c';
  if (score >= 60) return '#ff8c38';
  if (score >= 35) return '#ffcf3a';
  if (score >= 10) return '#39d0ff';
  return '#39ff89';
}
function sevName(score) {
  if (score >= 85) return 'CRÍTICO';
  if (score >= 60) return 'ALTO';
  if (score >= 35) return 'MÉDIO';
  if (score >= 10) return 'BAIXO';
  return 'INFO';
}

const SPEEDS = [
  { label: '×30', v: 30 }, { label: '×120', v: 120 },
  { label: '×600', v: 600 }, { label: '×3000', v: 3000 },
];
const WINDOW_OPTS = [
  { label: '5 min', ms: 5 * 60 * 1000 },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 h', ms: 60 * 60 * 1000 },
  { label: '6 h', ms: 6 * 60 * 60 * 1000 },
  { label: '24 h', ms: 24 * 60 * 60 * 1000 },
  { label: 'Tudo', ms: 0 },
];
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1h — sparse web é raro no ultimo 5min

const worldPath2D = typeof Path2D !== 'undefined' ? new Path2D(WORLD_PATH) : null;

function useInjectedStyles(id, css) {
  useEffect(() => {
    if (document.getElementById(id)) return;
    const el = document.createElement('style'); el.id = id; el.textContent = css;
    document.head.appendChild(el);
  }, [id, css]);
}

export default function WebMap({ points = [], events = [], liveEvent = null, agentNodes = [] }) {
  useInjectedStyles('webmap-styles', MAP_CSS);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const arcsRef = useRef([]);       // arcos ativos
  const rippleRef = useRef([]);     // impactos no comando
  const sizeRef = useRef({ w: 1000, h: 500, dpr: 1 });
  const [mode, setMode] = useState('live'); // 'live' | 'replay'
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [progress, setProgress] = useState(0); // 0..1
  const [simClock, setSimClock] = useState(null);
  const [hover, setHover] = useState(null);
  const [windowMs, setWindowMs] = useState(() => {
    try { const v = localStorage.getItem('webhoney-map-window2'); return v === null ? DEFAULT_WINDOW_MS : Number(v); } catch { return DEFAULT_WINDOW_MS; }
  });
  useEffect(() => { try { localStorage.setItem('webhoney-map-window2', String(windowMs)); } catch {} }, [windowMs]);
  const modeRef = useRef(mode); modeRef.current = mode;
  const playingRef = useRef(playing); playingRef.current = playing;
  const speedRef = useRef(speed); speedRef.current = speed;

  // mapa ip -> ponto geo (coords + metadados)
  const coordsByIp = useMemo(() => {
    const m = new Map();
    for (const p of points) if (typeof p.lat === 'number') m.set(p.ip, p);
    return m;
  }, [points]);

  const pxPoints = useMemo(() => points
    .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => ({ ...p, ...project(p.lat, p.lon), score: p.maxScore || 0 })), [points]);

  // Em modo AO VIVO, mostra só origens vistas dentro da janela escolhida (0 = tudo).
  // No REPLAY mostra todas (a janela é controlada pelo scrubber).
  const shownPoints = useMemo(() => {
    if (mode === 'replay' || !windowMs) return pxPoints;
    const cut = Date.now() - windowMs;
    return pxPoints.filter((p) => { const t = Date.parse(p.last_seen); return !t || t >= cut; });
  }, [pxPoints, windowMs, mode]);
  const windowLabel = (WINDOW_OPTS.find((o) => o.ms === windowMs) || { label: '—' }).label;

  const cmd = project(COMMAND.lat, COMMAND.lon);

  // ------- AGENTES: cada servidor no seu lugar (destino dos ataques) -------
  const nodesPx = useMemo(() => (agentNodes || [])
    .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number')
    .map((a) => ({ ...a, ...project(a.lat, a.lon) })), [agentNodes]);
  const nodeByTag = useMemo(() => { const m = new Map(); nodesPx.forEach((n) => m.set(n.tag, n)); return m; }, [nodesPx]);
  const homeFallback = useMemo(() => {
    if (nodesPx.length) return { x: nodesPx.reduce((s, n) => s + n.x, 0) / nodesPx.length, y: nodesPx.reduce((s, n) => s + n.y, 0) / nodesPx.length };
    return cmd;
  }, [nodesPx, cmd.x, cmd.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const destForTag = useCallback((tag) => nodeByTag.get(tag) || homeFallback, [nodeByTag, homeFallback]);
  // refs para o loop de animação (que roda fora do ciclo de render)
  const nodesRef = useRef(nodesPx); nodesRef.current = nodesPx;
  const destRef = useRef(destForTag); destRef.current = destForTag;
  const homeRef = useRef(homeFallback); homeRef.current = homeFallback;

  // ------- disparo de um arco (origem -> AGENTE atingido) -------
  const spawnArc = useCallback((lat, lon, score, hit, dest) => {
    const s = project(lat, lon);
    const d = dest || homeRef.current;
    const mx = (s.x + d.x) / 2, my = (s.y + d.y) / 2;
    const dx = d.x - s.x, dy = d.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(len * 0.28, 90);
    const cx = mx + (-dy / len) * bow, cy = my + (dx / len) * bow;
    arcsRef.current.push({
      sx: s.x, sy: s.y, cx, cy, ex: d.x, ey: d.y,
      t: 0, speed: 0.6 + Math.random() * 0.25, color: sevColor(score), score, hit: !!hit, done: false,
    });
    if (arcsRef.current.length > 160) arcsRef.current = arcsRef.current.slice(-160);
  }, []);

  // ------- modo AO VIVO: cada evento novo dispara um arco -------
  useEffect(() => {
    if (!liveEvent || modeRef.current !== 'live') return;
    const p = coordsByIp.get(liveEvent.ip);
    const dest = destForTag(liveEvent.agent);
    if (p) spawnArc(p.lat, p.lon, liveEvent.score ?? p.maxScore ?? 0, liveEvent.hit, dest);
    else rippleRef.current.push({ t: 0, color: sevColor(liveEvent.score || 0), x: dest.x, y: dest.y });
  }, [liveEvent, coordsByIp, spawnArc, destForTag]);

  // ------- estado do REPLAY -------
  const replay = useRef({ t0: 0, t1: 0, vt: 0, idx: 0 });
  const sortedEvents = useMemo(() => {
    const e = events.filter((x) => x.ts).slice().sort((a, b) => (a.ts < b.ts ? -1 : 1));
    return e;
  }, [events]);
  useEffect(() => {
    if (!sortedEvents.length) { replay.current = { t0: 0, t1: 0, vt: 0, idx: 0 }; return; }
    const t0 = Date.parse(sortedEvents[0].ts);
    const t1 = Date.parse(sortedEvents[sortedEvents.length - 1].ts);
    replay.current = { t0, t1: Math.max(t1, t0 + 1000), vt: t0, idx: 0 };
    setProgress(0); setSimClock(new Date(t0));
  }, [sortedEvents]);

  const enterReplay = () => {
    setMode('replay'); modeRef.current = 'replay';
    arcsRef.current = [];
    const r = replay.current; r.vt = r.t0; r.idx = 0;
    setProgress(0); setSimClock(new Date(r.t0)); setPlaying(true);
  };
  const enterLive = () => { setMode('live'); modeRef.current = 'live'; setPlaying(false); arcsRef.current = []; };

  const scrubTo = (frac) => {
    const r = replay.current; if (!r.t1) return;
    r.vt = r.t0 + (r.t1 - r.t0) * frac;
    // reposiciona o ponteiro sem disparar burst
    let i = 0; while (i < sortedEvents.length && Date.parse(sortedEvents[i].ts) <= r.vt) i++;
    r.idx = i; arcsRef.current = [];
    setProgress(frac); setSimClock(new Date(r.vt));
  };

  // ------- loop de animação -------
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf, last = performance.now();
    const themeAccent = () => {
      const s = getComputedStyle(document.documentElement);
      return {
        land: s.getPropertyValue('--accent-rgb').trim() || '57,255,137',
        cyan: (s.getPropertyValue('--cyan').trim() || '#2ce8ff'),
      };
    };
    let acc = themeAccent();
    let themeTick = 0;

    const draw = (nowT) => {
      const dt = Math.min(64, nowT - last); last = nowT;
      const { w, h, dpr } = sizeRef.current;
      if (++themeTick % 30 === 0) acc = themeAccent();

      // avanço do replay
      if (modeRef.current === 'replay' && playingRef.current) {
        const r = replay.current;
        if (r.t1 > r.t0) {
          r.vt += dt * speedRef.current;
          let spawned = 0;
          while (r.idx < sortedEvents.length && Date.parse(sortedEvents[r.idx].ts) <= r.vt) {
            const ev = sortedEvents[r.idx++];
            const p = coordsByIp.get(ev.ip);
            if (p && spawned < 50) { spawnArc(p.lat, p.lon, ev.score || 0, ev.hit, destRef.current(ev.agent)); spawned++; }
          }
          if (r.vt >= r.t1) { r.vt = r.t1; playingRef.current = false; setPlaying(false); }
          const frac = (r.vt - r.t0) / (r.t1 - r.t0);
          setProgress(frac); setSimClock(new Date(r.vt));
        }
      }

      // fundo
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform((dpr * w) / VW, 0, 0, (dpr * h) / VH, 0, 0);

      // graticule
      ctx.lineWidth = 0.5; ctx.strokeStyle = `rgba(${acc.land},0.06)`;
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) { ctx.moveTo(i * 100, 0); ctx.lineTo(i * 100, VH); }
      for (let i = 0; i <= 5; i++) { ctx.moveTo(0, i * 100); ctx.lineTo(VW, i * 100); }
      ctx.stroke();

      // continentes
      if (worldPath2D) {
        ctx.fillStyle = `rgba(${acc.land},0.08)`;
        ctx.strokeStyle = `rgba(${acc.land},0.45)`; ctx.lineWidth = 0.5;
        ctx.fill(worldPath2D); ctx.stroke(worldPath2D);
      }

      // heat + origens
      for (const p of shownPoints) {
        const col = sevColor(p.score);
        const rad = Math.min(3 + Math.sqrt(p.requests || p.attempts || 1) * 0.9, 10);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 3.2);
        g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, rad * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, rad * 0.42, 0, Math.PI * 2); ctx.fill();
        if (p.hits > 0) { // alvo atingido: anel branco
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.arc(p.x, p.y, rad * 0.7, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // arcos
      const arcs = arcsRef.current;
      for (const a of arcs) {
        a.t += (dt / 1000) * a.speed;
        if (a.t >= 1) { a.done = true; rippleRef.current.push({ t: 0, color: a.color, hit: a.hit, x: a.ex, y: a.ey }); continue; }
        const tt = a.t;
        // trilha (do início até tt)
        ctx.lineWidth = a.hit ? 1.6 : 1.0; ctx.strokeStyle = a.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        const steps = 22;
        for (let i = 0; i <= steps; i++) {
          const u = (i / steps) * tt; const iu = 1 - u;
          const x = iu * iu * a.sx + 2 * iu * u * a.cx + u * u * a.ex;
          const y = iu * iu * a.sy + 2 * iu * u * a.cy + u * u * a.ey;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // cabeça (cometa)
        const iu = 1 - tt;
        const hx = iu * iu * a.sx + 2 * iu * tt * a.cx + tt * tt * a.ex;
        const hy = iu * iu * a.sy + 2 * iu * tt * a.cy + tt * tt * a.ey;
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx, hy, a.hit ? 2.6 : 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.6; ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(hx, hy, a.hit ? 4.2 : 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      arcsRef.current = arcs.filter((a) => !a.done);

      // impactos (no ponto onde o arco terminou = o agente atingido)
      const rip = rippleRef.current;
      for (const r of rip) {
        r.t += dt / 1000;
        const rr = r.t * 26; const al = Math.max(0, 1 - r.t / 0.9);
        if (al <= 0) { r.done = true; continue; }
        const rx = r.x != null ? r.x : homeRef.current.x, ry = r.y != null ? r.y : homeRef.current.y;
        ctx.globalAlpha = al; ctx.strokeStyle = r.color || acc.cyan; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      rippleRef.current = rip.filter((r) => !r.done);

      // AGENTES — cada servidor no seu lugar (destino). Se nenhum tem geo, um nó central.
      const busy = arcs.length > 0;
      const drawNode = (nx, ny, online, label) => {
        const col = online === false ? 'rgba(170,190,180,0.95)' : acc.cyan;
        // halo pulsante para o marcador se destacar sobre o heat
        const pulse = 11 + Math.sin(nowT / 240) * 3;
        ctx.globalAlpha = 0.9; ctx.strokeStyle = busy ? '#ff3b5c' : col; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(nx, ny, pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(nx, ny, pulse + 4, 0, Math.PI * 2); ctx.stroke();
        // núcleo (branco + cor) — bem visível
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(nx, ny, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(nx, ny, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(nx - 9, ny); ctx.lineTo(nx + 9, ny); ctx.moveTo(nx, ny - 9); ctx.lineTo(nx, ny + 9); ctx.stroke();
        if (label) {
          ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const w = ctx.measureText(label).width; const ly = ny - pulse - 9;
          ctx.globalAlpha = 0.75; ctx.fillStyle = '#050b08';
          ctx.fillRect(nx - w / 2 - 4, ly - 7, w + 8, 14);
          ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.strokeRect(nx - w / 2 - 4, ly - 7, w + 8, 14);
          ctx.fillStyle = col; ctx.fillText(label, nx, ly);
          ctx.textBaseline = 'alphabetic';
        }
      };
      const nodes = nodesRef.current;
      if (nodes.length === 0) drawNode(homeRef.current.x, homeRef.current.y, true, '');
      else for (const n of nodes) drawNode(n.x, n.y, n.online, `${n.flag ? n.flag + ' ' : ''}${n.name || ''}`);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [shownPoints, sortedEvents, coordsByIp, spawnArc, cmd.x, cmd.y]);

  // ------- dimensionamento responsivo -------
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth; const h = w / 2; const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      sizeRef.current = { w, h, dpr };
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ------- hover: encontra a origem mais próxima -------
  const onMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VW;
    const vy = ((e.clientY - rect.top) / rect.height) * VH;
    let best = null, bd = 14 * 14;
    for (const p of shownPoints) {
      const d = (p.x - vx) ** 2 + (p.y - vy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    setHover(best ? { p: best, x: (best.x / VW) * 100, y: (best.y / VH) * 100 } : null);
  };

  // ------- HUD: nível + países -------
  const countries = useMemo(() => {
    const m = new Map();
    for (const p of shownPoints) {
      const k = p.country || '—';
      const g = m.get(k) || { country: k, flag: p.flag, requests: 0, maxScore: 0 };
      g.requests += p.requests || 0; g.maxScore = Math.max(g.maxScore, p.score || 0); m.set(k, g);
    }
    return Array.from(m.values()).sort((a, b) => b.requests - a.requests).slice(0, 6);
  }, [shownPoints]);
  const peak = shownPoints.reduce((m, p) => Math.max(m, p.score || 0), 0);
  const hitsTotal = shownPoints.reduce((m, p) => m + (p.hits || 0), 0);
  const unplaced = (agentNodes || []).filter((a) => !(typeof a.lat === 'number' && typeof a.lon === 'number'));

  return (
    <div className="panel webmap-wrap">
      <div className="wm-head">
        <h2 style={{ margin: 0 }}>🌐 Mapa de invasões web · {mode === 'live' ? 'ao vivo' : 'replay'}</h2>
        {mode === 'live' && (
          <select className="wm-window" value={windowMs} title="Janela de amostragem"
            onChange={(e) => setWindowMs(Number(e.target.value))}>
            {WINDOW_OPTS.map((o) => <option key={o.ms} value={o.ms}>⏱ {o.label}</option>)}
          </select>
        )}
        <div className="wm-modes">
          <button className={'wm-mode' + (mode === 'live' ? ' on' : '')} onClick={enterLive}>● AO VIVO</button>
          <button className={'wm-mode' + (mode === 'replay' ? ' on' : '')} onClick={enterReplay} disabled={!sortedEvents.length}>▷ REPLAY</button>
        </div>
        <div className="wm-threat">
          <span className="wm-threat-label">PICO</span>
          <span className="wm-threat-name" style={{ color: sevColor(peak), textShadow: `0 0 8px ${sevColor(peak)}` }}>{sevName(peak)}</span>
          {hitsTotal > 0 && <span className="wm-hits" title="alvos que responderam com sucesso">🎯 {hitsTotal} HIT{hitsTotal > 1 ? 'S' : ''}</span>}
        </div>
      </div>

      <div className="wm-map" ref={wrapRef}>
        <canvas ref={canvasRef} className="wm-canvas" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {shownPoints.length === 0 && (
          <div className="wm-msg">
            {pxPoints.length === 0
              ? 'Sem tráfego web hostil geolocalizado ainda. Instale um agente WEB e aponte para o access.log. 🛰️'
              : `Nada nos últimos ${windowLabel}. Amplie a janela (⏱) para ver mais. 🛡️`}
          </div>
        )}
        {hover && (
          <div className="wm-tip" style={{ left: `${hover.x}%`, top: `${hover.y}%` }}>
            <div className="wm-tip-ip">{hover.p.flag ? hover.p.flag + ' ' : ''}{hover.p.ip}</div>
            <div className="wm-tip-row">{[hover.p.city, hover.p.country].filter(Boolean).join(', ') || 'origem desconhecida'}</div>
            <div className="wm-tip-row"><b style={{ color: sevColor(hover.p.score) }}>{hover.p.score}</b> risco · {hover.p.categoryLabel || hover.p.category} · <b>{hover.p.requests}</b> req</div>
            {hover.p.hits > 0 && <div className="wm-tip-hit">🎯 {hover.p.hits} alvo(s) respondido(s)</div>}
            {hover.p.org && <div className="wm-tip-org">{hover.p.org}</div>}
          </div>
        )}
      </div>

      {mode === 'replay' && (
        <div className="wm-transport">
          <button className="wm-play" onClick={() => {
            const r = replay.current;
            if (r.vt >= r.t1) { r.vt = r.t0; r.idx = 0; arcsRef.current = []; setProgress(0); }
            setPlaying((p) => !p);
          }}>{playing ? '⏸' : '▶'}</button>
          <input className="wm-scrub" type="range" min={0} max={1000} value={Math.round(progress * 1000)}
            onChange={(e) => { setPlaying(false); scrubTo(Number(e.target.value) / 1000); }} />
          <span className="wm-clock">{simClock ? simClock.toLocaleString('pt-BR') : '—'}</span>
          <div className="wm-speeds">
            {SPEEDS.map((s) => (
              <button key={s.v} className={'wm-speed' + (speed === s.v ? ' on' : '')} onClick={() => setSpeed(s.v)}>{s.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="wm-foot">
        <div className="wm-legend">
          {[['CRÍTICO', 90], ['ALTO', 70], ['MÉDIO', 45], ['BAIXO', 20], ['INFO', 0]].map(([n, v]) => (
            <span key={n} className="wm-key"><i style={{ background: sevColor(v) }} />{n}</span>
          ))}
        </div>
        <div className="wm-countries">
          {unplaced.length > 0 && (
            <span className="wm-chip" title={unplaced.map((a) => `${a.name}: ${a.reason || 'sem geo'}`).join('\n')} style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
              ⚠ {unplaced.length} sem localização
            </span>
          )}
          {countries.length === 0 ? <span className="wm-dim">sem origens</span>
            : countries.map((c) => (
              <span key={c.country} className="wm-chip" style={{ borderColor: sevColor(c.maxScore) }}>
                {c.flag ? c.flag + ' ' : ''}{c.country} <b>{c.requests}</b>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

const MAP_CSS = `
  .webmap-wrap { overflow:hidden; }
  .wm-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
  .wm-window { background: var(--bg-0); border:1px solid var(--green-deep); color: var(--text); border-radius:3px;
    padding:3px 6px; font:inherit; font-size:10.5px; cursor:pointer; }
  .wm-window:focus { outline:none; border-color: var(--cyan); }
  .wm-modes { display:flex; gap:6px; margin-left:auto; }
  .wm-mode { background:transparent; border:1px solid var(--green-deep); color:var(--text-dim);
    padding:4px 12px; font:inherit; font-size:10.5px; letter-spacing:1px; border-radius:3px; cursor:pointer; }
  .wm-mode:hover:not(:disabled) { color:var(--text); }
  .wm-mode.on { color:var(--green); border-color:var(--green); box-shadow:0 0 8px var(--glow); }
  .wm-mode:disabled { opacity:.4; cursor:not-allowed; }
  .wm-threat { display:flex; align-items:center; gap:10px; font-size:10px; letter-spacing:1px; }
  .wm-threat-label { color:var(--text-dim); }
  .wm-threat-name { font-weight:bold; letter-spacing:2px; }
  .wm-hits { color:#ff3b5c; font-weight:bold; }
  .wm-map { position:relative; width:100%; border-radius:3px; border:1px solid var(--green-deep); overflow:hidden;
    background: radial-gradient(120% 100% at 50% 0%, rgba(var(--accent-rgb),0.05), transparent 60%), var(--bg-0); }
  .wm-canvas { display:block; width:100%; }
  .wm-msg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center;
    padding:24px; color:var(--text-dim); font-size:12px; letter-spacing:1px; }
  .wm-tip { position:absolute; transform:translate(-50%, calc(-100% - 12px)); z-index:5; pointer-events:none;
    background:var(--panel-solid); border:1px solid var(--green-dim); border-radius:3px; padding:7px 9px; min-width:160px;
    box-shadow:0 0 18px rgba(0,0,0,0.7); }
  .wm-tip-ip { color:var(--green); font-size:12px; font-weight:bold; margin-bottom:2px; }
  .wm-tip-row { color:var(--text); font-size:10.5px; line-height:1.5; }
  .wm-tip-hit { color:#ff3b5c; font-size:10px; font-weight:bold; margin-top:2px; }
  .wm-tip-org { color:var(--text-dim); font-size:9.5px; margin-top:3px; max-width:210px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .wm-transport { display:flex; align-items:center; gap:10px; margin-top:10px; padding:8px 4px; }
  .wm-play { width:34px; height:34px; border-radius:50%; border:1px solid var(--green); background:rgba(var(--accent-rgb),0.06);
    color:var(--green); font-size:13px; cursor:pointer; flex:0 0 auto; }
  .wm-play:hover { box-shadow:0 0 10px var(--glow); }
  .wm-scrub { flex:1; accent-color:var(--green); cursor:pointer; }
  .wm-clock { font-size:10.5px; color:var(--amber); min-width:150px; text-align:center; letter-spacing:0.5px; }
  .wm-speeds { display:flex; gap:4px; }
  .wm-speed { background:transparent; border:1px solid var(--green-deep); color:var(--text-dim);
    padding:3px 7px; font:inherit; font-size:10px; border-radius:3px; cursor:pointer; }
  .wm-speed.on { color:var(--cyan); border-color:var(--cyan); }
  .wm-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:8px; }
  .wm-legend { display:flex; gap:10px; flex-wrap:wrap; }
  .wm-key { display:inline-flex; align-items:center; gap:5px; font-size:9.5px; color:var(--text-dim); letter-spacing:1px; }
  .wm-key i { width:10px; height:10px; border-radius:2px; display:inline-block; box-shadow:0 0 6px currentColor; }
  .wm-countries { display:flex; gap:6px; flex-wrap:wrap; }
  .wm-chip { font-size:10px; color:var(--text); border:1px solid var(--green-deep); border-radius:2px; padding:2px 7px; background:rgba(var(--accent-rgb),0.05); }
  .wm-chip b { color:var(--amber); }
  .wm-dim { color:var(--text-dim); font-size:10px; }
`;
