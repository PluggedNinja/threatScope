import React, { useState } from 'react';
import { api } from '../api.js';

// Cache compartilhado entre todas as células de IP (evita reconsultar).
const cache = new Map(); // ip -> { pending?, done?, title }

// Mostra o IP e, ao passar o mouse, resolve o DNS reverso (PTR) e o exibe
// como tooltip (title nativo — nunca é cortado pela rolagem da tabela).
export default function IpName({ ip, className = 'mono-ip' }) {
  const initial = cache.get(ip)?.title || 'passe o mouse para resolver o DNS reverso';
  const [title, setTitle] = useState(initial);

  const resolve = () => {
    const c = cache.get(ip);
    if (c && c.done) { setTitle(c.title); return; }
    if (c && c.pending) return;
    cache.set(ip, { pending: true });
    setTitle('resolvendo DNS + GeoIP…');
    api.rdns(ip)
      .then((r) => {
        const lines = [];
        lines.push(r && r.host ? `🌐 ${r.host}` : 'sem registro PTR (DNS reverso)');
        const loc = [r.flag, r.country, r.city].filter(Boolean).join(' ');
        if (loc) lines.push(`📍 ${loc}`);
        const net = [r.asn ? `AS${r.asn}` : null, r.org].filter(Boolean).join(' · ');
        if (net) lines.push(`🛰 ${net}`);
        const t = lines.join('\n');
        cache.set(ip, { done: true, title: t });
        setTitle(t);
      })
      .catch(() => {
        const t = 'falha ao resolver DNS';
        cache.set(ip, { done: true, title: t });
        setTitle(t);
      });
  };

  return (
    <span className={`${className} ip-name`} title={title} onMouseEnter={resolve}>
      {ip}
    </span>
  );
}
