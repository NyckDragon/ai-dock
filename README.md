# AI Dock

Dock lateral para Windows 11: **quota das IAs** numa das bordas da tela + **launcher de prompts do Obsidian**.

[![Version](https://img.shields.io/badge/version-0.2.2-0a0a0c?style=flat-square)](CHANGELOG.md)
[![Windows 11](https://img.shields.io/badge/Windows-11-0078d4?style=flat-square)](#requisitos)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-6e5aff?style=flat-square)](LICENSE)

> Sem ícone na barra de tarefas. Sempre no topo. Recolhe para um pill ou abre o painel de uso e prompts.

## O que faz

- Fica fixo na **direita ou esquerda**, na tela que você escolher.
- Modo compacto: ícone, só %, anel de quota ou anel + %.
- Painel expandido com as janelas 5h / semanal de cada provider.
- Copia prompts Markdown do Vault do Obsidian num clique.

## Providers

| App | O que o dock lê | O que **não** lê |
| --- | --- | --- |
| **Codex** | `~/.codex/auth.json` (ou `CODEX_HOME`) e a API de uso da sessão | — |
| **Antigravity** | Language server local do app instalado | Conta Google na web |
| **Claude** | OAuth do **Claude Code CLI** em `%USERPROFILE%\.claude\.credentials.json` | Claude Desktop e claude.ai. São sessões diferentes. |

Claude só mostra % se o **Claude Code** estiver autenticado (`claude` + `/login`). Ter o Claude Desktop aberto não basta.

O dock **não renova token**. Se o access token da CLI expirou, reconecte pelo próprio Claude Code e clique em Atualizar.

## Requisitos

- Windows 11
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows 11 atualizado)
- Para **desenvolver**: Node.js 22+, Rust stable, requisitos do [Tauri 2 no Windows](https://v2.tauri.app/start/prerequisites/)

## Instalar / rodar

O workflow [Windows Build](.github/workflows/windows-build.yml) gera o instalador NSIS e um exe portátil a cada push na `main`. Baixe o artifact da Action mais recente enquanto não houver GitHub Release.

Desenvolvimento:

```bash
npm install
npm run tauri:dev
```

Instalador local:

```bash
npm run tauri:build
```

## Prompts do Obsidian

Selecione o Vault ou uma subpasta. Arquivos `.md` com frontmatter opcional:

```md
---
title: Editorial Campaign
category: Imagem
tags:
  - nano-banana
  - campanha
favorite: true
---

Crie uma campanha editorial...
```

## Stack

Tauri 2 · React + TypeScript + Vite · Rust

## Segurança

- Credenciais de Claude Code e Codex são **só lidas** no disco. O AI Dock não grava, não exibe e não envia esses arquivos para um servidor próprio.
- Não há refresh de OAuth nesta versão.
- O módulo Claude Web (`sessionKey`) existe no backend e ainda não está ligado na interface.

Notas de terceiros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Changelog

Ver [CHANGELOG.md](CHANGELOG.md).
