# Changelog

All notable changes to AI Dock are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
