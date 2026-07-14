import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { sfx } from '../sounds.js';

// Gerencia os padrões silenciados do feed web: adicionar, editar e remover.
export default function SilencedModal({ open, onClose, rules = [], onAdd, onRemove, onEdit }) {
  const [novo, setNovo] = useState('');
  const [editing, setEditing] = useState(null); // índice em edição
  const [draft, setDraft] = useState('');

  const add = () => { const v = novo.trim(); if (!v) return; onAdd?.(v); setNovo(''); sfx.blip?.(); };
  const startEdit = (i, v) => { setEditing(i); setDraft(v); };
  const commit = (oldV) => { const v = draft.trim(); if (v && v !== oldV) onEdit?.(oldV, v); setEditing(null); setDraft(''); };

  return (
    <Modal open={open} onClose={onClose} title="🔇 Padrões silenciados no feed" width={520}>
      <div className="silm">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Requisições que casarem com estes padrões (por trecho do path, IP exato, site ou user-agent)
          não aparecem no feed ao vivo, não tocam som e não disparam arco no mapa — mas continuam nas estatísticas.
        </p>

        <div className="silm-add">
          <input placeholder="ex.: /api/heartbeat, /favicon.ico, 10.0.0.5…" value={novo}
            onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="amber" onClick={add}>+ adicionar</button>
        </div>

        <div className="silm-list">
          {rules.length === 0 && <div className="tiny muted" style={{ padding: 12, textAlign: 'center' }}>Nada silenciado ainda.</div>}
          {rules.map((r, i) => (
            <div key={r} className="silm-row">
              {editing === i ? (
                <>
                  <input className="silm-edit" value={draft} autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commit(r); if (e.key === 'Escape') { setEditing(null); setDraft(''); } }} />
                  <button className="tiny" onClick={() => commit(r)}>✓ salvar</button>
                  <button className="tiny" onClick={() => { setEditing(null); setDraft(''); }}>cancelar</button>
                </>
              ) : (
                <>
                  <code className="silm-code">{r}</code>
                  <button className="tiny" onClick={() => startEdit(i, r)}>✎ editar</button>
                  <button className="tiny danger" onClick={() => { sfx.click(); onRemove?.(r); }}>✕ remover</button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('silm-styles')) {
  const el = document.createElement('style'); el.id = 'silm-styles';
  el.textContent = `
    .silm { display:flex; flex-direction:column; gap:12px; }
    .silm-add { display:flex; gap:8px; }
    .silm-add input { flex:1; background:var(--bg-0); border:1px solid var(--green-deep); color:var(--text); border-radius:3px; padding:7px 10px; font:inherit; font-size:12px; }
    .silm-add input:focus { outline:none; border-color:var(--cyan); }
    .silm-list { display:flex; flex-direction:column; gap:5px; max-height:340px; overflow:auto; }
    .silm-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid var(--green-deep); border-radius:3px; background:rgba(var(--accent-rgb),0.03); }
    .silm-code { flex:1; color:var(--amber); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .silm-edit { flex:1; background:var(--bg-0); border:1px solid var(--cyan); color:var(--text); border-radius:3px; padding:4px 8px; font:inherit; font-size:11.5px; }
  `;
  document.head.appendChild(el);
}
