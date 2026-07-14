import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { getToken } from '../api.js';

/* Conta do usuário logado: mostra o token de API (para usar em scripts/API e no
   download dos sensores) e permite copiar. */
export default function AccountModal({ open, onClose, user }) {
  const [copied, setCopied] = useState(false);
  const token = getToken();
  const copy = async () => {
    try { await navigator.clipboard.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <Modal open={open} title="👤 Minha conta" onClose={onClose} width={520}>
      {user && <p style={{ marginTop: 0 }}><b>{user.name}</b> <span className="muted tiny">{user.email}</span> · <span className="tiny">{user.role === 'admin' ? 'admin' : 'operador'}</span> · {user.sensors} sensor(es)</p>}
      <div className="tiny muted">Seu token de API (use no header <code>Authorization: Bearer</code> ou como <code>?token=</code>):</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input readOnly value={token} onFocus={(e) => e.target.select()}
          style={{ flex: 1, padding: '9px 12px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--green-deep,#264)', borderRadius: 8, color: 'var(--amber,#fb3)', font: 'inherit', fontSize: 13 }} />
        <button className="tiny" onClick={copy}>{copied ? '✅ Copiado' : 'Copiar'}</button>
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>Guarde este token com cuidado — ele dá acesso ao seu painel e aos seus sensores. Se vazar, peça ao admin para gerar um novo.</p>
    </Modal>
  );
}
