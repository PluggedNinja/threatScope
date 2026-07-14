import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, connectWs, getToken, clearToken, getTenant, setTenant } from './api.js';
import Landing from './components/Landing.jsx';
import LoginModal from './components/LoginModal.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import AccountModal from './components/AccountModal.jsx';
import { sfx, unlockAudio, setSoundEnabled, isSoundEnabled } from './sounds.js';
import { ToastProvider, useToast } from './components/Toast.jsx';
import StatCards from './components/StatCards.jsx';
import { TimelineChart, TopCharts } from './components/Charts.jsx';
import CountriesChart from './components/CountriesChart.jsx';
import Filters from './components/Filters.jsx';
import GroupedTable from './components/GroupedTable.jsx';
import AgentsPanel from './components/AgentsPanel.jsx';
import AgentGuide from './components/AgentGuide.jsx';
import LiveFeed from './components/LiveFeed.jsx';
import AttackMap from './components/AttackMap.jsx';
import Modal from './components/Modal.jsx';
import Hint from './components/Hint.jsx';
import WebDashboard from './components/WebDashboard.jsx';
import NetDashboard from './components/NetDashboard.jsx';
import AgentConfig from './components/AgentConfig.jsx';
import GeoCacheModal from './components/GeoCacheModal.jsx';
import ConfigModal from './components/ConfigModal.jsx';
import AgentsModal from './components/AgentsModal.jsx';
import BlockedModal from './components/BlockedModal.jsx';

const THEMES = [
  { id: 'phosphor', name: 'Phosphor · verde' },
  { id: 'amber', name: 'Âmbar CRT' },
  { id: 'ice', name: 'Gelo · ciano' },
  { id: 'redalert', name: 'Alerta Vermelho' },
  { id: 'synthwave', name: 'Synthwave' },
  { id: 'matrix', name: 'Matrix' },
  { id: 'gold', name: 'Comando Ouro' },
  { id: 'arctic', name: 'Ártico' },
  { id: 'toxic', name: 'Tóxico' },
  { id: 'violet', name: 'Violeta' },
  { id: 'bloodmoon', name: 'Lua de Sangue' },
  { id: 'ocean', name: 'Oceano' },
  { id: 'mono', name: 'Fantasma · mono' },
];

const BOOT_ART = `████████╗██╗  ██╗██████╗ ███████╗ █████╗ ████████╗
╚══██╔══╝██║  ██║██╔══██╗██╔════╝██╔══██╗╚══██╔══╝
   ██║   ███████║██████╔╝█████╗  ███████║   ██║
   ██║   ██╔══██║██╔══██╗██╔══╝  ██╔══██║   ██║
   ██║   ██║  ██║██║  ██║███████╗██║  ██║   ██║
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝
    ███████╗ ██████╗ ██████╗ ██████╗ ███████╗
    ██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝
    ███████╗██║     ██║   ██║██████╔╝█████╗
    ╚════██║██║     ██║   ██║██╔═══╝ ██╔══╝
    ███████║╚██████╗╚██████╔╝██║     ███████╗
    ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚══════╝`;

