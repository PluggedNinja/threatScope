import React from 'react';
import Modal from './Modal.jsx';
import AgentsPanel from './AgentsPanel.jsx';

// Gestão de agentes centralizada num modal (acessível pelo topo, em qualquer aba).
export default function AgentsModal({ open, onClose, ...panelProps }) {
  return (
    <Modal open={open} onClose={onClose} title="🖥️ Servidores / Agentes" width={980}>
      <div className="agm">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          Cada cartão é um servidor com um agente. Verde = respondeu na última coleta. Use <b>⚙</b> para
          configurar modo (SSH / WEB / NET) e logs, e <b>➕</b> para adicionar um novo servidor.
        </p>
        <AgentsPanel {...panelProps} embedded />
      </div>
    </Modal>
  );
}
