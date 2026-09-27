# Changelog

All notable changes to AI Dock are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-09-27

### Added

- **Aba Custos:** tokens e custo estimado na API das sessões do Claude Code e do Codex CLI, lidos dos logs locais, por dia (Hoje, 7 e 30 dias), ferramenta, modelo e projeto. Preços da tabela pública do LiteLLM, baixada no máximo uma vez por dia e guardada em cache. Modelos sem preço contam só em tokens e aparecem com `+`.
- **Status dos serviços:** incidentes das páginas de status oficiais do Claude, da OpenAI (Codex) e do Cursor aparecem no dock (ponto no ícone), no peek e no card, com botão "Ver status".
- **Plano real do Claude:** Max 5x, Max 20x, Pro, Team, Enterprise ou Free, pelo claude.ai ou pelo login do Claude Code.
- **Notificações novas:** instabilidade no serviço, provider que falhou 3 vezes seguidas e quando ele volta.
- **Pausar notificações** por 30 min, 1h, 2h, 4h ou até amanhã, em Configurações → Geral ou por 1h no menu da bandeja.
- **Histórico de 7 e 30 dias** no gráfico do card (Configurações → Aparência). O histórico guarda 30 dias: detalhe completo nas últimas 24h e um ponto por hora antes disso. Em períodos longos o gráfico agrupa os pontos e mantém os picos.
- **Interface em inglês**, com opção Automático, Português ou English em Configurações → Aparência. Mensagens do backend e rótulos das janelas também são traduzidos. O menu da bandeja segue o idioma.
- Testes de cobertura das traduções, dos custos e do histórico (38 de frontend, 38 em Rust).

### Changed

- README em inglês com versão em português, screenshots, tabela de providers, privacidade (todas as conexões de rede), projetos relacionados e aviso de não afiliação.
- SECURITY.md lista as leituras e conexões novas e indica o reporte privado de vulnerabilidades do GitHub.
- A release publicada pelo CI usa a seção da versão no CHANGELOG como notas.
- Dependabot mensal e agrupado para npm, Cargo e GitHub Actions.
- O gráfico do card usa a mesma escala do número grande (usado ou restante).
- LICENSE e Cargo.toml usam o nome de usuário do GitHub.

## [0.6.1] - 2026-09-27

### Fixed

- O dock às vezes ficava coberto por outro app que também fica sempre no topo. O Tauri ignora o pedido de "sempre no topo" quando a opção já está ligada, então o dock nunca voltava para cima. Agora ele se reposiciona no topo da camada a cada 2,5 s pela API do Windows, sem mover a janela nem roubar o foco.

## [0.6.0] - 2026-09-26

Inclui o trabalho do branch `fix/v0.4.2-auto-refresh`, que nunca tinha chegado ao `main`.

### Added

- **Entrar com claude.ai**: login do Claude numa janela do AI Dock, sem F12 nem copiar cookie. A sessão é capturada, testada e salva sozinha.
- Renovação automática da sessão do Claude: guarda cookies rotacionados pelo claude.ai e, quando a sessão falha, reabre o claude.ai escondido (no máximo a cada 20 min) para o site renovar sessão e Cloudflare antes de pedir login.
- Notificação quando a sessão do Claude expira de verdade, com botão "Reconectar" no card.
- Requests ao claude.ai usam o mesmo user agent do WebView2, que o Cloudflare exige para aceitar o `cf_clearance`.
- Claude Web aceita o Cookie completo ou a tabela de cookies do DevTools (do 0.4.2).
- Última leitura boa de cada provider fica salva e aparece como **desatualizada** quando uma atualização falha, inclusive ao abrir o app (do 0.4.2).
- Atualização logo após um reset conhecido, ao voltar o foco para o dock e quando a internet volta (do 0.4.2).
- Hover num provider com dado de mais de 1 min atualiza em segundo plano (do 0.4.2).
- Opção de atualizar a cada 1 min.
- Percentual "Como no app": o Claude mostra **% usado**, como no claude.ai, e os outros **% restante**. Passa a ser o padrão (do 0.4.2).
- Testes: 23 de frontend (cookie do Claude, exibição, ritmo, variáveis de prompt, snapshots, versão) e 25 em Rust (Claude Web, Cloudflare, rotação de cookie, Antigravity, Obsidian, helpers).
- CI roda os testes antes do build, valida PRs para o `main` e publica releases num job separado (do 0.4.2).
- Template de pull request (do 0.4.2).

### Fixed

- Antigravity: o grupo em uso (ex.: Claude + GPT) mostrava números antigos, porque o language server devolve o resumo de quota em cache. O dock agora pede `forceRefresh`, como o CodexBar, e volta ao pedido antigo se o servidor recusar.
- Antigravity: `remainingFraction` também é lido no formato oneof `{ case, value }` do protobuf.

