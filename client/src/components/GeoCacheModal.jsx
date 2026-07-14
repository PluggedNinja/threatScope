import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

function fmtSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function fmtDate(s) { try { return s ? new Date(s).toLocaleString('pt-BR') : '—'; } catch { return '—'; } }

// Globo decorativo animado (wireframe girando + varredura radar + blips).
function GeoGlobe({ ranges = 0, withGeo = 0 }) {
  return (
    <div className="gcm-globe" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 158 }}>
      <svg viewBox="0 0 140 140" width="158" height="158" style={{ width: 158, height: 158, overflow: 'visible', flex: '0 0 auto' }}>
        <defs>
          <radialGradient id="gcmCore" cx="50%" cy="42%" r="62%">
            <stop offset="0%" style={{ stopColor: 'var(--cyan)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--cyan)', stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="gcmSweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--cyan)', stopOpacity: 0.4 }} />
            <stop offset="100%" style={{ stopColor: 'var(--cyan)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r="56" fill="url(#gcmCore)" />
        <g className="gcm-sweep"><path d="M70,70 L70,14 A56,56 0 0,1 118,98 Z" fill="url(#gcmSweep)" />
          <animateTransform attributeName="transform" type="rotate" from="0 70 70" to="360 70 70" dur="4.5s" repeatCount="indefinite" /></g>
        <circle cx="70" cy="70" r="56" className="gcm-ring" />
        <g className="gcm-lat">
          {[16, 32, 46].map((ry) => <ellipse key={ry} cx="70" cy="70" rx="56" ry={ry} />)}
          <line x1="14" y1="70" x2="126" y2="70" />
        </g>
        <g className="gcm-lon">
          {[18, 38, 56].map((rx) => <ellipse key={rx} cx="70" cy="70" rx={rx} ry="56" />)}
          <line x1="70" y1="14" x2="70" y2="126" />
        </g>
        <g className="gcm-blips">
          <circle cx="46" cy="50" r="2.6" /><circle cx="96" cy="58" r="2.6" />
          <circle cx="58" cy="96" r="2.6" /><circle cx="90" cy="92" r="2.6" /><circle cx="52" cy="74" r="2.6" />
        </g>
        <text x="70" y="67" className="gcm-num" textAnchor="middle">{ranges.toLocaleString('pt-BR')}</text>
        <text x="70" y="82" className="gcm-numlab" textAnchor="middle">FAIXAS EM CACHE</text>
      </svg>
      <div className="gcm-globe-sub">{withGeo.toLocaleString('pt-BR')} geolocalizadas</div>
    </div>
  );
}

export default function GeoCacheModal({ open, onClose }) {
  const [st, setSt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.geoCache().then((s) => { setSt(s); setDays(s.ttlDays); }).catch(() => setSt(null)).finally(() => setLoading(false));
  };
  useEffect(() => { if (open) { setMsg(null); load(); } }, [open]);

  const saveTtl = async () => {
    setBusy(true); setMsg(null); sfx.click();
    try { const r = await api.setGeoTtl(Number(days)); setMsg({ type: 'ok', text: `Validade salva: ${r.ttlDays} dia(s).` }); load(); }
    catch (e) { setMsg({ type: 'warn', text: `Falha: ${e.message}` }); }
    finally { setBusy(false); }
  };
  const clear = async (mode, label) => {
    setBusy(true); setMsg(null); sfx.click();
    try { const r = await api.clearGeoCache(mode); sfx.success(); setMsg({ type: 'ok', text: `${label}: ${r.removed} faixa(s) removida(s).` }); load(); }
    catch (e) { setMsg({ type: 'warn', text: `Falha: ${e.message}` }); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="🌍 Cache de GeoIP (por faixa)" width={720}>
      <div className="gcm">
        {loading && <div className="muted"><span className="spinner" /> carregando…</div>}
        {!loading && st && (
          <>
            <div className="gcm-header" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <GeoGlobe ranges={st.ranges || 0} withGeo={st.withGeo || 0} />
              <div className="gcm-headright">
                <div className="gcm-grid">
                  <div className="gcm-cell"><span>Faixas em cache</span><b>{(st.ranges || 0).toLocaleString('pt-BR')}</b></div>
                  <div className="gcm-cell"><span>Com geo</span><b style={{ color: 'var(--green)' }}>{(st.withGeo || 0).toLocaleString('pt-BR')}</b></div>
                  <div className="gcm-cell"><span>Sem resposta</span><b style={{ color: 'var(--amber)' }}>{(st.empty || 0).toLocaleString('pt-BR')}</b></div>
                  <div className="gcm-cell"><span>Vencidas</span><b>{(st.stale || 0).toLocaleString('pt-BR')}</b></div>
                  <div className="gcm-cell"><span>Tamanho</span><b>{fmtSize(st.fileSize)}</b></div>
                  <div className="gcm-cell"><span>Validade</span><b style={{ color: 'var(--cyan)' }}>{st.ttlDays} dia(s)</b></div>
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Arquivo: <code>{st.file}</code><br />
                  Mais antiga: {fmtDate(st.oldest)} · mais nova: {fmtDate(st.newest)}
                  {st.geoDisabled && <><br /><span style={{ color: 'var(--amber)' }}>⚠ GEOIP_DISABLE=1 — geolocalização desligada.</span></>}
                </div>
              </div>
            </div>

            <div className="gcm-sec">
              <label className="gcm-lab">Validade do cache (dias) — quanto tempo uma faixa vale antes de re-resolver</label>
              <div className="gcm-row">
                <input type="number" min="0" max="3650" value={days} onChange={(e) => setDays(e.target.value)} />
                <button className="amber" disabled={busy} onClick={saveTtl}>💾 Salvar validade</button>
                <span className="tiny muted">0 = sempre re-resolver · 30 = padrão · 365 = ~fixo</span>
              </div>
            </div>

            <div className="gcm-sec">
              <label className="gcm-lab">Limpeza</label>
              <div className="gcm-row">
                <button className="tiny" disabled={busy} onClick={() => clear('failed', 'Falhas limpas')}>🧹 Limpar sem-resposta</button>
                <button className="tiny" disabled={busy} onClick={() => clear('stale', 'Vencidas limpas')}>🧹 Limpar vencidas</button>
                <button className="tiny danger" disabled={busy} onClick={() => clear('', 'Cache zerado')}>🗑 Limpar tudo</button>
              </div>
              <div className="tiny muted">Limpar força re-resolução na próxima consulta (útil se a geo de uma faixa mudou).</div>
            </div>

            {(st.topCountries?.length > 0 || st.topAsns?.length > 0) && (
              <div className="gcm-tops">
                <div className="gcm-top">
                  <div className="gcm-lab">Top países cacheados (faixas)</div>
                  <div className="gcm-list">
                    {(st.topCountries || []).map((c) => (
                      <div key={c.code || c.country} className="gcm-item">
                        <span>{c.flag ? c.flag + ' ' : ''}{c.country}</span><b>{c.ranges.toLocaleString('pt-BR')}</b>
                      </div>
                    ))}
                    {(!st.topCountries || st.topCountries.length === 0) && <div className="tiny muted">—</div>}
                  </div>
                </div>
                <div className="gcm-top">
                  <div className="gcm-lab">Top ASNs / provedores (faixas)</div>
                  <div className="gcm-list">
                    {(st.topAsns || []).map((a, i) => (
                      <div key={(a.asn || a.org) + i} className="gcm-item">
                        <span title={a.org}>{a.flag ? a.flag + ' ' : ''}{a.asn ? a.asn + ' · ' : ''}{a.org}</span><b>{a.ranges.toLocaleString('pt-BR')}</b>
                      </div>
                    ))}
                    {(!st.topAsns || st.topAsns.length === 0) && <div className="tiny muted">—</div>}
                  </div>
                </div>
              </div>
            )}

            {msg && <div className="tiny" style={{ color: msg.type === 'ok' ? 'var(--green)' : 'var(--amber)' }}>{msg.text}</div>}
          </>
        )}
        {!loading && !st && <div className="muted">Não consegui ler o cache (a central está rodando?).</div>}
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('gcm-styles')) {
  const el = document.createElement('style'); el.id = 'gcm-styles';
  el.textContent = `
    .gcm { display:flex; flex-direction:column; gap:14px; }
    .gcm-header { display:flex; gap:16px; align-items:center; }
    .gcm-headright { flex:1; min-width:0; }
    .gcm-globe { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; }
    .gcm-globe svg { width:158px; height:158px; overflow:visible; }
    .gcm-globe-sub { font-size:9px; color:var(--text-dim); letter-spacing:1px; margin-top:2px; }
    .gcm-ring { fill:none; stroke:var(--cyan); stroke-width:1.1; filter:drop-shadow(0 0 6px var(--cyan)); }
    .gcm-lat ellipse, .gcm-lat line, .gcm-lon ellipse, .gcm-lon line { fill:none; stroke:var(--cyan); stroke-width:0.5; opacity:0.32; }
    .gcm-lon { transform-box:fill-box; transform-origin:center; animation:gcmSpin 5.5s ease-in-out infinite; }
    @keyframes gcmSpin { 0%,100%{ transform:scaleX(1); } 50%{ transform:scaleX(0.12); } }
    .gcm-sweep path { mix-blend-mode:screen; }
    .gcm-blips circle { fill:var(--green); filter:drop-shadow(0 0 4px var(--green)); transform-box:fill-box; transform-origin:center; animation:gcmBlink 2.6s ease-in-out infinite; }
    .gcm-blips circle:nth-child(2){ animation-delay:.5s; } .gcm-blips circle:nth-child(3){ animation-delay:1s; }
    .gcm-blips circle:nth-child(4){ animation-delay:1.5s; } .gcm-blips circle:nth-child(5){ animation-delay:2s; }
    @keyframes gcmBlink { 0%,100%{ opacity:.25; transform:scale(.7); } 50%{ opacity:1; transform:scale(1.15); } }
    .gcm-num { fill:var(--cyan); font-size:22px; font-weight:bold; font-family:inherit; filter:drop-shadow(0 0 6px var(--cyan)); }
    .gcm-numlab { fill:var(--text-dim); font-size:6.5px; letter-spacing:2px; }
    .gcm-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
    .gcm-cell { border:1px solid var(--green-deep); border-radius:3px; padding:8px 10px; background:rgba(var(--accent-rgb),0.03); display:flex; flex-direction:column; gap:2px; }
    .gcm-cell span { font-size:9.5px; color:var(--text-dim); letter-spacing:1px; text-transform:uppercase; }
    .gcm-cell b { font-size:16px; color:var(--text); }
    .gcm-sec { display:flex; flex-direction:column; gap:6px; }
    .gcm-lab { font-size:10px; letter-spacing:1px; text-transform:uppercase; color:var(--text-dim); }
    .gcm-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .gcm-row input { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:6px 9px; font:inherit; font-size:12px; width:90px; }
    .gcm-row input:focus { outline:none; border-color:var(--cyan); }
    .gcm-tops { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .gcm-top { display:flex; flex-direction:column; gap:5px; }
    .gcm-list { display:flex; flex-direction:column; gap:3px; max-height:180px; overflow:auto; }
    .gcm-item { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; padding:3px 7px; border:1px solid var(--green-deep); border-radius:2px; background:rgba(var(--accent-rgb),0.03); }
    .gcm-item span { color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gcm-item b { color:var(--cyan); flex:0 0 auto; }
  `;
  document.head.appendChild(el);
}
