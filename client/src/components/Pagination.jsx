import React from 'react';
import { sfx } from '../sounds.js';

// Paginação reutilizável (client-side). Estética militar.
export default function Pagination({ page, pageSize, total, onPage, onPageSize, sizes = [15, 30, 50] }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);
  const go = (p) => { sfx.click(); onPage(Math.min(Math.max(1, p), pageCount)); };

  return (
    <div className="pagination">
      <span className="tiny muted">
        {from.toLocaleString('pt-BR')}–{to.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
      </span>
      <span className="pg-controls">
        <button className="tiny" disabled={cur <= 1} onClick={() => go(1)} title="Primeira">«</button>
        <button className="tiny" disabled={cur <= 1} onClick={() => go(cur - 1)}>‹ ant</button>
        <span className="tiny pg-count">pág {cur}/{pageCount}</span>
        <button className="tiny" disabled={cur >= pageCount} onClick={() => go(cur + 1)}>próx ›</button>
        <button className="tiny" disabled={cur >= pageCount} onClick={() => go(pageCount)} title="Última">»</button>
      </span>
      {onPageSize && (
        <select
          value={pageSize}
          onChange={(e) => { sfx.click(); onPageSize(Number(e.target.value)); onPage(1); }}
          title="Itens por página"
        >
          {sizes.map((s) => <option key={s} value={s}>{s}/pág</option>)}
        </select>
      )}
    </div>
  );
}
