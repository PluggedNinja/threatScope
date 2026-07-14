# PluggedNinja ThreatScope — modo público multi-tenant

Este documento resume as mudanças feitas para transformar a central em um serviço
**público e colaborativo**: qualquer pessoa pode se cadastrar, instalar sensores e
consumir a lista de IPs maliciosos via API — com **isolamento por conta (tenant)**,
**landing page pública** e **página de remoção de IP**.

> ⚠️ **Antes de tudo:** rode os testes da seção *Como testar* e só então reinicie a
> central de produção. Enquanto a central antiga estiver rodando, ela continua com o
> código antigo (Node não recarrega sozinho) — nada quebra até você reiniciar.

---

## O que mudou

### Backend
- **`server/db.js`**
  - Novas coleções persistidas: `users` (contas) e `removalRequests` (pedidos de remoção). O campo `owner` foi adicionado a cada sensor (a qual tenant ele pertence).
  - Contas/tokens: `registerUser`, `approveUser`, `findUserByToken`, `regenUserToken`, `setUserDisabled`, `deleteUser`, `seedAdmin`, `agentsForOwner`, `tagsForOwner`.
  - Remoção de IP: `createRemovalRequest`, `listRemovalRequests`, `resolveRemovalRequest`, `purgeIp`.
  - API pública com privacidade: `publicThreatFeed` e `publicLookup` — expõem **apenas `ip`, `reason` (razão) e `listedSince` (data de adesão)**, além de `lastSeen`/`events`. **Nunca** o nome do sensor nem credenciais.
  - Escopo multi-tenant no filtro central (`matches`): novo predicado `q.agents` (lista de sensores permitidos). Isso escopa SSH, WEB e NET de uma vez.
  - Config nova: `trustProxy` e `localhostAdmin`.
- **`server/api.js`**
  - **Autenticação por token de conta**: header `Authorization: Bearer <token>` (ou `X-Account-Token`, ou `?token=` para downloads/links). Gate global: tudo em `/api/*` exige conta aprovada, exceto as rotas públicas.
  - **Rotas públicas** (sem token): `/api/health`, `/api/public-info`, `/api/blocklist`, `/api/lookup[...]`, `/api/public/register`, `/api/public/removal`, `/api/agent-source` (o agente se autentica com o INGEST_TOKEN).
  - **Escopo por tenant**: cada usuário vê só os dados dos **seus** sensores (mapa, feeds, dossiê de IP, bloqueios, WebSocket). O **admin** vê tudo e pode escolher um tenant com `?tenant=<id>`.
  - **Guardas de dono**: gerenciar/bloquear um sensor exige ser o dono (ou admin).
  - **Admin-only**: `/api/config` (expõe o INGEST_TOKEN!), `/api/autoblock*`, mutações de `/api/geo-cache`, `DELETE /api/attempts`, e todo `/api/admin/*`.
  - **Novos endpoints**: `/api/me`, `/api/public/register`, `/api/public/removal`, `/api/public-info`, `/api/admin/users`, `/api/admin/tenants`, `/api/admin/users/:id/{approve,disable,regen-token}`, `DELETE /api/admin/users/:id`, `/api/admin/agents/:id/owner`, `/api/admin/removals`, `/api/admin/removals/:id/resolve`.
  - **Segurança**: rate-limit em memória nas rotas públicas; headers `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `x-powered-by` desligado; `trust proxy` quando atrás de proxy.
- **`server/index.js`**
  - Semeia a **conta admin** na 1ª execução e **imprime o token** no boot (guarde-o!).
  - **WebSocket com escopo**: cada conexão só recebe eventos dos seus sensores (token na query). Admin recebe tudo.
  - **Serve o cliente compilado** (`client/dist`) na mesma origem, se existir — deploy público com um proxy só.
  - Avisos de segurança no boot (ver abaixo).

### Frontend
- **`client/src/api.js`**: token de conta no header + `?token=` em downloads; `?tenant=` do admin; downloads autenticados; novos métodos (conta/admin); WebSocket com token.
- **`client/src/components/Landing.jsx`** + **`landing.css`**: landing pública (o que é, como ajuda, lógica detecção→banimento→lista→API, cadastro, download pós-aprovação, guia de instalação, remoção de IP, docs da API).
- **`LoginModal.jsx`**, **`AdminPanel.jsx`**, **`AccountModal.jsx`**: login por token, painel do admin (contas, remoções, atribuição sensor→tenant) e "minha conta" (token).
- **`App.jsx`**: rota por hash (`#/` landing pública, `#/painel` painel gated), seletor de tenant (admin), botões de conta/admin/sair.

---

## Como testar (faça isto ANTES de reiniciar produção)

No Windows, na pasta do projeto:

