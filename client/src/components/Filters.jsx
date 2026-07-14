import React from 'react';
import Hint from './Hint.jsx';
import { sfx } from '../sounds.js';

export default function Filters({ filters, setFilters, onExport, onClear, total }) {
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="panel">
      <h2>Filtros & operações <Hint>Filtre por IP, usuário, senha, intervalo ou busca livre. Os filtros valem para tabela, gráficos e exportação.</Hint></h2>
      <div className="toolbar">
        <label className="field">Servidor
          <input placeholder="ex: web-01" value={filters.agent || ''} onChange={set('agent')} />
        </label>
        <label className="field">IP de origem
          <input placeholder="ex: 45.61." value={filters.ip || ''} onChange={set('ip')} />
        </label>
        <label className="field">Usuário
          <input placeholder="ex: root" value={filters.username || ''} onChange={set('username')} />
        </label>
        <label className="field">Senha
          <input placeholder="ex: 123456" value={filters.password || ''} onChange={set('password')} />
        </label>
        <label className="field">Mostrar
          <select value={filters.withpass || ''} onChange={set('withpass')}>
            <option value="">Todas as tentativas</option>
            <option value="1">Apenas com senha</option>
          </select>
        </label>
        <label className="field">De
          <input type="datetime-local" value={filters.from || ''} onChange={set('from')} />
        </label>
        <label className="field">Até
          <input type="datetime-local" value={filters.to || ''} onChange={set('to')} />
        </label>
        <label className="field">Busca livre
          <input placeholder="qualquer campo…" value={filters.search || ''} onChange={set('search')} />
        </label>

        <button className="right" onClick={() => { sfx.click(); setFilters({}); }}>↺ Limpar filtros</button>
        <button onClick={() => { sfx.click(); onExport('csv'); }}>⬇ CSV</button>
        <button onClick={() => { sfx.click(); onExport('json'); }}>⬇ JSON</button>
        <button className="danger" onClick={() => { sfx.click(); onClear(); }}>🗑 Zerar base</button>
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        {total != null ? `${total.toLocaleString('pt-BR')} registros correspondem ao filtro atual.` : ''}
      </div>
    </div>
  );
}