### Changed

- Desafio do Cloudflare não é mais tratado como sessão expirada: entra em cooldown de 5 min e mantém a última leitura (do 0.4.2).
- 401 transitório tem uma nova tentativa antes de ser considerado expiração (do 0.4.2).
- Contas com mais de uma organização testam todas antes de falhar (do 0.4.2).
- "Remover sessão" virou "Sair" e também apaga os cookies do claude.ai do perfil do AI Dock.
- O dock destaca a **sessão atual (5h)** em vez da janela que mais limita. Dá para voltar ao comportamento antigo em Configurações → Aparência → Em destaque.
- CI: PRs rodam só os testes rápidos em Linux; o build de Windows roda no `main`, em tags e sob demanda. Juntar uma versão nova ao `main` publica a release sozinho.

### Security

- Cookie do Claude só no Gerenciador de Credenciais; o fallback em texto no AppData é migrado e apagado (do 0.4.2).
- A janela do claude.ai não tem capability do Tauri, então scripts do site não chamam comandos do AI Dock.
- CI com `contents: read`; permissão de escrita só no job de release em tags `v*` (do 0.4.2).

## [0.5.0] - 2026-09-26

### Added

- Atualização automática do uso (2, 5, 10 ou 15 min). Se um provider limitar a consulta, o intervalo dobra até 4x e volta ao normal sozinho.
- "Atualizado há X min" no cabeçalho e no peek, com aviso quando o dado fica velho.
- Indicador de ritmo por janela de uso: "No ritmo", "X% acima do ritmo" ou "Esgota em 2h 10min".
- Mini-gráfico das últimas 24h da janela que mais limita cada provider.
- Notificações do Windows: quota passando de 80% e 95% de uso, limite renovado e agente esperando você.
- Atalho global `Ctrl + Alt + Espaço` que abre a busca de prompts de qualquer app. Depois de copiar, o foco volta para o app anterior.
- Opção "Colar direto no app anterior".
- Variáveis em prompts: `{{nome}}` e `{{nome|padrão}}` pedem os valores antes de copiar.
- Biblioteca de prompts com filtros (Favoritos, Recentes, categorias), prévia do texto, contador, "Mostrar mais", navegação por teclado e ordenação pelos mais usados.
- A pasta do Obsidian é relida ao abrir o painel e a cada 3 min com ele aberto.
- Menu na bandeja (Abrir painel, Atualizar uso, Configurações, Encerrar) e tooltip com a quota de cada provider.
- Iniciar com o Windows.
- Ocultar automaticamente: o dock vira uma faixa fina na borda e aparece no hover. A faixa usa a cor da pior quota e pulsa quando um agente espera você.
- Esconder o dock durante jogos, vídeos e apresentações em tela cheia.
- Ajuste da altura do dock na borda.
- Mostrar, ocultar e reordenar providers.
- Mostrar o percentual como "quanto resta" ou "quanto já usei".
- Tema claro, escuro ou do sistema.
- Introdução de 3 passos na primeira execução.
- Esc recolhe o painel, e clicar fora também (configurável).
- Clicar num provider no dock ou no peek abre o painel já nele.

### Changed

- Novo sistema visual com tokens de cor, fonte Segoe UI Variable, números tabulares e texto de no mínimo 11px.
- Barras e números usam a cor da quota (verde, âmbar, vermelho) em todo lugar, não só no anel do dock.
- Reset sempre relativo ("Reseta em 2h 10min"), com a data exata no tooltip.
- Modo padrão do dock para instalações novas: Círculo (anel + %). No modo Clássico o ponto agora mostra a cor da quota.
- O indicador de "trabalhando" contorna a borda do ícone em vez de girar a forma.
- O peek abre alinhado ao ícone sob o mouse, rola quando o conteúdo é grande e o pill não se mexe mais ao abrir.
- O cabeçalho do painel ficou com 3 botões. Encerrar foi para Configurações → Geral e para a bandeja.
- Configurações em abas: Aparência (com prévia ao vivo do dock), Posição, Geral e Conexões.
- Passo a passo para obter o sessionKey do Claude.
- A consulta de atividade cai de 3s para 8s quando nada está rodando e o painel está fechado.
- Textos da interface todos em português ("Sob demanda", "Ilimitado").

### Fixed

- "Validando…" não aparecia e dava para enviar o sessionKey várias vezes.
- Mensagens antigas de erro e de sucesso ficavam na tela ao mesmo tempo.
- O peek dizia "Atualizado agora" mesmo com dados antigos.
- A busca de prompts cortava em 30 resultados sem avisar.
- O peek podia cortar o conteúdo de providers com muitas janelas.

