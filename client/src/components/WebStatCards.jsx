import React from 'react';
import { motion } from 'framer-motion';
import Hint from './Hint.jsx';

function Stat({ label, value, color, spark, hint }) {
  return (
    <motion.div className="panel stat"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22 }}>
      <div className="label">{label} {hint && <Hint>{hint}</Hint>}</div>
      <motion.div key={value} className={`value ${color || ''}`}
        initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}>{value}</motion.div>
      {spark && <div className="spark">{spark}</div>}
    </motion.div>
  );
}

export default function WebStatCards({ stats, live }) {
  const s = stats || {};
  const n = (x) => (x ?? 0).toLocaleString('pt-BR');
  return (
    <div className="grid cols-4">
      <Stat label="Requisições hostis" value={n(s.total)} color="cyan"
        spark={`+${live} ao vivo nesta sessão`} hint="Total de requisições web classificadas como suspeitas/maliciosas nos logs." />
      <Stat label="IPs de origem" value={n(s.uniqueIps)} color="amber"
        spark={`${s.botPct ?? 0}% são bots`} hint="Endereços IP únicos que fizeram varreduras." />
      <Stat label="Alvos atingidos" value={n(s.hits)} color="red"
        spark="caminhos sensíveis que responderam" hint="Requisições a caminhos sensíveis (/.env, /wp-config, admin…) que retornaram 2xx/3xx — possível exposição real." />
      <Stat label="Ameaças críticas" value={n(s.critical)}
        spark={`score médio ${s.avgScore ?? 0}/100`} hint="Requisições com score ≥ 85 (RCE, webshell, vazamento de segredo, SQLi confirmado)." />
    </div>
  );
}
