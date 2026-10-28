import { ArrowDown, ArrowUp, Check, Eye, EyeOff, FolderOpen, Monitor as MonitorIcon, Pencil, Power, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { intlLocale, t, tr } from "../lib/i18n";
import { currentPlatform } from "../lib/platform";
import { compactSlots } from "../lib/quota";
import { ROBOT_READY } from "../lib/robot-art";
import { GLOBAL_SHORTCUT_LABEL, REFRESH_CHOICES } from "../lib/settings";
import type {
  CompactMode,
  MonitorInfo,
  ProviderActivity,
  ProviderUsage,
  Settings,
  SettingsTab
} from "../types";
import { ClaudeConnectCard } from "./ClaudeConnectCard";
import { Segmented, Select, Switch } from "./controls";
import { DockPill } from "./DockPill";
import { ProviderIcon } from "./ProviderIcon";

export const COMPACT_MODES: { id: CompactMode; title: string; description: string }[] = [
  { id: "ring", title: "Círculo", description: "Anel de quota + %" },
  { id: "bars", title: "Barras", description: "Barras de quota" },
  { id: "square", title: "Quadrado", description: "Borda de quota + %" },
  { id: "percent", title: "Números", description: "Ícone + % colorido" },
  { id: "classic", title: "Clássico", description: "Ícone + status" }
];

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "Aparência" },
  { id: "position", label: "Posição" },
  { id: "general", label: "Geral" },
  { id: "connections", label: "Conexões" }
];

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
  deepseek: "DeepSeek",
  grok: "Grok",
  "grok-bot": t("Grok Bot")
};

export type SettingsPanelProps = {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  providers: ProviderUsage[];
  rawProviders?: ProviderUsage[];
  activities: ProviderActivity[];
  finished?: ReadonlySet<string>;
  monitors: MonitorInfo[];
  autostart: boolean | null;
  onAutostart: (next: boolean) => void;
  shortcutError: string | null;
  version: string | null;
  onChooseFolder: () => void;
  onProvidersChanged: () => void;
  onTestNotification: () => void;
  onReplayOnboarding: () => void;
  onQuit: () => void;
  withDialog: <T>(run: () => Promise<T> | T) => Promise<T>;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="settings-label">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { tab, onTab } = props;
  return (
    <div className="settings">
      <div className="tabs" role="tablist" aria-label={t("Seções das configurações")}>
        {TABS.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={"settings-tab-" + item.id}
            aria-selected={tab === item.id}
            aria-controls="settings-tabpanel"
            className={tab === item.id ? "is-selected" : ""}
            onClick={() => onTab(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className="panel-scroll" role="tabpanel" id="settings-tabpanel" aria-labelledby={"settings-tab-" + tab}>
        {tab === "appearance" ? <AppearanceTab {...props} /> : null}
        {tab === "position" ? <PositionTab {...props} /> : null}
        {tab === "general" ? <GeneralTab {...props} /> : null}
        {tab === "connections" ? <ConnectionsTab {...props} /> : null}
      </div>
    </div>
  );
}

export function CompactModePicker({ value, onChange }: { value: CompactMode; onChange: (mode: CompactMode) => void }) {
  return (
    <div className="mode-picker" role="radiogroup" aria-label={t("Visual do dock recolhido")}>
      {COMPACT_MODES.map((mode) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === mode.id}
          key={mode.id}
          className={value === mode.id ? "is-selected" : ""}
          onClick={() => onChange(mode.id)}
        >
          <strong>{t(mode.title)}</strong>
          <small>{t(mode.description)}</small>
        </button>
      ))}
    </div>
  );
}

const QUESTION_DEFAULTS = ["#FF4D8D", "#D4277A"] as const;
const PERMISSION_DEFAULTS = ["#FF7A45", "#E85D20"] as const;
const DONE_DEFAULTS = ["#D6FF4A", "#6A9A00"] as const;

function useSystemDark() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return dark;
}

function defaultSignalHex(defaults: readonly [string, string], theme: Settings["theme"], systemDark: boolean) {
  return theme === "dark" || (theme === "system" && systemDark) ? defaults[0] : defaults[1];
}

