import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { api, setToken } from '../api.js';

/* Login por TOKEN DE CONTA. O usuário cola o token recebido após a aprovação
   do admin; validamos chamando /api/me e guardamos no localStorage. */
export default function LoginModal({ open, onClose, onLoggedIn }) {
  const [tok, setTok] = useState('');
  const [state, setState] = useState({ loading: false, err: null });

  const submit = async (e) => {
    e.preventDefault();
    const t = tok.trim();
    if (!t) return;
    setState({ loading: true, err: null });
    setToken(t);
    try {
      const me = await api.me();
      setState({ loading: false, err: null });
      setTok('');
      onLoggedIn?.(me);
    } catch (err) {
      setToken(''); // token inválido: não guarda
      setState({ loading: false, err: err.code === 401 ? 'Token inválido ou conta não aprovada.' : (err.message || 'Falha ao entrar') });
    }
  };

  const localAdmin = async () => {
    setState({ loading: true, err: null });
    setToken('');
    try {
      const me = await api.recoverLocalAdmin();
      if (!me.isAdmin || !me.user?.token) throw new Error('local admin unavailable');
      setToken(me.user.token);
      setState({ loading: false, err: null });
      onLoggedIn?.(me);
    } catch {
      setToken('');
      setState({
        loading: false,
        err: 'A recuperação só funciona abrindo o ThreatScope diretamente em localhost no servidor, com o acesso local habilitado.',
      });
    }
  };

  return (
    <Modal open={open} title="🔐 Entrar no painel" onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Cole o <b>token de conta</b> que você recebeu após a aprovação do cadastro.
          O admin encontra o token dele no log de inicialização da central.
        </p>
        <input
          autoFocus value={tok} onChange={(e) => setTok(e.target.value)}
          placeholder="tsk_..." spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: 'rgba(0,0,0,0.35)', border: '1px solid var(--green-deep,#264)', borderRadius: 8, color: 'var(--text)', font: 'inherit', marginTop: 6 }}
        />
        {state.err && <div style={{ color: 'var(--red,#f66)', fontSize: 13, marginTop: 10 }}>⚠️ {state.err}</div>}
        <div className="flex" style={{ marginTop: 16 }}>
          <button className="primary" disabled={state.loading}>{state.loading ? 'Verificando…' : 'Entrar'}</button>
          <button type="button" className="right" onClick={onClose}>Cancelar</button>
        </div>
        <div style={{ borderTop: '1px solid var(--green-deep,#264)', marginTop: 16, paddingTop: 14 }}>
          <button type="button" className="tiny" disabled={state.loading} onClick={localAdmin}>Entrar como administrador local</button>
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>Sem token? Abra esta página diretamente no servidor via <code>localhost</code> e use este botão. O token será recuperado e salvo neste navegador.</p>
        </div>
      </form>
    </Modal>
  );
}
