import React, { useState, useEffect } from 'react';
import Hint from './Hint.jsx';
import Pagination from './Pagination.jsx';
import IpName from './IpName.jsx';
import IpDetail from './IpDetail.jsx';
import { sfx } from '../sounds.js';

function heat(n) {
  if (n >= 100) return 'hot';
  if (n >= 20) return 'warm';
  return 'cool';
}

function Row({ g, checked, onToggle, onOpen }) {
  const open = () => { sfx.click(); onOpen(g.ip); };
  return (
    <tr className="group-row">
      <td onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => { sfx.blip(); onToggle(g.ip); }} />
      </td>
      <td className="mono-ip ip-open" onClick={open} title="Abrir dossiê do IP" style={{ whiteSpace: 'nowrap' }}><IpName ip={g.ip} className="" /></td>
      <td onClick={open}><span className={`badge ${heat(g.attempts)}`}>{g.attempts}</span></td>
      <td onClick={open} className="cred">{g.users}</td>
      <td onClick={open} className="cred">{g.passwords}</td>
      <td onClick={open} className="tiny">{new Date(g.first_seen).toLocaleString('pt-BR')}</td>
      <td onClick={open} className="tiny">{new Date(g.last_seen).toLocaleString('pt-BR')}</td>
    </tr>
  );
}

const GT_STR = new Set(['ip']);
const gtVal = (g, k) => {
  switch (k) {
    case 'ip': return g.ip || '';
    case 'users': return g.users || 0;
    case 'passwords': return g.passwords || 0;
    case 'first_seen': return Date.parse(g.first_seen) || 0;
    case 'last_seen': return Date.parse(g.last_seen) || 0;
    default: return g.attempts || 0;
  }
};

export default function GroupedTable({ groups, selected, setSelected, onFocusSelected }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [detailIp, setDetailIp] = useState(null);
  const [sort, setSort] = useState({ key: 'attempts', dir: 'desc' });

  const total = groups.length;
  useEffect(() => {
    const pc = Math.max(1, Math.ceil(total / pageSize));
    if (page > pc) setPage(pc);
  }, [total, pageSize, page]);

  const sortedGroups = [...groups].sort((a, b) => {
    const va = gtVal(a, sort.key), vb = gtVal(b, sort.key);
    const cmp = GT_STR.has(sort.key) ? String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) : va - vb;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: GT_STR.has(k) ? 'asc' : 'desc' }));
  const Th = ({ k, children }) => (
    <th style={{ cursor: 'pointer', color: sort.key === k ? 'var(--cyan)' : undefined, whiteSpace: 'nowrap' }} onClick={() => toggleSort(k)}>
      {children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
    </th>
  );

  const start = (page - 1) * pageSize;
  const pageGroups = sortedGroups.slice(start, start + pageSize);

  const toggle = (ip) =>
    setSelected((s) => (s.includes(ip) ? s.filter((x) => x !== ip) : [...s, ip]));
  const allChecked = groups.length > 0 && selected.length === groups.length;
  const toggleAll = () => {
    sfx.blip();
    setSelected(allChecked ? [] : groups.map((g) => g.ip));
  };

  return (
    <div className="panel">
      <h2>
        Agrupado por IP de origem
        <Hint>Clique num IP para abrir o dossiê: tentativas paginadas, WHOIS/abuse e exportação. Marque vários IPs e use "Focar seleção" para filtrar todo o painel.</Hint>
        <span className="right flex">
          {selected.length > 0 && (
            <span className="chip">{selected.length} selecionado(s)
              <button onClick={() => { sfx.click(); setSelected([]); }}>✕</button>
            </span>
          )}
          <button className="amber" disabled={!selected.length}
            onClick={() => { sfx.click(); onFocusSelected(selected); }}>
            🎯 Focar seleção
          </button>
        </span>
      </h2>
      <div className="table-wrap" style={{ height: 540 }}>
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <Th k="ip">IP de origem</Th><Th k="attempts">Tentativas</Th><Th k="users">Usuários</Th><Th k="passwords">Senhas</Th>
              <Th k="first_seen">Primeira</Th><Th k="last_seen">Última</Th>
            </tr>
          </thead>
          <tbody>
            {pageGroups.map((g) => (
              <Row key={g.ip} g={g} checked={selected.includes(g.ip)} onToggle={toggle} onOpen={setDetailIp} />
            ))}
            {groups.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                Nenhum IP registrado ainda.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
      )}

      <IpDetail ip={detailIp} onClose={() => setDetailIp(null)} />
    </div>
  );
}
