import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

// Lista os IPs bloqueados no ufw de cada agente, com opção de desbloquear.
export default function BlockedModal({ open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [ab, setAb] = useState(null);
  const [abMsg, setAbMsg] = useState('');
  const [allowText, setAllowText] = useState('');

  const load = () => {
    setLoading(true);
    api.blockedList().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    api.getAutoblock().then((r) => { setAb(r); setAllowText((r.allowlist || []).join(', ')); }).catch(() => {});
  };
  useEffect(() => { if (open) load(); }, [open]);

  const saveAb = async (patch) => {
    const next = { ...ab, ...patch };
    setAb(next); setAbMsg('salvando…');
    try { const r = await api.setAutoblock(next); setAb(r); setAbMsg('✓ salvo'); sfx.blip?.(); setTimeout(() => setAbMsg(''), 1500); }
    catch { setAbMsg('falha ao salvar'); }
  };

  const resetSession = async () => {
    sfx.click(); setAbMsg('limpando…');
    try { const r = await api.resetAutoblockSession(); setAb(r); setAbMsg('memória limpa'); setTimeout(() => setAbMsg(''), 1500); }
    catch { setAbMsg('falha'); }
  };

  const unblock = async (ip, tag, ports) => {
    setBusy(ip + tag); sfx.click();
    try { await api.unblockIp(ip, [tag], ports); sfx.success(); load(); }
    catch {} finally { setBusy(''); }
  };
  const unblockAll = async (ip, ports) => {
    setBusy(ip + '*'); sfx.click();
    try { await api.unblockIp(ip, null, ports); sfx.success(); load(); }
    catch {} finally { setBusy(''); }
  };

  const agents = data?.agents || [];
  const totalBlocked = agents.reduce((n, a) => n + (a.blocked?.length || 0), 0);

  return (
    <Modal open={open} onClose={onClose} title="🚫 IPs bloqueados (ufw)" width={720}>
      <div className="blkm">
        <div className="blkm-top">
          <span className="tiny muted">{totalBlocked} bloqueio(s) em {agents.length} agente(s)</span>
          <button className="tiny" onClick={load} disabled={loading}>↻ atualizar</button>
        </div>

        {ab && ab.available === false && (
          <div className="blkm-ab" style={{ opacity: 0.75 }}>
            <span className="tiny muted">🤖 Auto-bloqueio <b>desativado</b> nesta instalação (a central foi iniciada com <code>DISABLE_AUTOBLOCK=1</code>). O bloqueio manual continua funcionando.</span>
          </div>
        )}

        {ab && ab.available !== false && (
          <div className="blkm-ab">
            <label className="blkm-ab-toggle">
              <input type="checkbox" checked={!!ab.enabled} onChange={(e) => saveAb({ enabled: e.target.checked })} />
              <b>🤖 Auto-bloqueio</b> — a central bloqueia IPs abusivos sozinha
              {abMsg && <span className="tiny muted" style={{ marginLeft: 6 }}>{abMsg}</span>}
            </label>
            {ab.enabled && (
              <div className="blkm-ab-session">
                <span className="tiny muted">{ab.sessionBlocked || 0} auto-bloqueado(s) nesta sessão</span>
                <button className="tiny" onClick={resetSession} disabled={!ab.sessionBlocked}>🧹 limpar memória</button>
              </div>
            )}
            <div className="blkm-ab-opts" style={{ opacity: ab.enabled ? 1 : 0.45, pointerEvents: ab.enabled ? 'auto' : 'none' }}>
              <label>SSH: bloquear acima de <input type="number" min="0" value={ab.sshAttempts} onChange={(e) => saveAb({ sshAttempts: Number(e.target.value) })} /> tentativas <span className="tiny muted">(0 = desligado)</span></label>
              <label><input type="checkbox" checked={!!ab.blockScanners} onChange={(e) => saveAb({ blockScanners: e.target.checked })} /> bloquear <b>port scanners</b> (NET)</label>
              <label><input type="checkbox" checked={!!ab.blockWebHits} onChange={(e) => saveAb({ blockWebHits: e.target.checked })} /> bloquear quem <b>acertou alvo web</b> (hit)</label>
              <label>Onde: <select value={ab.scope} onChange={(e) => saveAb({ scope: e.target.value })}>
                <option value="all">todos os agentes</option>
                <option value="hit">só os agentes atingidos</option>
              </select></label>
              <div className="blkm-ab-allow">
                <span>🛡️ Allowlist <span className="tiny muted">(nunca bloquear — IPs ou prefixos de faixa, ex.: <code>203.0.113.7</code> ou <code>10.</code>)</span></span>
                <textarea
                  rows={2}
                  value={allowText}
                  placeholder="seu.ip.aqui, 192.168., 10."
                  onChange={(e) => setAllowText(e.target.value)}
                  onBlur={() => saveAb({ allowlist: allowText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean) })}
                />
              </div>
            </div>
          </div>
        )}
        {loading && <div className="muted"><span className="spinner" /> lendo ufw…</div>}
        {!loading && agents.length === 0 && <div className="muted tiny">Nenhum agente registrado.</div>}
        {!loading && agents.map((a) => (
          <div key={a.id} className="blkm-agent">
            <div className="blkm-agent-head">
              <span className={'wd-dot ' + (a.online ? 'on' : 'off')} /> <b>{a.agent}</b>
              <span className="tiny muted">{a.online ? `${a.blocked.length} bloqueado(s)` : (a.error || 'offline')}</span>
              {a.online && <span className={'fw-badge ' + (a.ufwActive ? 'ok' : (a.firewall ? 'warn' : 'off'))} title="mecanismo de firewall que está aplicando os bloqueios">
                {a.ufwActive ? '🟢 ufw ativo' : a.firewall === 'iptables' ? '🟡 ufw ausente · iptables' : a.firewall ? '🟡 ufw INATIVO · iptables' : '⚪ firewall ?'}
              </span>}
            </div>
            <div className="blkm-ips">
              {a.online && a.blocked.length === 0 && <span className="tiny muted">nenhum IP bloqueado</span>}
              {a.blocked.map((raw) => {
                const b = typeof raw === 'string' ? { ip: raw, all: true, ports: [] } : raw;
                const ports = b.all ? null : (b.ports || []);
                return (
                  <span key={b.ip} className="blkm-ip">
                    {b.ip}{!b.all && b.ports && b.ports.length ? <span className="blkm-ports">:{b.ports.join(',')}</span> : ''}
                    <button className="blkm-x" disabled={busy === b.ip + a.agent} onClick={() => unblock(b.ip, a.agent, ports)} title="desbloquear neste agente">
                      {busy === b.ip + a.agent ? '…' : '✕'}
                    </button>
                    <button className="blkm-all" disabled={busy === b.ip + '*'} onClick={() => unblockAll(b.ip, ports)} title="desbloquear em todos os agentes">
                      {busy === b.ip + '*' ? '…' : '⎘'}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        <div className="tiny muted">✕ = desbloqueia só neste agente · ⎘ = desbloqueia em todos. Requer ufw + root no agente.</div>
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('blkm-styles')) {
  const el = document.createElement('style'); el.id = 'blkm-styles';
  el.textContent = `
    .blkm { display:flex; flex-direction:column; gap:12px; }
    .blkm-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .blkm-ab { border:1px solid var(--green-deep); border-radius:4px; padding:9px 11px; background:rgba(var(--accent-rgb),0.03); display:flex; flex-direction:column; gap:7px; }
    .blkm-ab-toggle { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text); cursor:pointer; }
    .blkm-ab code { color:var(--cyan); background:rgba(var(--accent-rgb),0.08); padding:0 3px; border-radius:2px; }
    .blkm-ab-session { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 8px; border:1px dashed var(--green-deep); border-radius:3px; background:rgba(var(--accent-rgb),0.02); }
    .blkm-ab-opts { display:flex; flex-direction:column; gap:6px; font-size:11.5px; color:var(--text); }
    .blkm-ab-opts label { display:flex; align-items:center; gap:6px; }
    .blkm-ab-opts input[type=number] { width:70px; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:3px 6px; font:inherit; }
    .blkm-ab-opts select { background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:3px 6px; font:inherit; font-size:11px; }
    .blkm-ab-allow { display:flex; flex-direction:column; gap:4px; margin-top:2px; }
    .blkm-ab-allow code { color:var(--cyan); background:rgba(var(--accent-rgb),0.08); padding:0 3px; border-radius:2px; }
    .blkm-ab-allow textarea { width:100%; box-sizing:border-box; resize:vertical; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:5px 7px; font-family:var(--mono,monospace); font-size:11px; }
    .blkm-agent { border:1px solid var(--green-deep); border-radius:4px; padding:8px 10px; background:rgba(var(--accent-rgb),0.03); }
    .blkm-agent-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .blkm-agent-head b { color:var(--cyan); }
    .fw-badge { margin-left:auto; font-size:10.5px; padding:1px 7px; border-radius:10px; border:1px solid; white-space:nowrap; }
    .fw-badge.ok { color:var(--green); border-color:var(--green-deep); background:rgba(var(--accent-rgb),0.06); }
    .fw-badge.warn { color:var(--amber); border-color:var(--amber); background:rgba(var(--warn-rgb),0.08); }
    .fw-badge.off { color:var(--text-dim); border-color:var(--green-deep); }
    .blkm-ips { display:flex; gap:6px; flex-wrap:wrap; }
    .blkm-ip { display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--text); border:1px solid #5a1620; border-radius:3px; padding:2px 4px 2px 7px; background:rgba(255,59,92,0.06); }
    .blkm-ports { color:var(--amber); font-size:10px; }
    .blkm-x, .blkm-all { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0 3px; font-size:11px; }
    .blkm-x:hover { color:#ff3b5c; } .blkm-all:hover { color:var(--amber); }
    .wd-dot { width:7px; height:7px; border-radius:50%; display:inline-block; } .wd-dot.on { background:var(--green); box-shadow:0 0 6px var(--green); } .wd-dot.off { background:var(--red); }
  `;
  document.head.appendChild(el);
}
