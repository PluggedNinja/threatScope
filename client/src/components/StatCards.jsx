import React from 'react';
import { motion } from 'framer-motion';
import Hint from './Hint.jsx';

function Stat({ label, value, color, spark, hint }) {
  return (
    <motion.div
      className="panel stat"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22 }}
    >
      <div className="label">{label} {hint && <Hint>{hint}</Hint>}</div>
      <motion.div key={value} className={`value ${color || ''}`}
        initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }}>
        {value}
      </motion.div>
      {spark && <div className="spark">{spark}</div>}
    </motion.div>
  );
}

export default function StatCards({ stats, live }) {
  const s = stats || {};
  return (
    <div className="grid cols-4">
      <Stat label="Tentativas totais" value={(s.total ?? 0).toLocaleString('pt-BR')} color="red"
        spark="ataques registrados" hint="Total de tentativas de autenticação capturadas pelo honeypot." />
      <Stat label="IPs de origem" value={(s.uniqueIps ?? 0).toLocaleString('pt-BR')} color="cyan"
        spark="hosts hostis distintos" hint="Quantidade de endereços IP únicos que atacaram." />
      <Stat label="Usuários testados" value={(s.uniqueUsers ?? 0).toLocaleString('pt-BR')} color="amber"
        spark="logins distintos" hint="Nomes de usuário únicos tentados pelos bots." />
      <Stat label="Senhas testadas" value={(s.uniquePass ?? 0).toLocaleString('pt-BR')}
        spark={`+${live} ao vivo nesta sessão`} hint="Senhas únicas tentadas pelos bots." />
    </div>
  );
}