/* ---------------- decorative radar ---------------- */
function Radar({ blips }) {
  return (
    <div className="radar" title="Varredura de perímetro">
      <span className="ring" />
      <span className="ring inner" />
      <span className="cross-h" />
      <span className="cross-v" />
      {blips.map((b) => (
        <span key={b.id} className="blip" style={{ left: `${b.x}%`, top: `${b.y}%` }} />
      ))}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="clock">{now.toLocaleTimeString('pt-BR')} · {now.toLocaleDateString('pt-BR')}</span>;
}

/* ---------------- boot sequence ---------------- */
function BootOverlay({ onDone }) {
  const lines = useMemo(() => [
    '> inicializando núcleo THREATSCOPE...',
    '> carregando contramedidas...',
    '> armando honeypot na porta 22...',
    '> estabelecendo uplink de telemetria...',
    '> PERÍMETRO ARMADO. Bem-vindo, operador.',
  ], []);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= lines.length) { const t = setTimeout(onDone, 500); return () => clearTimeout(t); }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 250 : 360);
    return () => clearTimeout(t);
  }, [step, lines.length, onDone]);
  return (
    <motion.div className="boot-overlay" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
      <div>
        <pre style={{ color: 'var(--green)', fontSize: 'clamp(6px, 1.1vw, 12px)' }}>{BOOT_ART}</pre>
        <div style={{ marginTop: 18, minHeight: 130 }}>
          {lines.slice(0, step).map((l, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              style={{ color: i === lines.length - 1 ? 'var(--amber)' : 'var(--text)' }}>
              {l}{i === step - 1 && <span className="spinner" style={{ marginLeft: 8 }} />}
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ---------------- dashboard ---------------- */
function Dashboard({ user = null, isAdmin = false, tenants = [], selectedTenant = '', onSelectTenant = () => {}, onLogout = () => {}, onOpenAccount = () => {}, onOpenAdmin = () => {}, onBackToSite = () => {} }) {
  const toast = useToast();
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('ssh'); // 'ssh' | 'web'
  const [filters, setFilters] = useState({});
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState([]);
  const [agents, setAgents] = useState([]);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const [live, setLive] = useState(0);
  const [wsOn, setWsOn] = useState(false);
  const [sound, setSound] = useState(isSoundEnabled());
  const [confirmClear, setConfirmClear] = useState(false);
  const [blips, setBlips] = useState([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [configAgent, setConfigAgent] = useState(null);
  const [geoCacheOpen, setGeoCacheOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [managerInfo, setManagerInfo] = useState(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('threatscope-theme') || 'phosphor'; } catch { return 'phosphor'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('threatscope-theme', theme); } catch {}
  }, [theme]);

  const knownIps = useRef(new Set());
  const knownAgents = useRef(new Set());
  const refreshTimer = useRef(null);
  const blipId = useRef(0);

  // serializa filtros p/ dependência estável
  const fkey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    try {
      const [s, g, ag, a] = await Promise.all([
        api.stats({ ...filters, kind: 'ssh' }),
        api.grouped({ ...filters, kind: 'ssh' }),
        api.agents(),
        api.attempts({ ...filters, kind: 'ssh', limit: 150 }),
      ]);
      setStats(s);
      setGroups(g);
      setAgents(ag);
      setRows(a.rows);
      g.forEach((row) => knownIps.current.add(row.ip));
      ag.forEach((row) => knownAgents.current.add(row.agent));
    } catch (e) {
      toast.push({ type: 'warn', title: 'Sem conexão', message: 'Não consegui falar com a API (:4000). O servidor está rodando?' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  // recarrega quando filtros mudam (com debounce)
  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  // refresh leve de stats/grupos disparado por novos ataques (throttle)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(async () => {
      refreshTimer.current = null;
      try {
        const [s, g, ag] = await Promise.all([api.stats({ ...filters, kind: 'ssh' }), api.grouped({ ...filters, kind: 'ssh' }), api.agents()]);
        setStats(s); setGroups(g); setAgents(ag);
      } catch {}
    }, 1600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey]);

  // info da central para o guia de agentes (uma vez)
  useEffect(() => {
    api.managerInfo().then(setManagerInfo).catch(() => {});
  }, []);

  // Cabeçalho auto-recolhível: aparece no início, recolhe sozinho após 3s e
  // reaparece quando o mouse chega ao topo da tela; recolhe ao descer bem abaixo.
  useEffect(() => {
    const t = setTimeout(() => setShowHeader(false), 3000);
    const onMove = (e) => {
      if (e.clientY <= 8) setShowHeader(true);
      else if (e.clientY > 130) setShowHeader(false);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => { clearTimeout(t); window.removeEventListener('mousemove', onMove); };
  }, []);

  // contagem de IPs bloqueados (badge no botão) — atualiza ao fechar o modal e a cada 2 min
  useEffect(() => {
    let alive = true;
    const load = () => api.blockedList()
      .then((d) => { if (alive) setBlockedCount((d.agents || []).reduce((n, a) => n + (a.blocked?.length || 0), 0)); })
      .catch(() => {});
    load();
    const iv = setInterval(load, 120000);
    return () => { alive = false; clearInterval(iv); };
  }, [blockedOpen]);

  const flashRadar = useCallback(() => {
    const id = ++blipId.current;
    const b = { id, x: 10 + Math.random() * 80, y: 10 + Math.random() * 80 };
    setBlips((bs) => [...bs, b].slice(-6));
    setTimeout(() => setBlips((bs) => bs.filter((x) => x.id !== id)), 2000);
  }, []);

  // WebSocket
  useEffect(() => {
    const close = connectWs((msg) => {
      if (msg.type === 'autoblock') {
        const a = msg.payload || {};
        sfx.alert();
        setBlockedCount((c) => c + 1);
        toast.push({ type: 'alert', title: '🚫 BLOQUEIO AUTOMÁTICO', message: `${a.ip} → ${(a.agents || []).join(', ') || 'agentes'}` });
        return;
      }
      if (msg.type === 'attempt') {
        const a = msg.payload;
        if (a.kind && a.kind !== 'ssh') return; // web/net são tratados nas próprias abas
        setRows((prev) => [a, ...prev].slice(0, 200));
        setLive((n) => n + 1);
        setNewIds((s) => { const n = new Set(s); n.add(a.id); return n; });
        setTimeout(() => setNewIds((s) => { const n = new Set(s); n.delete(a.id); return n; }), 1600);
        flashRadar();
        if (a.agent && !knownAgents.current.has(a.agent)) {
          knownAgents.current.add(a.agent);
          toast.push({ type: 'alert', title: 'NOVO SERVIDOR ONLINE', message: `Agente "${a.agent}" começou a reportar.` });
        }
        const isNewIp = !knownIps.current.has(a.ip);
        if (isNewIp) {
          knownIps.current.add(a.ip);
          sfx.alert();
          toast.push({ type: 'alert', title: 'NOVO HOST HOSTIL', message: `${a.ip} iniciou ataque · user="${a.username || '∅'}"` });
        } else {
          sfx.attack();
        }
        scheduleRefresh();
      }
    }, (ok) => setWsOn(ok));
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefresh, flashRadar]);

  const onExport = (format) => {
    window.open(api.exportUrl(format, filters), '_blank');
    toast.push({ title: 'Exportando', message: `Gerando arquivo ${format.toUpperCase()}…` });
  };

  const doClear = async () => {
    setConfirmClear(false);
    try {
      await api.clear();
      knownIps.current = new Set();
      setLive(0); setSelected([]);
      await refresh();
      sfx.success();
      toast.push({ title: 'Base zerada', message: 'Todos os registros foram apagados.' });
    } catch {
      toast.push({ type: 'warn', title: 'Falha', message: 'Não foi possível zerar a base.' });
    }
  };

  const onFocusSelected = (ips) => {
    setFilters((f) => ({ ...f, ips }));
    toast.push({ title: 'Foco aplicado', message: `Painel filtrado em ${ips.length} IP(s).` });
  };

  const onRemoveAgent = async (a) => {
    try {
      await api.removeAgent(a.id);
      await refresh();
      toast.push({ title: 'Agente removido', message: `${a.name || a.host} saiu do monitoramento.` });
    } catch {
      toast.push({ type: 'warn', title: 'Falha', message: 'Não foi possível remover o agente.' });
    }
  };

  const toggleSound = () => {
    unlockAudio();
    const v = !sound;
    setSound(v); setSoundEnabled(v);
    if (v) sfx.boot();
  };

  return (
    <div className="app" onClick={unlockAudio}>
      <AnimatePresence>
        {booting && <BootOverlay onDone={() => { setBooting(false); unlockAudio(); sfx.boot(); }} />}
      </AnimatePresence>

      {/* zona de gatilho: aproxime o mouse do topo para o cabeçalho descer */}
      <div className={'top-trigger' + (showHeader ? ' armed' : '')} onMouseEnter={() => setShowHeader(true)}>
        <span className="top-handle">▾</span>
      </div>

      <header className={'topbar' + (showHeader ? '' : ' tucked')}
        onMouseEnter={() => setShowHeader(true)} onMouseLeave={() => setShowHeader(false)}>
        <div className="brand">
          <span className="logo">🛡️</span>
          <div>
            <h1>THREATSCOPE</h1>
            <div className="sub">THREAT INTEL MAPPING</div>
          </div>
        </div>
        <div className="kpis">
          <span className="kpi"><b>{agents.filter((a) => a.online).length}</b><i>/{agents.length}</i><em>agentes on</em></span>
          <span className="kpi"><b style={{ color: 'var(--amber)' }}>{live}</b><em>ataques · sessão</em></span>
          <span className="kpi"><b style={{ color: blockedCount ? 'var(--red)' : 'var(--text-dim)' }}>{blockedCount}</b><em>bloqueados</em></span>
          <span className="kpi"><b>{view.toUpperCase()}</b><em>painel ativo</em></span>
        </div>
        <div className="status-strip">
          <div className="status-group">
            <span className={`led ${wsOn ? '' : 'off'}`}><span className="dot" /> {wsOn ? 'UPLINK' : 'OFFLINE'}</span>
            <Clock />
          </div>
          <span className="topbar-div" />
          <div className="actions-group">
            {isAdmin && tenants.length > 0 && (
              <select className="theme-select tiny" value={selectedTenant} title="Ver sensores de um tenant (admin)"
                onChange={(e) => { sfx.click(); onSelectTenant(e.target.value); }}>
                <option value="">👑 Todos os sensores</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>🏷️ {t.name} ({t.sensors})</option>)}
              </select>
            )}
            <button className="tiny amber" onClick={() => { sfx.click(); setAgentsOpen(true); }} title="Gerenciar servidores/agentes">🖥️ AGENTES</button>
            <button className="tiny danger" onClick={() => { sfx.click(); setBlockedOpen(true); }} title="IPs bloqueados / auto-bloqueio">🚫 BLOQUEIOS{blockedCount > 0 ? ` (${blockedCount})` : ''}</button>
            {isAdmin && <button className="tiny" onClick={() => { sfx.click(); setGeoCacheOpen(true); }} title="Cache de GeoIP">🌍 GEO</button>}
            {isAdmin && <button className="tiny" onClick={() => { sfx.click(); setConfigOpen(true); }} title="Configuração da central">⚙️ CONFIG</button>}
            {isAdmin && <button className="tiny" onClick={() => { sfx.click(); onOpenAdmin(); }} title="Administração: contas, remoções, tenants">👑 ADMIN</button>}
            <span className="topbar-div" />
            <select className="theme-select tiny" value={theme} title="Tema de cores"
              onChange={(e) => { sfx.click(); setTheme(e.target.value); }}>
              {THEMES.map((t) => <option key={t.id} value={t.id}>🎨 {t.name}</option>)}
            </select>
            <button className="tiny icon-btn" onClick={toggleSound} title={sound ? 'Som ligado' : 'Mudo'}>{sound ? '🔊' : '🔇'}</button>
            <button className="tiny icon-btn" onClick={() => { sfx.click(); setHelpOpen(true); }} title="Ajuda">❔</button>
            <button className="tiny icon-btn" onClick={() => { sfx.click(); onOpenAccount(); }} title={user ? `${user.name} · minha conta` : 'Minha conta'}>👤</button>
            <button className="tiny icon-btn" onClick={onBackToSite} title="Voltar ao site público">🌐</button>
            <button className="tiny icon-btn" onClick={onLogout} title="Sair">🚪</button>
          </div>
          <Radar blips={blips} />
        </div>
      </header>

      <div className="tabbar">
        <button className={'tab' + (view === 'ssh' ? ' on' : '')} onClick={() => { sfx.click(); setView('ssh'); }}>
          🔑 SSH · brute-force
        </button>
        <button className={'tab' + (view === 'web' ? ' on' : '')} onClick={() => { sfx.click(); setView('web'); }}>
          🌐 WEB · logs de acesso
        </button>
        <button className={'tab' + (view === 'net' ? ' on' : '')} onClick={() => { sfx.click(); setView('net'); }}>
          🛰️ NET · sensor de rede
        </button>
      </div>

      {view === 'ssh' && (
        <>
          <StatCards stats={stats} live={live} />

          <div style={{ marginTop: 14 }}>
            <AttackMap filters={{ ...filters, kind: 'ssh' }} pings={live} />
          </div>

          <div className="grid cols-3" style={{ marginTop: 14 }}>
            <TimelineChart data={stats?.timeline || []} theme={theme} />
            <TopCharts stats={stats} theme={theme} />
            <div style={{ gridColumn: 'span 2' }}><CountriesChart filters={{ ...filters, kind: 'ssh' }} kind="ssh" /></div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Filters
              filters={filters}
              setFilters={setFilters}
              onExport={onExport}
              onClear={() => { setConfirmClear(true); }}
              total={stats?.total}
            />
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <GroupedTable
              groups={groups}
              selected={selected}
              setSelected={setSelected}
              onFocusSelected={onFocusSelected}
            />
            <LiveFeed rows={rows} newIds={newIds} />
          </div>
        </>
      )}

      {view === 'web' && (
        <WebDashboard theme={theme} agents={agents} onRefreshAgents={refresh}
          onConfigAgent={(a) => { sfx.click(); setConfigAgent(a); }} />
      )}

      {view === 'net' && (
        <NetDashboard agents={agents} onRefreshAgents={refresh}
          onConfigAgent={(a) => { sfx.click(); setConfigAgent(a); }} />
      )}

      <footer style={{ marginTop: 28, textAlign: 'center' }} className="tiny muted">
        <div>{view === 'web'
          ? 'WEB · monitor de logs de acesso · classificação de ameaças em tempo real — use apenas em ativos próprios.'
          : 'THREATSCOPE · perímetro armado · capturas em tempo real via WebSocket — use apenas em ativos próprios.'}</div>
        <div style={{ marginTop: 4, opacity: 0.8 }}>© {new Date().getFullYear()} THREATSCOPE · Threat Intel Mapping — admin@plugged.ninja</div>
      </footer>

      {/* modal de confirmação de limpeza */}
      <Modal open={confirmClear} title="⚠️ Zerar base de capturas" onClose={() => setConfirmClear(false)} width={460}>
        <div className="legal">
          Esta ação apaga PERMANENTEMENTE todas as tentativas registradas. Não há como desfazer.
          Exporte antes se quiser guardar a inteligência coletada.
        </div>
        <div className="flex" style={{ marginTop: 16 }}>
          <button className="danger" onClick={doClear}>🗑 Confirmar exclusão</button>
          <button className="right" onClick={() => { sfx.click(); setConfirmClear(false); }}>Cancelar</button>
        </div>
      </Modal>

      {/* guia de adicionar agente */}
      <AgentGuide open={guideOpen} onClose={() => setGuideOpen(false)} info={managerInfo} onRegistered={refresh} defaultMode={view === 'web' ? 'web' : 'ssh'} />

      {/* gestão do cache de GeoIP */}
      <GeoCacheModal open={geoCacheOpen} onClose={() => setGeoCacheOpen(false)} />
      <ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />

      {/* gestão de agentes/servidores */}
      <AgentsModal
        open={agentsOpen} onClose={() => setAgentsOpen(false)}
        agents={agents}
        activeAgent={filters.agent}
        onSelect={(name) => setFilters((f) => ({ ...f, agent: name || undefined }))}
        onAddAgent={() => { sfx.click(); setGuideOpen(true); }}
        onRemove={onRemoveAgent}
        onConfig={(a) => { sfx.click(); setConfigAgent(a); }}
        latestVersion={managerInfo?.agentVersion}
      />

      {/* IPs bloqueados no ufw */}
      <BlockedModal open={blockedOpen} onClose={() => setBlockedOpen(false)} />

      {/* configuração do agente — por último para ficar SEMPRE por cima (ex.: aberto de dentro do modal de Agentes) */}
      <AgentConfig agent={configAgent} open={!!configAgent} onClose={() => setConfigAgent(null)} onSaved={refresh} />

      {/* modal de ajuda */}
      <Modal open={helpOpen} title="❔ Manual de campo — THREATSCOPE" onClose={() => setHelpOpen(false)} width={780}>
        <div className="help">
          <p><b className="hg">O que é o THREATSCOPE?</b> A central (manager) de uma malha de <b>honeypots</b> de ameaças.
            Em cada servidor seu roda um <b>agente</b> que atrai e registra atividade hostil (força bruta de SSH, varredura
            de vulnerabilidades web e conexões de rede). A central <b>conecta em cada agente</b> (arquitetura <i>pull</i>) e
            consolida tudo aqui: mapa mundial, feeds ao vivo, reputação e bloqueio.</p>

          <div className="hs">🖥️ Agentes</div>
          <p>Cada servidor monitorado é um agente. Abra <b>🖥️ AGENTES</b> no topo para adicionar (guia com download já
            pré-configurado), remover, testar conexão, posicionar no mapa e configurar (⚙): modo (SSH / WEB / NET), caminho
            dos logs web, interface de rede e janela de amostragem. Verde = respondendo. Os agentes se <b>auto-atualizam</b>.</p>

          <div className="hs">🔑 SSH · brute-force</div>
          <p>O honeypot SSH finge ser um servidor real e captura <b>usuários e senhas</b> testados pelos bots. O
            <b> Feed ao vivo</b> mostra cada tentativa (pisca + beep); <b>Agrupado por IP</b> resume os atacantes — clique numa
            linha para o dossiê completo (credenciais, reputação, WHOIS, países). O 🚫 na linha bloqueia o IP na hora.</p>

          <div className="hs">🌐 WEB · logs de acesso</div>
          <p>O agente lê os logs do seu Nginx/Apache/IIS e classifica cada requisição (scanner de vulnerabilidade, tentativa
            de RCE/webshell, força bruta de painel, etc.). <b>🎯 HIT</b> = a requisição atingiu um alvo sensível. Clique em um IP
            em <b>Origens por IP</b> para o dossiê e o bloqueio. Use <b>🔇 silenciar</b> para ignorar padrões legítimos.</p>

          <div className="hs">🛰️ NET · sensor de rede</div>
          <p>Via tcpdump, o agente resume as conexões que chegam (portas, serviços, <b>port scans</b>) em janelas de tempo —
            sem afogar você em ruído. O mapa mostra de onde vêm e para qual agente.</p>

          <div className="hs">🚫 Bloqueios & auto-bloqueio</div>
          <p>Bloquear um IP aplica uma regra no firewall do agente (<b>ufw</b> se ativo, senão <b>iptables</b>). Dá para escolher
            <b> todas as portas</b> ou serviços/portas específicas. Em <b>🚫 BLOQUEIOS</b> você vê o que está bloqueado por agente,
            desbloqueia, e liga o <b>🤖 auto-bloqueio</b> (bloquear sozinho quem passar de X tentativas, fizer port scan ou
            acertar alvo web), com <b>allowlist</b> para nunca bloquear seus próprios ranges.</p>

          <div className="hs">🌍 GEO · ⚙️ CONFIG</div>
          <p><b>GEO</b> gerencia o cache de geolocalização (por faixa /24, com validade configurável). <b>CONFIG</b> reúne tudo o
            que antes ficava no <code>.env</code>: token de coleta, porta, intervalo, CORS, GeoIP, chave AbuseIPDB e o interruptor
            do auto-bloqueio — salvo na base e valendo ao vivo (só a porta pede reinício).</p>

          <div className="hs">🔌 API de consulta (para outras ferramentas)</div>
          <p>A central expõe uma API <b>pública e read-only</b> para checar se um IP é malicioso segundo os seus honeypots:</p>
          <ul className="help-api">
            <li><code>GET /api/lookup/&lt;ip&gt;</code> → IP, primeiro/último evento, e <b>o que foi detectado</b> (SSH/WEB/NET).</li>
            <li><code>POST /api/lookup</code> com <code>{'{ "ips": ["1.2.3.4", ...] }'}</code> → consulta em lote (até 200).</li>
            <li><code>GET /api/blocklist?format=txt</code> → lista de todos os IPs vistos (um por linha, para firewalls).</li>
          </ul>

          <p className="muted tiny">Use apenas em ativos próprios. Os pontinhos do radar são decorativos e acendem a cada novo evento. Bom turno, operador. 🫡</p>
          <div className="help-copy">© {new Date().getFullYear()} THREATSCOPE · Threat Intel Mapping — <a href="mailto:admin@plugged.ninja">admin@plugged.ninja</a></div>
        </div>
      </Modal>
    </div>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('help-styles')) {
  const el = document.createElement('style'); el.id = 'help-styles';
  el.textContent = `
    .help { line-height:1.65; font-size:13px; }
    .help p { margin:6px 0; }
    .help .hg { color:var(--green); }
    .help b { color:var(--text); }
    .help .hs { margin-top:14px; margin-bottom:2px; color:var(--cyan); font-size:12px; letter-spacing:2px; border-bottom:1px solid var(--green-deep); padding-bottom:3px; }
    .help code { color:var(--amber); background:rgba(var(--accent-rgb),0.08); padding:0 4px; border-radius:2px; font-size:12px; }
    .help-api { margin:4px 0 0; padding-left:18px; }
    .help-api li { margin:3px 0; }
    .help-copy { margin-top:16px; padding-top:10px; border-top:1px solid var(--green-deep); font-size:11px; color:var(--text-dim); text-align:center; }
    .help-copy a { color:var(--cyan); }
  `;
  document.head.appendChild(el);
}

/* ---------------- app: rota + autenticação ---------------- */
function Root() {
  const [route, setRoute] = useState(() => (location.hash || '#/').replace(/^#/, ''));
  const [token, setTok] = useState(() => getToken());
  const [user, setUser] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSel] = useState(() => getTenant());
  const [loginOpen, setLoginOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute((location.hash || '#/').replace(/^#/, ''));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadTenants = useCallback(() => {
    api.adminTenants().then((t) => setTenants(t.tenants || [])).catch(() => {});
  }, []);

  // Carrega a conta. Sempre tenta /api/me: com token, valida o token; SEM token,
  // ainda funciona quando a central trata localhost como admin (uso local) —
  // aí o painel abre sem precisar colar token.
  useEffect(() => {
    let alive = true;
    api.me()
      .then((m) => { if (!alive) return; setUser(m.user); if (m.isAdmin) loadTenants(); })
      .catch((e) => {
        if (!alive) return;
        if (e.code === 401 || e.code === 403) { if (token) { clearToken(); setTok(''); } setUser(null); setTenants([]); }
      });
    return () => { alive = false; };
  }, [token, loadTenants]);

  const go = (r) => { location.hash = r; };
  const onLoggedIn = (m) => { setTok(getToken()); setUser(m.user); setLoginOpen(false); if (m.isAdmin) loadTenants(); go('/painel'); };
  const logout = () => { clearToken(); setTok(''); setUser(null); setTenants([]); setSel(''); go('/'); };
  const selectTenant = (id) => { setTenant(id); setSel(id); };

  const isAdmin = user?.role === 'admin';
  const loggedIn = !!token || !!user; // token OU admin-localhost (sessão sem token)
  const wantPanel = route.startsWith('/painel');
  const inPanel = wantPanel && loggedIn;

  return (
    <ToastProvider>
      {!inPanel && (
        <Landing loggedIn={loggedIn} user={user}
          onLogin={() => setLoginOpen(true)}
          onLogout={logout}
          onOpenPanel={() => (loggedIn ? go('/painel') : setLoginOpen(true))}
        />
      )}
      {inPanel && (
        <Dashboard
          key={'panel-' + selectedTenant}
          user={user} isAdmin={isAdmin}
          tenants={tenants} selectedTenant={selectedTenant} onSelectTenant={selectTenant}
          onLogout={logout} onOpenAccount={() => setAccountOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)} onBackToSite={() => go('/')}
        />
      )}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLoggedIn={onLoggedIn} />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} onChanged={loadTenants} />
      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} user={user} />
    </ToastProvider>
  );
}

export default function App() {
  return <Root />;
}
