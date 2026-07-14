import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { api, connectWs } from '../api.js';
import { sfx } from '../sounds.js';
import { useToast } from './Toast.jsx';
import Hint from './Hint.jsx';
import WebMap from './WebMap.jsx';
import { WebTimeline, WebSeverity } from './WebCharts.jsx';
import CountriesChart from './CountriesChart.jsx';
import AgentGuide from './AgentGuide.jsx';
import NetIpDetail from './NetIpDetail.jsx';

const sev = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');
function pal() {
  const fb = { green: '#39ff89', amber: '#ffb838', cyan: '#2ce8ff', red: '#ff4757', dim: '#1f9c54', panel: '#0d1a10', text: '#b8ffd0' };
  if (typeof window === 'undefined') return fb;
  const s = getComputedStyle(document.documentElement); const g = (n, f) => (s.getPropertyValue(n).trim() || f);
  return { green: g('--green', fb.green), amber: g('--amber', fb.amber), cyan: g('--cyan', fb.cyan), red: g('--red', fb.red), dim: g('--green-dim', fb.dim), panel: g('--panel-solid', fb.panel), text: g('--text', fb.text) };
}
function HBar({ title, data = [], color }) {
  const p = pal();
  const axis = { stroke: p.dim, fontSize: 10, fontFamily: 'Courier New' };
  const tip = { background: p.panel, border: `1px solid ${p.green}`, borderRadius: 4, color: p.text, fontFamily: 'Courier New', fontSize: 11 };
  return (
    <div className="panel">
      <h2>{title}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid stroke={p.dim} strokeOpacity={0.12} horizontal={false} />
          <XAxis type="number" tick={axis} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={axis} width={116} interval={0}
            tickFormatter={(v) => (v === '' || v == null ? '—' : String(v).length > 16 ? String(v).slice(0, 15) + '…' : String(v))} />
          <Tooltip contentStyle={tip} cursor={{ fill: p.green, fillOpacity: 0.08 }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
            {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.06} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function Stat({ label, value, color, spark, hint }) {
  return (
    <motion.div className="panel stat" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 22 }}>
      <div className="label">{label} {hint && <Hint>{hint}</Hint>}</div>
      <motion.div key={value} className={`value ${color || ''}`} initial={{ scale: 1.2, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}>{value}</motion.div>
      {spark && <div className="spark">{spark}</div>}
    </motion.div>
  );
}
function time(ts) { try { return new Date(ts).toLocaleTimeString('pt-BR'); } catch { return ''; } }
function ago(ts) { const d = Date.now() - Date.parse(ts); if (!Number.isFinite(d)) return ''; const s = Math.round(d / 1000); if (s < 60) return s + 's'; const m = Math.round(s / 60); if (m < 60) return m + 'min'; const h = Math.round(m / 60); return h < 24 ? h + 'h' : Math.round(h / 24) + 'd'; }

const NT_STR = new Set(['ip', 'service', 'category']);
const ntVal = (g, k) => (k === 'ip' ? g.ip || '' : k === 'service' ? g.service || '' : k === 'category' ? (g.categoryLabel || '') : k === 'ports' ? g.ports || 0 : k === 'last' ? Date.parse(g.last_seen) || 0 : k === 'connections' ? g.connections || 0 : g.maxScore || 0);

function NetTable({ groups = [], onOpen }) {
  const [sort, setSort] = useState({ key: 'maxScore', dir: 'desc' });
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const rows = (q ? groups.filter((g) => [g.ip, g.service, g.category, g.categoryLabel].some((x) => String(x || '').toLowerCase().includes(q))) : groups)
    .slice().sort((a, b) => { const va = ntVal(a, sort.key), vb = ntVal(b, sort.key); const c = NT_STR.has(sort.key) ? String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) : va - vb; return sort.dir === 'asc' ? c : -c; });
  const toggle = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: NT_STR.has(k) ? 'asc' : 'desc' }));
  const Th = ({ k, children, w }) => <th style={{ width: w, cursor: 'pointer', color: sort.key === k ? 'var(--cyan)' : undefined, whiteSpace: 'nowrap' }} onClick={() => toggle(k)}>{children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</th>;
  return (
    <div className="panel webtable">
      <div className="wt-head">
        <h2 style={{ margin: 0 }}>🛰️ Origens por IP · sondagens de porta</h2>
        <input className="wt-filter" placeholder="🔍 filtrar ip, serviço…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="wt-scroll">
        <table className="wt">
          <thead><tr>
            <Th k="maxScore" w="58px">Risco</Th><Th k="ip">IP de origem</Th><Th k="service">Serviço alvo</Th>
            <Th k="connections" w="60px">Conex</Th><Th k="ports" w="56px">Portas</Th><Th k="category">Categoria</Th><Th k="last" w="60px">Visto</Th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted tiny" style={{ padding: 16, textAlign: 'center' }}>Nenhuma conexão capturada ainda.</td></tr>}
            {rows.slice(0, 200).map((g) => { const c = sev(g.maxScore); return (
              <tr key={g.ip} className={g.scan ? 'wt-hit' : ''} onClick={() => onOpen && onOpen(g.ip)} title="abrir dossiê deste IP">
                <td><span className="wt-score" style={{ color: c, borderColor: c }}>{g.maxScore}</span></td>
                <td className="wt-ip">{g.ip} {g.scan && <span className="wt-hits">🛑 SCAN</span>}</td>
                <td>{g.service || '—'}</td><td>{g.connections}</td><td>{g.ports}</td>
                <td style={{ color: c }} className="wt-cat">{g.categoryLabel || g.category}</td>
                <td className="muted">{ago(g.last_seen)}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NetFeed({ rows = [], newIds, categories = [], onOpenIp }) {
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (!cat || r.category === cat) && (!q || [r.ip, r.dstPort, r.service, r.proto, r.label].some((x) => String(x || '').toLowerCase().includes(q))));
  return (
    <div className="panel webfeed">
      <div className="wf-head"><h2 style={{ margin: 0 }}>📡 Conexões ao vivo</h2></div>
      <div className="wf-controls">
        <input className="wf-filter" placeholder="🔍 filtrar ip, porta, serviço…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="wt-filter" style={{ minWidth: 0, flex: '0 0 auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">todos os tipos</option>
          {categories.map((c) => <option key={c.category} value={c.category}>{c.label} ({c.value})</option>)}
        </select>
      </div>
      <div className="wf-list">
        {shown.length === 0 && <div className="muted tiny" style={{ padding: 16 }}>{rows.length ? 'nada casa com o filtro.' : 'Aguardando o sensor de rede (tcpdump)…'}</div>}
        {shown.map((r) => { const c = sev(r.score || 0); const isNew = newIds && newIds.has(r.id); return (
          <div key={r.id} className={'wf-row' + (isNew ? ' fresh' : '') + (r.scan ? ' hit' : '')} style={{ cursor: 'pointer' }} onClick={() => onOpenIp?.(r.ip)}>
            <span className="wf-score" style={{ background: c, color: '#0a0f0b' }}>{r.score ?? 0}</span>
            <span className="wf-method">{(r.proto || 'tcp').toUpperCase()}</span>
            <span className="wf-path">→ porta <b style={{ color: 'var(--cyan)' }}>{r.dstPort}</b> {r.service && <span className="wf-site">{r.service}</span>}</span>
            <span className="wf-meta">
              <span className="wf-ip">{r.ip}</span>
              <span className="wf-cat" style={{ color: c }}>{r.label}</span>
              {r.scan && <span className="wf-hitbadge">🛑 SCAN</span>}
              <span className="wf-time">{time(r.ts)}</span>
            </span>
          </div>
        ); })}
      </div>
    </div>
  );
}

const WINS = [{ label: '1 min', ms: 60000 }, { label: '5 min', ms: 300000 }, { label: '15 min', ms: 900000 }, { label: '1 h', ms: 3600000 }];
function AlertsPanel({ alerts = [], geoByIp, win, setWin, onFocus }) {
  return (
    <div className="panel na-panel">
      <div className="na-top">
        <h2 style={{ margin: 0 }}>🚨 Ameaças ativas · resumo por IP</h2>
        <span className="na-count">{alerts.length} origem(ns)</span>
        <select className="na-win" value={win} onChange={(e) => setWin(Number(e.target.value))} title="Janela do resumo">
          {WINS.map((w) => <option key={w.ms} value={w.ms}>⏱ {w.label}</option>)}
        </select>
      </div>
      <div className="na-grid">
        {alerts.length === 0 && <div className="muted tiny" style={{ padding: 16 }}>Nenhuma conexão nesta janela. Perímetro calmo. 🛡️</div>}
        {alerts.map((a) => { const g = geoByIp.get(a.ip) || {}; const c = sev(a.maxScore); return (
          <div key={a.ip} className={'na-card' + (a.scan ? ' scan' : '')} onClick={() => onFocus && onFocus(a.ip)} style={{ borderColor: c }} title="focar este IP">
            <div className="na-h">
              <span className="na-ip">{g.flag ? g.flag + ' ' : ''}{a.ip}</span>
              <span className="na-score" style={{ color: c }}>{a.maxScore}</span>
            </div>
            <div className="na-sub">{[g.country, g.city].filter(Boolean).join(' · ') || 'origem desconhecida'}{a.scan && <span className="na-scan"> 🛑 VARREDURA</span>}</div>
            <div className="na-ports">{(a.topPorts || []).slice(0, 6).map((p) => <span key={p.port} className="na-port">{p.port}<b>×{p.n}</b></span>)}</div>
            <div className="na-meta">{a.connections} conexões · {a.ports} portas · {a.categoryLabel}{a.agents && a.agents.length ? ` → ${a.agents.join(', ')}` : ''}</div>
            <div className="na-time">há {ago(a.last_seen)} · {time(a.last_seen)}</div>
          </div>
        ); })}
      </div>
    </div>
  );
}

export default function NetDashboard({ agents = [], onRefreshAgents, onConfigAgent }) {
  const toast = useToast();
  const [filters, setFilters] = useState({});
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [geo, setGeo] = useState({ points: [], agents: [] });
  const [events, setEvents] = useState([]);
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState(0);
  const [newIds, setNewIds] = useState(new Set());
  const [liveEvent, setLiveEvent] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [managerInfo, setManagerInfo] = useState(null);
  const [detailIp, setDetailIp] = useState(null);
  const refreshTimer = useRef(null); const geoTimer = useRef(null);
  const lastToastRef = useRef(0); const bufRef = useRef([]);
  const [alerts, setAlerts] = useState([]);
  const [alertWin, setAlertWin] = useState(60000);
  const fkey = JSON.stringify(filters);
  const geoByIp = useMemo(() => { const m = new Map(); (geo.points || []).forEach((p) => m.set(p.ip, p)); return m; }, [geo]);
  const netAgents = useMemo(() => agents.filter((a) => (a.netAttempts || 0) > 0 || ((a.sshAttempts || 0) === 0 && (a.webAttempts || 0) === 0)), [agents]);

  const refresh = useCallback(async () => {
    try { const [s, g, a] = await Promise.all([api.netStats(filters), api.netGrouped(filters), api.netAttempts({ ...filters, limit: 120 })]); setStats(s); setGroups(g); setRows(a.rows); }
    catch { toast.push({ type: 'warn', title: 'Sem conexão', message: 'Não consegui falar com a API (:4000).' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);
  const refreshGeo = useCallback(async () => { try { setGeo(await api.netGeo(filters)); } catch {} }, [fkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshEvents = useCallback(async () => { try { const d = await api.netEvents({ ...filters, limit: 4000 }); setEvents(d.events || []); } catch {} }, [fkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshAlerts = useCallback(async () => { try { const from = new Date(Date.now() - alertWin).toISOString(); const g = await api.netGrouped({ ...filters, from }); setAlerts(g.slice(0, 48)); } catch {} }, [fkey, alertWin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(() => { refresh(); refreshGeo(); refreshEvents(); }, 200); return () => clearTimeout(t); }, [refresh, refreshGeo, refreshEvents]);
  useEffect(() => { const iv = setInterval(refreshGeo, 15000); return () => clearInterval(iv); }, [refreshGeo]);
  useEffect(() => { refreshAlerts(); const iv = setInterval(refreshAlerts, 4000); return () => clearInterval(iv); }, [refreshAlerts]);
  useEffect(() => { api.managerInfo().then(setManagerInfo).catch(() => {}); }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => { refreshTimer.current = null; try { const [s, g] = await Promise.all([api.netStats(filters), api.netGrouped(filters)]); setStats(s); setGroups(g); } catch {} }, 1600);
    if (!geoTimer.current) geoTimer.current = setTimeout(() => { geoTimer.current = null; refreshGeo(); }, 2500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey, refreshGeo]);

  // WS: só ENFILEIRA (tcpdump é muito volume). O flush periódico atualiza o estado
  // em lote, evitando a tempestade de re-renders que travava a animação.
  useEffect(() => {
    const close = connectWs((msg) => {
      if (msg.type !== 'attempt') return; const a = msg.payload; if (a.kind !== 'net') return;
      const buf = bufRef.current; buf.push(a); if (buf.length > 1000) bufRef.current = buf.slice(-1000);
      if ((a.scan || (a.score || 0) >= 90) && Date.now() - lastToastRef.current > 8000) { lastToastRef.current = Date.now(); sfx.alert(); }
    });
    return close;
  }, []);
  useEffect(() => {
    const iv = setInterval(() => {
      const buf = bufRef.current; if (!buf.length) return; bufRef.current = [];
      setRows((prev) => [...buf.slice().reverse(), ...prev].slice(0, 200));
      setLive((n) => n + buf.length);
      const ids = buf.map((a) => a.id);
      setNewIds((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; });
      setTimeout(() => setNewIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }), 1500);
      // mapa: dispara só o arco mais notável do lote — claro e seguível
      const top = buf.reduce((m, a) => ((a.score || 0) > (m ? m.score || 0 : -1) ? a : m), null);
      if (top) setLiveEvent({ ip: top.ip, agent: top.agent, score: top.score, hit: top.scan, key: `${top.id}-${Date.now()}` });
      scheduleRefresh();
    }, 800);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefresh]);

  const onExport = (format) => { window.open(api.netExportUrl(format, filters), '_blank'); toast.push({ title: 'Exportando', message: `Gerando ${format.toUpperCase()}…` }); };
  const focusIp = (ip) => { setFilters((f) => ({ ...f, ips: [ip] })); toast.push({ title: 'Foco aplicado', message: `Filtrado no IP ${ip}.` }); };
  const clearFocus = () => setFilters((f) => { const n = { ...f }; delete n.ips; return n; });
  const onlineNet = netAgents.filter((a) => a.online).length;
  const topPortLabel = stats?.topPorts?.[0]?.label;

  return (
    <div className="webdash">
      <div className="panel wd-toolbar">
        <div className="wd-agents">
          <span className={'led ' + (onlineNet ? '' : 'off')}><span className="dot" /> {onlineNet} SENSOR(ES) DE REDE</span>
          {netAgents.slice(0, 5).map((a) => (
            <span key={a.id} className="wd-agent" title={a.error || ''}>
              <i className={'wd-dot ' + (a.online ? 'on' : 'off')} />{a.name || a.host}
              <b>{(a.netAttempts || 0).toLocaleString('pt-BR')}</b>{a.netScans > 0 && <em>🛑{a.netScans}</em>}
              <button className="wd-gear" title="Configurar" onClick={() => onConfigAgent?.(a)}>⚙</button>
            </span>
          ))}
        </div>
        <div className="wd-actions">
          <input className="wd-search" placeholder="🔍 ip, porta, serviço…" value={filters.search || ''} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))} />
          <button className={'tiny' + (filters.scan ? ' amber' : '')} onClick={() => setFilters((f) => ({ ...f, scan: f.scan ? undefined : '1' }))}>🛑 só scans</button>
          {filters.ips && <button className="tiny" onClick={clearFocus}>✕ limpar foco</button>}
          <button className="tiny" onClick={() => onExport('csv')}>⬇ CSV</button>
          <button className="tiny" onClick={() => onExport('json')}>⬇ JSON</button>
          <button className="tiny amber" onClick={() => { sfx.click(); setGuideOpen(true); }}>➕ AGENTE</button>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Stat label="Conexões captadas" value={(stats?.total ?? 0).toLocaleString('pt-BR')} color="cyan" spark={`+${live} ao vivo`} hint="Tentativas de conexão (SYN) vistas pelo tcpdump." />
        <Stat label="IPs de origem" value={(stats?.uniqueIps ?? 0).toLocaleString('pt-BR')} color="amber" spark={`${stats?.uniquePorts ?? 0} portas distintas`} />
        <Stat label="Scanners de porta" value={(stats?.scanners ?? 0).toLocaleString('pt-BR')} color="red" spark="IPs varrendo várias portas" hint="IPs que tocaram muitas portas distintas numa janela curta." />
        <Stat label="Porta mais visada" value={topPortLabel || '—'} spark={`score médio ${stats?.avgScore ?? 0}/100`} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AlertsPanel alerts={alerts} geoByIp={geoByIp} win={alertWin} setWin={setAlertWin} onFocus={focusIp} />
      </div>

      <div style={{ marginTop: 14 }}>
        <WebMap points={geo.points || []} events={events} liveEvent={liveEvent} agentNodes={geo.agents || []} />
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <WebTimeline data={stats?.timeline || []} />
        <WebSeverity severity={stats?.severity || {}} />
        <CountriesChart filters={filters} kind="net" color="#ff8c38" />
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <HBar title="Top portas alvo" data={(stats?.topPorts || []).map((p) => ({ ...p, label: String(p.label) }))} color={pal().cyan} />
        <HBar title="Top serviços" data={stats?.topServices || []} color={pal().amber} />
        <HBar title="Top IPs de origem" data={stats?.topIps || []} color={pal().green} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <NetTable groups={groups} onOpen={setDetailIp} />
        <NetFeed rows={rows} newIds={newIds} categories={stats?.topCategories || []} onOpenIp={setDetailIp} />
      </div>

      <AgentGuide open={guideOpen} onClose={() => setGuideOpen(false)} info={managerInfo} onRegistered={onRefreshAgents} defaultMode="net" />
      <NetIpDetail ip={detailIp} onClose={() => setDetailIp(null)} />
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('netalerts-styles')) {
  const el = document.createElement('style'); el.id = 'netalerts-styles';
  el.textContent = `
    .na-top { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
    .na-count { color:var(--text-dim); font-size:11px; }
    .na-win { margin-left:auto; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:3px 6px; font:inherit; font-size:10.5px; cursor:pointer; }
    .na-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:8px; max-height:340px; overflow:auto; }
    .na-card { border:1px solid var(--green-deep); border-left-width:3px; border-radius:4px; padding:8px 10px; background:rgba(var(--accent-rgb),0.03); cursor:pointer; }
    .na-card:hover { background:rgba(var(--accent-rgb),0.07); }
    .na-card.scan { background:rgba(255,59,92,0.06); }
    .na-h { display:flex; align-items:center; justify-content:space-between; }
    .na-ip { color:var(--cyan); font-size:12px; font-weight:bold; }
    .na-score { font-size:13px; font-weight:bold; }
    .na-sub { color:var(--text-dim); font-size:10px; margin:2px 0 5px; }
    .na-scan { color:#ff3b5c; font-weight:bold; }
    .na-ports { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:5px; }
    .na-port { font-size:10px; color:var(--amber); border:1px solid var(--green-deep); border-radius:2px; padding:0 5px; background:var(--bg-0); }
    .na-port b { color:var(--text); font-weight:bold; }
    .na-meta { color:var(--text); font-size:10px; }
    .na-time { color:var(--text-dim); font-size:9.5px; margin-top:3px; }
  `;
  document.head.appendChild(el);
}
