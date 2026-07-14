# Política de Segurança — ThreatScope

O ThreatScope é uma ferramenta **defensiva**. Use-a apenas em ativos próprios.

## Reportar uma vulnerabilidade

Se você encontrar uma falha de segurança, **não abra uma issue pública**. Envie os
detalhes para **admin@plugged.ninja** com:

- descrição do problema e impacto;
- passos para reproduzir (PoC, se possível);
- versão/commit afetado.

Você receberá uma confirmação e trabalharemos numa correção. Divulgação coordenada:
por favor dê um prazo razoável antes de tornar o problema público.

## Boas práticas ao operar (deploy público)

- **Auto-update do agente é DESLIGADO por padrão** (`AUTO_UPDATE=0`). A rota
  `/agent/update` grava e executa código; só habilite se confiar na central **e**
  liberar a porta do agente (padrão `4000/tcp`) **apenas** para o IP da central.
- **Atrás de proxy reverso:** ative `TRUST_PROXY=1`. O bypass "localhost = admin"
  vem **desligado por padrão** (`localhostAdmin=false`); só ligue em uso local de
  confiança.
- **Token de coleta (`INGEST_TOKEN`):** use um token forte e único. Nunca versione
  arquivos `.env`, `host.key`, bases (`*.db`/`data/`) — já cobertos pelo `.gitignore`.
- **Firewall:** exponha publicamente apenas as rotas read-only de consulta
  (`/api/lookup`, `/api/blocklist`, `/api/public-info`); o painel exige token de conta.
- **Sensores por IP público:** contas não-admin só podem registrar sensores em IPs
  públicos (proteção anti-SSRF). Sensores internos devem ser registrados pelo admin.

## Escopo — o que este projeto NÃO faz

O ThreatScope é **passivo**: coleta e classifica atividade hostil que chega aos seus
servidores. Ele **não** testa credenciais capturadas contra terceiros nem realiza
qualquer acesso a sistemas de outrem — isso seria acesso não autorizado e ilegal em
muitas jurisdições.
