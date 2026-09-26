# Changelog

All notable changes to AI Dock are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
