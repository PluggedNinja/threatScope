import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import AbuseModal from './AbuseModal.jsx';
import RepVerdict from './RepVerdict.jsx';
import BlockIpButton from './BlockIpButton.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

const sev = (v) => (v >= 85 ? '#ff3b5c' : v >= 60 ? '#ff8c38' : v >= 35 ? '#ffcf3a' : v >= 10 ? '#39d0ff' : '#39ff89');
function time(ts) { try { return new Date(ts).toLocaleString('pt-BR'); } catch { return ''; } }
function short(p, n = 46) { p = String(p || ''); return p.length > n ? p.slice(0, n - 1) + '…' : p; }

// Dossiê web de um IP: histórico de requisições, hits, sites, reputação, abuse, bloqueio.
export default function WebIpDetail({ ip, onClose }) {
  const [rows, setRows] = useState(null);
  const [rep, setRep] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [showRep, setShowRep] = useState(false);
  const [abuse, setAbuse] = useState(null);

  useEffect(() => {
    setRep(null); setShowRep(false); setAbuse(null);
    if (!ip) { setRows(null); return; }
    let alive = true; setRows(null);
    api.webIp(ip).then((r) => { if (alive) setRows(Array.isArray(r) ? r : []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [ip]);

  const loadRep = () => {
    sfx.click(); const opening = !showRep; setShowRep(opening);
    if (!opening || repLoading || !ip || rep) return;
    setRepLoading(true);
    api.reputation(ip).then(setRep).catch(() => setRep({ error: 'falha ao consultar reputação' })).finally(() => setRepLoading(false));
  };

  const summary = useMemo(() => {
    const list = rows || [];
    const paths = new Map(); const cats = new Map(); const sites = new Set(); const agents = new Set();
    let maxScore = 0, hits = 0, first = null, last = null;
    for (const r of list) {
      paths.set(r.path, (paths.get(r.path) || 0) + 1);
      cats.set(r.label || r.category, (cats.get(r.label || r.category) || 0) + 1);
      if (r.host || r.site) sites.add(r.host || r.site);
      if (r.agent) agents.add(r.agent);
      maxScore = Math.max(maxScore, r.score || 0); if (r.hit) hits++;
      if (!first || r.ts < first) first = r.ts; if (!last || r.ts > last) last = r.ts;
    }
    const topPaths = [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { total: list.length, paths: paths.size, topPaths, topCats, sites: [...sites], agents: [...agents], maxScore, hits, first, last };
  }, [rows]);

  const reportAbuse = async () => {
    sfx.click(); setAbuse({ busy: true });
    let email = null, cc = null;
    try { const w = await api.whois(ip); email = (w && w.abuseEmail) || null; cc = (w && w.countryCode) || null; } catch {}
    const s = summary;
    const list = (rows || []).slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const evid = list.slice(0, 10).map((r) => `  ${new Date(r.ts).toISOString()}  ${ip} -> ${r.agent || 'server'}${r.host || r.site ? ' (' + (r.host || r.site) + ')' : ''}  ${r.wmethod || 'GET'} ${short(r.path, 60)}  ${r.status}  [${r.label || r.category}]${r.hit ? ' HIT' : ''}`);
    const text = [
      'Hello,', '',
      'We are reporting abusive web activity originating from an IP address in your network.', '',
      `Source IP: ${ip}`,
      'Activity: web scanning / exploitation attempts against our servers',
      `Observed (UTC): ${s.first ? new Date(s.first).toISOString() : '?'} to ${s.last ? new Date(s.last).toISOString() : '?'}`,
      `Malicious requests: ${s.total} · sensitive targets that responded (hits): ${s.hits}`,
      `Targeted sites: ${s.sites.join(', ') || 'n/a'}`,
      `Targeted host(s): ${s.agents.join(', ') || 'n/a'}`, '',
      'Evidence (most recent requests, timestamps in UTC):',
      ...evid, '',
      'These requests were captured from our web server access logs and were not solicited.',
      'Please investigate and take appropriate action against the source.', '',
      'Regards,', 'Security Team',
    ].join('\n');
    // Comentário curto p/ AbuseIPDB (máx 1024 chars, sem PII).
    const comment = `Web scanning / exploitation attempts detected: ${s.total} malicious requests between ${s.first ? new Date(s.first).toISOString() : '?'} and ${s.last ? new Date(s.last).toISOString() : '?'} (UTC), probing ${s.paths} distinct paths (CMS/admin/config probes). Captured from web server access logs.`;
    setAbuse({ email, text, subject: `Abuse report: web scanning / exploitation from ${ip}`, comment, lastTs: s.last || null, countryCode: cc });
  };

  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 500), [rows]);

  return (
    <Modal open={!!ip} title={`🌐 Dossiê web · ${ip || ''}`} onClose={onClose} width={780}>
      <div className="ipd">
        <div className="ipd-bar">
          <div className="ipd-chips">
            <span className="chip">{summary.total.toLocaleString('pt-BR')} requisições</span>
            <span className="chip">{summary.paths} paths distintos</span>
            <span className="chip" style={{ color: sev(summary.maxScore) }}>risco {summary.maxScore}</span>
            {summary.hits > 0 && <span className="chip" style={{ color: '#ff3b5c', borderColor: '#ff3b5c' }}>🎯 {summary.hits} hit(s)</span>}
          </div>
          <div className="ipd-actions">
            <button className="tiny" onClick={loadRep}>🛡 Reputação</button>
            <button className="tiny amber" disabled={abuse?.busy} onClick={reportAbuse}>{abuse?.busy ? <><span className="spinner" /> buscando…</> : '✉ Reportar abuse'}</button>
            <BlockIpButton ip={ip} tags={summary.agents} suggestedPorts={[80, 443]} />
          </div>
        </div>

        <AbuseModal open={!!(abuse && !abuse.busy)} onClose={() => setAbuse(null)} ip={ip} email={abuse?.email} subject={abuse?.subject} text={abuse?.text}
          context="web" comment={abuse?.comment} lastTs={abuse?.lastTs} countryCode={abuse?.countryCode} />

        {summary.total > 0 && (
          <div className="nid-summary">
            <div className="nid-block">
              <span className="ipd-lab">Paths mais pedidos</span>
              <div className="nid-ports">{summary.topPaths.map(([p, n]) => <span key={p} className="na-port" title={p}>{short(p, 26)}<b>×{n}</b></span>)}</div>
            </div>
            <div className="nid-block">
              <span className="ipd-lab">Categorias</span>
              <div className="nid-ports">{summary.topCats.map(([c, n]) => <span key={c} className="na-port" style={{ color: 'var(--cyan)' }}>{c}<b>×{n}</b></span>)}</div>
            </div>
            <div className="nid-block">
              <span className="ipd-lab">Sites · servidores · janela</span>
              <div className="tiny" style={{ color: 'var(--text)' }}>{[...summary.sites].join(', ') || '—'} · {summary.agents.join(', ') || '—'} · {time(summary.first)} → {time(summary.last)}</div>
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
                <div className="ipd-rep-bls">{(rep.dnsbl || []).map((d) => <span key={d.name} className={'ipd-bl' + (d.listed ? ' on' : '')}>{d.listed ? '⛔' : '✓'} {d.name}</span>)}</div>
                {!rep.abuseConfigured && <div className="tiny muted">💡 Score do AbuseIPDB é grátis: defina <b>ABUSEIPDB_KEY</b> no <b>server/.env</b>.</div>}
              </div>
            )}
          </div>
        )}

        <div className="ipd-table">
          <table>
            <thead><tr><th>Quando</th><th>Site</th><th>Método/Path</th><th>Status</th><th>Ação</th><th>Risco</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6}><span className="spinner" /> carregando requisições…</td></tr>}
              {rows && rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 18 }}>sem requisições para este IP</td></tr>}
              {sorted.map((r) => (
                <tr key={r.id} className={r.hit ? 'wt-hit' : ''}>
                  <td className="tiny">{time(r.ts)}</td>
                  <td className="tiny" style={{ color: 'var(--green)' }}>{r.host || r.site || '—'}</td>
                  <td className="tiny"><b style={{ color: 'var(--text-dim)' }}>{r.wmethod || 'GET'}</b> {short(r.path)}</td>
                  <td className="tiny">{r.status || '—'}</td>
                  <td className="tiny" style={{ color: r.hit ? '#ff3b5c' : 'var(--text)' }}>{r.label}{r.hit ? ' 🎯' : ''}</td>
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
