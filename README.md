# 🛡️ THREATSCOPE — Threat Intel Mapping

Central de comando para uma malha de **honeypots** de ameaças. Você instala um **agente** em cada servidor que quer proteger; ele atrai e registra atividade hostil (força bruta de SSH, varredura de vulnerabilidades web e conexões de rede suspeitas). A **central (manager)** consolida tudo em tempo real: mapa mundial de ataques, feeds ao vivo, reputação de IP, bloqueio no firewall e uma API pública para outras ferramentas consultarem se um IP é malicioso.

> Use apenas em ativos próprios. É uma ferramenta defensiva.

---

## Como funciona (arquitetura)

Arquitetura **pull**: a central conecta em cada agente e busca as capturas — os agentes **não** precisam alcançar a central para reportar.

```
                        ┌──────────────────────────┐
   agente (srv A) ◄─────┤                          │
   :4000  SSH/WEB/NET   │        CENTRAL           │──► Dashboard (navegador)
                        │  (manager + coletor +    │
   agente (srv B) ◄─────┤   WebSocket + API HTTP)  │──► API pública /api/lookup
   :4000                │                          │
                        └──────────────────────────┘
```

- A central **puxa** `/agent/attempts` de cada agente registrado, a cada N ms.
- Novidades chegam ao navegador por **WebSocket** (feed ao vivo).
- Por isso a central pode ficar **atrás de um firewall / sem IP público** sem prejuízo: ela só precisa alcançar os agentes (saída), não o contrário.

### Componentes

| Pasta | O que é |
|-------|---------|
| `server/` | Central: API HTTP + WebSocket + coletor + persistência (JSON puro, sem deps nativas). |
| `client/` | Dashboard React (Vite). Mapa, feeds, gráficos, modais. |
| `agent/`  | Agente de campo: honeypot SSH + leitor de logs web + sensor de rede (tcpdump). Auto-atualizável. |

---

## Instalação

### Central

```bash
cd server
npm install
npm start
```

Sobe em `http://localhost:4000` (API + WebSocket). Em outro terminal, o dashboard:

```bash
cd client
npm install
npm run dev      # desenvolvimento
# ou
npm run build && npm run preview
```

Na primeira execução, a central **semeia a configuração** a partir do `server/.env` (se existir) e passa a guardá-la na base. Daí em diante **toda a configuração é feita pela interface** (botão ⚙️ CONFIG). O único parâmetro que continua no ambiente é o `DB_PATH` (a config mora dentro da base, então é preciso saber onde a base está antes de lê-la).

### Agentes (sensores)

**Onde baixar.** Dois caminhos, ambos entregam o pacote **já pré-configurado** (token
embutido), pronto para rodar:

- **Pela landing pública** (modo colaborativo): cadastre-se (nome/email), aguarde a
  **aprovação do admin**, faça login com seu token e baixe o sensor no modo desejado.
- **Pelo painel** (admin/operador logado): **🖥️ AGENTES → ➕ AGENTE** e escolha o modo
  (SSH, WEB, NET ou combinações).

**Pré-requisito:** Node.js 18+ no servidor que você quer proteger.

**Instalação, em 4 passos:**

```bash
# 1) descompacte o pacote baixado e entre na pasta
# 2) instale as dependências (o .npmrc incluso pula deps nativas opcionais)
npm install

# 3) suba o sensor
sudo npm start          # Linux: sudo por causa da porta 22 e do firewall
# Windows: duplo-clique em start-agent.bat (como Administrador, para a porta 22)
```

**4) Registre o IP** do servidor na central (no **seu painel**, em 🖥️ AGENTES). A central
passa a **puxar** as capturas sozinha (arquitetura *pull*) — o sensor não precisa alcançar
a central. No modo público multi-tenant, o sensor que **você** registra fica vinculado à
**sua conta**; o admin pode reatribuí-lo a outro tenant.

**Modos do sensor:**

