import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import '../landing.css';

/* Landing pública do PluggedNinja ThreatScope.
   - Explica o projeto e como colaborar instalando sensores.
   - Cadastro (nome/email) -> conta pendente até o admin aprovar.
   - Download do agente liberado só para contas logadas/aprovadas.
   - Guia de instalação + lógica de detecção/banimento/lista/API.
   - Formulário de remoção de IP para donos que corrigiram o problema.
   - Docs da API pública (ip, razão, data de adesão — sem nome de sensor). */

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.ln-reveal');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }), { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ loading: false, msg: null, err: null });
  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true, msg: null, err: null });
    try {
      const r = await api.register(name.trim(), email.trim());
      setState({ loading: false, msg: r.message || 'Cadastro recebido! Aguarde a aprovação do admin.', err: null });
      setName(''); setEmail('');
    } catch (err) {
      setState({ loading: false, msg: null, err: err.message || 'Falha no cadastro' });
    }
  };
  return (
    <form className="ln-card ln-form" onSubmit={submit} id="cadastro">
      <h3>📝 Cadastre-se para colaborar</h3>
      <p className="ln-muted">Crie sua conta para instalar sensores. Após a aprovação do admin, você recebe um token para baixar o agente e acessar seu painel.</p>
      <label>Nome
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Seu nome ou organização" />
      </label>
      <label>E-mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="voce@exemplo.com" />
      </label>
      <button className="ln-btn primary" disabled={state.loading}>{state.loading ? 'Enviando…' : 'Solicitar acesso'}</button>
      {state.msg && <div className="ln-ok">✅ {state.msg}</div>}
      {state.err && <div className="ln-err">⚠️ {state.err}</div>}
    </form>
  );
}

function RemovalForm() {
  const [ip, setIp] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState({ loading: false, msg: null, err: null });
  const submit = async (e) => {
    e.preventDefault();
    setState({ loading: true, msg: null, err: null });
    try {
      const r = await api.requestRemoval(ip.trim(), email.trim(), message.trim());
      setState({ loading: false, msg: r.message || 'Pedido recebido. Vamos revisar.', err: null });
      setIp(''); setEmail(''); setMessage('');
    } catch (err) {
      setState({ loading: false, msg: null, err: err.message || 'Falha ao enviar' });
    }
  };
  return (
    <form className="ln-card ln-form" onSubmit={submit} id="remocao">
      <h3>🧹 Meu IP está na lista — pedir remoção</h3>
      <p className="ln-muted">É dono/responsável por um IP listado e já corrigiu o problema (fechou o serviço, limpou o host)? Solicite a revisão e a remoção da lista.</p>
      <label>IP
        <input value={ip} onChange={(e) => setIp(e.target.value)} required maxLength={60} placeholder="203.0.113.10" />
      </label>
      <label>E-mail de contato
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="responsavel@dominio.com" />
      </label>
      <label>Detalhes (opcional)
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3} placeholder="O que foi corrigido, comprovação, etc." />
      </label>
      <button className="ln-btn" disabled={state.loading}>{state.loading ? 'Enviando…' : 'Solicitar remoção'}</button>
      {state.msg && <div className="ln-ok">✅ {state.msg}</div>}
      {state.err && <div className="ln-err">⚠️ {state.err}</div>}
    </form>
  );
}

