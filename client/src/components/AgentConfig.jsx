import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';
import { WORLD_PATH } from '../worldPath.js';

const MODES = [
  { id: 'ssh', label: '🔑 SSH', desc: 'Honeypot na porta 22' },
  { id: 'web', label: '🌐 WEB', desc: 'Monitor de logs de acesso' },
  { id: 'net', label: '🛰️ NET', desc: 'Sensor tcpdump (todas as portas)' },
  { id: 'both', label: '🔑+🌐 Web+SSH', desc: 'Honeypot SSH e logs web' },
  { id: 'all', label: '★ Tudo', desc: 'SSH + web + rede' },
];

function fmtSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(1) + ' GB';
}

export default function AgentConfig({ agent, open, onClose, onSaved }) {
  const id = agent?.id;
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState(null);   // resposta do /config
  const [offline, setOffline] = useState(false);
  const [mode, setMode] = useState('ssh');
  const [logs, setLogs] = useState([]);       // caminhos selecionados
  const [ignore, setIgnore] = useState('127.0.0.1,::1');
  const [netIface, setNetIface] = useState('any');
  const [netFilter, setNetFilter] = useState('');
  const [custom, setCustom] = useState('');
  const [discovered, setDiscovered] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [loc, setLoc] = useState(null);
  const [locMsg, setLocMsg] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState(null);

  const testConn = async () => {
    setTesting(true); setTestMsg(null); sfx.click();
    const t0 = performance.now();
    try {
      const c = await api.agentConfig(id);
      const ms = Math.round(performance.now() - t0);
      if (c && c.online) { setTestMsg({ type: 'ok', text: `✓ Online — ${ms}ms · v${c.version ?? '?'} · modo ${c.mode || '?'}` }); setState(c); setOffline(false); sfx.success(); }
      else setTestMsg({ type: 'warn', text: `✗ Sem resposta do agente${c && c.error ? ' — ' + c.error : ''}. Verifique se ele está rodando e se a porta ${agent?.port || 4000}/tcp está liberada para a central.` });
    } catch (e) {
      setTestMsg({ type: 'warn', text: `✗ Falha ao contatar a central: ${e.message}` });
    } finally { setTesting(false); }
  };
  useEffect(() => { if (open) { setLoc(agent?.loc || null); setLocMsg(null); } }, [open, agent]);

  const placeAt = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 500;
    const nl = { lat: +(90 - (y / 500) * 180).toFixed(3), lon: +((x / 1000) * 360 - 180).toFixed(3) };
    setLoc(nl); sfx.blip?.();
    try { await api.setAgentLocation(id, nl); setLocMsg({ type: 'ok', text: `Posição fixada: ${nl.lat}, ${nl.lon}` }); onSaved?.(); }
    catch { setLocMsg({ type: 'warn', text: 'Falha ao salvar posição.' }); }
  };
  const clearLoc = async () => {
    setLoc(null); sfx.click();
    try { await api.setAgentLocation(id, { clear: true }); setLocMsg({ type: 'ok', text: 'Voltou para a geolocalização automática.' }); onSaved?.(); }
    catch { setLocMsg({ type: 'warn', text: 'Falha ao limpar.' }); }
  };
  const mx = loc ? ((loc.lon + 180) / 360) * 1000 : 0;
  const my = loc ? ((90 - loc.lat) / 180) * 500 : 0;

  const loadConfig = () => {
    setLoading(true); setMsg(null); setDiscovered(null);
    api.agentConfig(id).then((c) => {
      setState(c); setOffline(!c.online);
      setMode(c.mode || 'ssh');
      setLogs((c.webLogs || '').split(',').map((s) => s.trim()).filter(Boolean));
      setIgnore(c.webIgnore || '127.0.0.1,::1');
      setNetIface(c.netIface || 'any');
      setNetFilter(c.netFilter || '');
    }).catch(() => setOffline(true)).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open || !id) return;
    loadConfig();
    api.managerInfo().then((m) => setLatestVersion(m.agentVersion)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  const doUpdate = async () => {
    setUpdating(true); setMsg(null); sfx.click();
    try {
      const r = await api.updateAgent(id);
      sfx.success();
      setMsg({ type: 'ok', text: r.applying ? 'Atualização enviada! O agente vai reiniciar com a versão nova em instantes.' : (r.upToDate ? 'O agente já está na versão mais recente.' : 'Comando de atualização enviado.') });
      setTimeout(loadConfig, 4000);
    } catch (e) {
      setMsg({ type: 'warn', text: `Falha ao atualizar: ${e.message}` });
    } finally { setUpdating(false); }
  };

  const outdated = latestVersion != null && state?.version != null && state.version < latestVersion;

  const detect = async () => {
    sfx.click(); setDiscovering(true);
    try { const d = await api.agentLogs(id); setDiscovered(d.logs || []); }
    catch { setMsg({ type: 'warn', text: 'Não consegui detectar os logs (agente offline?).' }); }
    finally { setDiscovering(false); }
  };

  const toggle = (p) => setLogs((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const addCustom = () => {
    const p = custom.trim(); if (!p) return;
    setLogs((cur) => (cur.includes(p) ? cur : [...cur, p])); setCustom(''); sfx.blip?.();
  };

  const webActive = /web|both|all/.test(mode);
  const netActive = /net|all/.test(mode);

  const save = async () => {
    setSaving(true); setMsg(null); sfx.click();
    try {
      const r = await api.setAgentConfig(id, { mode, webLogs: logs.join(','), webIgnore: ignore.trim(), netIface: netIface.trim() || 'any', netFilter: netFilter.trim() });
      setState(r); setOffline(false); sfx.success();
      setMsg({ type: 'ok', text: `Aplicado! modo=${r.mode} · SSH ${r.running?.ssh ? 'ON' : 'off'} · WEB ${r.running?.web ? `vendo ${r.files?.length || 0} arquivo(s)` : 'off'}` });
      onSaved?.();
    } catch (e) {
      setMsg({ type: 'warn', text: `Falha ao aplicar: ${e.message}. O agente está online?` });
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`⚙ Configurar agente · ${agent?.name || agent?.host || ''}`} width={620}>
      <div className="acfg">
        {loading && <div className="muted"><span className="spinner" /> consultando o agente…</div>}
        {!loading && offline && (
          <div className="legal" style={{ marginBottom: 12, borderColor: 'var(--amber)', color: 'var(--amber)' }}>
            ⚠️ Agente offline ou sem resposta. Você pode ajustar abaixo e salvar — será aplicado assim que ele responder.
          </div>
        )}

        {!loading && (
          <>
            {state?.running && (
              <div className="acfg-status">
                <span className={'acfg-led ' + (state.running.ssh ? 'on' : '')}>SSH {state.running.ssh ? 'ativo' : 'off'}</span>
                <span className={'acfg-led ' + (state.running.web ? 'on' : '')}>WEB {state.running.web ? `${state.files?.length || 0} log(s)` : 'off'}</span>
                <span className={'acfg-led ' + (state.running.net ? 'on' : '')}>NET {state.running.net ? 'ativo' : 'off'}</span>
                <span className="acfg-cap">{(state.count ?? 0).toLocaleString('pt-BR')} capturas em buffer</span>
              </div>
            )}

            <div className="acfg-ver">
              <span>Versão do agente: <b>{state?.version ?? '—'}</b>{latestVersion != null && <span className="muted"> · central: {latestVersion}</span>}</span>
              <button className="tiny" disabled={testing} onClick={testConn}>{testing ? <><span className="spinner" /> testando…</> : '🔌 Testar conexão'}</button>
              {outdated
                ? <button className="tiny amber" disabled={updating} onClick={doUpdate}>{updating ? <><span className="spinner" /> atualizando…</> : '⬆ Atualizar agora'}</button>
                : (latestVersion != null && <span className="acfg-uptodate">✓ atualizado</span>)}
              {state?.updating && <span className="muted">↻ atualização em andamento…</span>}
            </div>
            {testMsg && (
              <div className="tiny" style={{ color: testMsg.type === 'ok' ? 'var(--green)' : 'var(--amber)', marginTop: -6 }}>{testMsg.text}</div>
            )}

            <div className="acfg-sec">
              <label className="acfg-lab">Modo do agente</label>
              <div className="acfg-modes">
                {MODES.map((m) => (
                  <button key={m.id} className={'acfg-mode' + (mode === m.id ? ' on' : '')} onClick={() => { sfx.click(); setMode(m.id); }}>
                    <b>{m.label}</b><span>{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="acfg-sec" style={{ opacity: webActive ? 1 : 0.5 }}>
              <label className="acfg-lab">
                Logs web {webActive ? '' : '(ative o modo WEB ou Ambos)'}
                <button className="tiny" style={{ marginLeft: 8 }} disabled={!webActive || discovering} onClick={detect}>
                  {discovering ? <><span className="spinner" /> detectando…</> : '🔍 detectar logs no servidor'}
                </button>
              </label>

              {logs.length === 0
                ? <div className="tiny muted" style={{ margin: '4px 0' }}>Nenhum caminho selecionado → o agente <b>autodetecta</b> nginx/apache/httpd.</div>
                : (
                  <div className="acfg-chips">
                    {logs.map((p) => (
                      <span key={p} className="acfg-chip">{p}<button onClick={() => toggle(p)} title="remover">✕</button></span>
                    ))}
                  </div>
                )}

              {discovered && (
                <div className="acfg-found">
                  {discovered.length === 0 && <div className="tiny muted">nada encontrado nos caminhos padrão.</div>}
                  {discovered.map((f) => (
                    <label key={f.path} className={'acfg-file' + (f.readable ? '' : ' bad')} title={f.readable ? f.sample : 'sem permissão de leitura'}>
                      <input type="checkbox" checked={logs.includes(f.path)} disabled={!f.readable} onChange={() => toggle(f.path)} />
                      <span className="acfg-file-path">{f.path}</span>
                      <span className="acfg-file-meta">
                        {f.exists ? (f.readable ? fmtSize(f.size) : '🔒 sem leitura') : 'não existe'}
                      </span>
                      {f.sample && <span className="acfg-file-sample">{f.sample}</span>}
                    </label>
                  ))}
                </div>
              )}

              <div className="acfg-custom">
                <input placeholder="/caminho/para/access.log" value={custom}
                  onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }} />
                <button className="tiny" onClick={addCustom}>+ adicionar caminho</button>
              </div>
            </div>

            <div className="acfg-sec">
              <label className="acfg-lab">📍 Posição no mapa {loc ? '(manual)' : '(automática)'} — clique para fixar</label>
              <div className="acfg-map">
                <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet" onClick={placeAt}>
                  <rect x="0" y="0" width="1000" height="500" fill="var(--bg-0)" />
                  <path d={WORLD_PATH} fill="rgba(var(--accent-rgb),0.09)" stroke="rgba(var(--accent-rgb),0.5)" strokeWidth="0.6" />
                  {loc && (
                    <g transform={`translate(${mx},${my})`}>
                      <circle r="12" fill="none" stroke="var(--cyan)" strokeWidth="1.4" opacity="0.6" />
                      <circle r="4.5" fill="var(--cyan)" />
                      <path d="M0,-9 L0,9 M-9,0 L9,0" stroke="var(--cyan)" strokeWidth="0.8" opacity="0.7" />
                    </g>
                  )}
                </svg>
              </div>
              <div className="flex" style={{ alignItems: 'center' }}>
                <span className="tiny muted">{loc ? `manual: ${loc.lat}, ${loc.lon}` : 'usando a geolocalização automática do IP'}</span>
                {loc && <button className="tiny right" onClick={clearLoc}>↺ usar automática</button>}
              </div>
              {locMsg && <div className="tiny" style={{ color: locMsg.type === 'ok' ? 'var(--green)' : 'var(--amber)' }}>{locMsg.text}</div>}
            </div>

            <div className="acfg-sec" style={{ opacity: webActive ? 1 : 0.5 }}>
              <label className="acfg-lab">IPs a ignorar (web)</label>
              <input className="acfg-ignore" value={ignore} onChange={(e) => setIgnore(e.target.value)}
                placeholder="127.0.0.1,::1,10.0.0." />
              <div className="tiny muted">Prefixos/substrings separados por vírgula (ex.: seu próprio IP, ranges internos).</div>
            </div>

            <div className="acfg-sec" style={{ opacity: netActive ? 1 : 0.5 }}>
              <label className="acfg-lab">Sensor de rede (tcpdump) {netActive ? '' : '(ative o modo NET ou Tudo)'}</label>
              <div className="acfg-custom">
                <input placeholder="interface (any)" value={netIface} onChange={(e) => setNetIface(e.target.value)} style={{ maxWidth: 140 }} />
                <input placeholder="filtro BPF opcional (vazio = SYNs de entrada)" value={netFilter} onChange={(e) => setNetFilter(e.target.value)} />
              </div>
              <div className="tiny muted">Precisa de <b>tcpdump</b> instalado e <b>root</b>. Capta SYN de entrada em todas as portas e detecta varreduras.</div>
            </div>

            {msg && (
              <div className="legal" style={{ borderColor: msg.type === 'ok' ? 'var(--green-dim)' : 'var(--amber)', color: msg.type === 'ok' ? 'var(--green)' : 'var(--amber)', background: 'rgba(0,0,0,0.25)' }}>
                {msg.text}
              </div>
            )}

            <div className="flex" style={{ marginTop: 14 }}>
              <button className="amber" disabled={saving} onClick={save}>
                {saving ? <><span className="spinner" /> aplicando…</> : '💾 Aplicar ao vivo'}
              </button>
              <button className="right" onClick={() => { sfx.click(); onClose(); }}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('acfg-styles')) {
  const el = document.createElement('style'); el.id = 'acfg-styles';
  el.textContent = `
    .acfg { display:flex; flex-direction:column; gap:14px; }
    .acfg-status { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:11px; }
    .acfg-led { border:1px solid var(--green-deep); border-radius:3px; padding:2px 8px; color:var(--text-dim); }
    .acfg-led.on { color:var(--green); border-color:var(--green); box-shadow:0 0 6px var(--glow); }
    .acfg-cap { color:var(--text-dim); margin-left:auto; }
    .acfg-ver { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text); flex-wrap:wrap;
      border:1px solid var(--green-deep); border-radius:3px; padding:6px 10px; background:rgba(var(--accent-rgb),0.03); }
    .acfg-ver b { color:var(--cyan); }
    .acfg-uptodate { color:var(--green); font-size:10.5px; }
    .acfg-sec { display:flex; flex-direction:column; gap:6px; }
    .acfg-lab { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-dim); display:flex; align-items:center; }
    .acfg-modes { display:flex; gap:8px; flex-wrap:wrap; }
    .acfg-mode { flex:1; min-width:120px; text-align:left; background:transparent; border:1px solid var(--green-deep);
      border-radius:4px; padding:8px 10px; cursor:pointer; display:flex; flex-direction:column; gap:2px; }
    .acfg-mode b { color:var(--text); font-size:12px; } .acfg-mode span { color:var(--text-dim); font-size:9.5px; }
    .acfg-mode.on { border-color:var(--green); box-shadow:0 0 8px var(--glow); }
    .acfg-mode.on b { color:var(--green); }
    .acfg-chips { display:flex; gap:6px; flex-wrap:wrap; }
    .acfg-chip { display:inline-flex; align-items:center; gap:6px; font-size:10.5px; color:var(--cyan);
      border:1px solid var(--green-deep); border-radius:3px; padding:2px 6px; background:rgba(var(--accent-rgb),0.05); }
    .acfg-chip button { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0; font-size:11px; }
    .acfg-found { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow:auto; border:1px solid var(--green-deep);
      border-radius:3px; padding:6px; background:var(--bg-0); }
    .acfg-file { display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:center; padding:4px 6px; border-radius:3px; cursor:pointer; }
    .acfg-file:hover { background:rgba(var(--accent-rgb),0.05); }
    .acfg-file.bad { opacity:0.55; cursor:not-allowed; }
    .acfg-file-path { color:var(--text); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .acfg-file-meta { color:var(--text-dim); font-size:9.5px; }
    .acfg-file-sample { grid-column:2 / -1; color:var(--text-dim); font-size:9px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .acfg-custom { display:flex; gap:8px; }
    .acfg-custom input, .acfg-ignore { flex:1; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text);
      border-radius:3px; padding:6px 9px; font:inherit; font-size:11px; }
    .acfg-custom input:focus, .acfg-ignore:focus { outline:none; border-color:var(--cyan); }
    .acfg-map { border:1px solid var(--green-deep); border-radius:3px; overflow:hidden; background:var(--bg-0); }
    .acfg-map svg { display:block; width:100%; aspect-ratio:2/1; cursor:crosshair; }
  `;
  document.head.appendChild(el);
}
