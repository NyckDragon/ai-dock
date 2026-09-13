# AI Dock

Dock lateral para Windows 11: **quota das IAs** numa das bordas da tela + **launcher de prompts do Obsidian**.

[![Version](https://img.shields.io/badge/version-0.2.3-0a0a0c?style=flat-square)](CHANGELOG.md)
[![Windows 11](https://img.shields.io/badge/Windows-11-0078d4?style=flat-square)](#requisitos)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-6e5aff?style=flat-square)](LICENSE)

> Sem ícone na barra de tarefas. Sempre no topo. Recolhe para um pill ou abre o painel de uso e prompts. Encerrar fica no cabeçalho e em Configurações.

## Download

Enquanto o repo for privado, o instalador sai no artifact da Action [Windows Build](../../actions/workflows/windows-build.yml).

Quando existir uma tag `v0.2.3`, o mesmo workflow publica o NSIS e o exe portátil em [Releases](../../releases).

O binário ainda **não é assinado**. O SmartScreen do Windows pode avisar na primeira abertura.

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
| **Claude** | `sessionKey` do claude.ai (Configurações) **ou** OAuth do Claude Code | Sessão interna do Claude Desktop, sozinha |

Para o Claude Web: abra claude.ai logado → F12 → Application → Cookies → `sessionKey` → cole **só no AI Dock**. O valor fica no Gerenciador de Credenciais do Windows. Nunca cole isso numa issue.

O dock **não renova** cookie nem token. Se o % sumir, cole um sessionKey novo.

## Requisitos

- Windows 11
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)
- Para desenvolver: Node.js 22+, Rust stable, [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/)

## Rodar no Windows

```bash
npm install
npm run tauri:dev
```

```bash
npm run tauri:build
```

## Prompts do Obsidian

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

- Credenciais de Claude Code e Codex são **só lidas** no disco.
- O `sessionKey` do Claude Web vai para o Credential Manager. Nunca para o GitHub.
- O AI Dock não extrai cookie do Chrome/Edge sozinho.

[SECURITY.md](SECURITY.md) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Abrir o repositório

Antes de tornar público, no GitHub: **Settings → General → About**

- Description: `Windows 11 dock for Claude, Codex and Antigravity usage plus Obsidian prompts`
- Topics: `tauri` `rust` `react` `windows-11` `claude` `obsidian` `ai-usage`
- Homepage: deixe vazio até existir site

Depois: Settings → Change repository visibility → Public.

## Projetos próximos

[CodexBar](https://github.com/steipete/CodexBar), [UsageDeck](https://github.com/CallMeLewis/UsageDeck). O AI Dock não inclui código deles.

## Changelog

[CHANGELOG.md](CHANGELOG.md)