export default function Landing({ loggedIn = false, user, onLogin, onLogout, onOpenPanel }) {
  useReveal();
  const [info, setInfo] = useState(null);
  useEffect(() => { api.publicInfo().then(setInfo).catch(() => {}); }, []);
  const approved = loggedIn; // conta aprovada (com token) ou admin-localhost

  const download = (mode) => {
    if (!approved) { onLogin(); return; }
    window.open(api.agentBundleUrl(mode), '_blank');
  };

  return (
    <div className="landing">
      {/* Top bar */}
      <header className="ln-top">
        <div className="ln-brand"><span className="ln-logo">🛡️</span><b>PluggedNinja</b> <span className="ln-accent">ThreatScope</span></div>
        <nav className="ln-nav">
          <a href="#como">Como funciona</a>
          <a href="#colabore">Colabore</a>
          <a href="#api">API</a>
          <a href="#remocao">Remoção de IP</a>
          {loggedIn
            ? <><button className="ln-btn sm" onClick={onOpenPanel}>🗺️ Meu painel</button><button className="ln-btn sm ghost" onClick={onLogout}>Sair</button></>
            : <button className="ln-btn sm primary" onClick={onLogin}>Entrar</button>}
        </nav>
      </header>

      {/* Hero */}
      <section className="ln-hero">
        <div className="ln-hero-txt ln-reveal">
          <div className="ln-badge">rede colaborativa de honeypots · aberta</div>
          <h1>Transforme os ataques que chegam nos seus servidores em <span className="ln-accent">inteligência de ameaças compartilhada</span>.</h1>
          <p>O ThreatScope é uma malha de <b>honeypots</b>. Você instala um <b>sensor</b> em cada servidor; ele atrai e registra força bruta de SSH, varredura de vulnerabilidades web e port scans. A central consolida tudo, classifica os atacantes e publica uma <b>blocklist pública</b> que qualquer ferramenta pode consumir via API.</p>
          <div className="ln-hero-cta">
            <a className="ln-btn primary lg" href="#cadastro">Quero colaborar</a>
            <a className="ln-btn lg ghost" href="#api">Ver a API pública</a>
          </div>
        </div>
        <div className="ln-hero-stats ln-reveal">
          <div className="ln-stat"><b>{info ? info.maliciousIps.toLocaleString('pt-BR') : '—'}</b><span>IPs maliciosos na lista</span></div>
          <div className="ln-stat"><b>{info ? info.sensors : '—'}</b><span>sensores ativos</span></div>
          <div className="ln-stat"><b>aberto</b><span>instale o seu sensor</span></div>
        </div>
      </section>

      {/* O que é / por que ajuda */}
      <section className="ln-sec" id="sobre">
        <h2 className="ln-reveal">Por que isso ajuda todo mundo</h2>
        <div className="ln-grid3">
          <div className="ln-card ln-reveal"><div className="ln-ic">🎯</div><h3>Detecta cedo</h3><p>Como o honeypot não é um serviço real, <b>todo</b> acesso é hostil por definição — nada de falso positivo. O primeiro pacote de um bot já vira um sinal.</p></div>
          <div className="ln-card ln-reveal"><div className="ln-ic">🌐</div><h3>Efeito de rede</h3><p>Um IP que ataca o seu servidor provavelmente ataca o meu. Ao juntar sensores de vários operadores, todos veem o atacante <b>antes</b> de serem atingidos.</p></div>
          <div className="ln-card ln-reveal"><div className="ln-ic">🔓</div><h3>Aberto e privado</h3><p>Qualquer um pode instalar sensores e consumir a lista via API. A lista pública traz só <b>IP, razão e data de adesão</b> — nunca o nome de quem capturou.</p></div>
        </div>
      </section>

      {/* Como funciona: detecção -> banimento -> lista -> API */}
      <section className="ln-sec" id="como">
        <h2 className="ln-reveal">Como funciona, do ataque à API</h2>
        <div className="ln-flow">
          <div className="ln-step ln-reveal"><span className="ln-num">1</span><h3>Captura</h3><p>O sensor SSH finge ser um servidor real e grava usuários/senhas testados. O sensor WEB lê os logs do nginx/apache e classifica cada requisição (scanner, RCE, SQLi, força bruta de painel…). O sensor NET resume conexões e detecta port scans.</p></div>
          <div className="ln-arrow">→</div>
          <div className="ln-step ln-reveal"><span className="ln-num">2</span><h3>Classificação</h3><p>Cada evento recebe uma <b>razão</b> (SSH brute-force, alvo sensível atingido, port scan…). A central agrega por IP, calcula reputação (DNSBLs, AbuseIPDB opcional) e geolocaliza no mapa.</p></div>
          <div className="ln-arrow">→</div>
          <div className="ln-step ln-reveal"><span className="ln-num">3</span><h3>Banimento</h3><p>Você bloqueia um IP no firewall do sensor (ufw/iptables) com um clique — ou liga o <b>auto-bloqueio</b>: bane sozinho quem passar de X tentativas, fizer port scan ou acertar um alvo web. Uma <b>allowlist</b> protege seus próprios ranges.</p></div>
          <div className="ln-arrow">→</div>
          <div className="ln-step ln-reveal"><span className="ln-num">4</span><h3>Lista + API</h3><p>Todo IP visto entra na <b>blocklist</b>. Terceiros puxam a lista via API (texto para ipset/ufw, ou JSON) e consultam um IP específico. A distribuição preserva a privacidade: nunca revela qual sensor capturou.</p></div>
        </div>
      </section>

      {/* Colabore: cadastro + download + instalação */}
      <section className="ln-sec" id="colabore">
        <h2 className="ln-reveal">Colabore: instale um sensor</h2>
        <div className="ln-grid2">
          <RegisterForm />
          <div className="ln-card ln-reveal">
            <h3>⬇️ Baixe o agente</h3>
            {approved
              ? <p className="ln-muted">Sua conta está aprovada. Baixe o pacote já pré-configurado (token embutido) para o modo desejado:</p>
              : <p className="ln-muted">O download é liberado após a aprovação da sua conta. Já aprovado? <button className="ln-link" onClick={onLogin}>Entre com seu token</button>.</p>}
            <div className="ln-dl">
              <button className="ln-btn" onClick={() => download('ssh')} disabled={!approved}>🔑 Sensor SSH</button>
              <button className="ln-btn" onClick={() => download('web')} disabled={!approved}>🌐 Sensor WEB</button>
              <button className="ln-btn" onClick={() => download('all')} disabled={!approved}>🛰️ SSH+WEB+NET</button>
            </div>
            <h4 className="ln-h4">Instalação em 4 passos</h4>
            <ol className="ln-ol">
              <li>Instale o <b>Node.js 18+</b> no servidor que quer proteger.</li>
              <li>Descompacte o pacote e rode <code>npm install</code> na pasta.</li>
              <li>Suba o sensor: <code>sudo npm start</code> (sudo por causa da porta 22 e do firewall). No Windows, execute <code>start-agent.bat</code> como Administrador.</li>
              <li>No seu painel, registre o IP do servidor (porta <code>4000</code>) e libere essa porta <b>apenas para o IP da central</b>.</li>
            </ol>
            <p className="ln-muted tiny">O sensor WEB apenas <b>lê</b> os logs — não altera nada no servidor. A central puxa as capturas (arquitetura pull), então o sensor não precisa alcançar a central.</p>
          </div>
        </div>
      </section>

      {/* Painel/mapa gated */}
      <section className="ln-sec ln-panel-cta ln-reveal" id="painel">
        <div>
          <h2>🗺️ Mapa e painel ao vivo</h2>
          <p>Acompanhe seus sensores num mapa-múndi com arcos de ataque em tempo real, feeds ao vivo, dossiês de IP e bloqueio. <b>Cada conta vê apenas os seus próprios sensores</b>; a lista completa de ameaças fica disponível para todos via API.</p>
        </div>
        {loggedIn
          ? <button className="ln-btn primary lg" onClick={onOpenPanel}>Abrir meu painel →</button>
          : <button className="ln-btn primary lg" onClick={onLogin}>Entrar para acessar →</button>}
      </section>

      {/* API pública */}
      <section className="ln-sec" id="api">
        <h2 className="ln-reveal">API pública de ameaças</h2>
        <p className="ln-muted ln-reveal">Read-only, para firewalls, SIEMs e outras ferramentas. <b>Privacidade:</b> a resposta traz apenas <b>ip</b>, <b>razão</b> e <b>data de adesão</b> à lista — nunca o nome do sensor nem credenciais capturadas.</p>
        <div className="ln-grid2">
          <div className="ln-card ln-reveal">
            <h3>Lista completa (blocklist)</h3>
            <pre className="ln-pre">{`# um IP por linha (ideal p/ ipset/ufw)
GET /api/blocklist?format=txt

# JSON com razão e data de adesão
GET /api/blocklist
{
  "count": 128,
  "threats": [
    { "ip": "203.0.113.10",
      "reason": "SSH brute-force",
      "listedSince": "2026-07-01T10:12:03Z",
      "lastSeen": "2026-07-05T17:20:55Z",
      "events": 431 }
  ]
}`}</pre>
          </div>
          <div className="ln-card ln-reveal">
            <h3>Consultar um IP</h3>
            <pre className="ln-pre">{`GET /api/lookup/203.0.113.10
{
  "ip": "203.0.113.10",
  "found": true,
  "malicious": true,
  "reason": "SSH brute-force",
  "listedSince": "2026-07-01T10:12:03Z",
  "lastSeen": "2026-07-05T17:20:55Z"
}

# lote (até 200 por chamada)
POST /api/lookup
{ "ips": ["1.2.3.4", "5.6.7.8"] }`}</pre>
          </div>
        </div>
      </section>

      {/* Remoção de IP */}
      <section className="ln-sec" id="remocao-sec">
        <h2 className="ln-reveal">É dono de um IP listado?</h2>
        <div className="ln-grid2">
          <RemovalForm />
          <div className="ln-card ln-reveal ln-remocao-info">
            <h3>Como funciona a remoção</h3>
            <p>Envie o IP e um contato. A equipe revisa o pedido e, uma vez confirmado que a atividade hostil cessou, o IP é removido da lista e deixa de aparecer na API.</p>
            <p className="ln-muted">Dicas para agilizar: feche/proteja o serviço exposto (troque a porta 22, exija chave SSH), verifique se o host não foi comprometido, e descreva o que foi corrigido.</p>
          </div>
        </div>
      </section>

      <footer className="ln-foot">
        <div>🛡️ <b>PluggedNinja ThreatScope</b> — rede colaborativa de honeypots · use apenas em ativos próprios.</div>
        <div className="ln-muted tiny">© {new Date().getFullYear()} PluggedNinja · admin@plugged.ninja</div>
      </footer>
    </div>
  );
}
