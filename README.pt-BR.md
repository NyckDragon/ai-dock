# AI Dock

Dock lateral para Windows 11, com beta no macOS, que mostra **quanto resta da quota das IAs** (Claude, Codex, Cursor e Antigravity), o que seus agentes estão fazendo, quanto esse uso custaria na API e a sua **biblioteca de prompts do Obsidian**, a um hover de distância.

[![Versão](https://img.shields.io/badge/vers%C3%A3o-0.7.0-0a0a0c?style=flat-square)](CHANGELOG.md)
[![Windows 11](https://img.shields.io/badge/Windows-11-0078d4?style=flat-square)](#download)
[![macOS beta](https://img.shields.io/badge/macOS-beta-999999?style=flat-square)](https://github.com/NyckDragon/ai-dock/releases/tag/macos-beta.1)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square)](https://tauri.app)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-6e5aff?style=flat-square)](LICENSE)

[English](README.md) · **Português**

<p>
  <img src="docs/screenshots/dock-peek.png" alt="Dock recolhido na borda da tela com o peek do Codex aberto" width="280">
  <img src="docs/screenshots/usage.png" alt="Painel de uso com janelas de sessão e semanal, ritmo e um incidente de status" width="250">
  <img src="docs/screenshots/costs.png" alt="Aba Custos com 30 dias de custo estimado por dia, ferramenta e modelo" width="250">
</p>

## Download

### Windows 11

Baixe o instalador (NSIS) ou o `.exe` portátil em [Releases](../../releases).

O binário **ainda não é assinado**, então o SmartScreen do Windows pode avisar na primeira abertura (Mais informações → Executar assim mesmo).

### macOS em teste

Só Apple Silicon. [Baixe o .dmg](https://github.com/NyckDragon/ai-dock/releases/download/macos-beta.1/AI-Dock-macOS-beta-aarch64.dmg). Ele também está no [pré-release](https://github.com/NyckDragon/ai-dock/releases/tag/macos-beta.1), separado do release 0.7.0 de Windows.

O app não é assinado nem notarizado. O Gatekeeper avisa na primeira abertura: clique com o botão direito em AI Dock → Abrir.

Testadores são bem-vindos. Abra uma [issue](https://github.com/NyckDragon/ai-dock/issues) com o que quebrou: borda esquerda e direita, dois monitores, troca de Space, bandeja, atalho, iniciar ao entrar, a cota dos quatro provedores, sumir em tela cheia, o dock voltar para a frente, e colar depois de permitir Acessibilidade. Não há binário Intel.

## O que faz

- **Sempre no topo, sem atrapalhar.** Fica na borda esquerda ou direita de qualquer tela, na altura que você escolher. Sem ícone na barra de tarefas. Pode se ocultar numa faixa fina e some durante apps em tela cheia.
- **Quota num olhar.** Quatro visuais recolhidos (círculo, quadrado, números, clássico) com a cor de quanto resta. Passe o mouse num provider para ver todas as janelas, o reset e o plano.
- **Ritmo.** "Esgota em 2h 10min" ou "19% abaixo do ritmo" em cada janela, e um gráfico das últimas 24 horas, 7 ou 30 dias.
- **Nome real do plano**, como Claude Max 5x ou Max 20x, quando o provider informa.
- **Status dos serviços.** Incidentes das páginas de status oficiais do Claude, da OpenAI (Codex) e do Cursor aparecem no dock e nos cards, com link para a página.
- **Custos locais.** Tokens e custo estimado na API das suas sessões do Claude Code e do Codex CLI, por dia, ferramenta, modelo e projeto, lidos dos logs locais.
- **Atividade dos agentes.** Veja quando Codex, Cursor ou Antigravity estão trabalhando e receba uma notificação quando um agente espera você.
- **Notificações** de quota baixa (80% e 95% de uso), limite renovado, instabilidade no serviço e provider que parou de atualizar (e quando volta). Pause de 30 min até "amanhã" em Configurações ou na bandeja.
- **Prompts do Obsidian.** Busca, favoritos, recentes, `{{variáveis}}` preenchidas antes de copiar, atalho global **Ctrl + Alt + Espaço** e opção de colar direto no app em que você estava.
- Interface em português e inglês; tema claro, escuro ou do sistema; iniciar com o Windows.

## Providers

| Provider | O que o AI Dock lê | O que **não** lê |
| --- | --- | --- |
| **Claude** | O login OAuth local do Claude Code **ou** a sessão do claude.ai em que você entra dentro do AI Dock (ou um cookie colado à mão) | Cookies do Chrome/Edge, sessão interna do Claude Desktop |
| **Codex** | `~/.codex/auth.json` (ou `CODEX_HOME`) e o endpoint de uso do ChatGPT | — |
| **Cursor** | O estado logado do editor em `%APPDATA%\Cursor\User\globalStorage\state.vscdb` (só leitura) e `cursor.com/api/usage-summary` | Senha da conta ou navegador |
| **Antigravity** | O language server local do app instalado | Sua conta Google na web |

### Conectar o Claude

Em **Configurações → Conexões → Entrar com claude.ai**, o AI Dock abre a página de login do próprio claude.ai numa janela dele. Entre (use e-mail se o Google recusar a janela embutida) e a janela fecha sozinha.

Depois disso o AI Dock **renova a sessão sozinho**: guarda os cookies que o claude.ai rotaciona e, quando a sessão para de funcionar, reabre o claude.ai escondido por alguns segundos (no máximo a cada 20 min) para o site renovar. Só pede login de novo, com uma notificação, quando o claude.ai realmente te desloga. Um desafio do Cloudflare não conta como sessão expirada: a última leitura continua visível e marcada como antiga.

Alternativa manual: DevTools do claude.ai → Application → Cookies → copie a tabela inteira (ou o cabeçalho `Cookie`) e cole em **Colar o cookie manualmente**. Nunca cole isso numa issue.

### Custos

A aba **Custos** lê os logs JSONL que o Claude Code (`~/.claude/projects`) e o Codex CLI (`~/.codex/sessions`) já gravam no seu PC e calcula o preço de cada modelo pela [tabela pública do LiteLLM](https://github.com/BerriAI/litellm). Assinaturas não cobram por token, então o número é **quanto esse uso custaria na API**, não o que você paga. Modelos que não estão na tabela contam só em tokens e aparecem com `+`.

## Privacidade

O AI Dock não tem servidor, conta nem telemetria. Tudo roda no seu PC.

- As credenciais do Claude Code, do Codex e do Cursor são **só lidas**, nunca copiadas. A sessão do Cursor fica em memória durante a consulta.
- O cookie do Claude Web fica no **Gerenciador de Credenciais do Windows**. No beta do macOS, os mesmos valores vão para o **Keychain** de login. Só `sessionKey`, `cf_clearance`, `__cf_bm` e `anthropic-device-id` são guardados.
- A janela do claude.ai é conteúdo remoto, sem acesso aos comandos do AI Dock.
- O AI Dock **nunca lê cookies do Chrome, do Edge ou de outro navegador**.
- O cache local e o histórico de uso guardam só números de quota, nunca credenciais.

As requisições de rede vão só para:

| Onde | Para quê |
| --- | --- |
| `api.anthropic.com`, `claude.ai` | Uso do Claude |
| `chatgpt.com` | Uso do Codex |
| `cursor.com` | Uso do Cursor |
| `status.claude.com`, `status.openai.com`, `status.cursor.com` | Status público de incidentes, a cada 5 min |
| `raw.githubusercontent.com` | Tabela de preços do LiteLLM, no máximo uma vez por dia, com cache em disco |

Detalhes em [SECURITY.md](SECURITY.md).

## Prompts do Obsidian

Aponte o AI Dock para o seu Vault (ou uma pasta dentro dele). Cada `.md` é um prompt; o front matter é opcional.

```md
---
title: Campanha editorial
category: Imagem
tags:
  - foto
favorite: true
---

Crie uma campanha editorial para {{marca}} com tom {{tom|sofisticado}}.
```

`{{nome}}` vira um campo para preencher antes de copiar; `{{nome|padrão}}` já vem preenchido.

## Requisitos

- Windows 11 com [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (já vem no Windows 11)
- Beta do macOS: Apple Silicon
- Os apps que você quer acompanhar, logados no mesmo computador

## Compilar

Precisa de Node.js 22+, Rust stable e dos [pré-requisitos do Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev     # rodar em desenvolvimento
npm run tauri:build   # instalador + exe portátil
npm run test:frontend # testes do frontend
cd src-tauri && cargo test
```

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para como mudanças e releases funcionam.

## Projetos relacionados

- [CodexBar](https://github.com/steipete/CodexBar): app de barra de menus do macOS para limites de uso de IA. A correção do `forceRefresh` do Antigravity segue a abordagem dele.
- [UsageDeck](https://github.com/CallMeLewis/UsageDeck): app de bandeja do Windows para uso, limites e resets de IAs de código.
- [ccusage](https://github.com/ryoppippi/ccusage): CLI que mostra uso de tokens e custo a partir dos logs locais dos agentes; a ideia por trás da aba Custos.

O AI Dock não contém código desses projetos. Veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Aviso

O AI Dock é um projeto independente. Não é afiliado, endossado nem patrocinado pela Anthropic, OpenAI, Anysphere (Cursor), Google ou Obsidian. Nomes e logos pertencem aos seus donos e aparecem só para identificar cada serviço. Os números vêm dos endpoints de cada provider e podem mudar ou parar de funcionar quando o provider mudar.

## Autor

Feito por **Nycolas Monteiro** ([@NyckDragon](https://github.com/NyckDragon)).

## Licença

[MIT](LICENSE). Você pode usar, alterar e compartilhar o AI Dock, inclusive nos seus projetos, desde que mantenha o aviso de copyright e dê crédito ao autor.
