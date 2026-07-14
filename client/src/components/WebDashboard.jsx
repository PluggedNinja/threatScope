import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, connectWs } from '../api.js';
import { sfx } from '../sounds.js';
import { useToast } from './Toast.jsx';
import WebStatCards from './WebStatCards.jsx';
import WebMap from './WebMap.jsx';
import { WebTimeline, WebSeverity, WebTopCharts } from './WebCharts.jsx';
import CountriesChart from './CountriesChart.jsx';
import WebFeed from './WebFeed.jsx';
import WebTopAgents from './WebTopAgents.jsx';
import WebTable from './WebTable.jsx';
import AgentGuide from './AgentGuide.jsx';
import SilencedModal from './SilencedModal.jsx';
import WebIpDetail from './WebIpDetail.jsx';

export default function WebDashboard({ agents = [], onRefreshAgents, onConfigAgent }) {
  const toast = useToast();
  const [filters, setFilters] = useState({});
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [geo, setGeo] = useState({ points: [], geoDisabled: false });
  const [events, setEvents] = useState([]);
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState(0);
  const [newIds, setNewIds] = useState(new Set());
  const [liveEvent, setLiveEvent] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [managerInfo, setManagerInfo] = useState(null);
  const refreshTimer = useRef(null);
  const geoTimer = useRef(null);
  const fkey = JSON.stringify(filters);

  // ----- silenciar entradas no feed (ruído legítimo tipo /api/heartbeat) -----
  const [ignoreRules, setIgnoreRules] = useState(() => {
    try { return JSON.parse(localStorage.getItem('webhoney-feed-ignore') || '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem('webhoney-feed-ignore', JSON.stringify(ignoreRules)); } catch {} }, [ignoreRules]);
  const ignoreRef = useRef(ignoreRules); ignoreRef.current = ignoreRules;
  const isIgnored = (r) => ignoreRef.current.some((rule) => {
    const q = String(rule).toLowerCase();
    return String(r.path || '').toLowerCase().includes(q) || String(r.ip || '') === rule || String(r.ua || '').toLowerCase().includes(q);
  });
  const addRule = (p) => { const s = String(p || '').trim(); if (!s) return; setIgnoreRules((cur) => (cur.includes(s) ? cur : [...cur, s])); };
  const removeRule = (p) => setIgnoreRules((cur) => cur.filter((x) => x !== p));
  const editRule = (oldP, newP) => setIgnoreRules((cur) => { const s = String(newP || '').trim(); if (!s) return cur; return cur.map((x) => (x === oldP ? s : x)); });
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [detailIp, setDetailIp] = useState(null);

  const webAgents = useMemo(() => agents.filter((a) => (a.webAttempts || 0) > 0 || (a.sshAttempts || 0) === 0), [agents]);

  const refresh = useCallback(async () => {
    try {
      const [s, g, a] = await Promise.all([
        api.webStats(filters), api.webGrouped(filters), api.webAttempts({ ...filters, limit: 120 }),
      ]);
      setStats(s); setGroups(g); setRows(a.rows);
    } catch {
      toast.push({ type: 'warn', title: 'Sem conexão', message: 'Não consegui falar com a API (:4000).' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  const refreshGeo = useCallback(async () => {
    try { setGeo(await api.webGeo(filters)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  const refreshEvents = useCallback(async () => {
    try { const d = await api.webEvents({ ...filters, limit: 4000 }); setEvents(d.events || []); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  useEffect(() => { const t = setTimeout(() => { refresh(); refreshGeo(); refreshEvents(); }, 200); return () => clearTimeout(t); }, [refresh, refreshGeo, refreshEvents]);
  useEffect(() => { const iv = setInterval(refreshGeo, 15000); return () => clearInterval(iv); }, [refreshGeo]);
  useEffect(() => { api.managerInfo().then(setManagerInfo).catch(() => {}); }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      try { const [s, g] = await Promise.all([api.webStats(filters), api.webGrouped(filters)]); setStats(s); setGroups(g); } catch {}
    }, 1600);
    if (!geoTimer.current) geoTimer.current = setTimeout(() => { geoTimer.current = null; refreshGeo(); }, 2500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey, refreshGeo]);

  // WebSocket — só eventos web
  useEffect(() => {
    const close = connectWs((msg) => {
      if (msg.type !== 'attempt') return;
      const a = msg.payload;
      if (a.kind !== 'web') return;
      if (isIgnored(a)) { scheduleRefresh(); return; } // silenciado: fora do feed/som/arco (mas conta nas estatísticas)
      setRows((prev) => [a, ...prev].slice(0, 200));
      setLive((n) => n + 1);
      setNewIds((s) => { const n = new Set(s); n.add(a.id); return n; });
      setTimeout(() => setNewIds((s) => { const n = new Set(s); n.delete(a.id); return n; }), 1500);
      setLiveEvent({ ip: a.ip, agent: a.agent, score: a.score, category: a.category, hit: a.hit, key: `${a.id}-${Date.now()}` });
      if (a.hit || (a.score || 0) >= 85) { sfx.alert(); toast.push({ type: 'alert', title: a.hit ? '🎯 ALVO ATINGIDO' : 'AMEAÇA CRÍTICA', message: `${a.ip} · ${a.wmethod} ${String(a.path).slice(0, 40)} (${a.label})` }); }
      else sfx.attack();
      scheduleRefresh();
    });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefresh]);

  const onExport = (format) => { window.open(api.webExportUrl(format, filters), '_blank'); toast.push({ title: 'Exportando', message: `Gerando ${format.toUpperCase()}…` }); };
  const focusIp = (ip) => { setFilters((f) => ({ ...f, ips: [ip] })); toast.push({ title: 'Foco aplicado', message: `Painel filtrado no IP ${ip}.` }); };
  const clearFocus = () => setFilters((f) => { const n = { ...f }; delete n.ips; return n; });
  const categories = stats?.topCategories || [];
  const onlineWeb = webAgents.filter((a) => a.online).length;

  return (
    <div className="webdash">
      {/* toolbar */}
      <div className="panel wd-toolbar">
        <div className="wd-agents">
          <span className={'led ' + (onlineWeb ? '' : 'off')}><span className="dot" /> {onlineWeb} SERVIDOR(ES) WEB</span>
          {webAgents.slice(0, 5).map((a) => (
            <span key={a.id} className="wd-agent" title={a.error || ''}>
              <i className={'wd-dot ' + (a.online ? 'on' : 'off')} />{a.name || a.host}
              <b>{(a.webAttempts || 0).toLocaleString('pt-BR')}</b>{a.webHits > 0 && <em>🎯{a.webHits}</em>}
              <button className="wd-gear" title="Configurar modo e logs" onClick={() => onConfigAgent?.(a)}>⚙</button>
            </span>
          ))}
        </div>
        <div className="wd-actions">
          <input className="wd-search" placeholder="🔍 filtrar path, IP, UA…" value={filters.search || ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))} />
          <select className="theme-select tiny" value={filters.category || ''} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}>
            <option value="">todas categorias</option>
            {categories.map((c) => <option key={c.category} value={c.category}>{c.label} ({c.value})</option>)}
          </select>
          <button className={'tiny' + (filters.hit ? ' amber' : '')} onClick={() => setFilters((f) => ({ ...f, hit: f.hit ? undefined : '1' }))}>🎯 só hits</button>
          {filters.ips && <button className="tiny" onClick={clearFocus}>✕ limpar foco</button>}
          <button className="tiny" onClick={() => onExport('csv')}>⬇ CSV</button>
          <button className="tiny" onClick={() => onExport('json')}>⬇ JSON</button>
          <button className="tiny amber" onClick={() => { sfx.click(); setGuideOpen(true); }}>➕ AGENTE</button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}><WebStatCards stats={stats} live={live} /></div>

      <div style={{ marginTop: 14 }}>
        <WebMap points={geo.points || []} events={events} liveEvent={liveEvent} agentNodes={geo.agents || []} />
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <WebTimeline data={stats?.timeline || []} />
        <WebSeverity severity={stats?.severity || {}} />
        <div className="panel wd-mini">
          <h2>Resumo tático</h2>
          <ul className="wd-summary">
            <li><span>Bots vs humanos</span><b>{stats?.bots ?? 0} / {stats?.humans ?? 0}</b></li>
            <li><span>Caminhos distintos sondados</span><b>{(stats?.uniquePaths ?? 0).toLocaleString('pt-BR')}</b></li>
            <li><span>Score médio de ameaça</span><b style={{ color: 'var(--amber)' }}>{stats?.avgScore ?? 0}/100</b></li>
            <li><span>Alvos que responderam (hits)</span><b style={{ color: '#ff3b5c' }}>{stats?.hits ?? 0}</b></li>
            <li><span>Categoria dominante</span><b>{categories[0]?.label || '—'}</b></li>
          </ul>
          {geo.geoDisabled && <div className="legal" style={{ marginTop: 8 }}>🔒 GeoIP desligado (GEOIP_DISABLE=1). Ligue para ver o mapa.</div>}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <WebTopCharts stats={stats} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <CountriesChart filters={filters} kind="web" color="#2ce8ff" />
        <WebTopAgents agents={agents} />
      </div>

      {/* Feed ao vivo em LARGURA TOTAL (a tabela tem muitas colunas e precisa de espaço) */}
      <div style={{ marginTop: 14 }}>
        <WebFeed rows={rows.filter((r) => !isIgnored(r))} newIds={newIds}
          silencedCount={ignoreRules.length} onOpenSilenced={() => setSilenceOpen(true)} onAddRule={addRule} />
      </div>

      {/* Origens agrupadas por IP em largura total logo abaixo */}
      <div style={{ marginTop: 14 }}>
        <WebTable groups={groups} onOpen={setDetailIp} />
      </div>

      <AgentGuide open={guideOpen} onClose={() => setGuideOpen(false)} info={managerInfo} onRegistered={onRefreshAgents} defaultMode="web" />
      <SilencedModal open={silenceOpen} onClose={() => setSilenceOpen(false)} rules={ignoreRules} onAdd={addRule} onRemove={removeRule} onEdit={editRule} />
      <WebIpDetail ip={detailIp} onClose={() => setDetailIp(null)} />
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('webdash-styles')) {
  const el = document.createElement('style'); el.id = 'webdash-styles';
  el.textContent = `
    .wd-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .wd-agents { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:11px; }
    .wd-agent { display:inline-flex; align-items:center; gap:5px; color:var(--text); border:1px solid var(--green-deep);
      border-radius:3px; padding:2px 8px; background:rgba(var(--accent-rgb),0.04); }
    .wd-agent b { color:var(--cyan); } .wd-agent em { color:#ff3b5c; font-style:normal; font-size:10px; }
    .wd-gear { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0 0 0 2px; font-size:12px; }
    .wd-gear:hover { color:var(--green); }
    .wd-dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
    .wd-dot.on { background:var(--green); box-shadow:0 0 6px var(--green); } .wd-dot.off { background:var(--red); }
    .wd-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .wd-search { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px;
      padding:5px 9px; font:inherit; font-size:11px; min-width:180px; }
    .wd-search:focus { outline:none; border-color:var(--cyan); }
    .wd-mini h2 { margin-top:0; }
    .wd-summary { list-style:none; margin:0; padding:0; }
    .wd-summary li { display:flex; align-items:center; justify-content:space-between; padding:7px 0;
      border-bottom:1px solid rgba(var(--accent-rgb),0.08); font-size:11.5px; }
    .wd-summary li span { color:var(--text-dim); }
    .wd-summary li b { color:var(--text); }
  `;
  document.head.appendChild(el);
}
