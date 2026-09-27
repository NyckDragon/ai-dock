import { useEffect, useRef, useState } from "react";
import { normalizeClaudeCookieInput } from "../lib/claudeCookie";
import { t, tr } from "../lib/i18n";
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
import { rich } from "./Rich";

function errorMessage(error: unknown) {
  if (typeof error === "string") return tr(error);
  if (error instanceof Error) return tr(error.message);
  return t("Algo deu errado.");
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

const TITLES: Record<WebState, () => string> = {
  unknown: () => "Claude Web",
  connected: () => t("Claude conectado"),
  blocked: () => t("Claude conectado · leitura bloqueada agora"),
  expired: () => t("A sessão do Claude expirou"),
  missing: () => t("Conectar o Claude")
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
        if (next === "blocked" || next === "expired") setMessage({ kind: "error", text: tr(snapshot.error) });
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
            ? { kind: "note", text: t("Login salvo.") + " " + tr(event.message) }
            : { kind: "note", text: t("Pronto! O AI Dock renova essa sessão sozinho daqui pra frente.") }
        );
        onChangedRef.current();
      } else if (event.status === "timeout") {
        setMessage({ kind: "error", text: tr(event.message) || t("O login demorou demais. Tente de novo.") });
      } else {
        setMessage({ kind: "note", text: t("Janela fechada antes de concluir o login.") });
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
      setMessage({ kind: "note", text: t("Cookie do Claude salvo e testado.") });
      onChanged();
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const confirmed = await withDialog(() =>
      window.confirm(t("Remover a sessão do claude.ai deste PC? Você vai precisar entrar de novo."))
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await clearClaudeWebSession();
      setState("missing");
      setMessage({ kind: "note", text: t("Sessão removida.") });
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
        ? t("Instalar o Claude Code CLI (terminal), não o Claude Desktop?")
        : t("Desinstalar o Claude Code CLI instalado via npm? O Claude Desktop permanece.");
    if (!(await withDialog(() => window.confirm(question)))) return;
    setCliBusy(true);
    setCliMessage(null);
    try {
      setCli(action === "install" ? await installProviderCli() : await uninstallProviderCli());
      setCliMessage({
        kind: "note",
        text: action === "install" ? t("Claude Code CLI instalado.") : t("Claude Code CLI desinstalado.")
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
          <strong>{TITLES[state]()}</strong>
          <small>
            {connected
              ? t("O AI Dock renova a sessão sozinho. Só pede login de novo se o claude.ai te deslogar.")
              : t("Entre na sua conta do claude.ai numa janela do AI Dock. Sem F12, sem copiar cookie.")}
          </small>
        </span>
        <i className={"status-dot" + (connected ? " status-dot--on" : "")} aria-hidden="true" />
      </div>

      <div className="button-row">
        <button type="button" className="button button--primary" onClick={() => void login()} disabled={waitingLogin}>
          {waitingLogin ? t("Aguardando login…") : connected || state === "expired" ? t("Reconectar") : t("Entrar com claude.ai")}
        </button>
        {connected ? (
          <button type="button" className="button button--ghost" onClick={() => void remove()} disabled={busy}>
            {t("Sair")}
          </button>
        ) : null}
      </div>

      {waitingLogin ? (
        <p className="hint">
          {t(
            "Termine o login na janela que abriu; ela fecha sozinha. Se o Google recusar o login ali, use a opção de entrar com e-mail."
          )}
        </p>
      ) : null}

      {message?.text ? <div className={"notice notice--" + message.kind}>{message.text}</div> : null}

      <details className="steps">
        <summary>{t("Colar o cookie manualmente")}</summary>
        <ol>
          <li>{rich(t("Abra **claude.ai** logado no navegador e aperte [[F12]]."))}</li>
          <li>{rich(t("Vá em **Application → Cookies → https://claude.ai**."))}</li>
          <li>
            {rich(
              t("Selecione a tabela inteira, copie e cole abaixo. Também vale o cabeçalho `Cookie` completo ou só o `sessionKey`.")
            )}
          </li>
        </ol>
        <textarea
          className="input input--area"
          rows={4}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("Cole a tabela de cookies, o cabeçalho Cookie ou o sessionKey")}
          aria-label={t("Cookie do claude.ai")}
          value={cookie}
          onChange={(event) => setCookie(event.target.value)}
        />
        <p className="hint">
          {rich(
            t(
              "O AI Dock guarda só `sessionKey`, `cf_clearance`, `__cf_bm` e `anthropic-device-id`, no Gerenciador de Credenciais do Windows."
            )
          )}
        </p>
        <div className="button-row">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void saveCookie()}
            disabled={busy || cookie.trim().length < 20}
          >
            {busy ? t("Validando…") : t("Salvar e testar")}
          </button>
        </div>
      </details>

      <details className="advanced">
        <summary>{t("Avançado: Claude Code CLI (terminal)")}</summary>
        <p className="hint">
          {t("Se o Claude Code estiver logado neste PC, o AI Dock usa o OAuth dele primeiro.")}
          {cli?.version ? " " + t("Versão: {version}.", { version: cli.version }) : ""}
        </p>
        <div className="button-row">
          {!cli?.installed && cli?.npmAvailable ? (
            <button type="button" className="button button--primary" onClick={() => void runCli("install")} disabled={cliBusy}>
              {cliBusy ? t("Instalando…") : t("Instalar CLI")}
            </button>
          ) : null}
          {cli?.installed ? (
            <button type="button" className="button button--ghost" onClick={() => void openProviderSetup()}>
              {t("Abrir CLI")}
            </button>
          ) : null}
          {cli?.installed ? (
            <button type="button" className="button button--danger" onClick={() => void runCli("uninstall")} disabled={cliBusy}>
              {t("Desinstalar CLI")}
            </button>
          ) : null}
        </div>
        {cli && !cli.installed && !cli.npmAvailable ? (
          <p className="hint">{t("Node.js/npm não encontrado. Instale o Node.js para instalar o CLI por aqui.")}</p>
        ) : null}
        {cliMessage ? <div className={"notice notice--" + cliMessage.kind}>{cliMessage.text}</div> : null}
      </details>
    </div>
  );
}