```bat
:: 1) Sintaxe do backend (deve passar sem erros)
cd server
node --check db.js && node --check api.js && node --check index.js && echo BACKEND_OK

:: 2) Build do cliente (deve terminar sem erros)
cd ..\client
npm install
npm run build

:: 3) Suba a central e ANOTE o token de admin impresso no boot
cd ..\server
npm start
```

No boot você verá um bloco roxo com o **token de admin** (`tsk_...`). Guarde-o.

Testes rápidos de fumaça (outro terminal), trocando `PORTA` (padrão 4000):

```bat
:: público — sem token
curl http://localhost:PORTA/api/blocklist
curl http://localhost:PORTA/api/public-info
:: deve ter reason/listedSince e NÃO ter nome de sensor

:: protegido — sem token deve dar 401 (a menos que venha de localhost; veja segurança)
curl http://localhost:PORTA/api/agents

:: com o token de admin
curl -H "Authorization: Bearer SEU_TOKEN_ADMIN" http://localhost:PORTA/api/me
```

No navegador: abra o painel, `#/` mostra a landing; clique **Entrar** e cole o token
de admin; o painel abre. Cadastre uma conta de teste pela landing, aprove no **👑 ADMIN**,
copie o token gerado e logue com ele em uma aba anônima — deve ver só os sensores
atribuídos a ela.

> Testes automatizados da lógica (contas, isolamento por tenant, privacidade da API
> pública, rate-limit, guardas de dono) foram executados e passaram durante o
> desenvolvimento. O `node --check` + `npm run build` acima cobrem a integração final.

---

## Deploy público seguro (pluggedninja)

1. **Compile o cliente**: `cd client && npm run build`. A central passa a servir tudo
   (landing + painel + API) na porta dela — uma única origem.
2. **🔴 ATIVE `trustProxy`** antes de expor. Duas formas:
   - variável de ambiente ao subir a central: `TRUST_PROXY=1`
   - ou no painel do admin → ⚙️ CONFIG (campo trustProxy), se preferir.
3. **Aponte o pluggedninja** (proxy reverso HTTPS) para a porta da central, encaminhando
   `/`, `/api` e **`/ws`** (WebSocket precisa de upgrade de conexão).
4. **Firewall dos sensores**: cada agente escuta em `:4000` — libere essa porta
   **apenas para o IP da central**.

### Por que `trustProxy` é obrigatório
Para conveniência local, **conexões de localhost agem como admin** (você usa o painel
sem token na sua máquina). Um proxy reverso normalmente fala com a central por
`localhost` — então, **sem `trustProxy`, qualquer visitante do site viraria admin**.
Com `trustProxy` ligado, esse atalho é desligado e o `req.ip` passa a ser o IP real do
visitante (também necessário para o rate-limit funcionar por IP). A central avisa disso
no boot em vermelho.

---

## Revisão de segurança — resumo

**Corrigido/implementado**
- Isolamento por tenant em dados, dossiês, bloqueios e WebSocket (o cliente não consegue forjar `?agents`).
- Segredo da central (`INGEST_TOKEN` via `/api/config`) e políticas globais são **admin-only**.
- API pública não vaza nome de sensor nem credenciais (só ip/razão/data de adesão).
- Cadastro não permite auto-aprovação nem auto-promoção a admin (papel e `approved` são forçados no servidor).
- Tokens opacos (`crypto.randomBytes`), rate-limit nas rotas públicas, headers de segurança, `x-powered-by` off.
- Download de sensores só para contas **aprovadas**.

**Limitações conhecidas / recomendações**
- **INGEST_TOKEN é compartilhado** entre todos os sensores (é o que a central usa para
  falar com os agentes). Num cenário público, mantenha **cada agente com o firewall
  restrito ao IP da central**. Isolamento por token *por tenant* nos agentes seria uma
  evolução futura (mudança maior no protocolo central↔agente).
- **`?token=` em URLs** (usado em downloads e links do painel) pode aparecer em logs de
  proxy. Prefira o header `Authorization` sempre que possível; o `?token=` existe porque
  `window.open` não envia headers.
- Rate-limit é **em memória** (por processo). Se rodar múltiplas instâncias, use um
  limite no proxy também.
- Revise o `README.md`: a seção da API pública descrevia os campos antigos
  (`agents`, credenciais). Agora a resposta traz `reason` e `listedSince` e **não** traz
  sensores. (Não reescrevi o README para não misturar; recomendo atualizar.)

---

## Rollback
As mudanças são aditivas e a base de dados ganha campos novos sem apagar nada. Se
precisar voltar, restaure as versões anteriores de `server/db.js`, `server/api.js`,
`server/index.js`, `client/src/api.js`, `client/src/App.jsx` e remova os componentes
novos (`Landing.jsx`, `LoginModal.jsx`, `AdminPanel.jsx`, `AccountModal.jsx`, `landing.css`).
Os dados coletados (`~/.threatscope/…`) não são afetados.
```