| Modo | O que faz | Requisitos |
|------|-----------|-----------|
| **SSH** | Honeypot na porta 22: captura usuários/senhas testados por bots. | root (porta 22) |
| **WEB** | Lê os logs do nginx/apache/IIS e classifica cada requisição. Só **lê** os logs, não altera nada. | leitura dos logs (grupo `adm`/`www-data` ou sudo) |
| **NET** | Via `tcpdump`, resume conexões e detecta **port scans**. | `tcpdump` + root |

> **Firewall:** libere a porta do sensor (padrão `4000/tcp`) **apenas para o IP da central**.
> Isso é essencial no modo público — o token de coleta é compartilhado entre os sensores.

---

## Recursos

- **🔑 SSH — brute-force:** honeypot que captura usuários e senhas testados pelos bots. Feed ao vivo, agrupamento por IP, dossiê com reputação (DNSBL + AbuseIPDB opcional), WHOIS e países.
- **🌐 WEB — logs de acesso:** lê os logs do Nginx/Apache/IIS e classifica cada requisição (scanner de vulnerabilidade, RCE/webshell, força bruta de painel, vazamento de segredo…). Marca **🎯 HIT** quando um alvo sensível é atingido. Padrões legítimos podem ser silenciados.
- **🛰️ NET — sensor de rede:** via tcpdump, resume conexões que chegam (portas, serviços, **port scans**) em janelas de tempo, sem ruído.
- **🗺️ Mapa mundial:** cada agente no seu lugar; arcos de ataque partindo da origem até o agente atingido. Geolocalização por faixa /24 com cache persistente.
- **🚫 Bloqueio:** aplica regra no firewall do agente (**ufw** se ativo, senão **iptables**), por **todas as portas** ou serviços/portas específicas. Bloqueio rápido direto do feed.
- **🤖 Auto-bloqueio (opcional):** bloqueia sozinho quem passar de X tentativas de SSH, fizer port scan ou acertar alvo web. Com **allowlist** para nunca bloquear seus próprios ranges.
- **⚙️ Config na interface:** token, porta, intervalo de coleta, CORS, GeoIP, chave AbuseIPDB e disponibilidade do auto-bloqueio — tudo salvo na base, valendo ao vivo (só a porta pede reinício).
- **♻️ Auto-update dos agentes:** a central distribui novas versões do código do agente automaticamente (pull, com fallback de push).

---

## API pública de consulta (threat intel)

Pensada para **outras ferramentas** verificarem se um IP é malicioso segundo os seus honeypots. Endpoints **read-only, sem token** (CORS liberado).

### Consultar um IP

```
GET /api/lookup/<ip>
```

```bash
curl http://SUA-CENTRAL:4000/api/lookup/203.0.113.10
```

```json
{
  "ip": "203.0.113.10",
  "found": true,
  "malicious": true,
  "reason": "SSH brute-force + Web: alvo sensível atingido (Força bruta de painel)",
  "listedSince": "2026-07-01T10:12:03.000Z",
  "lastSeen": "2026-07-05T17:20:55.000Z",
  "events": 431,
  "kinds": ["ssh", "web"],
  "source": "pluggedninja-threatscope"
}
```

Se o IP nunca foi visto: `{ "ip": "...", "found": false, "malicious": false }`.

> **Privacidade:** a API pública devolve apenas **`ip`**, **`reason`** (razão) e
> **`listedSince`** (data de adesão à lista) — além de `lastSeen`/`events`. Ela
> **nunca** revela o nome do sensor que capturou, nem os usuários/senhas testados.

### Consultar em lote

```
POST /api/lookup      Content-Type: application/json
{ "ips": ["1.2.3.4", "5.6.7.8"] }        (até 200 por chamada)
```

```bash
curl -X POST http://SUA-CENTRAL:4000/api/lookup \
  -H 'Content-Type: application/json' \
  -d '{"ips":["1.2.3.4","5.6.7.8"]}'
```