type Hsv = { h: number; s: number; v: number };

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function questionSoft(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, .14)`;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(red: number, green: number, blue: number) {
  const channel = (part: number) => Math.round(part).toString(16).padStart(2, "0");
  return "#" + channel(red) + channel(green) + channel(blue);
}

function rgbToHsv(red: number, green: number, blue: number): Hsv {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToRgb(hsv: Hsv): [number, number, number] {
  const c = hsv.v * hsv.s;
  const hp = hsv.h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = hsv.v - c;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hsvToHex(hsv: Hsv) {
  const [red, green, blue] = hsvToRgb(hsv);
  return rgbToHex(red, green, blue);
}

function hexToHsv(hex: string) {
  const [red, green, blue] = hexToRgb(hex);
  return rgbToHsv(red, green, blue);
}

/** Theme defaults stay null so light and dark keep their own token. */
function storedSignalColor(hex: string, defaults: readonly string[]): string | null {
  const upper = hex.toUpperCase();
  if (defaults.some((item) => item.toUpperCase() === upper)) return null;
  return hex.toLowerCase();
}

function sameSignalColor(a: string | null, b: string | null) {
  if (a == null || b == null) return a == null && b == null;
  return a.toUpperCase() === b.toUpperCase();
}

function applySignalColor(cssVar: string, hex: string | null) {
  const root = document.documentElement;
  if (hex == null) {
    root.style.removeProperty(cssVar);
    root.style.removeProperty(cssVar + "-soft");
    return;
  }
  root.style.setProperty(cssVar, hex);
  root.style.setProperty(cssVar + "-soft", questionSoft(hex));
}

function SignalColorControl({
  label,
  cssVar,
  defaults,
  value,
  fallback,
  onCommit
}: {
  label: string;
  cssVar: "--question" | "--permission" | "--done";
  defaults: readonly [string, string];
  value: string | null;
  fallback: string;
  onCommit: (next: string | null) => void;
}) {
  const shown = (value ?? fallback).toLowerCase();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(shown);
  const [hsv, setHsv] = useState(() => hexToHsv(shown));
  const [rgbText, setRgbText] = useState(() => hexToRgb(shown).map(String));
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const hsvRef = useRef(hsv);
  const latestHex = useRef(shown);
  const draggingRef = useRef(false);
  const modeRef = useRef<"sv" | "hue">("sv");
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rgbTextRef = useRef(rgbText);
  const valueRef = useRef(value);
  const fallbackRef = useRef(fallback);
  const onCommitRef = useRef(onCommit);
  const cssVarRef = useRef(cssVar);
  const defaultsRef = useRef(defaults);
  hsvRef.current = hsv;
  rgbTextRef.current = rgbText;
  valueRef.current = value;
  fallbackRef.current = fallback;
  onCommitRef.current = onCommit;
  cssVarRef.current = cssVar;
  defaultsRef.current = defaults;

  useEffect(() => {
    if (draggingRef.current) return;
    latestHex.current = shown;
    if (hsvToHex(hsvRef.current).toLowerCase() === shown) {
      setDraft(shown);
      setRgbText(hexToRgb(shown).map(String));
      return;
    }
    const next = hexToHsv(shown);
    hsvRef.current = next;
    setDraft(shown);
    setHsv(next);
    setRgbText(hexToRgb(shown).map(String));
  }, [shown]);

  const paint = (next: Hsv, hex: string) => {
    const text = hexToRgb(hex).map(String);
    hsvRef.current = next;
    latestHex.current = hex;
    rgbTextRef.current = text;
    // The dock preview reads these variables. Settings stay untouched until release.
    applySignalColor(cssVarRef.current, hex);
    setDraft(hex);
    setHsv(next);
    setRgbText(text);
  };

  const commitHex = (hex: string) => {
    const stored = storedSignalColor(hex, defaultsRef.current);
    const visible = (stored ?? fallbackRef.current).toLowerCase();
    applySignalColor(cssVarRef.current, stored == null ? null : visible);
    const kept = hsvToHex(hsvRef.current).toLowerCase() === visible ? hsvRef.current : hexToHsv(visible);
    const text = hexToRgb(visible).map(String);
    hsvRef.current = kept;
    latestHex.current = visible;
    rgbTextRef.current = text;
    setDraft(visible);
    setHsv(kept);
    setRgbText(text);
    if (!sameSignalColor(stored, valueRef.current)) onCommitRef.current(stored);
  };

  const applyPointer = (x: number, y: number) => {
    const surface = modeRef.current === "sv" ? svRef.current : hueRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const current = hsvRef.current;
    const next =
      modeRef.current === "sv"
        ? { h: current.h, s: clamp01((x - rect.left) / rect.width), v: 1 - clamp01((y - rect.top) / rect.height) }
        : { h: clamp01((x - rect.left) / rect.width) * 360, s: current.s, v: current.v };
    paint(next, hsvToHex(next));
  };

  const queuePointer = (x: number, y: number) => {
    pendingRef.current = { x, y };
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      applyPointer(pending.x, pending.y);
    });
  };

  const flushPointer = () => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) applyPointer(pending.x, pending.y);
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, mode: "sv" | "hue") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    modeRef.current = mode;
    queuePointer(event.clientX, event.clientY);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    queuePointer(event.clientX, event.clientY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    flushPointer();
    draggingRef.current = false;
    commitHex(latestHex.current);
  };

  const commitRgbText = () => {
    const channels = rgbTextRef.current.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
    if (channels.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      setRgbText(hexToRgb(latestHex.current).map(String));
      return;
    }
    const [red, green, blue] = channels as [number, number, number];
    commitHex(rgbToHex(red, green, blue));
  };

  useLayoutEffect(() => {
    if (!open) return;
    const placePopover = () => {
      const button = buttonRef.current;
      const pop = popRef.current;
      if (!button || !pop) return;
      const anchor = button.getBoundingClientRect();
      const box = pop.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      let top = anchor.bottom + gap;
      if (top + box.height > window.innerHeight - margin) top = anchor.top - gap - box.height;
      let left = anchor.right - box.width;
      left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));
      setPlace({ top, left });
    };
    placePopover();
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (draggingRef.current) {
        flushPointer();
        draggingRef.current = false;
        commitHex(latestHex.current);
      } else {
        commitRgbText();
      }
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      commitRgbText();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const restore = () => {
    applySignalColor(cssVarRef.current, null);
    const next = hexToHsv(fallback.toLowerCase());
    hsvRef.current = next;
    latestHex.current = fallback.toLowerCase();
    setDraft(fallback.toLowerCase());
    setHsv(next);
    setRgbText(hexToRgb(fallback).map(String));
    if (value != null) onCommit(null);
  };

  return (
    <div className="question-color">
      <button
        type="button"
        ref={buttonRef}
        className="question-color__swatch"
        style={{ background: draft }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      <button type="button" className="button button--small" onClick={restore} disabled={value == null}>
        {t("Restaurar padrão")}
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="question-popover"
              role="dialog"
              aria-label={label}
              style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: "hidden" }}
            >
              <div
                ref={svRef}
                className="question-popover__sv"
                style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
                onPointerDown={(event) => startDrag(event, "sv")}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="question-popover__thumb" style={{ left: hsv.s * 100 + "%", top: (1 - hsv.v) * 100 + "%" }} />
              </div>
              <div
                ref={hueRef}
                className="question-popover__hue"
                onPointerDown={(event) => startDrag(event, "hue")}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <span className="question-popover__thumb" style={{ left: (hsv.h / 360) * 100 + "%", top: "50%" }} />
              </div>
              <div className="question-popover__rgb">
                {(["R", "G", "B"] as const).map((channel, index) => (
                  <label key={channel}>
                    {channel}
                    <input
                      value={rgbText[index]}
                      inputMode="numeric"
                      aria-label={channel}
                      spellCheck={false}
                      onChange={(event) => {
                        const text = event.target.value.replace(/\D/g, "").slice(0, 3);
                        setRgbText((current) => {
                          const next = [...current];
                          next[index] = text;
                          rgbTextRef.current = next;
                          return next;
                        });
                      }}
                      onBlur={commitRgbText}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        event.currentTarget.blur();
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function SignalSample({
  providerId,
  label,
  wait,
  done = false
}: {
  providerId: string;
  label: string;
  wait?: "permission" | "question";
  done?: boolean;
}) {
  return (
    <span
      className="signal-preview__item"
      data-activity={wait ? "waiting" : undefined}
      data-wait={wait}
      data-signal={done ? "done" : undefined}
    >
      <span className="slot-icon">
        <ProviderIcon providerId={providerId} size={18} />
      </span>
      <span className="signal-preview__track" aria-hidden="true">
        <span className="signal-preview__fill" />
      </span>
      <small>{label}</small>
    </span>
  );
}

function AppearanceTab({ settings, update, providers, activities, finished }: SettingsPanelProps) {
  const systemDark = useSystemDark();
  const previewSlots = useMemo(() => {
    const slots = compactSlots(providers, settings.antigravityGroupMode).slice(0, 3);
    if (slots.length) return slots;
    return [
      { id: "claude", name: "Claude", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 72 }] },
      { id: "codex", name: "Codex", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 41 }] },
      { id: "cursor", name: "Cursor", connected: true, windows: [{ id: "s", label: "Sessão", remainingPercent: 12 }] }
    ];
  }, [providers]);

  return (
    <>
      <Group title={t("Interface e Tema")}>
        <Select
          label={t("Idioma")}
          description={t("Idioma da interface do AI Dock.")}
          value={settings.language}
          onChange={(language) => update({ language })}
          options={[
            { value: "auto", label: t("Automático (Sistema)") },
            { value: "pt", label: "Português" },
            { value: "en", label: "English" }
          ]}
        />
        <Select
          label={t("Tema")}
          description={t("Aparência clara, escura ou do sistema.")}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "system", label: t("Seguir o Sistema") },
            { value: "dark", label: t("Escuro") },
            { value: "light", label: t("Claro") }
          ]}
        />
        <div className="select-setting-row">
          <div className="select-setting-row__copy">
            <strong>{t("Cor de pergunta")}</strong>
            <small>{t("Quando uma IA espera sua resposta. A cor da quota não muda.")}</small>
          </div>
          <SignalColorControl
            label={t("Cor de pergunta")}
            cssVar="--question"
            defaults={QUESTION_DEFAULTS}
            value={settings.questionColor}
            fallback={defaultSignalHex(QUESTION_DEFAULTS, settings.theme, systemDark)}
            onCommit={(questionColor) => update({ questionColor })}
          />
        </div>
        <div className="select-setting-row">
          <div className="select-setting-row__copy">
            <strong>{t("Cor de permissão")}</strong>
            <small>{t("Quando uma IA pede permissão para agir. A cor da quota não muda.")}</small>
          </div>
          <SignalColorControl
            label={t("Cor de permissão")}
            cssVar="--permission"
            defaults={PERMISSION_DEFAULTS}
            value={settings.permissionColor}
            fallback={defaultSignalHex(PERMISSION_DEFAULTS, settings.theme, systemDark)}
            onCommit={(permissionColor) => update({ permissionColor })}
          />
        </div>
        <div className="select-setting-row">
          <div className="select-setting-row__copy">
            <strong>{t("Cor de finalização")}</strong>
            <small>{t("Quando uma IA termina uma tarefa. Fica aceso até você ver o dock.")}</small>
          </div>
          <SignalColorControl
            label={t("Cor de finalização")}
            cssVar="--done"
            defaults={DONE_DEFAULTS}
            value={settings.doneColor}
            fallback={defaultSignalHex(DONE_DEFAULTS, settings.theme, systemDark)}
            onCommit={(doneColor) => update({ doneColor })}
          />
        </div>
      </Group>

      <Group title={t("Dock recolhido")}>
        <div className="mascot-row">
          <Switch
            label={t("Mascote")}
            description={t("Mostra o gato no topo do dock recolhido.")}
            checked={settings.mascotEnabled}
            onChange={(mascotEnabled) => update({ mascotEnabled })}
          />
          <div className="mascot-choice" role="radiogroup" aria-label={t("Mascote")}>
            <button
              type="button"
              role="radio"
              aria-checked={settings.mascot !== "robot" || !ROBOT_READY}
              className={settings.mascot !== "robot" || !ROBOT_READY ? "is-selected" : ""}
              onClick={() => update({ mascot: "cat" })}
            >
              {t("Gato")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.mascot === "robot" && ROBOT_READY}
              className={settings.mascot === "robot" && ROBOT_READY ? "is-selected" : ""}
              disabled={!ROBOT_READY}
              onClick={() => update({ mascot: "robot" })}
            >
              {t("Robô")}
            </button>
          </div>
        </div>
        {!ROBOT_READY ? <p className="mascot-choice__note">{t("Faltam os frames do robô.")}</p> : null}
        <Switch
          label={t("Vidro · beta")}
          description={t("Fundo translúcido na pill. O tema claro e escuro fica igual.")}
          checked={settings.glassEnabled}
          onChange={(glassEnabled) => update({ glassEnabled })}
        />
        {settings.glassEnabled ? (
          <div className="glass-opacity">
            <div className="range-row">
              <span className="glass-opacity__label">{t("Transparência")}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.glassOpacity}
                aria-label={t("Transparência")}
                onChange={(event) => update({ glassOpacity: Number(event.target.value) })}
              />
              <span className="range-value">{settings.glassOpacity}</span>
            </div>
            <p className="hint">
              {t("0 é o vidro mais sólido. 100 é o mais transparente em que os números ainda se leem.")}
            </p>
          </div>
        ) : null}
        <div className="mode-preview-layout">
          <div className="mode-preview" aria-hidden="true">
            <div className="signal-preview">
              <SignalSample providerId="codex" label={t("Pergunta")} wait="question" />
              <SignalSample providerId="cursor" label={t("Permissão")} wait="permission" />
              <SignalSample providerId="claude" label={t("Finalização")} done />
            </div>
            <DockPill
              slots={previewSlots}
              mode={settings.compactMode}
              showSign={settings.showSign}
              display={settings.display}
              headline={settings.headline}
              antigravityGroupMode={settings.antigravityGroupMode}
              activityIndicator={settings.activityIndicator}
              pulseActiveBar={settings.pulseActiveBar}
              hideBarsNumber={settings.hideBarsNumber}
              activities={activities}
              finished={finished}
              side={settings.side}
              loading={false}
              mascot={settings.mascotEnabled}
              mascotKind={settings.mascot === "robot" && ROBOT_READY ? "robot" : "cat"}
              glass={settings.glassEnabled}
              glassOpacity={settings.glassOpacity}
              interactive={false}
            />
          </div>
          <CompactModePicker value={settings.compactMode} onChange={(compactMode) => update({ compactMode })} />
        </div>
      </Group>

      <Group title={t("Em destaque")}>
        <Segmented
          label={t("Janela em destaque no dock")}
          value={settings.headline}
          onChange={(headline) => update({ headline })}
          options={[
            { value: "session", label: t("Sessão atual (5h)") },
            { value: "limiting", label: t("A que mais limita") }
          ]}
        />
        <p className="hint">
          {t(
            "Qual janela aparece no anel do dock e no número grande do card. Quem não tem sessão de 5h (como o Cursor) mostra a janela que tiver."
          )}
        </p>
      </Group>

      <Group title={t("Histórico no card")}>
        <Segmented
          label={t("Período do gráfico de histórico")}
          value={settings.historyRange}
          onChange={(historyRange) => update({ historyRange })}
          options={[
            { value: "24h", label: "24h" },
            { value: "7d", label: t("7 dias") },
            { value: "30d", label: t("30 dias") }
          ]}
        />
        <p className="hint">{t("O histórico fica só neste PC e começa a partir da primeira leitura.")}</p>
      </Group>

      <Group title={t("Percentual")}>
        <Segmented
          label={t("O que o percentual mostra")}
          value={settings.display}
          onChange={(display) => update({ display })}
          options={[
            { value: "native", label: t("Como no app") },
            { value: "remaining", label: t("Restante") },
            { value: "used", label: t("Usado") }
          ]}
        />
        <p className="hint">
          {t(
            "\"Como no app\" segue cada produto: o Claude mostra quanto você já usou, como no claude.ai; os outros mostram quanto resta."
          )}
        </p>
        {settings.compactMode !== "classic" ? (
          <Switch
            label={t("Símbolo % no dock")}
            description={t("Desligue para ganhar espaço com números de 3 dígitos.")}
            checked={settings.showSign}
            onChange={(showSign) => update({ showSign })}
          />
        ) : null}
        {settings.compactMode === "bars" || settings.antigravityGroupMode === "bars" ? (
          <Switch
            label={t("Ocultar percentual no modo barras")}
            description={t("Exibe apenas as barrinhas coloridas no dock, sem o número ao lado.")}
            checked={settings.hideBarsNumber}
            onChange={(hideBarsNumber) => update({ hideBarsNumber })}
          />
        ) : null}
      </Group>
    </>
  );
}

function PositionTab({ settings, update, monitors }: SettingsPanelProps) {
  return (
    <>
      <Group title={t("Lado da tela")}>
        <Segmented
          label={t("Lado da tela")}
          value={settings.side}
          onChange={(side) => update({ side })}
          options={[
            { value: "left", label: t("Esquerda") },
            { value: "right", label: t("Direita") }
          ]}
        />
      </Group>

      <Group title={t("Altura")}>
        <div className="range-row">
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={settings.verticalOffset}
            aria-label={t("Posição vertical do dock")}
            aria-valuetext={
              settings.verticalOffset === 0
                ? t("Centro")
                : settings.verticalOffset < 0
                  ? t("{value}% acima", { value: Math.abs(settings.verticalOffset) })
                  : t("{value}% abaixo", { value: settings.verticalOffset })
            }
            onChange={(event) => update({ verticalOffset: Number(event.target.value) })}
          />
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => update({ verticalOffset: 0 })}
            disabled={settings.verticalOffset === 0}
          >
            {t("Centralizar")}
          </button>
        </div>
        <p className="hint">{t("Arraste para subir ou descer o dock na borda.")}</p>
        <Switch
          label={t("Bloquear posição")}
          description={t("Impede arrastar o dock para cima ou para baixo com o mouse.")}
          checked={settings.lockPosition}
          onChange={(lockPosition) => update({ lockPosition })}
        />
      </Group>

      {monitors.length > 0 ? (
        <Group title={t("Tela")}>
          <div className="option-list">
            {monitors.map((monitor) => (
              <button
                type="button"
                key={monitor.index}
                className={"option" + (monitor.index === settings.monitorIndex ? " is-selected" : "")}
                aria-pressed={monitor.index === settings.monitorIndex}
                onClick={() => update({ monitorIndex: monitor.index })}
              >
                <span className="tile-icon">
                  <MonitorIcon size={15} />
                </span>
                <span className="option__copy">
                  <strong>{t("Tela {number}", { number: monitor.index + 1 })}</strong>
                  <small>
                    {tr(monitor.name)} · {monitor.width} × {monitor.height}
                  </small>
                </span>
                {monitor.index === settings.monitorIndex ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      <Group title={t("Visibilidade")}>
        <Switch
          label={t("Ocultar automaticamente")}
          description={t("Fica só uma faixa fina na borda. Passe o mouse para mostrar.")}
          checked={settings.autoHide}
          onChange={(autoHide) => update({ autoHide })}
        />
        <Switch
          label={t("Esconder em tela cheia")}
          description={t("Some durante jogos, vídeos e apresentações.")}
          checked={settings.hideOnFullscreen}
          onChange={(hideOnFullscreen) => update({ hideOnFullscreen })}
        />
      </Group>
    </>
  );
}

const PAUSES: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 240, label: "4h" }
];

function tomorrowMorning(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0).getTime();
}

function PauseNotifications({ settings, update }: Pick<SettingsPanelProps, "settings" | "update">) {
  const until = settings.notificationsPausedUntil;
  if (until != null && until > Date.now()) {
    const time = new Intl.DateTimeFormat(intlLocale(), {
      weekday: new Date(until).toDateString() === new Date().toDateString() ? undefined : "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(until);
    return (
      <div className="notice notice--warning">
        <span>{t("Notificações pausadas até {time}.", { time })}</span>
        <button type="button" className="text-button" onClick={() => update({ notificationsPausedUntil: null })}>
          {t("Retomar")}
        </button>
      </div>
    );
  }
  return (
    <div className="pause-row">
      <span>{t("Pausar por")}</span>
      <div className="pause-row__options">
        {PAUSES.map((pause) => (
          <button
            type="button"
            key={pause.minutes}
            className="chip"
            onClick={() => update({ notificationsPausedUntil: Date.now() + pause.minutes * 60 * 1000 })}
          >
            {pause.label}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => update({ notificationsPausedUntil: tomorrowMorning() })}>
          {t("Até amanhã")}
        </button>
      </div>
    </div>
  );
}

function GeneralTab({
  settings,
  update,
  autostart,
  onAutostart,
  shortcutError,
  version,
  onTestNotification,
  onReplayOnboarding,
  onQuit
}: SettingsPanelProps) {
  return (
    <>
      <Group title={t("Comportamento")}>
        <Switch
          label={t(
            currentPlatform() === "macos"
              ? "Iniciar com o Mac"
              : currentPlatform() === "linux"
                ? "Iniciar com o Linux"
                : "Iniciar com o Windows"
          )}
          checked={Boolean(autostart)}
          disabled={autostart == null}
          onChange={onAutostart}
        />
        <Switch
          label={t("Atalho global")}
          description={
            <>
              <kbd>{t(GLOBAL_SHORTCUT_LABEL)}</kbd> {t("abre a busca de prompts de qualquer lugar.")}
            </>
          }
          checked={settings.globalShortcut}
          onChange={(globalShortcut) => update({ globalShortcut })}
        />
        {shortcutError ? <div className="notice notice--error">{shortcutError}</div> : null}
        <Switch
          label={t("Colar direto no app anterior")}
          description={t("Depois de copiar um prompt, o dock recolhe, volta para o app em que você estava e cola.")}
          checked={settings.autoPaste}
          onChange={(autoPaste) => update({ autoPaste })}
        />
        <Switch
          label={t("Fechar o painel ao clicar fora")}
          checked={settings.closeOnBlur}
          onChange={(closeOnBlur) => update({ closeOnBlur })}
        />
        <Segmented
          label={t("Indicador de atividade")}
          value={settings.activityIndicator}
          onChange={(activityIndicator) => update({ activityIndicator })}
          options={[
            { value: "sweep", label: t("Luz giratória") },
            { value: "pulse", label: t("Pulso suave") },
            { value: "solid", label: t("Branco fixo") },
            { value: "none", label: t("Desativado") }
          ]}
        />
        {settings.activityIndicator !== "none" ? (
          <Switch
            label={t("Pulsar barra em uso")}
            description={t("Desligue para manter a barra iluminada em branco fixo sem pulsar.")}
            checked={settings.pulseActiveBar}
            onChange={(pulseActiveBar) => update({ pulseActiveBar })}
          />
        ) : null}
        <p className="hint">
          {t("Efeito visual quando o agente está trabalhando: luz giratória na borda, pulso suave, branco fixo ou desativado.")}
        </p>
      </Group>

      <Group title={t("Atualizar uso a cada")}>
        <Segmented
          label={t("Intervalo de atualização")}
          value={settings.refreshMinutes}
          onChange={(refreshMinutes) => update({ refreshMinutes })}
          options={REFRESH_CHOICES.map((minutes) => ({ value: minutes, label: t("{minutes} min", { minutes }) }))}
        />
        <p className="hint">{t("Se um provider limitar a consulta, o intervalo dobra sozinho até voltar ao normal.")}</p>
      </Group>

      <Group title={t("Notificações")}>
        <Switch
          label={t("Quota baixa")}
          description={t("Avisa quando uma janela passa de 80% e de 95% de uso.")}
          checked={settings.notifyLowQuota}
          onChange={(notifyLowQuota) => update({ notifyLowQuota })}
        />
        <Switch
          label={t("Limite renovado")}
          description={t("Avisa quando uma janela de uso reseta.")}
          checked={settings.notifyReset}
          onChange={(notifyReset) => update({ notifyReset })}
        />
        <Switch
          label={t("Agente esperando você")}
          description={t("Codex, Cursor ou Antigravity pararam para pedir sua resposta.")}
          checked={settings.notifyWaiting}
          onChange={(notifyWaiting) => update({ notifyWaiting })}
        />
        <Switch
          label={t("Instabilidade no serviço")}
          description={t("Incidente na página de status oficial do Claude, Codex ou Cursor.")}
          checked={settings.notifyIncidents}
          onChange={(notifyIncidents) => update({ notifyIncidents })}
        />
        <Switch
          label={t("Falha ao atualizar")}
          description={t("Um provider falhou 3 vezes seguidas, e quando volta.")}
          checked={settings.notifyFailures}
          onChange={(notifyFailures) => update({ notifyFailures })}
        />
        <PauseNotifications settings={settings} update={update} />
        <button type="button" className="button button--ghost button--block" onClick={onTestNotification}>
          {t("Enviar notificação de teste")}
        </button>
      </Group>

      <Group title={t("Sobre")}>
        <p className="hint">
          AI Dock {version ? "v" + version : ""} · {t("quota das IAs e prompts do Obsidian.")}
        </p>
        <div className="button-row">
          <button type="button" className="button button--ghost" onClick={onReplayOnboarding}>
            {t("Rever introdução")}
          </button>
          <button type="button" className="button button--danger" onClick={onQuit}>
            <Power size={14} /> {t("Encerrar AI Dock")}
          </button>
        </div>
      </Group>
    </>
  );
}

function ConnectionsTab({
  settings,
  update,
  providers,
  rawProviders = providers,
  onChooseFolder,
  onProvidersChanged,
  withDialog
}: SettingsPanelProps) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const rawById = new Map(rawProviders.map((provider) => [provider.id, provider]));
  const validProviderIds = new Set(providers.map((p) => p.id));
  const isRecognizedId = (id: string) => ["claude", "codex", "cursor", "grok", "antigravity", "deepseek"].includes(id) || validProviderIds.has(id);
  const allIds = Array.from(new Set([...settings.providerOrder.filter(isRecognizedId), ...providers.map((p) => p.id)]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState("");

  function move(id: string, direction: -1 | 1) {
    const order = [...allIds];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    update({ providerOrder: order });
  }

  function toggle(id: string) {
    const hidden = settings.hiddenProviders.includes(id);
    update({
      hiddenProviders: hidden
        ? settings.hiddenProviders.filter((item) => item !== id)
        : [...settings.hiddenProviders, id]
    });
  }

  function saveAlias(id: string, name: string) {
    const trimmed = name.trim();
    const next = { ...settings.providerAliases };
    if (trimmed) {
      next[id] = trimmed;
    } else {
      delete next[id];
    }
    update({ providerAliases: next });
    setEditingId(null);
  }

  const antigravityProviders = providers.filter((p) => p.id === "antigravity" || p.id.startsWith("antigravity-"));

  return (
    <>
      <Group title={t("Providers")}>
        <p className="hint">{t("Ordem e visibilidade no dock e no painel.")}</p>
        <ul className="provider-list">
          {allIds.map((id, index) => {
            const provider = byId.get(id);
            const raw = rawById.get(id);
            const hidden = settings.hiddenProviders.includes(id);
            const customAlias = settings.providerAliases[id];
            const name = provider?.name || PROVIDER_NAMES[id] || id;
            const originalName = (raw && tr(raw.name)) || PROVIDER_NAMES[id] || id;
            const isEditing = editingId === id;

            return (
              <li key={id} className={"provider-list__item" + (hidden ? " is-hidden" : "")}>
                <ProviderIcon providerId={id} size={16} brand />
                <span className="provider-list__copy">
                  {isEditing ? (
                    <div className="provider-alias-edit">
                      <input
                        type="text"
                        className="provider-alias-input"
                        placeholder={originalName}
                        value={aliasInput}
                        autoFocus
                        onChange={(e) => setAliasInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveAlias(id, aliasInput);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <button
                        type="button"
                        className="icon-button icon-button--small icon-button--save"
                        onClick={() => saveAlias(id, aliasInput)}
                        title={t("Salvar")}
                        aria-label={t("Salvar")}
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--small"
                        onClick={() => setEditingId(null)}
                        title={t("Cancelar")}
                        aria-label={t("Cancelar")}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <strong>
                        {name}
                        {customAlias ? (
                          <span className="provider-list__alias-tag" title={t("Nome personalizado")}>
                            ★
                          </span>
                        ) : null}
                      </strong>
                      <small className={provider?.connected ? "is-on" : ""}>
                        {provider?.email && !name.includes(provider.email) ? `${provider.email} · ` : ""}
                        {provider ? (provider.connected ? t("Conectado") : tr(provider.error) || t("Não conectado")) : t("Lendo…")}
                      </small>
                    </>
                  )}
                </span>
                <span className="provider-list__actions">
                  <button
                    type="button"
                    className={"icon-button icon-button--small" + (customAlias ? " is-active" : "")}
                    onClick={() => {
                      if (isEditing) {
                        setEditingId(null);
                      } else {
                        setEditingId(id);
                        setAliasInput(customAlias || "");
                      }
                    }}
                    title={customAlias ? t("Editar nome personalizado (atual: {name})", { name }) : t("Personalizar nome")}
                    aria-label={t("Personalizar nome de {name}", { name })}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, -1)}
                    disabled={index === 0}
                    aria-label={t("Mover {name} para cima", { name })}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => move(id, 1)}
                    disabled={index === allIds.length - 1}
                    aria-label={t("Mover {name} para baixo", { name })}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => toggle(id)}
                    aria-pressed={!hidden}
                    aria-label={hidden ? t("Mostrar {name}", { name }) : t("Ocultar {name}", { name })}
                    title={hidden ? t("Mostrar") : t("Ocultar")}
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Group>

      <Group title={t("Antigravity")}>
        <Segmented
          label={t("Visual no dock")}
          value={settings.antigravityGroupMode}
          onChange={(antigravityGroupMode) => update({ antigravityGroupMode })}
          options={[
            { value: "bars", label: t("Barras") },
            { value: "rings", label: t("Anéis") },
            { value: "split", label: t("Separado") }
          ]}
        />
        <p className="hint">
          {settings.antigravityGroupMode === "bars"
            ? t("Junta Gemini, Claude+GPT e Argon com barrinhas horizontais empilhadas.")
            : settings.antigravityGroupMode === "split"
              ? t("Mostra cada família de modelos (Gemini, Claude+GPT, Argon) em um slot separado.")
              : t("Junta Gemini, Claude+GPT e Argon em 1 slot com anéis concêntricos por conta.")}
        </p>

        <div className="antigravity-accounts">
          <label className="field-label">{t("Contas e instâncias conectadas")}</label>
          <p className="hint">
            {t("Personalize o nome de exibição de cada conta (ex: Pessoal, Trabalho).")}
          </p>
          <div className="antigravity-accounts__list">
            {antigravityProviders.map((ag) => {
              const alias = settings.providerAliases[ag.id] || "";
              const original = rawById.get(ag.id);
              const email = ag.email || original?.email;
              return (
                <div key={ag.id} className="antigravity-account-row">
                  <div className="antigravity-account-row__info">
                    <span className="antigravity-account-row__badge">
                      {ag.id === "antigravity" ? "1" : ag.id.replace("antigravity-", "")}
                    </span>
                    <div className="antigravity-account-row__copy">
                      <strong>{alias || ag.name}</strong>
                      <small className="antigravity-account-row__email">
                        {email || (original ? tr(original.name) : t("Instância local"))}
                      </small>
                    </div>
                  </div>
                  <div className="antigravity-account-row__input-wrap">
                    <input
                      type="text"
                      className="antigravity-account-input"
                      placeholder={t("Nome (ex: Pessoal, Trabalho)")}
                      value={alias}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = { ...settings.providerAliases };
                        if (val.trim()) {
                          next[ag.id] = val;
                        } else {
                          delete next[ag.id];
                        }
                        update({ providerAliases: next });
                      }}
                    />
                    {alias ? (
                      <button
                        type="button"
                        className="text-button text-button--small"
                        onClick={() => {
                          const next = { ...settings.providerAliases };
                          delete next[ag.id];
                          update({ providerAliases: next });
                        }}
                        title={t("Restaurar padrão")}
                      >
                        {t("Padrão")}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {antigravityProviders.length === 0 ? (
              <small className="hint is-empty">{t("Nenhuma conta do Antigravity conectada no momento.")}</small>
            ) : null}
          </div>
        </div>
      </Group>

      <Group title={t("Claude")}>
        <ClaudeConnectCard onChanged={onProvidersChanged} withDialog={withDialog} />
      </Group>

      <Group title={t("Obsidian")}>
        <button type="button" className="option" onClick={onChooseFolder}>
          <span className="tile-icon">
            <FolderOpen size={15} />
          </span>
          <span className="option__copy">
            <strong>{settings.obsidianPath ? t("Pasta conectada") : t("Conectar pasta")}</strong>
            <small>{settings.obsidianPath || t("Vault ou pasta de prompts")}</small>
          </span>
        </button>
        {settings.obsidianPath ? (
          <button type="button" className="text-button" onClick={() => update({ obsidianPath: null })}>
            {t("Desconectar pasta")}
          </button>
        ) : null}
        <p className="hint">
          {t("Use {simple} ou {fallback} no prompt para preencher antes de copiar.", { simple: "\u0000", fallback: "\u0001" })
            .split(/(\u0000|\u0001)/)
            .map((part, index) =>
              part === "\u0000" ? (
                <code key={index}>{"{{" + t("variável") + "}}"}</code>
              ) : part === "\u0001" ? (
                <code key={index}>{"{{" + t("variável") + "|" + t("padrão") + "}}"}</code>
              ) : (
                part
              )
            )}
        </p>
      </Group>
    </>
  );
}
