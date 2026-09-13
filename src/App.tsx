import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Monitor as MonitorIcon,
  PanelLeftClose,
  PanelRightClose,
  Power,
  RefreshCw,
  Settings2,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./provider-connect.css";
import "./compact-modes.css";
import { PromptLibrary } from "./components/PromptLibrary";
import { UsageCard } from "./components/UsageCard";
import {
  chooseObsidianFolder,
  clearClaudeWebSession,
  fetchClaudeWebStatus,
  fetchMonitors,
  fetchProviderSetupStatus,
  fetchUsage,
  installProviderCli,
  openProviderSetup,
  quitApp,
  raiseDock,
  saveClaudeWebSession,
  scanPrompts,
  setDock,
  uninstallProviderCli
} from "./lib/tauri";
import type {
  CompactMode,
  DockSide,
  MonitorInfo,
  PromptItem,
  ProviderSetupStatus,
  ProviderUsage
} from "./types";

const STORAGE_SIDE = "ai-dock-side";
const STORAGE_MONITOR = "ai-dock-monitor-index";
const STORAGE_OBSIDIAN = "ai-dock-obsidian-path";
const STORAGE_COMPACT_MODE = "ai-dock-compact-mode";
const STORAGE_COMPACT_SIGN = "ai-dock-compact-sign";

const compactModes: { id: CompactMode; title: string; description: string }[] = [
  { id: "classic", title: "Padrão", description: "Ícone + AI + pontos" },
  { id: "percent", title: "Números", description: "AI + percentual" },
  { id: "ring", title: "Círculo", description: "AI + anel" },
  { id: "square", title: "Quadrado", description: "AI + borda do retângulo" }
];

function readCompactMode(): CompactMode {
  const stored = localStorage.getItem(STORAGE_COMPACT_MODE);
  if (stored === "ring-percent") return "ring";
  return compactModes.some((mode) => mode.id === stored) ? (stored as CompactMode) : "classic";
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Algo deu errado.";
}

function providerHeadroom(provider: ProviderUsage) {
  if (!provider.connected || provider.windows.length === 0) return null;
  return Math.max(0, Math.min(100, Math.min(...provider.windows.map((item) => item.remainingPercent))));
}

function quotaTone(remaining: number | null) {
  if (remaining == null) return "empty";
  if (remaining > 60) return "good";
  if (remaining > 25) return "warning";
  return "danger";
}

function compactSlots(providers: ProviderUsage[]): ProviderUsage[] {
  const slots: ProviderUsage[] = [];
  for (const provider of providers) {
    if (provider.id !== "antigravity") {
      slots.push(provider);
      continue;
    }
    const gemini = provider.windows.filter((item) => item.id.startsWith("gemini"));
    const other = provider.windows.filter((item) => item.id.startsWith("claude-gpt") || item.id.startsWith("third-party"));
    slots.push({ ...provider, id: "antigravity-gemini", name: "Gemini", windows: gemini });
    slots.push({ ...provider, id: "antigravity-gpt", name: "Claude + GPT", windows: other });
  }
  return slots;
}

function compactWindowHeight(mode: CompactMode, count: number) {
  const n = Math.max(count, 4);
  if (mode === "classic") return 220;
  if (mode === "ring") return 92 + n * 42;
  return 92 + n * 36;
}

