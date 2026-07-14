import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts';

// Lê as cores do tema ativo direto das variáveis CSS (segue o seletor de tema).
function palette() {
  const fb = { green: '#39ff89', amber: '#ffb838', cyan: '#2ce8ff', red: '#ff4757', dim: '#1f9c54', panel: '#0d1a10', text: '#b8ffd0' };
  if (typeof window === 'undefined') return fb;
  const s = getComputedStyle(document.documentElement);
  const g = (n, f) => (s.getPropertyValue(n).trim() || f);
  return {
    green: g('--green', fb.green), amber: g('--amber', fb.amber), cyan: g('--cyan', fb.cyan),
    red: g('--red', fb.red), dim: g('--green-dim', fb.dim), panel: g('--panel-solid', fb.panel),
    text: g('--text', fb.text),
  };
}

function fmtHour(h) {
  if (!h) return '';
  const [d, t] = h.split('T');
  const [, mo, day] = d.split('-');
  return `${day}/${mo} ${t}h`;
}

// eslint-disable-next-line no-unused-vars
export function TimelineChart({ data = [], theme }) {
  const pal = palette();
  const axis = { stroke: pal.dim, fontSize: 10, fontFamily: 'Courier New' };
  const tip = { background: pal.panel, border: `1px solid ${pal.green}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };
  const d = data.map((x) => ({ ...x, hour: fmtHour(x.hour) }));
  return (
    <div className="panel">
      <h2>Linha do tempo de ataques</h2>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={d} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pal.green} stopOpacity={0.6} />
              <stop offset="100%" stopColor={pal.green} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={pal.dim} strokeOpacity={0.15} />
          <XAxis dataKey="hour" tick={axis} interval="preserveStartEnd" />
          <YAxis tick={axis} allowDecimals={false} />
          <Tooltip contentStyle={tip} cursor={{ stroke: pal.green, strokeOpacity: 0.3 }} />
          <Area type="monotone" dataKey="value" stroke={pal.green} strokeWidth={2}
            fill="url(#g1)" isAnimationActive animationDuration={600} name="tentativas" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBar({ title, data = [], color, pal }) {
  const axis = { stroke: pal.dim, fontSize: 10, fontFamily: 'Courier New' };
  const tip = { background: pal.panel, border: `1px solid ${pal.green}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };
  return (
    <div className="panel">
      <h2>{title}</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
          <CartesianGrid stroke={pal.dim} strokeOpacity={0.12} horizontal={false} />
          <XAxis type="number" tick={axis} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={axis} width={116} interval={0}
            tickFormatter={(v) => (v === '' ? '∅ vazio' : v.length > 16 ? v.slice(0, 15) + '…' : v)} />
          <Tooltip contentStyle={tip} cursor={{ fill: pal.green, fillOpacity: 0.08 }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
            {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={1 - i * 0.06} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
export function TopCharts({ stats, theme }) {
  const s = stats || {};
  const pal = palette();
  return (
    <>
      <HBar title="Top usuários" data={s.topUsers || []} color={pal.amber} pal={pal} />
      <HBar title="Top senhas" data={s.topPasswords || []} color={pal.red} pal={pal} />
      <HBar title="Top IPs de origem" data={s.topIps || []} color={pal.cyan} pal={pal} />
    </>
  );
}
