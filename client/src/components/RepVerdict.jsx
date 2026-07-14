import React from 'react';

// Veredito combinado de reputação: DNSBLs públicas + AbuseIPDB.
// Evita o "✓ limpo" enganoso quando o IP não está em DNSBL mas acumula denúncias no AbuseIPDB.
export default function RepVerdict({ rep }) {
  if (!rep) return null;
  const a = rep.abuseipdb || {};
  const score = typeof a.score === 'number' ? a.score : null;
  const reports = a.totalReports || 0;
  const listed = rep.listedCount || 0;

  const level = (listed > 0 || (score !== null && score >= 75)) ? 'bad'
    : ((score !== null && score >= 25) || reports > 0) ? 'warn'
    : 'ok';

  const verdict = listed > 0 ? `⛔ Listado em ${listed} blocklist(s)`
    : level === 'bad' ? '⛔ Malicioso segundo o AbuseIPDB'
    : level === 'warn' ? '⚠ Fora das DNSBLs, mas com denúncias no AbuseIPDB'
    : '✓ Limpo nas blocklists públicas';

  const scoreColor = score >= 75 ? '#ff3b5c' : score >= 25 ? 'var(--amber)' : 'var(--green)';

  return (
    <div className="ipd-rep-head">
      <span className={'ipd-rep-' + level}>{verdict}</span>
      {score !== null && (
        <span className="ipd-rep-abuse" style={{ color: scoreColor }}>
          score {score}% · {reports.toLocaleString('pt-BR')} denúncia(s)
          {a.lastReportedAt && <span className="ipd-rep-last"> · última: {new Date(a.lastReportedAt).toLocaleDateString('pt-BR')}</span>}
        </span>
      )}
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('repv-styles')) {
  const el = document.createElement('style'); el.id = 'repv-styles';
  el.textContent = `
    .ipd-rep-warn { color: var(--amber); font-weight: bold; }
    .ipd-rep-last { color: var(--text-dim); font-weight: normal; font-size: 10.5px; }
  `;
  document.head.appendChild(el);
}