### Security

- CSP definida para o app empacotado.
- O `boot.log` só é gravado em builds de desenvolvimento.

### Removed

- Código morto: o provider Antigravity v1, `DockFit.tsx` e CSS sem uso.

## [0.4.1] - 2026-09-20

### Fixed

- Remove duplicação do tray: o ícone agora é criado somente pelo backend Rust.
- AI Dock passa a permitir apenas uma instância; abrir o executável novamente traz a instância existente para frente.
- Janela principal deixa de aparecer na taskbar e permanece acessível pelo tray.
- Hover/peek agora expande a janela nativa antes de renderizar o card, evitando flash, clipping e efeito de clone no primeiro hover.
- Fechamento do peek anima antes de encolher a janela.
- Troca entre providers mantém a janela aberta, evitando resize repetido.

### Changed

- Slots e rings do modo compacto ganharam transições de hover mais suaves.
- Peek ganhou animação de entrada/saída com opacity, scale, slide e blur leve.

## [0.4.0] - 2026-09-20

### Added

- Cursor como provider de quota, reutilizando a sessão já autenticada no editor.
- Leitura de uso do Cursor via `https://cursor.com/api/usage-summary`.
- Activity Monitor direto do Cursor via `composerHeaders` em `state.vscdb`.
- Detecção de várias tarefas simultâneas do Cursor.
- Estados `working`, `waiting` e `idle` para Cursor.
- Logo real do Cursor no dock e nos cards.
- Peek mostra contagem quando existem múltiplas tarefas ativas.

### Security

- SQLite do Cursor é aberto em modo somente leitura.
- Credenciais do Cursor existem apenas em memória durante a consulta e não são persistidas, exibidas nem registradas pelo AI Dock.
- Fallback `immutable=1` é usado apenas quando necessário para leitura segura do banco local.

### Validation

- Windows Build passou com TypeScript, Vite, Rust, rusqlite, Tauri, NSIS e Portable EXE.
- Smoke test com uma instalação real do Cursor permanece separado do CI e deve confirmar quota e activity no PC do usuário.

## [0.3.0] - 2026-09-19

### Added

- Logos reais dos providers no dock compacto.
- Peek no hover com quota, reset, plano e estado de conexão sem abrir o painel completo.
- Activity Monitor local para Codex e Antigravity.
- Codex Desktop lê turns ativos do SQLite local; CLI/extensão usa fallback por rollout recente.
- Antigravity detecta atividade por transcript local recente e marca a leitura como estimada.
- Estado visual no ring: arco em movimento quando está trabalhando e pulso âmbar quando espera ação.

### Changed

- Antigravity continua separado em Gemini e Claude + GPT no compacto.
- O dock pode ampliar temporariamente a janela transparente para o peek sem alterar o painel expandido.
- Versões frontend, Rust e bundle alinhadas em 0.3.0.

## [0.2.3] - 2026-09-13

### Added

- Configurações → Claude: colar `sessionKey` do claude.ai, validar e guardar no Credential Manager.
- Card do Claude usa Claude Web quando o OAuth do Claude Code não existe.
- Botão Encerrar no cabeçalho e nas configurações (mata o processo).

### Changed

- Claude Code ficou como opção avançada nas configurações.

### Known issues

- `sessionKey` é sessão não oficial; a Anthropic pode recusar o cookie sem aviso.
- Antigravity no compacto ainda mistura os dois pools num número só.
- Sem ícone na bandeja e sem iniciar com o Windows.

## [0.2.2] - 2026-09-13

### Added

- Backend for Claude Web (`sessionKey` no Credencial Manager do Windows).
- Documentação de produto no README.

### Changed

- Versão única do app em `package.json`, `tauri.conf.json` e `Cargo.toml`.

## [0.2.1] - 2026-09-13

### Added

- Instalação one-click do Claude Code pelas Configurações (via npm).
- Fluxo Conectar / Verificar conexão do Claude Code.

### Fixed

- Leitura da quota do Antigravity no Windows (provider v2, app instalado + language server).
- Resize do dock serializado entre estados compacto/expandido.

## [0.2.0] - 2026-09-13

### Added

- Modos compactos: padrão, só %, anel, anel + %.
- Provider Antigravity (quota local Gemini / Claude+GPT).

## [0.1.0] - 2026-09-12

### Added

- Dock lateral Windows 11 (Tauri 2).
- Uso de Claude Code e Codex a partir dos arquivos OAuth locais.
- Launcher de prompts Markdown do Obsidian.
