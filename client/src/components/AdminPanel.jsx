import React, { useEffect, useState, useCallback } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

/* Painel do ADMIN: aprovar contas, gerenciar tokens, resolver pedidos de
   remoção de IP e atribuir cada sensor a um tenant (quem vê o sensor). */
export default function AdminPanel({ open, onClose, onChanged }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [removals, setRemovals] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [revealed, setRevealed] = useState({}); // id -> token exibido

  const load = useCallback(async () => {
    if (!open) return;
    setErr(null);
    try {
      const [u, r, a, t] = await Promise.all([
        api.adminUsers().catch(() => ({ users: [] })),
        api.adminRemovals().catch(() => ({ removals: [] })),
        api.agents().catch(() => []),
        api.adminTenants().catch(() => ({ tenants: [] })),
      ]);
      setUsers(u.users || []); setRemovals(r.removals || []); setAgents(a || []); setTenants(t.tenants || []);
    } catch (e) { setErr(e.message || 'falha ao carregar'); }
  }, [open]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { const res = await fn(); await load(); onChanged?.(); return res; }
    catch (e) { setErr(e.message || 'falha na operação'); }
    finally { setBusy(false); }
  };

  const approve = (id) => act(async () => { const r = await api.approveUser(id); if (r.user?.token) setRevealed((s) => ({ ...s, [id]: r.user.token })); });
  const regen = (id) => act(async () => { const r = await api.regenUserToken(id); if (r.user?.token) setRevealed((s) => ({ ...s, [id]: r.user.token })); });
  const toggle = (id, disabled) => act(() => api.disableUser(id, disabled));
  const del = (id) => { if (confirm('Remover esta conta? Os sensores dela ficam sem dono.')) act(() => api.deleteUser(id)); };
  const assign = (agentId, owner) => act(() => api.setAgentOwner(agentId, owner || null));
  const resolve = (id, status, purge) => act(() => api.resolveRemoval(id, status, purge));

  const pendingUsers = users.filter((u) => !u.approved).length;
  const pendingRemovals = removals.filter((r) => r.status === 'pending').length;

  return (
    <Modal open={open} title="👑 Administração" onClose={onClose} width={860}>
      <div className="ap-tabs">
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Contas{pendingUsers ? ` (${pendingUsers})` : ''}</button>
        <button className={tab === 'sensors' ? 'on' : ''} onClick={() => setTab('sensors')}>Sensores → Tenant</button>
        <button className={tab === 'removals' ? 'on' : ''} onClick={() => setTab('removals')}>Remoções{pendingRemovals ? ` (${pendingRemovals})` : ''}</button>
      </div>
      {err && <div className="ap-err">⚠️ {err}</div>}

      {tab === 'users' && (
        <div className="ap-list">
          {users.length === 0 && <div className="muted tiny">Nenhuma conta ainda.</div>}
          {users.map((u) => (
            <div className="ap-row" key={u.id}>
              <div className="ap-main">
                <b>{u.name}</b> <span className="muted tiny">{u.email}</span>
                <div className="ap-tags">
                  <span className={'ap-tag ' + (u.role === 'admin' ? 'adm' : '')}>{u.role}</span>
                  <span className={'ap-tag ' + (u.approved ? 'ok' : 'pend')}>{u.approved ? 'aprovado' : 'pendente'}</span>
                  {u.disabled && <span className="ap-tag off">desativado</span>}
                  <span className="ap-tag">{u.sensors} sensor(es)</span>
                </div>
                {revealed[u.id] && <div className="ap-token">token: <code>{revealed[u.id]}</code> <span className="muted tiny">(copie e envie ao usuário — não é exibido de novo)</span></div>}
              </div>
              <div className="ap-actions">
                {!u.approved && <button className="tiny amber" disabled={busy} onClick={() => approve(u.id)}>Aprovar</button>}
                {u.approved && u.role !== 'admin' && <button className="tiny" disabled={busy} onClick={() => toggle(u.id, !u.disabled)}>{u.disabled ? 'Reativar' : 'Desativar'}</button>}
                {u.approved && <button className="tiny" disabled={busy} onClick={() => regen(u.id)}>Novo token</button>}
                {u.role !== 'admin' && <button className="tiny danger" disabled={busy} onClick={() => del(u.id)}>Excluir</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'sensors' && (
        <div className="ap-list">
          <div className="muted tiny" style={{ marginBottom: 8 }}>Defina qual tenant enxerga cada sensor no painel dele. A lista pública (API) nunca revela o sensor.</div>
          {agents.length === 0 && <div className="muted tiny">Nenhum sensor registrado.</div>}
          {agents.map((a) => (
            <div className="ap-row" key={a.id}>
              <div className="ap-main"><b>{a.name || a.host}</b> <span className="muted tiny">{a.host}:{a.port}</span></div>
              <div className="ap-actions">
                <select value={a.owner || ''} disabled={busy} onChange={(e) => assign(a.id, e.target.value)}>
                  <option value="">— sem dono —</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'removals' && (
        <div className="ap-list">
          {removals.length === 0 && <div className="muted tiny">Nenhuma solicitação de remoção.</div>}
          {removals.map((r) => (
            <div className="ap-row" key={r.id}>
              <div className="ap-main">
                <b>{r.ip}</b> <span className={'ap-tag ' + (r.status === 'pending' ? 'pend' : r.status === 'resolved' ? 'ok' : 'off')}>{r.status}</span>
                <div className="muted tiny">{r.email} · {new Date(r.createdAt).toLocaleString('pt-BR')}</div>
                {r.message && <div className="ap-msg">{r.message}</div>}
              </div>
              <div className="ap-actions">
                {r.status === 'pending' && <>
                  <button className="tiny amber" disabled={busy} onClick={() => resolve(r.id, 'resolved', true)} title="Marca resolvido e remove o IP da lista">Resolver + remover IP</button>
                  <button className="tiny" disabled={busy} onClick={() => resolve(r.id, 'resolved', false)}>Só resolver</button>
                  <button className="tiny danger" disabled={busy} onClick={() => resolve(r.id, 'rejected', false)}>Rejeitar</button>
                </>}
                {r.status !== 'pending' && <button className="tiny" disabled={busy} onClick={() => resolve(r.id, 'pending', false)}>Reabrir</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('admin-panel-styles')) {
  const el = document.createElement('style'); el.id = 'admin-panel-styles';
  el.textContent = `
    .ap-tabs { display:flex; gap:8px; margin-bottom:12px; }
    .ap-tabs button { background:transparent; border:1px solid var(--green-deep,#264); color:var(--text-dim); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:12px; }
    .ap-tabs button.on { background:rgba(var(--accent-rgb,0,255,140),0.14); color:var(--text); border-color:var(--green,#3f7); }
    .ap-list { display:flex; flex-direction:column; gap:8px; max-height:60vh; overflow:auto; }
    .ap-row { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; background:rgba(255,255,255,0.03); border:1px solid var(--green-deep,#234); border-radius:10px; padding:12px 14px; }
    .ap-main b { color:var(--text); }
    .ap-tags { display:flex; gap:6px; margin-top:6px; flex-wrap:wrap; }
    .ap-tag { font-size:10px; text-transform:uppercase; letter-spacing:1px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.06); color:var(--text-dim); }
    .ap-tag.ok { color:var(--green,#3f7); background:rgba(var(--accent-rgb,0,255,140),0.12); }
    .ap-tag.pend { color:var(--amber,#fb3); background:rgba(255,180,50,0.12); }
    .ap-tag.off { color:var(--red,#f66); background:rgba(255,80,80,0.12); }
    .ap-tag.adm { color:#7fd; background:rgba(120,200,255,0.12); }
    .ap-token { margin-top:8px; font-size:12px; color:var(--text); word-break:break-all; }
    .ap-token code { color:var(--amber,#fb3); }
    .ap-msg { margin-top:6px; font-size:12px; color:var(--text-dim); border-left:2px solid var(--green-deep,#264); padding-left:8px; }
    .ap-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; justify-content:flex-end; min-width:180px; }
    .ap-actions select { background:rgba(0,0,0,0.35); color:var(--text); border:1px solid var(--green-deep,#264); border-radius:6px; padding:5px 8px; font:inherit; font-size:12px; }
    .ap-err { color:var(--red,#f66); font-size:13px; margin-bottom:10px; }
  `;
  document.head.appendChild(el);
}
