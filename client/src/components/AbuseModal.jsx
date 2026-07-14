import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { sfx } from '../sounds.js';

// Categorias do AbuseIPDB (https://www.abuseipdb.com/categories) por tipo de ataque.
const ABUSEIPDB_CATS = {
  ssh: { ids: [18, 22], label: '18 Brute-Force · 22 SSH' },
  web: { ids: [21, 15], label: '21 Web App Attack · 15 Hacking' },
  net: { ids: [14], label: '14 Port Scan' },
};

// Modal de reporte de abuse: e-mail do provedor + mensagem pronta com evidências,
// e reporte nas listas públicas (AbuseIPDB via API/form, blocklist.de, DShield, CERT.br).
export default function AbuseModal({ open, onClose, ip, email, subject, text, context = 'ssh', comment, lastTs, countryCode }) {
  const [copied, setCopied] = useState('');
  const [apiRep, setApiRep] = useState(null); // null | {busy} | {ok,score} | {error,noKey}
  useEffect(() => { if (open) setApiRep(null); }, [open, ip]);

  const copy = (t, what) => { try { navigator.clipboard?.writeText(t); } catch {} sfx.blip?.(); setCopied(what); setTimeout(() => setCopied(''), 1500); };
  const mailto = email ? `mailto:${email}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text || '')}` : null;

  const cats = ABUSEIPDB_CATS[context] || ABUSEIPDB_CATS.ssh;
  const apiComment = comment || (text || '').slice(0, 1024);
  const isBR = String(countryCode || '').toUpperCase() === 'BR';
  // CERT.br recomenda: e-mail direto ao abuse da rede de origem com Cc: cert@cert.br (logs + timezone).
  const certMailto = email
    ? `mailto:${email}?cc=cert@cert.br&subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text || '')}`
    : `mailto:cert@cert.br?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(text || '')}`;

  const sendAbuseIpdb = async () => {
    sfx.click(); setApiRep({ busy: true });
    try {
      const r = await api.reportAbuseIpdb({ ip, categories: cats.ids, comment: apiComment, timestamp: lastTs || undefined });
      setApiRep(r);
      if (r.ok) sfx.success?.();
    } catch (e) { setApiRep({ ok: false, error: e.message || 'falha na chamada' }); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`✉ Reportar abuse · ${ip || ''}`} width={700}>
      <div className="abz">
        <div className="abz-block">
          <span className="abz-lab">E-mail de abuse do provedor</span>
          {email ? (
            <div className="abz-row">
              <code className="abz-mail">{email}</code>
              <button className="tiny" onClick={() => copy(email, 'email')}>{copied === 'email' ? '✓ copiado' : '⧉ copiar'}</button>
              <a className="btn amber" href={mailto} onClick={() => sfx.click()} style={{ padding: '4px 10px' }}>✉ abrir e-mail</a>
            </div>
          ) : (
            <div className="tiny muted">Não publicado no WHOIS deste IP. Copie a mensagem abaixo e envie ao contato de abuse do provedor.</div>
          )}
        </div>

        <div className="abz-block">
          <span className="abz-lab">Reportar em listas públicas</span>

          <div className="abz-svc">
            <div className="abz-svc-head">
              <b>AbuseIPDB</b>
              <span className="tiny muted">categorias sugeridas: {cats.label}</span>
            </div>
            <div className="abz-row">
              <button className="tiny amber" disabled={apiRep?.busy} onClick={sendAbuseIpdb}>
                {apiRep?.busy ? <><span className="spinner" /> enviando…</> : '🚀 reportar via API'}
              </button>
              <a className="tiny abz-link" href={`https://www.abuseipdb.com/report?ip=${encodeURIComponent(ip || '')}`} target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ abrir formulário (IP pré-preenchido)</a>
              <button className="tiny" onClick={() => copy(apiComment, 'aipdb')}>{copied === 'aipdb' ? '✓ copiado' : '⧉ copiar comentário'}</button>
            </div>
            {apiRep && !apiRep.busy && apiRep.ok && <div className="tiny abz-ok">✓ reportado com sucesso{typeof apiRep.score === 'number' ? ` · novo score: ${apiRep.score}%` : ''}</div>}
            {apiRep && !apiRep.busy && apiRep.ok === false && (
              <div className="tiny abz-err">
                ⚠ {apiRep.error}
                {apiRep.noKey && <> — pegue uma chave grátis em abuseipdb.com e defina <b>ABUSEIPDB_KEY</b> no <b>server/.env</b>, ou use o formulário acima.</>}
              </div>
            )}
          </div>

          <div className="abz-svc">
            <div className="abz-svc-head">
              <b>blocklist.de</b>
              <span className="tiny muted">report só via conta registrada (fail2ban / X-ARF / API)</span>
            </div>
            <div className="abz-row">
              <a className="tiny abz-link" href={`https://www.blocklist.de/en/search.html?ip=${encodeURIComponent(ip || '')}`} target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ consultar IP na base</a>
              <a className="tiny abz-link" href="https://www.blocklist.de/en/register.html" target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ registrar conta p/ reportar</a>
            </div>
          </div>

          <div className="abz-svc">
            <div className="abz-svc-head">
              <b>DShield / SANS ISC</b>
              <span className="tiny muted">submissão de logs via cliente DShield</span>
            </div>
            <div className="abz-row">
              <a className="tiny abz-link" href={`https://isc.sans.edu/ipinfo/${encodeURIComponent(ip || '')}`} target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ histórico do IP no ISC</a>
              <a className="tiny abz-link" href="https://isc.sans.edu/howto.html" target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ como enviar logs</a>
            </div>
          </div>

          <div className="abz-svc">
            <div className="abz-svc-head">
              <b>CERT.br</b>
              <span className="tiny muted">{isBR ? '🇧🇷 IP brasileiro — recomendado' : 'para IPs de redes brasileiras'}</span>
            </div>
            <div className="abz-row">
              <a className="tiny abz-link" href={certMailto} onClick={() => sfx.click()}>✉ e-mail ao abuse com Cc: cert@cert.br</a>
              <a className="tiny abz-link" href="https://cert.br/reportar/" target="_blank" rel="noreferrer" onClick={() => sfx.click()}>↗ instruções</a>
            </div>
          </div>
        </div>

        <div className="abz-block">
          <div className="abz-head">
            <span className="abz-lab">Mensagem para o abuse (com evidências)</span>
            <button className="tiny amber" onClick={() => copy(text, 'msg')}>{copied === 'msg' ? '✓ copiado!' : '⧉ copiar mensagem'}</button>
          </div>
          <textarea readOnly className="abz-text" value={text || ''} onFocus={(e) => e.target.select()} />
        </div>
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('abz-styles')) {
  const el = document.createElement('style'); el.id = 'abz-styles';
  el.textContent = `
    .abz { display:flex; flex-direction:column; gap:14px; }
    .abz-block { display:flex; flex-direction:column; gap:6px; }
    .abz-lab { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-dim); }
    .abz-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .abz-mail { color:var(--cyan); font-size:13px; background:rgba(0,0,0,0.35); padding:4px 8px; border-radius:3px; }
    .abz-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .abz-svc { border:1px solid var(--green-deep); border-radius:3px; padding:8px 10px; display:flex; flex-direction:column; gap:6px; background:rgba(var(--accent-rgb),0.03); }
    .abz-svc-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
    .abz-svc-head b { font-size:12px; color:var(--text); }
    .abz-link { color:var(--cyan); text-decoration:none; border:1px solid var(--green-deep); border-radius:2px; padding:2px 8px; }
    .abz-link:hover { text-decoration:underline; }
    .abz-ok { color:var(--green); }
    .abz-err { color:var(--amber); }
    .abz-text { width:100%; min-height:280px; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text);
      border-radius:3px; padding:10px; font-family:var(--mono); font-size:11.5px; line-height:1.55; resize:vertical; white-space:pre; }
    .abz-text:focus { outline:none; border-color:var(--cyan); }
  `;
  document.head.appendChild(el);
}
