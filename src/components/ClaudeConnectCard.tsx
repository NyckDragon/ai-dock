import { useEffect, useRef, useState } from "react";
import { normalizeClaudeCookieInput } from "../lib/claudeCookie";
import {
  claudeLogin,
  clearClaudeWebSession,
  fetchClaudeWebStatus,
  fetchProviderSetupStatus,
  installProviderCli,
  onClaudeLogin,
  openProviderSetup,
  saveClaudeWebSession,
  uninstallProviderCli
} from "../lib/tauri";
import type { ProviderSetupStatus, ProviderUsage } from "../types";
import { ProviderIcon } from "./ProviderIcon";

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Algo deu errado.";
}

/** Cloudflare blocks and cooldowns pass on their own; the session itself is fine. */
export function isTransientClaudeError(error?: string | null) {
  const lower = (error || "").toLowerCase();
  return lower.includes("cloudflare") || lower.includes("cooldown") || lower.includes("http 403") || lower.includes("rede");
}

type Message = { kind: "note" | "error"; text: string } | null;
type WebState = "unknown" | "connected" | "blocked" | "expired" | "missing";

function webState(snapshot: ProviderUsage): WebState {
  if (snapshot.connected) return "connected";
  if (isTransientClaudeError(snapshot.error)) return "blocked";
  if (/expirou|inválid|invalid/i.test(snapshot.error || "")) return "expired";
  return "missing";
}

const TITLES: Record<WebState, string> = {
  unknown: "Claude Web",
  connected: "Claude conectado",
  blocked: "Claude conectado · leitura bloqueada agora",
  expired: "A sessão do Claude expirou",
  missing: "Conectar o Claude"
};

