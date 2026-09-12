# AI Dock

Dock lateral para Windows 11 que combina **uso de IAs** e **launcher de prompts do Obsidian**.

## MVP 0.1

- Dock fixo na lateral direita ou esquerda.
- Modo compacto e painel expansível.
- Uso real do Claude Code via OAuth local (`~/.claude/.credentials.json`).
- Uso real do Codex via OAuth local (`~/.codex/auth.json` / `CODEX_HOME`).
- Leitura de `five_hour` / `seven_day` (Claude).
- Leitura de `primary_window` / `secondary_window` (Codex).
- Seleção de Vault ou subpasta do Obsidian.
- Busca de prompts Markdown.
- Um clique para copiar o corpo do prompt.
- Frontmatter opcional: `title`, `category`, `tags`, `favorite`.
- Credenciais são **somente lidas localmente** e nunca gravadas, exibidas ou persistidas pelo AI Dock.

## Stack

- Tauri 2
- React + TypeScript + Vite
- Rust

## Frontmatter recomendado

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

## Rodar no Windows

Pré-requisitos: Node.js, Rust e os requisitos do Tauri 2 para Windows/WebView2.

```bash
npm install
npm run tauri:dev
```

Para gerar instalador:

```bash
npm run tauri:build
```

## Segurança do MVP

O AI Dock não implementa refresh de token e não altera arquivos de autenticação de Claude/Codex. Se a sessão estiver expirada, o app informa para autenticar novamente pela CLI oficial.