Retorna `{ "results": [ {…}, {…} ] }`.

### Feed / blocklist completa

Todos os IPs vistos, para ingestão por firewalls e SIEMs:

```
GET /api/blocklist?format=txt          # um IP por linha (ideal para ipset/ufw)
GET /api/blocklist                     # JSON com ip, nº de eventos, último evento e tipos
GET /api/blocklist?minEvents=5&since=2026-07-01&kind=ssh
```

```bash
# Exemplo: alimentar um ipset a partir do feed
curl -s 'http://SUA-CENTRAL:4000/api/blocklist?format=txt&minEvents=3' \
  | while read ip; do ipset add threatscope "$ip" 2>/dev/null; done
```

> Como todo IP que aparece bateu num honeypot (tráfego não solicitado), o campo `malicious` é `true` para qualquer IP encontrado.

---

## Modo público / multi-tenant (PluggedNinja ThreatScope)

A central pode ser exposta como um **serviço público colaborativo**: qualquer pessoa se
cadastra, instala sensores e consome a lista via API — com **isolamento por conta**.

- **Landing pública** em `/` (rota `#/`) explica o projeto, tem cadastro (nome/email),
  download do agente (após aprovação), guia de instalação, docs da API e o formulário de
  **remoção de IP**. O painel/mapa fica em `#/painel` e exige login.
- **Contas por token de API** (`Authorization: Bearer tsk_...`). Cadastro cria conta
  **pendente**; o admin aprova e o token é gerado. Cada conta vê **só os seus sensores**;
  o admin vê todos e escolhe qual tenant enxerga cada sensor.
- **Endpoints públicos novos:** `POST /api/public/register` (cadastro),
  `POST /api/public/removal` (pedido de remoção de IP), `GET /api/public-info`.
- **Conta admin** é criada na 1ª execução e o **token é impresso no boot** (guarde-o).
  Localmente (sem proxy), conexões de `localhost` já agem como admin.

> 📄 Passo a passo de **teste, deploy seguro (pluggedninja) e revisão de segurança** em
> [`MULTITENANT_DEPLOY.md`](MULTITENANT_DEPLOY.md). **Importante:** ative `trustProxy`
> (ou `TRUST_PROXY=1`) antes de expor publicamente.

---

## Segurança & operação

- **Token de coleta:** defina um token forte em ⚙️ CONFIG e use o **mesmo** em todos os agentes. A central o embute automaticamente no pacote baixado.
- **Bloqueio exige `ufw`/`iptables` e root** no agente. Se o `ufw` estiver inativo, a central aplica via `iptables` (não persiste em reboot; rode `ufw enable` para persistir).
- **Persistência:** a base fica fora do projeto (`~/.threatscope/threatscope.db`, formato JSON) com escrita atômica, backup e auto-recuperação. Instalações antigas continuam em `~/.sshoney` para não perder dados.
- **API pública:** só `/api/lookup`, `/api/blocklist`, `/api/public-info`, `/api/public/register` e `/api/public/removal` são abertos (read-only/cadastro, com rate-limit). Todo o restante de `/api/*` (painel, agentes, config) exige **token de conta**; configuração da central e políticas globais são **admin-only**.
- **Multi-tenant:** cada conta só vê os próprios sensores (dados, mapa, WebSocket). A API pública nunca revela o nome do sensor — só `ip`, `reason` e `listedSince`. Veja [`MULTITENANT_DEPLOY.md`](MULTITENANT_DEPLOY.md).

---

## Estrutura de dados

Cada evento capturado tem um campo `kind`: `ssh` | `web` | `net`. A central mantém a mesma API para os três, com campos específicos por tipo (credenciais para SSH; método/caminho/status para WEB; porta/serviço/scan para NET).

---

© 2026 THREATSCOPE · Threat Intel Mapping — admin@plugged.ninja
