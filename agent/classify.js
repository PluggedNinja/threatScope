// Classificador de ameaças web — compartilhado entre o AGENTE (que lê os logs)
// e a CENTRAL (fallback). Dado um request de acesso web, devolve:
//   { score(0-100), category, label, isBot, hit }
// Sem dependências: roda igual no agente empacotado e no servidor.

const RULES = [
  ['env-leak',    'Vazamento de segredo', 96, /(^|\/)\.(env|git|aws|ssh|htpasswd|npmrc|dockercfg)(\/|$|\.)|\/wp-config\.php|\/config\.(php|json|yml|yaml)|\/\.git\/|id_rsa|\/credentials|\/secrets?/i],
  ['rce-shell',   'RCE / Webshell',       97, /\/cgi-bin\/|\/boaform\/|\/shell|\/bin\/sh|\/etc\/passwd|\.\.(\/|%2f)|\/vendor\/phpunit|\/thinkphp|eval\(|system\(|passthru|\/actuator\/gateway|\/goform\/|\/HNAP1|\/setup\.cgi|\/console\/|struts|\.action(\?|$)|jndi:|\$\{/i],
  ['sqli',        'SQL Injection',        90, /(union(\s|\+|%20)+select|information_schema|\bor\b(\s|\+|%20)+1=1|sleep\(\d|benchmark\(|'(\s|\+|%20)*or(\s|\+|%20)*'|%27|concat\(|extractvalue\()/i],
  ['xss',         'Cross-Site Scripting', 62, /(<script|onerror=|onload=|javascript:|%3cscript|document\.cookie|alert\()/i],
  ['admin-probe', 'Painel administrativo',68, /\/phpmyadmin|\/pma\/|\/adminer|\/manager\/html|\/solr\/|\/jenkins|\/_?admin(\/|$|er)|\/wp-admin\/|\/administrator\/|\/xmlrpc\.php|\/dbadmin|\/mysql/i],
  ['wp-scan',     'Recon WordPress',      55, /\/wp-login\.php|\/wp-content\/|\/wp-json\/|\/wp-includes\/|\/wordpress\//i],
  ['cms-exploit', 'Exploit de CMS',       64, /\/joomla|\/drupal|CHANGELOG\.txt|\/typo3|\/magento|\/bitrix|\/plugins\/.*\.php|\/components\/com_/i],
  ['path-scan',   'Fuzzing de caminhos',  48, /\/(backup|backups|bak|old|dump|db|database|sql|www|web|site|admin|test|dev|staging)\.(zip|tar|gz|sql|bak|rar|7z)|\.(bak|old|save|swp|orig)(\?|$)|\/\.well-known\/(?!acme)/i],
  ['proxy-abuse', 'Abuso de proxy',       72, /^https?:\/\//i],
  [' enum',       'Enumeração de rota',   30, /\/(login|signin|admin|api|graphql|\.env|actuator|metrics|debug|status|server-status)(\/|$|\?)/i],
];

const SCANNER_UA = /(sqlmap|nikto|nmap|masscan|zgrab|zmap|nuclei|acunetix|nessus|openvas|wpscan|dirbuster|gobuster|feroxbuster|hydra|medusa|fuzz|xray|goby|censys|shodan|netsystemsresearch|paloalto|expanse)/i;
const TOOL_UA = /(curl|wget|python-requests|python-urllib|go-http-client|libwww|okhttp|axios|node-fetch|java\/|guzzle|winhttp|powershell|httpclient|scrapy|aiohttp|http_request|zgrab|masscan|lua-resty)/i;
const GOOD_BOT_UA = /(googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|slurp|facebookexternalhit|twitterbot|linkedinbot|telegrambot|uptimerobot|pingdom|semrushbot|ahrefsbot|petalbot)/i;
const BROWSER_UA = /mozilla\/[\d.]+.*(chrome|safari|firefox|edg|opr|gecko|trident)/i;

function isSuspiciousStatus(status) {
  const s = Number(status) || 0;
  return s === 200 || s === 201 || s === 301 || s === 302 || s === 401 || s === 403;
}

export function classifyRequest({ path = '/', ua = '', method = 'GET', status = 0 } = {}) {
  const target = String(path || '/');
  const agent = String(ua || '');
  let category = 'benign';
  let label = 'Tráfego comum';
  let score = 0;

  for (const [cat, lbl, base, rx] of RULES) {
    if (rx.test(target)) { if (base > score) { score = base; category = cat.trim(); label = lbl; } }
  }

  const scanner = SCANNER_UA.test(agent);
  const tool = TOOL_UA.test(agent);
  const goodBot = GOOD_BOT_UA.test(agent);
  const looksBrowser = BROWSER_UA.test(agent);
  const emptyUa = !agent || agent === '-';

  if (scanner) { score = Math.max(score, 80); if (category === 'benign') { category = 'scanner'; label = 'Scanner de vulnerabilidade'; } else score += 8; }
  if (tool && !goodBot) { score += category === 'benign' ? 22 : 10; if (category === 'benign') { category = 'automation'; label = 'Cliente automatizado'; } }
  if (emptyUa) score += 12;

  const m = String(method || 'GET').toUpperCase();
  if (m === 'CONNECT') { score = Math.max(score, 72); if (category === 'benign') { category = 'proxy-abuse'; label = 'Abuso de proxy'; } }
  if ((m === 'PUT' || m === 'DELETE' || m === 'PATCH') && category !== 'benign') score += 8;
  if (m === 'POST' && /\.(php|asp|aspx|jsp|cgi)(\?|$)/i.test(target) && category !== 'benign') score += 6;

  const sensitive = ['env-leak', 'rce-shell', 'sqli', 'admin-probe', 'cms-exploit'].includes(category);
  const hit = sensitive && isSuspiciousStatus(status) && Number(status) < 400;
  if (hit) score = Math.max(score, 95);

  let isBot;
  if (goodBot || scanner || tool || emptyUa) isBot = true;
  else if (looksBrowser && category === 'benign') isBot = false;
  else if (looksBrowser) isBot = category !== 'benign' && score >= 55;
  else isBot = true;

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (category === 'benign' && score >= 40) { category = 'suspicious'; label = 'Requisição suspeita'; }

  return { score, category, label, isBot, hit };
}

// ---- classificação de CONEXÕES de rede (sensor tcpdump) ----
const SERVICES = {
  20: ['FTP-data', 40, 'ftp'], 21: ['FTP', 60, 'ftp'], 22: ['SSH', 60, 'ssh-probe'], 23: ['Telnet', 78, 'telnet'],
  25: ['SMTP', 45, 'mail'], 53: ['DNS', 15, 'dns'], 80: ['HTTP', 10, 'web'], 110: ['POP3', 40, 'mail'],
  135: ['MS-RPC', 75, 'smb'], 137: ['NetBIOS', 78, 'smb'], 139: ['NetBIOS', 80, 'smb'], 143: ['IMAP', 40, 'mail'],
  161: ['SNMP', 62, 'snmp'], 389: ['LDAP', 70, 'directory'], 443: ['HTTPS', 10, 'web'], 445: ['SMB', 88, 'smb'],
  500: ['IKE/VPN', 40, 'vpn'], 502: ['Modbus', 92, 'ics'], 587: ['SMTP', 45, 'mail'], 636: ['LDAPS', 70, 'directory'],
  1433: ['MSSQL', 86, 'database'], 1521: ['Oracle', 86, 'database'], 1723: ['PPTP', 55, 'vpn'], 1883: ['MQTT', 70, 'iot'],
  1900: ['SSDP', 40, 'iot'], 2049: ['NFS', 78, 'fileshare'], 2323: ['Telnet-IoT', 80, 'telnet'], 2375: ['Docker', 96, 'docker'],
  2376: ['Docker', 96, 'docker'], 3128: ['Proxy', 60, 'proxy'], 3306: ['MySQL', 86, 'database'], 3389: ['RDP', 90, 'rdp'],
  4444: ['Metasploit', 92, 'c2'], 5060: ['SIP', 55, 'voip'], 5432: ['PostgreSQL', 86, 'database'], 5555: ['ADB', 88, 'iot'],
  5601: ['Kibana', 80, 'database'], 5900: ['VNC', 86, 'vnc'], 5901: ['VNC', 86, 'vnc'], 6379: ['Redis', 92, 'database'],
  7547: ['TR-069', 76, 'iot'], 8080: ['HTTP-alt', 25, 'web'], 8443: ['HTTPS-alt', 25, 'web'], 8888: ['HTTP-alt', 25, 'web'],
  9000: ['Portainer', 82, 'docker'], 9200: ['Elasticsearch', 86, 'database'], 11211: ['Memcached', 82, 'cache'],
  27017: ['MongoDB', 88, 'database'], 33060: ['MySQLX', 86, 'database'],
};

export function classifyConn({ dstPort, proto = 'tcp', isScan = false } = {}) {
  const p = Number(dstPort) || 0;
  const known = SERVICES[p];
  let service, score, category;
  if (known) { [service, score, category] = known; }
  else { service = `${String(proto).toUpperCase()}/${p}`; score = p > 0 && p < 1024 ? 35 : 12; category = 'probe'; }
  let label = known ? `${service} — sondagem` : `Porta ${p || '?'}`;
  if (isScan) { score = Math.max(score, 88); category = 'port-scan'; label = 'Varredura de portas'; }
  score = Math.max(0, Math.min(100, score));
  return { service, score, category, label };
}

export function severity(score) {
  if (score >= 85) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score >= 10) return 'low';
  return 'info';
}

export default { classifyRequest, classifyConn, severity };
