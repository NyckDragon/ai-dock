import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Monitor as MonitorIcon,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Settings2,
  Sparkles,
  Terminal,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./provider-connect.css";
import "./compact-modes.css";
import { PromptLibrary } from "./components/PromptLibrary";
import { UsageCard } from "./components/UsageCard";
import {
  chooseObsidianFolder,
  fetchMonitors,
  fetchProviderSetupStatus,
  fetchUsage,
  installProviderCli,
  openProviderSetup,
  scanPrompts,
  setDock
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

const compactModes: { id: CompactMode; title: string; description: string }[] = [
  { id: "classic", title: "Padrão", description: "Ícone + status" },
  { id: "percent", title: "Só %", description: "Percentual restante" },
  { id: "ring", title: "Só círculo", description: "Borda de quota" },
  { id: "ring-percent", title: "Círculo + %", description: "Borda + percentual" }
];

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

function CompactProviderMetric({ provider, mode }: { provider: ProviderUsage; mode: CompactMode }) {
  const remaining = providerHeadroom(provider);
  const rounded = remaining == null ? null : Math.round(remaining);
  const title = rounded == null ? `${provider.name}: não conectado` : `${provider.name}: ${rounded}% restante`;

  if (mode === "percent") {
    return (
      <span className="compact-metric compact-metric--percent" title={title}>
        {rounded == null ? "--" : `${rounded}%`}
      </span>
    );
  }

  const degrees = remaining == null ? 0 : remaining * 3.6;
  const tone = quotaTone(remaining);
  const ringClass = `compact-ring compact-ring--${tone}${mode === "ring" ? " compact-ring--only" : ""}`;

  return (
    <span
      className={ringClass}
      title={title}
      style={{ "--ring-value": `${degrees}deg` } as React.CSSProperties}
    >
      {mode === "ring-percent" ? (
        <span className="compact-ring__value">
          {rounded == null ? "--" : rounded}
          {rounded == null ? null : <small>%</small>}
        </span>
      ) : null}
    </span>
  );
}

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [side, setSide] = useState<DockSide>(() =>
    localStorage.getItem(STORAGE_SIDE) === "left" ? "left" : "right"
  );
  const [compactMode, setCompactMode] = useState<CompactMode>(() => {
    const stored = localStorage.getItem(STORAGE_COMPACT_MODE) as CompactMode | null;
    return compactModes.some((mode) => mode.id === stored) ? stored! : "classic";
  });
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

  const compactProviders = useMemo(
    () => providers.filter((provider) => ["claude", "codex", "antigravity"].includes(provider.id)).slice(0, 3),
    [providers]
  );

  async function refreshProviders() {
    setLoading(true);
    try {
      setProviders(await fetchUsage());
    } finally {
      setLoading(false);
    }
  }

  async function refreshProviderStatus() {
    try {
      setProviderStatus(await fetchProviderSetupStatus());
    } catch {
      setProviderStatus(null);
    }
  }

  async function refreshMonitorsList() {
    try {
      const available = await fetchMonitors();
      setMonitors(available);
      if (available.length > 0 && monitorIndex >= available.length) {
        localStorage.setItem(STORAGE_MONITOR, "0");
        setMonitorIndex(0);
      }
    } catch {
      setMonitors([]);
    }
  }

  async function refreshPrompts(path: string | null) {
    if (!path) {
      setPrompts([]);
      return;
    }
    try {
      setPrompts(await scanPrompts(path));
    } catch {
      setPrompts([]);
    }
  }

  useEffect(() => {
    void setDock(side, expanded, monitorIndex);
  }, [expanded, side, monitorIndex]);

  useEffect(() => {
    void refreshProviders();
    void refreshPrompts(obsidianPath);
    void refreshMonitorsList();
    void refreshProviderStatus();
  }, []);

  async function chooseObsidian() {
    const path = await chooseObsidianFolder();
    if (!path) return;
    localStorage.setItem(STORAGE_OBSIDIAN, path);
    setObsidianPath(path);
    await refreshPrompts(path);
  }

  async function installClaude() {
    setSetupStarting(true);
    setSetupError(null);
    setSetupNote("Instalando Claude Code em segundo plano...");
    try {
      const latest = await installProviderCli();
      setProviderStatus(latest);
      setSetupNote("Claude Code instalado. Agora clique em Conectar Claude para autorizar sua conta uma vez.");
    } catch (error) {
      setSetupError(errorMessage(error));
      setSetupNote(null);
    } finally {
      setSetupStarting(false);
    }
  }

  async function connectClaude() {
    setSetupStarting(true);
    setSetupError(null);
    setSetupNote(null);
    try {
      await openProviderSetup();
      setSetupNote("O Claude foi aberto para autenticação. Entre com a mesma conta do Claude Desktop e, quando terminar, volte aqui e clique em Verificar conexão.");
    } catch (error) {
      setSetupError(errorMessage(error));
    } finally {
      setSetupStarting(false);
    }
  }

  async function verifyClaude() {
    setSetupError(null);
    const latest = await fetchProviderSetupStatus().catch(() => null);
    if (latest) {
      setProviderStatus(latest);
      setSetupNote(
        latest.authenticated
          ? "Claude conectado. Atualizando os limites."
          : "A autenticação ainda não foi detectada. Termine o login na janela do Claude e tente novamente."
      );
    }
    await refreshProviders();
  }

  function toggleSide() {
    const next = side === "right" ? "left" : "right";
    localStorage.setItem(STORAGE_SIDE, next);
    setSide(next);
  }

  function selectMonitor(index: number) {
    localStorage.setItem(STORAGE_MONITOR, String(index));
    setMonitorIndex(index);
  }

  function cycleMonitor() {
    if (monitors.length < 2) return;
    selectMonitor((monitorIndex + 1) % monitors.length);
  }

  function selectCompactMode(mode: CompactMode) {
    localStorage.setItem(STORAGE_COMPACT_MODE, mode);
    setCompactMode(mode);
    if (expanded) {
      void setDock(side, true, monitorIndex);
    }
  }

  if (!expanded) {
    return (
      <main className={`compact-shell compact-shell--${side}`}>
        <button className="dock-pill" onClick={() => setExpanded(true)} title="Abrir AI Dock">
          <div className="dock-glow" />
          {compactMode === "classic" ? (
            <>
              <Sparkles size={19} />
              <span className="dock-word">AI</span>
              <span className="dock-statuses">
                {compactProviders.map((provider) => (
                  <i key={provider.id} className={`mini-dot mini-dot--${provider.connected ? "on" : "off"}`} />
                ))}
              </span>
            </>
          ) : (
            <span className="compact-metrics">
              {compactProviders.map((provider) => (
                <CompactProviderMetric key={provider.id} provider={provider} mode={compactMode} />
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
            <button className={`icon-button ${loading ? "is-spinning" : ""}`} onClick={refreshProviders} title="Atualizar uso">
              <RefreshCw size={15} />
            </button>
            {monitors.length > 1 && (
              <button className="icon-button" onClick={cycleMonitor} title="Mover para a próxima tela">
                <MonitorIcon size={15} />
              </button>
            )}
            <button className="icon-button" onClick={toggleSide} title="Trocar lado">
              {side === "right" ? <PanelLeftClose size={16} /> : <PanelRightClose size={16} />}
            </button>
            <button
              className={`icon-button ${settingsOpen ? "is-active" : ""}`}
              onClick={() => setSettingsOpen((open) => !open)}
              title="Configurações"
            >
              <Settings2 size={16} />
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
                <button className="icon-button" onClick={() => setSettingsOpen(false)} title="Fechar configurações">
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
                      onClick={() => selectCompactMode(mode.id)}
                    >
                      {mode.title}
                      <small>{mode.description}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-label">Claude</div>
                <div className="provider-connect-card">
                  <div className="provider-connect-head">
                    <span className="monitor-option__icon provider-connect-icon"><Terminal size={15} /></span>
                    <span className="monitor-option__copy">
                      <strong>
                        {providerStatus?.authenticated
                          ? "Claude conectado"
                          : providerStatus?.installed
                            ? "Claude Code pronto"
                            : "Claude ainda não vinculado"}
                      </strong>
                      <small>
                        {providerStatus?.version
                          ? providerStatus.version
                          : providerStatus?.installed
                            ? "Só falta autorizar sua conta"
                            : providerStatus?.npmAvailable
                              ? "Pode ser instalado pelo próprio AI Dock"
                              : "Node/npm não encontrado neste PC"}
                      </small>
                    </span>
                    <span className={`provider-status-dot ${providerStatus?.authenticated ? "is-connected" : ""}`} />
                  </div>

                  <p className="provider-connect-copy">
                    O Claude Desktop não expõe a quota da assinatura para outros apps. O AI Dock usa a autenticação oficial do Claude Code apenas para consultar os limites da mesma conta.
                  </p>

                  <div className="provider-connect-actions">
                    {!providerStatus?.installed && providerStatus?.npmAvailable && (
                      <button className="provider-primary-button" onClick={installClaude} disabled={setupStarting}>
                        {setupStarting ? "Instalando..." : "Instalar Claude Code"}
                      </button>
                    )}
                    {providerStatus?.installed && !providerStatus.authenticated && (
                      <button className="provider-primary-button" onClick={connectClaude} disabled={setupStarting}>
                        {setupStarting ? "Abrindo..." : "Conectar Claude"}
                      </button>
                    )}
                    {providerStatus?.installed && (
                      <button className="provider-secondary-button" onClick={verifyClaude}>
                        {providerStatus.authenticated ? "Atualizar conexão" : "Verificar conexão"}
                      </button>
                    )}
                  </div>

                  {!providerStatus?.installed && providerStatus && !providerStatus.npmAvailable ? (
                    <div className="provider-connect-note">
                      Para eu automatizar a instalação do Claude Code neste PC, primeiro precisamos instalar Node.js/npm. Não precisa fazer nada no terminal agora.
                    </div>
                  ) : null}

                  {setupNote ? <div className="provider-connect-note">{setupNote}</div> : null}
                  {setupError ? <div className="provider-connect-error">{setupError}</div> : null}
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-label">Tela do dock</div>
                <div className="monitor-list">
                  {monitors.length === 0 ? (
                    <div className="settings-hint">Nenhuma tela encontrada.</div>
                  ) : monitors.map((monitor) => (
                    <button
                      key={monitor.index}
                      className={`monitor-option ${monitor.index === monitorIndex ? "is-selected" : ""}`}
                      onClick={() => selectMonitor(monitor.index)}
                    >
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
                <div className="settings-label">Lado da tela</div>
                <div className="side-picker">
                  <button
                    className={side === "left" ? "is-selected" : ""}
                    onClick={() => {
                      localStorage.setItem(STORAGE_SIDE, "left");
                      setSide("left");
                    }}
                  >
                    Esquerda
                  </button>
                  <button
                    className={side === "right" ? "is-selected" : ""}
                    onClick={() => {
                      localStorage.setItem(STORAGE_SIDE, "right");
                      setSide("right");
                    }}
                  >
                    Direita
                  </button>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-label">Obsidian</div>
                <button className="obsidian-setting" onClick={chooseObsidian}>
                  <span className="monitor-option__icon"><FolderOpen size={15} /></span>
                  <span className="monitor-option__copy">
                    <strong>{obsidianPath ? "Pasta conectada" : "Conectar pasta"}</strong>
                    <small>{obsidianPath || "Selecione seu Vault ou a pasta de prompts"}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="settings-note">
                As preferências ficam salvas. O dock continua fixo na tela escolhida e pode ser arrastado pelo cabeçalho quando estiver aberto.
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

            <PromptLibrary prompts={prompts} obsidianPath={obsidianPath} onChooseFolder={chooseObsidian} />
          </div>
        )}
      </div>
    </main>
  );
}