export function ClaudeConnectCard({
  onChanged,
  withDialog
}: {
  onChanged: () => void;
  /** Runs a native or confirm dialog without the panel closing on blur. */
  withDialog: <T>(run: () => Promise<T> | T) => Promise<T>;
}) {
  const [state, setState] = useState<WebState>("unknown");
  const [waitingLogin, setWaitingLogin] = useState(false);
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [cli, setCli] = useState<ProviderSetupStatus | null>(null);
  const [cliBusy, setCliBusy] = useState(false);
  const [cliMessage, setCliMessage] = useState<Message>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    fetchClaudeWebStatus()
      .then((snapshot) => {
        const next = webState(snapshot);
        setState(next);
        if (next === "blocked" || next === "expired") setMessage({ kind: "error", text: snapshot.error || "" });
      })
      .catch(() => setState("missing"));
    fetchProviderSetupStatus().then(setCli).catch(() => setCli(null));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    void onClaudeLogin((event) => {
      setWaitingLogin(false);
      if (event.status === "connected") {
        setState(event.message ? "blocked" : "connected");
        setMessage(
          event.message
            ? { kind: "note", text: "Login salvo. " + event.message }
            : { kind: "note", text: "Pronto! O AI Dock renova essa sessão sozinho daqui pra frente." }
        );
        onChangedRef.current();
      } else if (event.status === "timeout") {
        setMessage({ kind: "error", text: event.message || "O login demorou demais. Tente de novo." });
      } else {
        setMessage({ kind: "note", text: "Janela fechada antes de concluir o login." });
      }
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  async function login() {
    setMessage(null);
    try {
      await claudeLogin();
      setWaitingLogin(true);
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    }
  }

  async function saveCookie() {
    setBusy(true);
    setMessage(null);
    try {
      await saveClaudeWebSession(normalizeClaudeCookieInput(cookie));
      setState("connected");
      setCookie("");
      setMessage({ kind: "note", text: "Cookie do Claude salvo e testado." });
      onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const confirmed = await withDialog(() =>
      window.confirm("Remover a sessão do claude.ai deste PC? Você vai precisar entrar de novo.")
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await clearClaudeWebSession();
      setState("missing");
      setMessage({ kind: "note", text: "Sessão removida." });
      onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runCli(action: "install" | "uninstall") {
    const question =
      action === "install"
        ? "Instalar o Claude Code CLI (terminal), não o Claude Desktop?"
        : "Desinstalar o Claude Code CLI instalado via npm? O Claude Desktop permanece.";
    if (!(await withDialog(() => window.confirm(question)))) return;
    setCliBusy(true);
    setCliMessage(null);
    try {
      setCli(action === "install" ? await installProviderCli() : await uninstallProviderCli());
      setCliMessage({
        kind: "note",
        text: action === "install" ? "Claude Code CLI instalado." : "Claude Code CLI desinstalado."
      });
      onChanged();
    } catch (error) {
      setCliMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setCliBusy(false);
    }
  }

  const connected = state === "connected" || state === "blocked";

  return (
    <div className="connect-card">
      <div className="connect-card__head">
        <span className="tile-icon">
          <ProviderIcon providerId="claude" size={16} brand />
        </span>
        <span className="connect-card__copy">
          <strong>{TITLES[state]}</strong>
          <small>
            {connected
              ? "O AI Dock renova a sessão sozinho. Só pede login de novo se o claude.ai te deslogar."
              : "Entre na sua conta do claude.ai numa janela do AI Dock. Sem F12, sem copiar cookie."}
          </small>
        </span>
        <i className={"status-dot" + (connected ? " status-dot--on" : "")} aria-hidden="true" />
      </div>

      <div className="button-row">
        <button type="button" className="button button--primary" onClick={() => void login()} disabled={waitingLogin}>
          {waitingLogin ? "Aguardando login…" : connected || state === "expired" ? "Reconectar" : "Entrar com claude.ai"}
        </button>
        {connected ? (
          <button type="button" className="button button--ghost" onClick={() => void remove()} disabled={busy}>
            Sair
          </button>
        ) : null}
      </div>

      {waitingLogin ? (
        <p className="hint">
          Termine o login na janela que abriu; ela fecha sozinha. Se o Google recusar o login ali, use a opção de
          entrar com e-mail.
        </p>
      ) : null}

      {message?.text ? <div className={"notice notice--" + message.kind}>{message.text}</div> : null}

      <details className="steps">
        <summary>Colar o cookie manualmente</summary>
        <ol>
          <li>Abra <strong>claude.ai</strong> logado no navegador e aperte <kbd>F12</kbd>.</li>
          <li>Vá em <strong>Application → Cookies → https://claude.ai</strong>.</li>
          <li>Selecione a tabela inteira, copie e cole abaixo. Também vale o cabeçalho <code>Cookie</code> completo ou só o <code>sessionKey</code>.</li>
        </ol>
        <textarea
          className="input input--area"
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder="Cole a tabela de cookies, o cabeçalho Cookie ou o sessionKey"
          aria-label="Cookie do claude.ai"
          value={cookie}
          onChange={(event) => setCookie(event.target.value)}
        />
        <p className="hint">
          O AI Dock guarda só <code>sessionKey</code>, <code>cf_clearance</code>, <code>__cf_bm</code> e{" "}
          <code>anthropic-device-id</code>, no Gerenciador de Credenciais do Windows.
        </p>
        <div className="button-row">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void saveCookie()}
            disabled={busy || cookie.trim().length < 20}
          >
            {busy ? "Validando…" : "Salvar e testar"}
          </button>
        </div>
      </details>

      <details className="advanced">
        <summary>Avançado: Claude Code CLI (terminal)</summary>
        <p className="hint">
          Se o Claude Code estiver logado neste PC, o AI Dock usa o OAuth dele primeiro.
          {cli?.version ? " Versão: " + cli.version + "." : ""}
        </p>
        <div className="button-row">
          {!cli?.installed && cli?.npmAvailable ? (
            <button type="button" className="button button--primary" onClick={() => void runCli("install")} disabled={cliBusy}>
              {cliBusy ? "Instalando…" : "Instalar CLI"}
            </button>
          ) : null}
          {cli?.installed ? (
            <button type="button" className="button button--ghost" onClick={() => void openProviderSetup()}>
              Abrir CLI
            </button>
          ) : null}
          {cli?.installed ? (
            <button type="button" className="button button--danger" onClick={() => void runCli("uninstall")} disabled={cliBusy}>
              Desinstalar CLI
            </button>
          ) : null}
        </div>
        {cli && !cli.installed && !cli.npmAvailable ? (
          <p className="hint">Node.js/npm não encontrado. Instale o Node.js para instalar o CLI por aqui.</p>
        ) : null}
        {cliMessage ? <div className={"notice notice--" + cliMessage.kind}>{cliMessage.text}</div> : null}
      </details>
    </div>
  );
}
