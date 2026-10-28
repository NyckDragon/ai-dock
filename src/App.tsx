import { getVersion } from "@tauri-apps/api/app";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CostsView } from "./components/CostsView";
import { DockPill } from "./components/DockPill";
import { Onboarding } from "./components/Onboarding";
import { PromptLibrary } from "./components/PromptLibrary";
import { ProviderPeek } from "./components/ProviderPeek";
import { SettingsPanel } from "./components/SettingsPanel";
import { UsageCard, UsageCardSkeleton } from "./components/UsageCard";
import { useActivity } from "./hooks/useActivity";
import { useCosts } from "./hooks/useCosts";
import { useDockWindow } from "./hooks/useDockWindow";
import { useFinishSignal } from "./hooks/useFinishSignal";
import { useNotifications, notify } from "./hooks/useNotifications";
import { useNow } from "./hooks/useNow";
import { usePrompts } from "./hooks/usePrompts";
import { statusFor, useProviderStatus } from "./hooks/useProviderStatus";
import { useProviders } from "./hooks/useProviders";
import { stripNotice, waitKind } from "./lib/finish";
import { formatAge } from "./lib/format";
import { resolveLanguage, setLocale, t, tr } from "./lib/i18n";
import {
  activityForSlot,
  arrangeProviders,
  baseProviderId,
  compactSlots,
  displayWord,
  providerHeadroom,
  quotaTone,
  shownPercent,
  type QuotaTone
} from "./lib/quota";
import { ROBOT_READY } from "./lib/robot-art";
import { GLOBAL_SHORTCUT, GLOBAL_SHORTCUT_LABEL, loadSettings, saveSettings } from "./lib/settings";
import {
  chooseObsidianFolder,
  claudeLogin,
  onClaudeLogin,
  shareWebUserAgent,
  fetchMonitors,
  focusDock,
  isTauri,
  onTrayAction,
  quitApp,
  raiseDock,
  rememberForeground,
  returnFocus,
  setDockHits,
  setTrayMenu,
  setTrayTooltip
} from "./lib/tauri";
import type { MonitorInfo, PanelView, Settings, SettingsTab } from "./types";

const QUESTION_HEX = /^#[0-9A-Fa-f]{6}$/;

