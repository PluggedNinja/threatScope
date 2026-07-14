import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { api } from '../api.js';

function palette() {
  const fb = { green: '#39ff89', amber: '#ffb838', cyan: '#2ce8ff', red: '#ff4757', dim: '#1f9c54', panel: '#0d1a10', text: '#b8ffd0' };
  if (typeof window === 'undefined') return fb;
  const s = getComputedStyle(document.documentElement);
  const g = (n, f) => (s.getPropertyValue(n).trim() || f);
  return { green: g('--green', fb.green), amber: g('--amber', fb.amber), cyan: g('--cyan', fb.cyan), red: g('--red', fb.red), dim: g('--green-dim', fb.dim), panel: g('--panel-solid', fb.panel), text: g('--text', fb.text) };
}

// Gráfico "TOP países de origem" — busca /api/countries sozinho (SSH ou WEB via kind).
export default function CountriesChart({ filters = {}, kind = 'ssh', color }) {
  const [rows, setRows] = useState([]);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastKey = useRef('');
  const fkey = JSON.stringify(filters) + kind;

  const load = useCallback(async () => {
    try {
      const d = await api.countries({ ...filters, kind });
      setRows(d.countries || []); setDisabled(!!d.geoDisabled);
    } catch { /* mantém o que tinha */ }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);

  const pal = palette();
  const col = color || pal.green;
  const axis = { stroke: pal.dim, fontSize: 10, fontFamily: 'Courier New' };
  const tip = { background: pal.panel, border: `1px solid ${pal.green}`, borderRadius: 4, color: pal.text, fontFamily: 'Courier New', fontSize: 11 };

  return (
    <div className="panel">
      <h2>🌍 Top países de origem</h2>
      {rows.length === 0
        ? <div className="muted tiny" style={{ padding: 20, textAlign: 'center' }}>{disabled ? '🔒 GeoIP desligado (GEOIP_DISABLE=1).' : loading ? 'triangulando países…' : 'sem dados geolocalizados ainda.'}</div>
        : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
              <CartesianGrid stroke={pal.dim} strokeOpacity={0.12} horizontal={false} />
              <XAxis type="number" tick={axis} allowDecimals={false} />
              <YAxis type="category" dataKey="label" tick={axis} width={184} interval={0}
                tickFormatter={(v) => (v && v.length > 26 ? v.slice(0, 25) + '…' : v)} />
              <Tooltip contentStyle={tip} cursor={{ fill: pal.green, fillOpacity: 0.08 }}
                formatter={(val, _n, p) => [`${val} ataques · ${p && p.payload ? p.payload.ips : 0} IP(s)`, 'total']} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600}>
                {rows.map((_, i) => <Cell key={i} fill={col} fillOpacity={1 - i * 0.06} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
    </div>
  );
}
