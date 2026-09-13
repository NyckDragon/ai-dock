# Changelog

All notable changes to AI Dock are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