function questionSoft(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, .14)`;
}

function applyStoredColor(name: "--question" | "--permission" | "--done", color: string | null) {
  const root = document.documentElement;
  if (color && QUESTION_HEX.test(color)) {
    root.style.setProperty(name, color);
    root.style.setProperty(name + "-soft", questionSoft(color));
  } else {
    root.style.removeProperty(name);
    root.style.removeProperty(name + "-soft");
  }
}

const TONE_RANK: Record<QuotaTone, number> = { empty: 0, good: 1, warning: 2, danger: 3 };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [expanded, setExpanded] = useState(() => !settings.onboarded);
  const [showOnboarding, setShowOnboarding] = useState(() => !settings.onboarded);
  const [view, setView] = useState<PanelView>("usage");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [focusProvider, setFocusProvider] = useState<string | null>(null);
  const [promptFocusKey, setPromptFocusKey] = useState(0);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [peekTop, setPeekTop] = useState(8);
  const [costDays, setCostDays] = useState(7);
  const now = useNow(30000);

  // Strings are read while rendering, so the language is set before any child renders.
  const locale = resolveLanguage(settings.language);
  setLocale(locale);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const { providers, loading, lastUpdatedAt, failed, history, refresh } = useProviders(settings.refreshMinutes);
  const activities = useActivity(expanded);
  const promptState = usePrompts(settings.obsidianPath, expanded);
  const statuses = useProviderStatus();

  const displayProviders = useMemo(() => {
    return providers.map((p) => {
      const alias = settings.providerAliases?.[p.id]?.trim();
      return { ...p, name: alias || tr(p.name) };
    });
    // The locale is a dependency because tr() reads it.
  }, [providers, settings.providerAliases, locale]);

  useNotifications(displayProviders, activities, statuses, settings);
  const costs = useCosts(true, costDays);
  const dock = useDockWindow(settings, expanded);

  const visibleProviders = useMemo(
    () => arrangeProviders(displayProviders, settings),
    [displayProviders, settings.providerOrder, settings.hiddenProviders]
  );
  const slots = useMemo(
    () => compactSlots(visibleProviders, settings.antigravityGroupMode),
    [visibleProviders, settings.antigravityGroupMode]
  );
  const slotIds = useMemo(() => slots.map((slot) => slot.id), [slots]);
  const finish = useFinishSignal(activities, slotIds);
  const activityFor = (id: string) => activityForSlot(activities, id);

  // Dialogs (native folder picker, confirm) blur the window; they must not close the panel.
  const dialogDepthRef = useRef(0);
  const withDialog = useCallback(async <T,>(run: () => Promise<T> | T): Promise<T> => {
    dialogDepthRef.current += 1;
    try {
      return await run();
    } finally {
      window.setTimeout(() => {
        dialogDepthRef.current -= 1;
      }, 400);
    }
  }, []);

  // Theme ------------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    applyStoredColor("--question", settings.questionColor);
    applyStoredColor("--permission", settings.permissionColor);
    applyStoredColor("--done", settings.doneColor);
  }, [settings.theme, settings.questionColor, settings.permissionColor, settings.doneColor]);

  // Glass reaches the peek, the signal list and the open panel, not only the pill.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.glassEnabled) {
      root.dataset.glass = "on";
      root.style.setProperty("--glass-t", String(Math.min(100, Math.max(0, settings.glassOpacity)) / 100));
    } else {
      delete root.dataset.glass;
      root.style.removeProperty("--glass-t");
    }
  }, [settings.glassEnabled, settings.glassOpacity]);

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "pt-BR";
  }, [locale]);

  // One-time reads ---------------------------------------------------------
  useEffect(() => {
    fetchMonitors().then(setMonitors).catch(() => setMonitors([]));
    if (!isTauri()) return;
    void shareWebUserAgent().catch(() => undefined);
    autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  // Panel actions ----------------------------------------------------------
  // True while the panel was opened by the global shortcut: copying then hands focus back.
  const paletteModeRef = useRef(false);

  const openPanel = useCallback(
    (slotId?: string) => {
      paletteModeRef.current = false;
      dock.resetPeek();
      setSettingsOpen(false);
      if (slotId) {
        setView("usage");
        setFocusProvider(baseProviderId(slotId));
      }
      setExpanded(true);
    },
    [dock.resetPeek]
  );

  const collapse = useCallback(() => {
    setExpanded(false);
    setSettingsOpen(false);
  }, []);

  const openSettings = useCallback(
    (tab?: SettingsTab) => {
      dock.resetPeek();
      if (tab) setSettingsTab(tab);
      setSettingsOpen(true);
      setExpanded(true);
    },
    [dock.resetPeek]
  );

  const finishOnboarding = useCallback(() => {
    update({ onboarded: true });
    setShowOnboarding(false);
  }, [update]);

  const chooseFolder = useCallback(async () => {
    const path = await withDialog(() => chooseObsidianFolder());
    if (path) update({ obsidianPath: path });
  }, [update, withDialog]);

  // Keep on top, hide for full-screen apps ---------------------------------
  const hideOnFullscreenRef = useRef(settings.hideOnFullscreen);
  hideOnFullscreenRef.current = settings.hideOnFullscreen;
  useEffect(() => {
    const raise = () => void raiseDock(hideOnFullscreenRef.current).catch(() => undefined);
    const tick = window.setInterval(raise, 2500);
    window.addEventListener("focus", raise);
    document.addEventListener("visibilitychange", raise);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", raise);
      document.removeEventListener("visibilitychange", raise);
    };
  }, []);

  // Esc and click-outside close the panel ----------------------------------
  const blurStateRef = useRef({ expanded, settingsOpen, showOnboarding, closeOnBlur: settings.closeOnBlur });
  blurStateRef.current = { expanded, settingsOpen, showOnboarding, closeOnBlur: settings.closeOnBlur };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !blurStateRef.current.expanded) return;
      if (blurStateRef.current.showOnboarding) return;
      if (blurStateRef.current.settingsOpen) setSettingsOpen(false);
      else collapse();
    };
    let timer: number | null = null;
    const onBlur = () => {
      const state = blurStateRef.current;
      // Settings stay open on blur: people leave to copy the sessionKey from the browser.
      if (!state.expanded || !state.closeOnBlur || state.settingsOpen || state.showOnboarding) return;
      timer = window.setTimeout(() => {
        if (!document.hasFocus() && dialogDepthRef.current === 0) collapse();
      }, 150);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [collapse]);

  // Global shortcut: prompt palette from anywhere -------------------------
  const paletteRef = useRef<() => void>(() => undefined);
  paletteRef.current = () => {
    if (expanded && view === "prompts" && !settingsOpen && !showOnboarding) {
      collapse();
      return;
    }
    paletteModeRef.current = true;
    dock.resetPeek();
    setSettingsOpen(false);
    setView("prompts");
    setExpanded(true);
    setPromptFocusKey((key) => key + 1);
    void rememberForeground()
      .catch(() => undefined)
      .then(() => focusDock())
      .catch(() => undefined);
  };

  const onPromptCopied = () => {
    if (!paletteModeRef.current && !settings.autoPaste) return;
    paletteModeRef.current = false;
    collapse();
    void returnFocus(settings.autoPaste).catch(() => undefined);
  };

  const onShellEnter = () => {
    dock.onShellEnter();
    // The app under the pointer still has focus here; remember it for paste-back.
    void rememberForeground().catch(() => undefined);
  };

  useEffect(() => {
    if (!isTauri() || !settings.globalShortcut) {
      setShortcutError(null);
      return;
    }
    let registered = false;
    register(GLOBAL_SHORTCUT, (event) => {
      if (event.state === "Pressed") paletteRef.current();
    })
      .then(() => {
        registered = true;
        setShortcutError(null);
      })
      .catch(() =>
        setShortcutError(
          t("Não foi possível registrar {shortcut}. Outro app pode estar usando esse atalho.", { shortcut: t(GLOBAL_SHORTCUT_LABEL) })
        )
      );
    return () => {
      if (registered) void unregister(GLOBAL_SHORTCUT).catch(() => undefined);
    };
  }, [settings.globalShortcut]);

  // Claude sign-in window ----------------------------------------------------
  const reconnectClaude = useCallback(() => {
    claudeLogin().catch(() => openSettings("connections"));
  }, [openSettings]);

  const refreshAfterLoginRef = useRef(refresh);
  refreshAfterLoginRef.current = refresh;
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    void onClaudeLogin((event) => {
      if (event.status === "connected") void refreshAfterLoginRef.current({ force: true });
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Tray -------------------------------------------------------------------
  const trayRef = useRef<(action: string) => void>(() => undefined);
  trayRef.current = (action) => {
    if (action === "refresh") void refresh({ force: true });
    else if (action === "pause") update({ notificationsPausedUntil: Date.now() + 60 * 60 * 1000 });
    else if (action === "resume") update({ notificationsPausedUntil: null });
    else if (action === "settings") openSettings();
    else openPanel();
  };
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let alive = true;
    void onTrayAction((action) => trayRef.current(action)).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // A timed pause ends on its own; drop it so the tray offers "Pause" again.
  const pausedUntil = settings.notificationsPausedUntil;
  useEffect(() => {
    if (pausedUntil == null) return;
    const left = pausedUntil - Date.now();
    if (left <= 0) {
      update({ notificationsPausedUntil: null });
      return;
    }
    const timer = window.setTimeout(() => update({ notificationsPausedUntil: null }), Math.min(left, 2 ** 31 - 1));
    return () => window.clearTimeout(timer);
  }, [pausedUntil, update]);

  useEffect(() => {
    void setTrayMenu({
      open: t("Abrir painel"),
      refresh: t("Atualizar uso"),
      pause: t("Pausar notificações por 1h"),
      resume: t("Retomar notificações"),
      settings: t("Configurações"),
      quit: t("Encerrar AI Dock"),
      paused: pausedUntil != null
    }).catch(() => undefined);
  }, [locale, pausedUntil]);

  useEffect(() => {
    const parts = visibleProviders
      .map((provider) => {
        const remaining = providerHeadroom(provider, settings.headline);
        if (remaining == null) return null;
        const value = shownPercent(remaining, settings.display, provider.id);
        return provider.name + " " + value + "% " + displayWord(settings.display, provider.id) + (provider.stale ? " (" + t("antigo") + ")" : "");
      })
      .filter(Boolean);
    void setTrayTooltip(parts.length ? "AI Dock · " + parts.join(" · ") : "AI Dock").catch(() => undefined);
  }, [visibleProviders, settings.display, settings.headline, locale]);

  // Autostart --------------------------------------------------------------
  const toggleAutostart = useCallback(async (next: boolean) => {
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
      setAutostart(await autostartEnabled());
    } catch {
      setAutostart(null);
    }
  }, []);

  // Scroll to the provider picked in the dock -----------------------------
  const cardRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!expanded || !focusProvider || settingsOpen || view !== "usage") return;
    const frame = window.requestAnimationFrame(() =>
      cardRefs.current.get(focusProvider)?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
    const clear = window.setTimeout(() => setFocusProvider(null), 1600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clear);
    };
  }, [expanded, focusProvider, settingsOpen, view]);

  // Peek placement: centered on the hovered slot, kept inside the window ---
  const stageRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLElement>(null);
  const peekProvider = slots.find((slot) => slot.id === dock.peekId) || null;

  useLayoutEffect(() => {
    if (!peekProvider) return;
    const position = () => {
      const slot = stageRef.current?.querySelector<HTMLElement>('[data-slot="' + peekProvider.id + '"]');
      const card = peekRef.current;
      if (!slot || !card) return;
      const rect = slot.getBoundingClientRect();
      const height = card.offsetHeight;
      const max = Math.max(8, window.innerHeight - height - 8);
      setPeekTop(Math.round(Math.min(max, Math.max(8, rect.top + rect.height / 2 - height / 2))));
    };
    position();
    const observer = new ResizeObserver(position);
    if (peekRef.current) observer.observe(peekRef.current);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [peekProvider, dock.peekPhase]);

  // Windows hit testing: the spare peek width must not catch clicks. --------
  const hitKeyRef = useRef("");
  useLayoutEffect(() => {
    if (!isTauri()) return;
    let frame = 0;
    const send = () => {
      if (expanded || dock.hidden) {
        if (hitKeyRef.current === "off") return;
        hitKeyRef.current = "off";
        void setDockHits(false, []);
        return;
      }
      const root = stageRef.current?.closest(".compact-shell");
      if (!root) return;
      const boxes: { x: number; y: number; width: number; height: number }[] = [];
      const take = (el: Element) => {
        if (!(el instanceof HTMLElement)) return;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      };
      root
        .querySelectorAll(".dock-pill, .dock-mascot-stack, .dock-mascot__img, .dock-signals, .dock-signal-list")
        .forEach(take);
      const peek = root.querySelector(".peek-wrap--open");
      if (peek) {
        take(peek);
        const pill = root.querySelector(".dock-pill");
        if (pill) {
          const pillBox = pill.getBoundingClientRect();
          const peekBox = peek.getBoundingClientRect();
          const top = Math.min(pillBox.top, peekBox.top);
          const bottom = Math.max(pillBox.bottom, peekBox.bottom);
          if (peekBox.right < pillBox.left) {
            boxes.push({ x: peekBox.right, y: top, width: pillBox.left - peekBox.right, height: bottom - top });
          } else if (pillBox.right < peekBox.left) {
            boxes.push({ x: pillBox.right, y: top, width: peekBox.left - pillBox.right, height: bottom - top });
          }
        }
      }
      const key = JSON.stringify(boxes);
      if (key === hitKeyRef.current) return;
      hitKeyRef.current = key;
      void setDockHits(true, boxes);
    };
    send();
    const root = stageRef.current?.closest(".compact-shell");
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(send);
    });
    const mutationObserver = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(send);
    });
    if (root) {
      resizeObserver.observe(root);
      root
        .querySelectorAll(".dock-pill, .dock-mascot-stack, .dock-mascot__img, .dock-signals, .dock-signal-list, .peek-wrap")
        .forEach((node) => resizeObserver.observe(node));
      mutationObserver.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }
    window.addEventListener("resize", send);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", send);
    };
  }, [expanded, dock.hidden, dock.peekPhase, dock.overlay, peekTop, settings.side, settings.mascotEnabled]);

  // Compact dock -----------------------------------------------------------
  if (!expanded) {
    if (dock.hidden) {
      let worst: QuotaTone = "empty";
      for (const slot of slots) {
        const tone = quotaTone(providerHeadroom(slot));
        if (TONE_RANK[tone] > TONE_RANK[worst]) worst = tone;
      }
      let permission = false;
      let question = false;
      let working = false;
      let finished = false;
      for (const slot of slots) {
        const activity = activityFor(slot.id);
        const kind = waitKind(activity);
        if (kind === "permission") permission = true;
        else if (kind === "question") question = true;
        if (activity?.state === "working") working = true;
        if (kind == null && finish.done.has(slot.id)) finished = true;
      }
      const strip = stripNotice({ permission, question, working, done: finished });
      return (
        <main
          className={"compact-shell compact-shell--" + settings.side + " is-hidden"}
          onMouseEnter={onShellEnter}
          aria-label={t("AI Dock oculto. Passe o mouse para mostrar.")}
        >
          <div
            className={"dock-handle dock-handle--" + worst}
            data-activity={strip.activity}
            data-wait={strip.wait ?? undefined}
            data-signal={strip.done ? "done" : undefined}
            style={{ height: Math.round(dock.anchorHeight * 0.45) }}
          />
        </main>
      );
    }

    return (
      <main
        className={
          "compact-shell compact-shell--" +
          settings.side +
          (settings.mascotEnabled ? " compact-shell--mascot" : "")
        }
        style={
          settings.mascotEnabled
            ? ({ "--mascot-overlay": dock.overlay.height + "px" } as CSSProperties)
            : undefined
        }
        onMouseEnter={onShellEnter}
        onMouseLeave={dock.onShellLeave}
      >
        <div className="compact-stage" ref={stageRef}>
          <DockPill
            pillRef={dock.pillRef}
            slots={slots}
            mode={settings.compactMode}
            showSign={settings.showSign}
            display={settings.display}
            headline={settings.headline}
            antigravityGroupMode={settings.antigravityGroupMode}
            activityIndicator={settings.activityIndicator}
            pulseActiveBar={settings.pulseActiveBar}
            hideBarsNumber={settings.hideBarsNumber}
            activities={activities}
            finished={finish.done}
            statuses={statuses}
            side={settings.side}
            loading={loading}
            mascot={settings.mascotEnabled}
            mascotKind={settings.mascot === "robot" && ROBOT_READY ? "robot" : "cat"}
            glass={settings.glassEnabled}
            glassOpacity={settings.glassOpacity}
            onMascotOverlay={dock.setOverlay}
            onSeen={finish.dismiss}
            lockPosition={settings.lockPosition}
            verticalOffset={settings.verticalOffset}
            onOffsetChange={(verticalOffset) => setSettings((current) => ({ ...current, verticalOffset }))}
            onOffsetCommit={(verticalOffset) => update({ verticalOffset })}
            onOpen={openPanel}
            onHoverSlot={(id) => {
              // An old reading gets a quiet refresh while the peek opens.
              if (!lastUpdatedAt || Date.now() - lastUpdatedAt > 60_000) void refresh({ background: true });
              void dock.openPeek(id);
            }}
          />

          {peekProvider ? (
            <div
              className={"peek-wrap peek-wrap--" + dock.peekPhase}
              style={{ top: peekTop }}
              onMouseEnter={dock.clearCloseTimer}
            >
              <ProviderPeek
                ref={peekRef}
                provider={peekProvider}
                activity={activityFor(peekProvider.id)}
                status={statusFor(statuses, baseProviderId(peekProvider.id))}
                updatedAt={lastUpdatedAt}
                display={settings.display}
                now={now}
                onOpen={() => openPanel(peekProvider.id)}
              />
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  // Expanded panel ---------------------------------------------------------
  const stale = lastUpdatedAt != null && now - lastUpdatedAt > settings.refreshMinutes * 2 * 60000;
  const status = loading
    ? t("Atualizando…")
    : failed
      ? t("Falha ao atualizar")
      : lastUpdatedAt
        ? t("Atualizado {age}", { age: formatAge(lastUpdatedAt, now) })
        : t("Aguardando leitura");
  const CollapseIcon = settings.side === "right" ? ChevronRight : ChevronLeft;

  return (
    <main className={"app-shell app-shell--" + settings.side}>
      <div className="dock-panel">
        <header className="app-header" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <span className="brand-mark" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div data-tauri-drag-region>
              <div className="brand-name">AI Dock</div>
              <div className={"brand-status" + (stale || failed ? " is-stale" : "")} aria-live="polite">
                {stale || failed ? <AlertTriangle size={11} aria-hidden="true" /> : null}
                {status}
              </div>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={"icon-button" + (loading ? " is-spinning" : "")}
              onClick={() => void refresh({ force: true })}
              aria-label={t("Atualizar uso agora")}
              title={t("Atualizar uso agora")}
            >
              <RefreshCw size={15} />
            </button>
            <button
              type="button"
              className={"icon-button" + (settingsOpen ? " is-active" : "")}
              onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
              aria-label={t("Configurações")}
              aria-pressed={settingsOpen}
              title={t("Configurações")}
            >
              <Settings2 size={16} />
            </button>
            <button type="button" className="icon-button" onClick={collapse} aria-label={t("Recolher (Esc)")} title={t("Recolher (Esc)")}>
              <CollapseIcon size={17} />
            </button>
          </div>
        </header>

        {settingsOpen ? (
          <>
            <div className="subheader">
              <h2>{t("Configurações")}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSettingsOpen(false)}
                aria-label={t("Fechar configurações")}
              >
                <X size={15} />
              </button>
            </div>
            <SettingsPanel
              tab={settingsTab}
              onTab={setSettingsTab}
              settings={settings}
              update={update}
              providers={displayProviders}
              rawProviders={providers}
              activities={activities}
              finished={finish.done}
              monitors={monitors}
              autostart={autostart}
              onAutostart={(next) => void toggleAutostart(next)}
              shortcutError={shortcutError}
              version={version}
              onChooseFolder={() => void chooseFolder()}
              onProvidersChanged={() => void refresh({ force: true })}
              onTestNotification={() => void notify("AI Dock", t("As notificações estão funcionando."), true)}
              onReplayOnboarding={() => {
                setSettingsOpen(false);
                setShowOnboarding(true);
              }}
              onQuit={() => void quitApp()}
              withDialog={withDialog}
            />
          </>
        ) : (
          <>
            <div className="view-tabs" role="tablist" aria-label={t("Conteúdo do painel")}>
              <button
                type="button"
                role="tab"
                aria-selected={view === "usage"}
                className={view === "usage" ? "is-selected" : ""}
                onClick={() => setView("usage")}
              >
                {t("Uso")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "costs"}
                className={view === "costs" ? "is-selected" : ""}
                onClick={() => setView("costs")}
              >
                {t("Custos")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "prompts"}
                className={view === "prompts" ? "is-selected" : ""}
                onClick={() => {
                  setView("prompts");
                  setPromptFocusKey((key) => key + 1);
                }}
              >
                Prompts
                {promptState.prompts.length ? <small>{promptState.prompts.length}</small> : null}
              </button>
            </div>

            <div className="panel-scroll" role="tabpanel">
              {view === "usage" ? (
                <div className="usage-stack">
                  {visibleProviders.length === 0 && loading
                    ? [0, 1, 2].map((index) => <UsageCardSkeleton key={index} />)
                    : visibleProviders.map((provider) => (
                        <UsageCard
                          key={provider.id}
                          ref={(node) => {
                            if (node) cardRefs.current.set(provider.id, node);
                            else cardRefs.current.delete(provider.id);
                          }}
                          provider={provider}
                          activity={activityFor(provider.id)}
                          display={settings.display}
                          headline={settings.headline}
                          history={history}
                          historyRange={settings.historyRange}
                          status={statusFor(statuses, provider.id)}
                          now={now}
                          highlighted={focusProvider === provider.id}
                          onConnect={provider.id === "claude" ? reconnectClaude : undefined}
                        />
                      ))}
                  {visibleProviders.length === 0 && !loading ? (
                    <button type="button" className="empty-state" onClick={() => openSettings("connections")}>
                      <span>{t("Nenhum provider visível")}</span>
                      <small>{t("Escolha quais mostrar em Configurações → Conexões.")}</small>
                    </button>
                  ) : null}
                </div>
              ) : view === "costs" ? (
                <CostsView
                  report={costs.report}
                  loading={costs.loading}
                  days={costDays}
                  onDays={setCostDays}
                  onReload={() => void costs.reload()}
                />
              ) : (
                <PromptLibrary
                  prompts={promptState.prompts}
                  obsidianPath={settings.obsidianPath}
                  scanning={promptState.scanning}
                  error={promptState.error}
                  focusKey={promptFocusKey}
                  onChooseFolder={() => void chooseFolder()}
                  onRescan={() => void promptState.rescan()}
                  onCopied={onPromptCopied}
                />
              )}
            </div>
          </>
        )}

        {showOnboarding ? (
          <Onboarding
            providers={providers}
            loading={loading}
            settings={settings}
            update={update}
            onOpenConnections={() => {
              finishOnboarding();
              openSettings("connections");
              reconnectClaude();
            }}
            onFinish={finishOnboarding}
          />
        ) : null}
      </div>
    </main>
  );
}