function CompactProviderMetric({
  provider,
  mode,
  showSign
}: {
  provider: ProviderUsage;
  mode: CompactMode;
  showSign: boolean;
}) {
  const remaining = providerHeadroom(provider);
  const rounded = remaining == null ? null : Math.round(remaining);
  const label = rounded == null ? "--" : showSign ? `${rounded}%` : `${rounded}`;
  const title = rounded == null ? `${provider.name}: não conectado` : `${provider.name}: ${rounded}% restante`;

  if (mode === "percent") {
    return (
      <span className="compact-metric compact-metric--percent" title={title}>
        {label}
      </span>
    );
  }

  const degrees = remaining == null ? 0 : remaining * 3.6;
  const tone = quotaTone(remaining);

  return (
    <span
      className={`compact-gauge compact-gauge--${tone}${mode === "ring" ? " compact-gauge--circle" : ""}`}
      title={title}
      style={{ "--ring-value": `${degrees}deg` } as React.CSSProperties}
    >
      <span className="compact-gauge__face">
        {rounded == null ? "--" : rounded}
        {rounded == null || !showSign ? null : <small>%</small>}
      </span>
    </span>
  );
}

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [side, setSide] = useState<DockSide>(() => (localStorage.getItem(STORAGE_SIDE) === "left" ? "left" : "right"));
  const [compactMode, setCompactMode] = useState<CompactMode>(readCompactMode);
  const [showSign, setShowSign] = useState(() => localStorage.getItem(STORAGE_COMPACT_SIGN) !== "off");
  const [monitorIndex, setMonitorIndex] = useState(() => {
    const stored = Number(localStorage.getItem(STORAGE_MONITOR));
    return Number.isInteger(stored) && stored >= 0 ? stored : 0;
  });
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [obsidianPath, setObsidianPath] = useState<string | null>(() => localStorage.getItem(STORAGE_OBSIDIAN));
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderSetupStatus | null>(null);
  const [setupStarting, setSetupStarting] = useState(false);
  const [setupNote, setSetupNote] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [webConnected, setWebConnected] = useState(false);
  const [sessionKey, setSessionKey] = useState("");
  const [webBusy, setWebBusy] = useState(false);
  const [webNote, setWebNote] = useState<string | null>(null);
  const [webError, setWebError] = useState<string | null>(null);

  const compactProviders = useMemo(() => compactSlots(providers), [providers]);
  const windowHeight = compactWindowHeight(compactMode, compactProviders.length);

  async function refreshProviders() {
    setLoading(true);
    try {
      setProviders(await fetchUsage());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void setDock(side, expanded, monitorIndex, windowHeight);
  }, [expanded, side, monitorIndex, compactMode, windowHeight]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      void raiseDock();
    }, 2500);
    const onFocus = () => void raiseDock();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    void refreshProviders();
    if (obsidianPath) {
      scanPrompts(obsidianPath).then(setPrompts).catch(() => setPrompts([]));
    }
    fetchMonitors().then(setMonitors).catch(() => setMonitors([]));
    fetchProviderSetupStatus().then(setProviderStatus).catch(() => setProviderStatus(null));
    fetchClaudeWebStatus()
      .then((snapshot) => {
        setWebConnected(Boolean(snapshot.connected));
        if (snapshot.connected) setWebNote("Sessão do claude.ai salva neste PC.");
        else if (snapshot.error) setWebError(snapshot.error);
      })
      .catch(() => setWebConnected(false));
  }, []);

  async function installClaude() {
    if (!window.confirm("Instalar o Claude Code CLI (terminal), não o Claude Desktop?")) return;
    setSetupStarting(true);
    setSetupError(null);
    try {
      setProviderStatus(await installProviderCli());
      setSetupNote("Claude Code CLI instalado.");
    } catch (error) {
      setSetupError(errorMessage(error));
    } finally {
      setSetupStarting(false);
    }
  }

  async function removeClaudeCli() {
    if (!window.confirm("Desinstalar o Claude Code CLI instalado via npm? O Claude Desktop permanece.")) return;
    setSetupStarting(true);
    setSetupError(null);
    try {
      setProviderStatus(await uninstallProviderCli());
      setSetupNote("Claude Code CLI desinstalado.");
    } catch (error) {
      setSetupError(errorMessage(error));
    } finally {
      setSetupStarting(false);
    }
  }

  if (!expanded) {
    return (
      <main className={`compact-shell compact-shell--${side}`}>
        <button className="dock-pill" onClick={() => setExpanded(true)} title="Abrir AI Dock">
          <Sparkles size={16} />
          <span className="dock-word">AI</span>
          {compactMode === "classic" ? (
            <span className="dock-statuses">
              {compactProviders.map((provider) => (
                <i key={provider.id} className={`mini-dot mini-dot--${provider.connected && provider.windows.length ? "on" : "off"}`} />
              ))}
            </span>
          ) : (
            <span className="compact-metrics">
              {compactProviders.map((provider) => (
                <CompactProviderMetric key={provider.id} provider={provider} mode={compactMode} showSign={showSign} />
              ))}
            </span>
          )}
          {side === "right" ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
      </main>
    );
  }

  return (
    <main className={`app-shell app-shell--${side}`}>
      <div className="dock-panel">
        <header className="app-header" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <span className="brand-mark"><Sparkles size={16} /></span>
            <div>
              <div className="brand-name">AI Dock</div>
              <div className="brand-subtitle">Usage + Prompt Launcher</div>
            </div>
          </div>
          <div className="header-actions">
            <button className={`icon-button ${loading ? "is-spinning" : ""}`} onClick={() => void refreshProviders()} title="Atualizar uso">
              <RefreshCw size={15} />
            </button>
            {monitors.length > 1 && (
              <button className="icon-button" onClick={() => setMonitorIndex((index) => (index + 1) % monitors.length)} title="Próxima tela">
                <MonitorIcon size={15} />
              </button>
            )}
            <button className="icon-button" onClick={() => {
              const next = side === "right" ? "left" : "right";
              localStorage.setItem(STORAGE_SIDE, next);
              setSide(next);
            }} title="Trocar lado">
              {side === "right" ? <PanelLeftClose size={16} /> : <PanelRightClose size={16} />}
            </button>
            <button className={`icon-button ${settingsOpen ? "is-active" : ""}`} onClick={() => setSettingsOpen((open) => !open)} title="Configurações">
              <Settings2 size={16} />
            </button>
            <button className="icon-button" onClick={() => void quitApp()} title="Encerrar AI Dock">
              <Power size={15} />
            </button>
            <button className="collapse-button" onClick={() => setExpanded(false)} title="Recolher">
              {side === "right" ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
          </div>
        </header>

        {settingsOpen ? (
          <div className="panel-scroll settings-scroll">
            <section className="settings-page">
              <div className="settings-title-row">
                <div>
                  <span className="eyebrow">PREFERÊNCIAS</span>
                  <h2>Configurações</h2>
                </div>
                <button className="icon-button" onClick={() => setSettingsOpen(false)} title="Fechar">
                  <X size={15} />
                </button>
              </div>

              <div className="settings-group">
                <div className="settings-label">Dock recolhido</div>
                <div className="compact-mode-picker">
                  {compactModes.map((mode) => (
                    <button
                      key={mode.id}
                      className={compactMode === mode.id ? "is-selected" : ""}
                      onClick={() => {
                        localStorage.setItem(STORAGE_COMPACT_MODE, mode.id);
                        setCompactMode(mode.id);
                      }}
                    >
                      {mode.title}
                      <small>{mode.description}</small>
                    </button>
                  ))}
                </div>
                {compactMode !== "classic" && (
                  <button
                    className={`compact-toggle ${showSign ? "is-selected" : ""}`}
                    onClick={() => {
                      const next = !showSign;
                      localStorage.setItem(STORAGE_COMPACT_SIGN, next ? "on" : "off");
                      setShowSign(next);
                    }}
                  >
                    {showSign ? "Ocultar o sinal de %" : "Mostrar o sinal de %"}
                  </button>
                )}
              </div>

              <div className="settings-group">
                <div className="settings-label">Claude</div>
                <div className="provider-connect-card">
                  <div className="provider-connect-head">
                    <span className="monitor-option__icon provider-connect-icon"><Sparkles size={15} /></span>
                    <span className="monitor-option__copy">
                      <strong>{webConnected ? "Claude Web conectado" : "Conectar pelo claude.ai"}</strong>
                      <small>O Claude Desktop aberto não entrega quota. Precisa do sessionKey.</small>
                    </span>
                    <span className={`provider-status-dot ${webConnected ? "is-connected" : ""}`} />
                  </div>
                  <p className="provider-connect-copy">claude.ai → F12 → Application → Cookies → sessionKey.</p>
                  {!webConnected && (
                    <input className="provider-session-input" type="password" autoComplete="off" spellCheck={false} placeholder="sessionKey" value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} />
                  )}
                  <div className="provider-connect-actions">
                    {!webConnected && (
                      <button className="provider-primary-button" onClick={() => void saveClaudeWebSession(sessionKey).then(() => { setWebConnected(true); setSessionKey(""); setWebNote("Claude Web conectado."); void refreshProviders(); }).catch((error) => { setWebConnected(false); setWebError(errorMessage(error)); })} disabled={webBusy || sessionKey.trim().length < 20}>
                        {webBusy ? "Validando..." : "Salvar e testar"}
                      </button>
                    )}
                    {webConnected && (
                      <button className="provider-secondary-button" onClick={() => void clearClaudeWebSession().then(() => { setWebConnected(false); void refreshProviders(); })}>Remover sessão</button>
                    )}
                  </div>
                  {webNote ? <div className="provider-connect-note">{webNote}</div> : null}
                  {webError ? <div className="provider-connect-error">{webError}</div> : null}
                  <details className="provider-advanced">
                    <summary>Avançado: Claude Code CLI (terminal)</summary>
                    <p className="provider-connect-copy">Instala o CLI, não o Claude Desktop da Store.</p>
                    <div className="provider-connect-actions">
                      {!providerStatus?.installed && providerStatus?.npmAvailable && (
                        <button className="provider-primary-button" onClick={() => void installClaude()} disabled={setupStarting}>Instalar CLI</button>
                      )}
                      {providerStatus?.installed && (
                        <button className="provider-danger-button" onClick={() => void removeClaudeCli()} disabled={setupStarting}>Desinstalar CLI</button>
                      )}
                      {providerStatus?.installed && (
                        <button className="provider-secondary-button" onClick={() => void openProviderSetup()}>Abrir CLI</button>
                      )}
                    </div>
                    {setupNote ? <div className="provider-connect-note">{setupNote}</div> : null}
                    {setupError ? <div className="provider-connect-error">{setupError}</div> : null}
                  </details>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-label">Tela do dock</div>
                <div className="monitor-list">
                  {monitors.map((monitor) => (
                    <button key={monitor.index} className={`monitor-option ${monitor.index === monitorIndex ? "is-selected" : ""}`} onClick={() => { localStorage.setItem(STORAGE_MONITOR, String(monitor.index)); setMonitorIndex(monitor.index); }}>
                      <span className="monitor-option__icon"><MonitorIcon size={15} /></span>
                      <span className="monitor-option__copy">
                        <strong>Tela {monitor.index + 1}</strong>
                        <small>{monitor.name} · {monitor.width} × {monitor.height}</small>
                      </span>
                      {monitor.index === monitorIndex && <Check size={15} />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-label">Obsidian</div>
                <button className="obsidian-setting" onClick={async () => {
                  const path = await chooseObsidianFolder();
                  if (!path) return;
                  localStorage.setItem(STORAGE_OBSIDIAN, path);
                  setObsidianPath(path);
                  setPrompts(await scanPrompts(path).catch(() => []));
                }}>
                  <span className="monitor-option__icon"><FolderOpen size={15} /></span>
                  <span className="monitor-option__copy">
                    <strong>{obsidianPath ? "Pasta conectada" : "Conectar pasta"}</strong>
                    <small>{obsidianPath || "Vault ou pasta de prompts"}</small>
                  </span>
                </button>
              </div>

              <div className="settings-group">
                <button className="provider-danger-button" onClick={() => void quitApp()}>Encerrar AI Dock</button>
              </div>
            </section>
          </div>
        ) : (
          <div className="panel-scroll">
            <section className="usage-section">
              <div className="section-heading section-heading--usage">
                <div>
                  <span className="eyebrow">USO</span>
                  <h2>Suas IAs</h2>
                </div>
                <Bot size={17} className="muted-icon" />
              </div>
              <div className="usage-stack">
                {providers.map((provider) => <UsageCard provider={provider} key={provider.id} />)}
              </div>
            </section>
            <PromptLibrary prompts={prompts} obsidianPath={obsidianPath} onChooseFolder={async () => {
              const path = await chooseObsidianFolder();
              if (!path) return;
              localStorage.setItem(STORAGE_OBSIDIAN, path);
              setObsidianPath(path);
              setPrompts(await scanPrompts(path).catch(() => []));
            }} />
          </div>
        )}
      </div>
    </main>
  );
}
