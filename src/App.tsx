import {
  Bot,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Settings2,
  Sparkles
} from "lucide-react";
import { useEffect, useState } from "react";
import { PromptLibrary } from "./components/PromptLibrary";
import { UsageCard } from "./components/UsageCard";
import { chooseObsidianFolder, fetchUsage, scanPrompts, setDock } from "./lib/tauri";
import type { DockSide, PromptItem, ProviderUsage } from "./types";

const STORAGE_SIDE = "ai-dock-side";
const STORAGE_OBSIDIAN = "ai-dock-obsidian-path";

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [side, setSide] = useState<DockSide>(() =>
    localStorage.getItem(STORAGE_SIDE) === "left" ? "left" : "right"
  );
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [obsidianPath, setObsidianPath] = useState<string | null>(() => localStorage.getItem(STORAGE_OBSIDIAN));
  const [prompts, setPrompts] = useState<PromptItem[]>([]);

  async function refreshProviders() {
    setLoading(true);
    try {
      setProviders(await fetchUsage());
    } finally {
      setLoading(false);
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
    void setDock(side, expanded);
  }, [expanded, side]);

  useEffect(() => {
    void refreshProviders();
    void refreshPrompts(obsidianPath);
  }, []);

  async function chooseObsidian() {
    const path = await chooseObsidianFolder();
    if (!path) return;
    localStorage.setItem(STORAGE_OBSIDIAN, path);
    setObsidianPath(path);
    await refreshPrompts(path);
  }

  function toggleSide() {
    const next = side === "right" ? "left" : "right";
    localStorage.setItem(STORAGE_SIDE, next);
    setSide(next);
  }

  if (!expanded) {
    return (
      <main className={`compact-shell compact-shell--${side}`}>
        <button className="dock-pill" onClick={() => setExpanded(true)} title="Abrir AI Dock">
          <div className="dock-glow" />
          <Sparkles size={19} />
          <span className="dock-word">AI</span>
          <span className="dock-statuses">
            {providers.slice(0, 3).map((provider) => (
              <i key={provider.id} className={`mini-dot mini-dot--${provider.connected ? "on" : "off"}`} />
            ))}
          </span>
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
            <button className="icon-button" onClick={toggleSide} title="Trocar lado">
              {side === "right" ? <PanelLeftClose size={16} /> : <PanelRightClose size={16} />}
            </button>
            <button className="icon-button" title="Configurações (em breve)">
              <Settings2 size={16} />
            </button>
            <button className="collapse-button" onClick={() => setExpanded(false)} title="Recolher">
              {side === "right" ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
            </button>
          </div>
        </header>

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
      </div>
    </main>
  );
}
