import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import AbuseModal from './AbuseModal.jsx';
import RepVerdict from './RepVerdict.jsx';
import BlockIpButton from './BlockIpButton.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

const sev = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');
function time(ts) { try { return new Date(ts).toLocaleString('pt-BR'); } catch { return ''; } }

// Dossiê de rede de um IP: histórico de conexões (tcpdump), portas, reputação.
export default function NetIpDetail({ ip, onClose }) {
  const [rows, setRows] = useState(null);
  const [rep, setRep] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [showRep, setShowRep] = useState(false);

  useEffect(() => {
    setRep(null); setShowRep(false);
    if (!ip) { setRows(null); return; }
    let alive = true; setRows(null);
    api.netIp(ip).then((r) => { if (alive) setRows(Array.isArray(r) ? r : []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [ip]);

  const loadRep = () => {
    sfx.click(); const opening = !showRep; setShowRep(opening);
    if (!opening || repLoading || !ip || rep) return;
    setRepLoading(true);
    api.reputation(ip).then(setRep).catch(() => setRep({ error: 'falha ao consultar reputação' })).finally(() => setRepLoading(false));
  };

  const [abuse, setAbuse] = useState(null); // { email, text, busy }
  const buildReport = () => {
    const s = summary;
    const ports = (s.topPorts || []).map(([p, n]) => `${p} x${n}`).join(', ') || 'n/a';
    const svcs = (s.topSvc || []).map(([sv, n]) => `${sv} x${n}`).join(', ') || 'n/a';
    const evid = (rows || []).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 10)
      .map((r) => `  ${new Date(r.ts).toISOString()}  ${ip} -> ${r.agent || 'server'}:${r.dstPort}/${r.proto || 'tcp'}  ${r.service || ''}${r.scan ? ' [PORT SCAN]' : ''}`);
    return [
      'Hello,', '',
      'We are reporting abusive network activity originating from an IP address in your network.', '',
      `Source IP: ${ip}`,
      'Activity: unsolicited connection attempts / port scanning against our servers',
      `Observed (UTC): ${s.first ? new Date(s.first).toISOString() : '?'} to ${s.last ? new Date(s.last).toISOString() : '?'}`,
      `Connection attempts: ${s.total} across ${s.ports} distinct ports · port scan detected: ${s.scan ? 'YES' : 'no'}`,
      `Top targeted ports: ${ports}`,
      `Top targeted services: ${svcs}`,
      `Targeted host(s): ${(s.agents || []).join(', ') || 'n/a'}`, '',
      'Evidence (most recent connections, timestamps in UTC):',
      ...evid, '',
      'These connections were captured by our network sensors (passive SYN capture) and were not solicited.',
      'Please investigate and take appropriate action against the source.', '',
      'Regards,', 'Security Team',
    ].join('\n');
  };
  const reportAbuse = async () => {
    sfx.click(); setAbuse({ busy: true });
    let email = null, cc = null;
    try { const w = await api.whois(ip); email = w && w.abuseEmail ? w.abuseEmail : null; cc = (w && w.countryCode) || null; } catch {}
    const s = summary;
    // Comentário curto p/ AbuseIPDB (máx 1024 chars, sem PII).
    const topPorts = (s.topPorts || []).slice(0, 8).map(([p]) => p).join(', ');
    const comment = `Port scan / unsolicited connection attempts detected: ${s.total} connections to ${s.ports} distinct ports (${topPorts || 'n/a'}) between ${s.first ? new Date(s.first).toISOString() : '?'} and ${s.last ? new Date(s.last).toISOString() : '?'} (UTC). Captured by passive network sensors (SYN capture).`;
    setAbuse({ email, text: buildReport(), subject: `Abuse report: port scanning / unauthorized access from ${ip}`, comment, lastTs: s.last || null, countryCode: cc });
  };

  const summary = useMemo(() => {
    const list = rows || [];
    const ports = new Map(); const services = new Map(); const agents = new Set();
    let maxScore = 0, scan = false, first = null, last = null;
    for (const r of list) {
      ports.set(r.dstPort, (ports.get(r.dstPort) || 0) + 1);
      if (r.service) services.set(r.service, (services.get(r.service) || 0) + 1);
      if (r.agent) agents.add(r.agent);
      maxScore = Math.max(maxScore, r.score || 0); if (r.scan) scan = true;
      if (!first || r.ts < first) first = r.ts; if (!last || r.ts > last) last = r.ts;
    }
    const topPorts = Array.from(ports.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topSvc = Array.from(services.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { total: list.length, ports: ports.size, topPorts, topSvc, agents: [...agents], maxScore, scan, first, last };
  }, [rows]);

  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 500), [rows]);

  return (
    <Modal open={!!ip} title={`🛰️ Dossiê de rede · ${ip || ''}`} onClose={onClose} width={760}>
      <div className="ipd">
        <div className="ipd-bar">
          <div className="ipd-chips">
            <span className="chip">{summary.total.toLocaleString('pt-BR')} conexões</span>
            <span className="chip">{summary.ports} portas distintas</span>
            <span className="chip" style={{ color: sev(summary.maxScore) }}>risco {summary.maxScore}</span>
            {summary.scan && <span className="chip" style={{ color: '#ff3b5c', borderColor: '#ff3b5c' }}>🛑 VARREDURA</span>}
          </div>
          <div className="ipd-actions">
            <button className="tiny" onClick={loadRep}>🛡 Reputação</button>
            <button className="tiny amber" disabled={abuse?.busy} onClick={reportAbuse}>{abuse?.busy ? <><span className="spinner" /> buscando…</> : '✉ Reportar abuse'}</button>
            <BlockIpButton ip={ip} tags={summary.agents} suggestedPorts={(summary.topPorts || []).slice(0, 6).map(([p]) => Number(p)).filter(Boolean)} />
          </div>
        </div>

        <AbuseModal open={!!(abuse && !abuse.busy)} onClose={() => setAbuse(null)} ip={ip} email={abuse?.email} subject={abuse?.subject} text={abuse?.text}
          context="net" comment={abuse?.comment} lastTs={abuse?.lastTs} countryCode={abuse?.countryCode} />

        {summary.total > 0 && (
          <div className="nid-summary">
            <div className="nid-block">
              <span className="ipd-lab">Portas mais tocadas</span>
              <div className="nid-ports">{summary.topPorts.map(([p, n]) => <span key={p} className="na-port">{p}<b>×{n}</b></span>)}</div>
            </div>
            <div className="nid-block">
              <span className="ipd-lab">Serviços alvo</span>
              <div className="nid-ports">{summary.topSvc.length ? summary.topSvc.map(([s, n]) => <span key={s} className="na-port" style={{ color: 'var(--cyan)' }}>{s}<b>×{n}</b></span>) : <span className="muted tiny">—</span>}</div>
            </div>
            <div className="nid-block">
              <span className="ipd-lab">Servidores atingidos · janela</span>
              <div className="tiny" style={{ color: 'var(--text)' }}>{summary.agents.join(', ') || '—'} · {time(summary.first)} → {time(summary.last)}</div>
            </div>
          </div>
        )}

        {showRep && (
          <div className="ipd-whois">
            {repLoading && <div className="muted"><span className="spinner" /> consultando blocklists…</div>}
            {!repLoading && rep && rep.error && <div className="muted">⚠ {rep.error}</div>}
            {!repLoading && rep && !rep.error && (
              <div className="ipd-rep">
                <RepVerdict rep={rep} />
                <div className="ipd-rep-bls">
                  {(rep.dnsbl || []).map((d) => <span key={d.name} className={'ipd-bl' + (d.listed ? ' on' : '')}>{d.listed ? '⛔' : '✓'} {d.name}</span>)}
                </div>
                {!rep.abuseConfigured && <div className="tiny muted">💡 Score do AbuseIPDB é grátis: defina <b>ABUSEIPDB_KEY</b> no <b>server/.env</b>.</div>}
              </div>
            )}
          </div>
        )}

        <div className="ipd-table">
          <table>
            <thead><tr><th>Quando</th><th>Proto/Porta</th><th>Serviço</th><th>Ação detectada</th><th>Risco</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={5}><span className="spinner" /> carregando conexões…</td></tr>}
              {rows && rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 18 }}>sem conexões registradas para este IP</td></tr>}
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="tiny">{time(r.ts)}</td>
                  <td className="tiny"><b style={{ color: 'var(--cyan)' }}>{(r.proto || 'tcp')}/{r.dstPort}</b></td>
                  <td className="tiny">{r.service || '—'}</td>
                  <td className="tiny" style={{ color: r.scan ? '#ff3b5c' : 'var(--text)' }}>{r.label}{r.scan ? ' 🛑' : ''}</td>
                  <td className="tiny"><span style={{ color: sev(r.score) }}>{r.score}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('nid-styles')) {
  const el = document.createElement('style'); el.id = 'nid-styles';
  el.textContent = `
    .nid-summary { display:grid; grid-template-columns:1fr 1fr; gap:10px 18px; border:1px solid var(--green-deep); border-radius:3px; padding:10px; background:rgba(var(--accent-rgb),0.03); }
    .nid-block:last-child { grid-column:1 / -1; }
    .nid-ports { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; }
    .nid-report { width:100%; min-height:150px; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:8px; font:inherit; font-size:11px; resize:vertical; }
  `;
  document.head.appendChild(el);
}
