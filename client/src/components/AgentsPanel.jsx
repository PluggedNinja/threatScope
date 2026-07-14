import React from 'react';
import { motion } from 'framer-motion';
import Hint from './Hint.jsx';
import { sfx } from '../sounds.js';

function rel(ts) {
  if (!ts) return 'nunca';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s atrás`;
  if (d < 3600) return `${Math.floor(d / 60)}m atrás`;
  if (d < 86400) return `${Math.floor(d / 3600)}h atrás`;
  return new Date(ts).toLocaleString('pt-BR');
}

export default function AgentsPanel({ agents = [], activeAgent, onSelect, onAddAgent, onRemove, onConfig, latestVersion, embedded }) {
  const onlineCount = agents.filter((a) => a.online).length;

  return (
    <div className={embedded ? '' : 'panel'}>
      <h2 style={embedded ? { marginTop: 0 } : undefined}>
        {!embedded && <>Servidores / Agentes
          <Hint>Cada cartão é um servidor registrado. A central conecta no IP dele e busca as capturas. Verde = respondeu na última coleta. Clique no cartão para filtrar o painel por aquele servidor.</Hint></>}
        <span className="right flex">
          <span className="chip">{onlineCount}/{agents.length} online</span>
          <button className="amber" onClick={() => onAddAgent?.()}>➕ Adicionar agente</button>
        </span>
      </h2>

      <div className="agents-grid">
        {agents.map((a) => {
          const active = activeAgent === a.tag;
          return (
            <motion.div
              key={a.id}
              className={`agent-card ${a.online ? 'on' : 'off'} ${active ? 'active' : ''}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
            >
              <div className="agent-head">
                <span className={`led ${a.online ? '' : 'off'}`}><span className="dot" /></span>
                <span className="agent-name" onClick={() => { sfx.click(); onSelect?.(active ? '' : a.tag); }} style={{ cursor: 'pointer' }}>
                  {a.name || a.host}
                </span>
                <button
                  className="tiny"
                  style={{ marginLeft: 'auto', padding: '2px 6px' }}
                  title="Configurar agente (modo e logs)"
                  onClick={() => { sfx.click(); onConfig?.(a); }}
                >⚙</button>
                <button
                  className="tiny danger"
                  style={{ padding: '2px 6px' }}
                  title="Remover agente"
                  onClick={() => { sfx.click(); onRemove?.(a); }}
                >✕</button>
              </div>
              <div className="tiny muted" style={{ marginBottom: 6 }}>
                {a.host}:{a.port}
                {a.version != null && <span> · v{a.version}</span>}
                {latestVersion != null && a.version != null && a.version < latestVersion && (
                  <span title="atualização disponível — o agente se atualiza sozinho" style={{ color: 'var(--amber)', marginLeft: 6 }}>⬆ v{latestVersion}</span>
                )}
              </div>
              <div className="agent-metrics">
                <div><b className="cred">{(a.attempts || 0).toLocaleString('pt-BR')}</b><span>ataques</span></div>
                <div><b className="mono-ip">{a.ips || 0}</b><span>IPs</span></div>
                <div><b>{a.users || 0}</b><span>usuários</span></div>
              </div>
              <div className="tiny muted">
                {a.online
                  ? <>online · coleta {rel(a.last_seen)}</>
                  : <span style={{ color: 'var(--red)' }}>offline{a.error ? ` · ${a.error}` : ''}</span>}
              </div>
            </motion.div>
          );
        })}
        {agents.length === 0 && (
          <div className="muted" style={{ padding: 18 }}>
            <p style={{ margin: '0 0 10px' }}>Nenhum agente registrado. Instale um agente num servidor seu e registre o IP dele aqui. 🛰️</p>
            <button className="amber" onClick={() => onAddAgent?.()}>➕ Adicionar meu primeiro agente</button>
          </div>
        )}
      </div>
    </div>
  );
}
