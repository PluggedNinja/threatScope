import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

// Configuração da central — tudo o que antes ficava no server/.env, agora aqui.
export default function ConfigModal({ open, onClose }) {
  const [c, setC] = useState(null);
  const [msg, setMsg] = useState('');
  const [restart, setRestart] = useState(false);
  const [showTok, setShowTok] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMsg(''); setRestart(false);
    api.managerConfig().then(setC).catch(() => setMsg('falha ao carregar config'));
  }, [open]);

  const set = (k, v) => setC((o) => ({ ...o, [k]: v }));

  const save = async () => {
    if (!c) return;
    setMsg('salvando…');
    try {
      const r = await api.setManagerConfig(c);
      setC(r); setRestart(!!r.restartNeeded);
      setMsg('✓ salvo — mudanças (exceto porta) já valendo'); sfx.success();
      setTimeout(() => setMsg(''), 4000);
    } catch { setMsg('falha ao salvar'); sfx.alert(); }
  };

  return (
    <Modal open={open} onClose={onClose} title="⚙️ Configuração da central" width={640}>
      {!c && <div className="muted"><span className="spinner" /> carregando…</div>}
      {c && (
        <div className="cfg">
          <div className="cfg-note tiny">Tudo aqui era do <code>server/.env</code>. Agora fica salvo na base e vale ao vivo (só a porta exige reiniciar).</div>

          <label className="cfg-row">
            <span>Token de coleta <span className="tiny muted">(o MESMO nos agentes)</span></span>
            <span className="cfg-tok">
              <input type={showTok ? 'text' : 'password'} value={c.ingestToken} onChange={(e) => set('ingestToken', e.target.value)} />
              <button type="button" className="tiny" onClick={() => setShowTok((s) => !s)}>{showTok ? '🙈' : '👁'}</button>
            </span>
          </label>

          <label className="cfg-row">
            <span>Porta da API <span className="tiny amber">(reiniciar p/ valer)</span></span>
            <input type="number" min="1" max="65535" value={c.apiPort} onChange={(e) => set('apiPort', Number(e.target.value))} />
          </label>

          <label className="cfg-row">
            <span>Intervalo de coleta <span className="tiny muted">(ms, mín. 1000)</span></span>
            <input type="number" min="1000" step="500" value={c.pollMs} onChange={(e) => set('pollMs', Number(e.target.value))} />
          </label>

          <label className="cfg-row">
            <span>CORS (origem permitida) <span className="tiny muted">* = tudo</span></span>
            <input type="text" value={c.corsOrigin} onChange={(e) => set('corsOrigin', e.target.value)} />
          </label>

          <label className="cfg-row">
            <span>URL pública da central <span className="tiny muted">(embutida no agente baixado)</span></span>
            <input type="text" placeholder="http://203.0.113.10:4000" value={c.publicUrl} onChange={(e) => set('publicUrl', e.target.value)} />
          </label>

          <div className="cfg-sec">GeoIP & Reputação</div>
          <label className="cfg-check"><input type="checkbox" checked={!!c.geoipDisable} onChange={(e) => set('geoipDisable', e.target.checked)} /> Desligar GeoIP (offline/privacidade)</label>
          <label className="cfg-row">
            <span>Validade do cache GeoIP <span className="tiny muted">(dias)</span></span>
            <input type="number" min="0" value={c.geoTtlDays} onChange={(e) => set('geoTtlDays', Number(e.target.value))} />
          </label>
          <label className="cfg-row">
            <span>Chave AbuseIPDB <span className="tiny muted">(opcional, grátis)</span></span>
            <input type="password" value={c.abuseipdbKey} onChange={(e) => set('abuseipdbKey', e.target.value)} placeholder="deixe vazio se não usar" />
          </label>

          <div className="cfg-sec">Auto-bloqueio</div>
          <label className="cfg-check"><input type="checkbox" checked={c.autoblockAvailable !== false} onChange={(e) => set('autoblockAvailable', e.target.checked)} /> Recurso de auto-bloqueio disponível (desmarque p/ remover totalmente)</label>

          {restart && <div className="cfg-warn">⚠ A porta mudou para <b>{c.apiPort}</b>. Reinicie a central para a nova porta valer (as outras mudanças já estão ativas).</div>}

          <div className="cfg-actions">
            {msg && <span className="tiny muted">{msg}</span>}
            <button className="tiny amber" onClick={save}>💾 Salvar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('cfg-styles')) {
  const el = document.createElement('style'); el.id = 'cfg-styles';
  el.textContent = `
    .cfg { display:flex; flex-direction:column; gap:9px; }
    .cfg-note { color:var(--text-dim); }
    .cfg code { color:var(--cyan); background:rgba(var(--accent-rgb),0.08); padding:0 3px; border-radius:2px; }
    .cfg-sec { margin-top:6px; color:var(--green); font-size:11px; letter-spacing:2px; border-bottom:1px solid var(--green-deep); padding-bottom:3px; }
    .cfg-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12px; color:var(--text); }
    .cfg-row > span:first-child { flex:1; }
    .cfg-row input { width:230px; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:5px 8px; font:inherit; font-size:11px; }
    .cfg-row input:focus { outline:none; border-color:var(--cyan); }
    .cfg-tok { display:inline-flex; gap:4px; align-items:center; }
    .cfg-tok input { width:200px; }
    .cfg-check { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--text); cursor:pointer; }
    .cfg-warn { border:1px solid var(--amber); border-radius:3px; padding:7px 9px; font-size:11px; color:var(--amber); background:rgba(var(--warn-rgb),0.07); }
    .cfg-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:6px; }
  `;
  document.head.appendChild(el);
}
