import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, PieChart, Pie,
} from 'recharts';

function palette() {
  const fb = { green: '#39ff89', amber: '#ffb838', cyan: '#2ce8ff', red: '#ff4757', dim: '#1f9c54', panel: '#0d1a10', text: '#b8ffd0' };
  if (typeof window === 'undefined') return fb;
  const s = getComputedStyle(document.documentElement);
  const g = (n, f) => (s.getPropertyValue(n).trim() || f);
  return {
    green: g('--green', fb.green), amber: g('--amber', fb.amber), cyan: g('--cyan', fb.cyan),
    red: g('--red', fb.red), dim: g('--green-dim', fb.dim), panel: g('--panel-solid', fb.panel), text: g('--text', fb.text),
  };
}
function fmtHour(h) {
  if (!h) return '';
  const [d, t] = h.split('T'); const [, mo, day] = d.split('-');
  return `${day}/${mo} ${t}h`;
}
const sevColor = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');

export function WebTimeline({ data = [] }) {
  const pal = palette();
  const axis = { stroke: pal.dim, fontSize: 10, fontFamily: 'Courier New' };
  const tip = { background: pal.panel, border: `1px solid ${pal.cyan}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };
  const d = data.map((x) => ({ ...x, hour: fmtHour(x.hour) }));
  return (
    <div className="panel">
      <h2>Linha do tempo · requisições hostis</h2>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={d} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pal.cyan} stopOpacity={0.6} />
              <stop offset="100%" stopColor={pal.cyan} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={pal.dim} strokeOpacity={0.15} />
          <XAxis dataKey="hour" tick={axis} interval="preserveStartEnd" />
          <YAxis tick={axis} allowDecimals={false} />
          <Tooltip contentStyle={tip} cursor={{ stroke: pal.cyan, strokeOpacity: 0.3 }} />
          <Area type="monotone" dataKey="value" stroke={pal.cyan} strokeWidth={2} fill="url(#wg1)" isAnimationActive animationDuration={600} name="requisições" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBar({ title, data = [], color, pal, formatter, height = 200, yWidth = 108 }) {
  const axis = { stroke: pal.dim, fontSize: 9.5, fontFamily: 'Courier New' };
  const tip = { background: pal.panel, border: `1px solid ${pal.green}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };
  const rows = (data || []).slice(0, 8);
  return (
    <div className="panel">
      <h2>{title}</h2>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={pal.dim} strokeOpacity={0.12} horizontal={false} />
          <XAxis type="number" tick={axis} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={axis} width={yWidth} interval={0}
            tickFormatter={formatter || ((v) => (v === '' ? '∅ vazio' : v.length > 15 ? v.slice(0, 14) + '…' : v))} />
          <Tooltip contentStyle={tip} cursor={{ fill: pal.green, fillOpacity: 0.08 }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
            {rows.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.06} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SEV_ORDER = [['critical', 'Crítico', 90], ['high', 'Alto', 70], ['medium', 'Médio', 45], ['low', 'Baixo', 20], ['info', 'Info', 0]];

export function WebSeverity({ severity = {} }) {
  const pal = palette();
  const data = SEV_ORDER.map(([k, name, v]) => ({ name, value: severity[k] || 0, color: sevColor(v) })).filter((x) => x.value > 0);
  const tip = { background: pal.panel, border: `1px solid ${pal.cyan}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };
  const total = data.reduce((m, x) => m + x.value, 0);
  return (
    <div className="panel">
      <h2>Severidade das ameaças</h2>
      {total === 0 ? <div className="muted tiny" style={{ padding: 20, textAlign: 'center' }}>sem dados</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} isAnimationActive animationDuration={600}>
              {data.map((d, i) => <Cell key={i} fill={d.color} stroke={pal.panel} />)}
            </Pie>
            <Tooltip contentStyle={tip} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="wc-legend">
        {SEV_ORDER.map(([k, name, v]) => (
          <span key={k} className="wc-key"><i style={{ background: sevColor(v) }} />{name} <b>{severity[k] || 0}</b></span>
        ))}
      </div>
    </div>
  );
}

// Lista compacta de barrinhas (mesmo estilo do TOP agentes / TOP países).
function MiniBars({ title, data = [], color = 'var(--cyan)' }) {
  const rows = (data || []).slice(0, 8);
  const max = Math.max(1, ...rows.map((d) => d.value || 0));
  return (
    <div className="panel wc-mini">
      <h2>{title}</h2>
      {rows.length === 0 && <div className="muted tiny" style={{ padding: 10 }}>sem dados</div>}
      <div className="wcm-list">
        {rows.map((d, i) => {
          const label = d.label === '' || d.label == null ? '∅ vazio' : String(d.label);
          return (
            <div key={i} className="wcm-row" title={`${label}: ${(d.value || 0).toLocaleString('pt-BR')}`}>
              <span className="wcm-label">{label}</span>
              <span className="wcm-bar-wrap"><span className="wcm-bar" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></span>
              <span className="wcm-val">{(d.value || 0).toLocaleString('pt-BR')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WebTopCharts({ stats }) {
  const s = stats || {};
  const pal = palette();
  return (
    <div className="grid cols-3">
      <HBar title="🏷️ Top categorias de ataque" data={s.topCategories || []} color={pal.red} pal={pal} height={180} />
      <HBar title="🧭 Top caminhos sondados" data={s.topPaths || []} color={pal.amber} pal={pal} height={180} />
      <HBar title="📡 Top IPs de origem" data={s.topIps || []} color={pal.cyan} pal={pal} height={180} yWidth={120} />
    </div>
  );
}

// injeta o CSS da legenda do gráfico de severidade
if (typeof document !== 'undefined' && !document.getElementById('webcharts-styles')) {
  const el = document.createElement('style'); el.id = 'webcharts-styles';
  el.textContent = `
    .wc-legend { display:flex; flex-wrap:wrap; gap:8px 12px; justify-content:center; margin-top:6px; }
    .wc-key { display:inline-flex; align-items:center; gap:5px; font-size:10px; color:var(--text-dim); }
    .wc-key i { width:9px; height:9px; border-radius:2px; box-shadow:0 0 5px currentColor; }
    .wc-key b { color:var(--text); }
    .wc-mini .wcm-list { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
    .wcm-row { display:grid; grid-template-columns: minmax(70px,44%) minmax(0,1fr) auto; align-items:center; gap:8px; font-size:11px; }
    .wcm-label { color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .wcm-bar-wrap { height:11px; background:rgba(var(--accent-rgb),0.06); border:1px solid var(--green-deep); border-radius:3px; overflow:hidden; }
    .wcm-bar { display:block; height:100%; border-radius:2px; opacity:0.85; transition:width .5s ease; }
    .wcm-val { color:var(--text-dim); font-weight:bold; white-space:nowrap; text-align:right; font-size:10.5px; }
  `;
  document.head.appendChild(el);
}
