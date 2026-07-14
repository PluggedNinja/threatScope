import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

function Copy({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="tiny" onClick={() => {
      try { navigator.clipboard?.writeText(text); } catch {}
      sfx.click(); setOk(true); setTimeout(() => setOk(false), 1200);
    }}>{ok ? '✓ copiado' : '⧉ copiar'}</button>
  );
}
function Cmd({ children }) { return <div className="cmd"><code>{children}</code><Copy text={children} /></div>; }

const MODES = [
  { id: 'ssh', label: '🔑 SSH', desc: 'Honeypot na porta 22' },
  { id: 'web', label: '🌐 WEB', desc: 'Monitor de logs de acesso' },
  { id: 'net', label: '🛰️ NET', desc: 'Sensor tcpdump (todas as portas)' },
  { id: 'both', label: '🔑+🌐 Web+SSH', desc: 'SSH e logs web' },
  { id: 'all', label: '★ Tudo', desc: 'SSH + web + rede' },
];

export default function AgentGuide({ open, onClose, info, onRegistered, defaultMode = 'ssh' }) {
  const [mode, setMode] = useState(defaultMode);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(4000);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (open) setMode(defaultMode); }, [open, defaultMode]);

  const webActive = /web|both|all/.test(mode);
  const sshActive = /ssh|both|all/.test(mode);
  const netActive = /net|all/.test(mode);
  const bundleUrl = `${api.agentBundleUrl(mode)}&port=${encodeURIComponent(port || 4000)}${name ? `&id=${encodeURIComponent(name)}` : ''}`;

  const register = async () => {
    if (!host.trim()) { setMsg({ type: 'warn', text: 'Informe o IP/host do servidor.' }); return; }
    setBusy(true); setMsg(null); sfx.click();
    try {
      await api.addAgent({ host: host.trim(), port: Number(port) || 4000, name: name.trim() });
      sfx.success();
      setMsg({ type: 'ok', text: `Agente ${host.trim()}:${port} registrado! Depois você pode ajustar modo e logs pelo ⚙.` });
      setHost(''); setName('');
      onRegistered?.();
    } catch (e) { setMsg({ type: 'warn', text: `Falha ao registrar: ${e.message}` }); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="➕ Adicionar um agente (servidor)">
      <div className="guide">
        <div className="legal" style={{ marginBottom: 12, borderColor: 'var(--green-dim)', color: 'var(--text)', background: 'rgba(57,255,137,0.06)' }}>
          Fluxo: (1) escolha o modo, (2) baixe o agente já pré-configurado, (3) rode no servidor e
          (4) registre o IP dele aqui. Depois dá pra reconfigurar tudo pela interface (botão ⚙).
        </div>

        <p className="step"><span className="n">1</span> Escolha o que este agente vai fazer:</p>
        <div className="ag-modes">
          {MODES.map((m) => (
            <button key={m.id} className={'ag-mode' + (mode === m.id ? ' on' : '')} onClick={() => { sfx.click(); setMode(m.id); }}>
              <b>{m.label}</b><span>{m.desc}</span>
            </button>
          ))}
        </div>

        {info && !info.tokenConfigured && (
          <div className="legal" style={{ margin: '12px 0' }}>
            ⚠️ A central ainda usa o <b>INGEST_TOKEN</b> padrão. Defina um token forte no <b>server/.env</b> e
            reinicie — o agente baixado já vem com esse token.
          </div>
        )}

        <p className="step"><span className="n">2</span> Baixe o agente (um pacote só, já configurado no modo escolhido):</p>
        <a className="btn amber" href={bundleUrl} onClick={() => sfx.click()} download>⬇ Baixar agente (.zip)</a>

        <p className="step"><span className="n">3</span> No servidor, extraia, instale e suba:</p>
        <Cmd>cd agent &amp;&amp; npm install &amp;&amp; {sshActive ? 'sudo ' : ''}npm start</Cmd>
        {webActive && (
          <p className="tiny muted">
            Modo WEB autodetecta <code>/var/log/nginx/access.log</code>, <code>apache2</code> e <code>httpd</code>.
            Para apontar caminhos específicos, use o botão <b>⚙</b> depois de registrar — ou edite <b>WEB_LOGS</b> no <b>.env</b>.
            O usuário precisa de leitura nos logs (grupo adm/www-data, ou sudo).
          </p>
        )}
        {netActive && (
          <p className="tiny muted">
            <b>NET (tcpdump):</b> exige <b>tcpdump</b> instalado (<code>apt install tcpdump</code>) e <b>root</b> (sudo). Capta SYN de entrada em todas as portas e detecta varreduras. Ajuste a interface/filtro depois pelo <b>⚙</b>.
          </p>
        )}
        {sshActive && (
          <p className="tiny muted">
            <b>Linux:</b> porta 22 exige root (sudo). Ocupada pelo SSH real? Use <b>HONEYPOT_PORT=2222</b> no <b>.env</b> e redirecione com iptables.<br />
            <b>Windows:</b> dê duplo-clique em <b>start-agent.bat</b> (como Administrador p/ a porta 22, ou use <b>HONEYPOT_PORT=2222</b>). Libere a porta no firewall: <code>netsh advfirewall firewall add rule name="threatscope" dir=in action=allow protocol=TCP localport={port || 4000}</code>
          </p>
        )}
        <p className="tiny muted">Libere a porta <b>{port || 4000}/tcp</b> no firewall do servidor para o IP da central.</p>

        <p className="step"><span className="n">4</span> Registre o servidor — a central passa a coletar e você pode configurá-lo pela interface:</p>
        <div className="reg-form">
          <label className="field">IP / host do servidor
            <input placeholder="ex: 203.0.113.10" value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
          <label className="field">Porta
            <input type="number" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 90 }} />
          </label>
          <label className="field">Nome (opcional)
            <input placeholder="ex: web-01" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="amber" disabled={busy} onClick={register}>
            {busy ? <><span className="spinner" /> registrando…</> : '🛰️ Registrar agente'}
          </button>
        </div>

        {msg && (
          <div className="legal" style={{ marginTop: 10, borderColor: msg.type === 'ok' ? 'var(--green-dim)' : 'var(--amber)', color: msg.type === 'ok' ? 'var(--green)' : 'var(--amber)', background: 'rgba(0,0,0,0.25)' }}>
            {msg.text}
          </div>
        )}
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('agmode-styles')) {
  const el = document.createElement('style'); el.id = 'agmode-styles';
  el.textContent = `
    .ag-modes { display:flex; gap:8px; flex-wrap:wrap; margin:2px 0 4px; }
    .ag-mode { flex:1; min-width:130px; text-align:left; background:transparent; border:1px solid var(--green-deep);
      border-radius:4px; padding:8px 10px; cursor:pointer; display:flex; flex-direction:column; gap:2px; }
    .ag-mode b { color:var(--text); font-size:12px; } .ag-mode span { color:var(--text-dim); font-size:9.5px; }
    .ag-mode.on { border-color:var(--green); box-shadow:0 0 8px var(--glow); }
    .ag-mode.on b { color:var(--green); }
  `;
  document.head.appendChild(el);
}
