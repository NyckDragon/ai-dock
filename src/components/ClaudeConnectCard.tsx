import { useEffect, useState } from "react";
import {
  clearClaudeWebSession,
  fetchClaudeWebStatus,
  fetchProviderSetupStatus,
  installProviderCli,
  openProviderSetup,
  saveClaudeWebSession,
  uninstallProviderCli
} from "../lib/tauri";
import type { ProviderSetupStatus } from "../types";
import { ProviderIcon } from "./ProviderIcon";

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Algo deu errado.";
}

type Message = { kind: "note" | "error"; text: string } | null;

export function ClaudeConnectCard({
  onChanged,
  withDialog
}: {
  onChanged: () => void;
  /** Runs a native or confirm dialog without the panel closing on blur. */
  withDialog: <T>(run: () => Promise<T> | T) => Promise<T>;
}) {
  const [connected, setConnected] = useState(false);
  const [sessionKey, setSessionKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [cli, setCli] = useState<ProviderSetupStatus | null>(null);
  const [cliBusy, setCliBusy] = useState(false);
  const [cliMessage, setCliMessage] = useState<Message>(null);

  useEffect(() => {
    fetchClaudeWebStatus()
      .then((snapshot) => {
        setConnected(Boolean(snapshot.connected));
        if (snapshot.connected) setMessage({ kind: "note", text: "Sessão do claude.ai salva neste PC." });
        else if (snapshot.error) setMessage({ kind: "error", text: snapshot.error });
      })
      .catch(() => setConnected(false));
    fetchProviderSetupStatus().then(setCli).catch(() => setCli(null));
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await saveClaudeWebSession(sessionKey.trim());
      setConnected(true);
      setSessionKey("");
      setMessage({ kind: "note", text: "Claude Web conectado." });
      onChanged();
    } catch (error) {
      setConnected(false);
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const confirmed = await withDialog(() => window.confirm("Remover a sessão do claude.ai salva neste PC?"));
    if (!confirmed) return;
    setBusy(true);
    try {
      await clearClaudeWebSession();
      setConnected(false);
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

  return (
    <div className="connect-card">
      <div className="connect-card__head">
        <span className="tile-icon">
          <ProviderIcon providerId="claude" size={16} brand />
        </span>
        <span className="connect-card__copy">
          <strong>{connected ? "Claude Web conectado" : "Conectar pelo claude.ai"}</strong>
          <small>O Claude Desktop não informa a quota. O AI Dock usa a sessão do claude.ai.</small>
        </span>
        <i className={"status-dot" + (connected ? " status-dot--on" : "")} aria-hidden="true" />
      </div>

      {!connected ? (
        <>
          <details className="steps">
            <summary>Como obter o sessionKey</summary>
            <ol>
              <li>Abra <strong>claude.ai</strong> logado no navegador.</li>
              <li>Aperte <kbd>F12</kbd> e vá em <strong>Application</strong> (ou Armazenamento).</li>
              <li>Em <strong>Cookies → https://claude.ai</strong>, copie o valor de <strong>sessionKey</strong>.</li>
              <li>Cole abaixo. Ele fica só no Gerenciador de Credenciais do Windows.</li>
            </ol>
          </details>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Cole o sessionKey"
            aria-label="sessionKey do claude.ai"
            value={sessionKey}
            onChange={(event) => setSessionKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && sessionKey.trim().length >= 20 && !busy) void save();
            }}
          />
        </>
      ) : null}

      <div className="button-row">
        {connected ? (
          <button type="button" className="button button--ghost" onClick={() => void remove()} disabled={busy}>
            Remover sessão
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={busy || sessionKey.trim().length < 20}
          >
            {busy ? "Validando…" : "Salvar e testar"}
          </button>
        )}
      </div>

      {message ? <div className={"notice notice--" + message.kind}>{message.text}</div> : null}

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
