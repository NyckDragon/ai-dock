import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { waitKind, type WaitKind } from "../lib/finish";
import { t } from "../lib/i18n";
import {
  CAT_BREATHE,
  MASCOT_SRC,
  mascotBang,
  mascotMarkNotices,
  mascotNoticeText,
  mascotNotices,
  mascotOverlayHeight,
  mascotPose,
  robotPoseSrc,
  type MascotKind
} from "../lib/mascot";
import { ROBOT_FILES } from "../lib/robot-art";
import type { MascotOverlay } from "../hooks/useDockWindow";
import {
  activityForSlot,
  antigravityPools,
  baseProviderId,
  clampPercent,
  displayWord,
  balanceReading,
  percentLabel,
  providerHeadroom,
  quotaTone,
  shownPercent
} from "../lib/quota";
import type {
  ActivityIndicator,
  AntigravityGroupMode,
  CompactMode,
  DockSide,
  HeadlineWindow,
  PercentDisplay,
  ProviderActivity,
  ProviderStatus,
  ProviderUsage
} from "../types";
import { statusFor } from "../hooks/useProviderStatus";
import { ProviderIcon } from "./ProviderIcon";
import { statusText } from "./StatusBadge";

type SlotSignal = { wait: WaitKind | null; done: boolean };
type MascotMark = "question" | "bang";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

function MascotFigure({
  slots,
  activities,
  finished,
  side,
  kind,
  interactive,
  onOverlay
}: {
  slots: ProviderUsage[];
  activities: ProviderActivity[];
  finished?: ReadonlySet<string>;
  side: DockSide;
  kind: MascotKind;
  interactive: boolean;
  pill: HTMLDivElement | null;
  onOverlay?: (size: MascotOverlay) => Promise<void> | void;
}) {
  const pose = mascotPose(slots, activities, finished);
  const notices = mascotNotices(slots, activities, finished);
  const question = notices.some((notice) => notice.kind === "question");
  const bang = mascotBang(notices);
  const [hover, setHover] = useState<MascotMark | null>(null);
  const [pinned, setPinned] = useState<MascotMark | null>(null);
  const [frame, setFrame] = useState(0);
  const signalsRef = useRef<HTMLSpanElement | null>(null);
  const open = pinned ?? hover;
  const lines = open ? mascotMarkNotices(notices, open) : [];
  const robot = robotPoseSrc(pose, ROBOT_FILES);
  const useRobot = kind === "robot" && robot.src.length > 0;
  const robotWalk = useRobot && pose === "sit" ? robot.frames : [];
  const shownFrame = robotWalk.length ? robotWalk[frame % robotWalk.length] : robot.src;
  const figure = useRobot ? "robot" : pose === "sit" ? "breathe" : pose;
  const drawWidth = !useRobot && pose === "sleep" ? 76 : 0;

  useEffect(() => {
    if (robotWalk.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % robotWalk.length), 180);
    return () => window.clearInterval(timer);
  }, [robotWalk.length, robotWalk.join("|")]);

  useEffect(() => {
    if (pinned === "question" && !question) setPinned(null);
    if (pinned === "bang" && !bang) setPinned(null);
  }, [pinned, question, bang]);

  useEffect(() => {
    if (!pinned) return;
    const release = (event: PointerEvent) => {
      if (signalsRef.current?.contains(event.target as Node)) return;
      setPinned(null);
    };
    document.addEventListener("pointerdown", release);
    return () => document.removeEventListener("pointerdown", release);
  }, [pinned]);

  useLayoutEffect(() => {
    if (!interactive) return;
    // The line above the head is already reserved. The mark does not change it.
    void onOverlay?.({ height: mascotOverlayHeight(0), width: drawWidth });
  }, [interactive, onOverlay, drawWidth]);

  const toggle = (mark: MascotMark) => {
    setPinned((current) => (current === mark ? null : mark));
  };

  const signalIdle = !question && !bang;
  return (
    <span className="dock-mascot-stack">
      <span
        className={"dock-signals" + (signalIdle ? " is-idle" : "")}
        ref={signalsRef}
        onMouseLeave={() => setHover(null)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {lines.length ? (
          <ul className="dock-signal-list">
            {lines.map((notice) => (
              <li key={notice.slotId + notice.kind + notice.name}>{mascotNoticeText(notice)}</li>
            ))}
          </ul>
        ) : null}
        <span className="dock-signals__marks">
          <button
            type="button"
            className={"dock-signal dock-signal--question" + (open === "question" ? " is-open" : "") + (question ? "" : " is-idle")}
            aria-label={t("Pergunta")}
            aria-expanded={question ? open === "question" : undefined}
            aria-hidden={question ? undefined : true}
            tabIndex={question ? undefined : -1}
            onMouseEnter={() => setHover("question")}
            onClick={() => toggle("question")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <text x="8" y="11.92" textAnchor="middle" fontSize="11">{"?"}</text>
            </svg>
          </button>
          <button
            type="button"
            className={"dock-signal dock-signal--bang" + (open === "bang" ? " is-open" : "") + (bang ? "" : " is-idle")}
            style={{ "--signal": bang === "permission" ? "var(--permission)" : "var(--done)" } as CSSProperties}
            aria-label={bang === "permission" ? t("Permissão") : t("Finalização")}
            aria-expanded={bang ? open === "bang" : undefined}
            aria-hidden={bang ? undefined : true}
            tabIndex={bang ? undefined : -1}
            onMouseEnter={() => setHover("bang")}
            onClick={() => toggle("bang")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <text x="8" y="11.85" textAnchor="middle" fontSize="11">{"!"}</text>
            </svg>
          </button>
        </span>
      </span>
      <span className={"dock-mascot dock-mascot--" + figure} aria-hidden="true">
        <span className="dock-mascot__motion">
          {!useRobot && pose === "sit" ? (
            <span className={"dock-mascot__clip" + (side === "right" ? " dock-mascot__img--flip" : "")}>
              <img className="dock-mascot__sheet" src={CAT_BREATHE} alt="" draggable={false} />
            </span>
          ) : (
            <img
              className={"dock-mascot__img" + (side === "right" ? " dock-mascot__img--flip" : "")}
              src={useRobot ? shownFrame : MASCOT_SRC[pose]}
              alt=""
              draggable={false}
            />
          )}
        </span>
      </span>
    </span>
  );
}

function SlotIcon({
  providerId,
  size,
  signal
}: {
  providerId: string;
  size: number;
  signal: SlotSignal;
}) {
  const wait = signal.wait;
  const done = !wait && signal.done;
  return (
    <span
      className="slot-icon"
      data-activity={wait ? "waiting" : undefined}
      data-wait={wait ?? undefined}
      data-signal={done ? "done" : undefined}
    >
      <ProviderIcon providerId={providerId} size={size} />
    </span>
  );
}

type SlotProps = {
  provider: ProviderUsage;
  mode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  headline: HeadlineWindow;
  antigravityGroupMode?: AntigravityGroupMode;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  hideBarsNumber?: boolean;
  animateActivity?: boolean;
  activity?: ProviderActivity;
  finished?: boolean;
  status?: ProviderStatus;
  interactive: boolean;
  onHover?: (slotId: string) => void;
  onOpen?: (slotId: string) => void;
};

function slotLabel(
  provider: ProviderUsage,
  remaining: number | null,
  display: PercentDisplay,
  activity?: ProviderActivity,
  status?: ProviderStatus
) {
  const isUnified =
    provider.id.startsWith("antigravity") &&
    provider.windows.some((w) => w.id.startsWith("gemini")) &&
    provider.windows.some((w) => w.id.startsWith("claude-gpt") || w.id.startsWith("third-party"));

  const balance = balanceReading(provider);
  let quota: string;
  if (isUnified) {
    const pools = antigravityPools(provider);
    quota = pools.map((p) => `${p.name}: ${p.remainingPercent}%`).join(", ");
  } else if (balance) {
    quota = balance;
  } else {
    quota =
      remaining == null
        ? provider.connected
          ? t("sem dados de quota")
          : t("não conectado")
        : shownPercent(remaining, display, provider.id) + "% " + displayWord(display, provider.id);
  }
  const state =
    activity?.state === "waiting" ? ", " + t("esperando você") : activity?.state === "working" ? ", " + t("trabalhando") : "";
  const stale = provider.stale && remaining != null ? " (" + t("última leitura, não atualizou") + ")" : "";
  const incident = status ? " · " + statusText(status) : "";
  return provider.name + ": " + quota + stale + state + incident;
}

/** One quota mark lights with the warning. Several families light only the named pool. */
function familyPoolLit(activePools: string[], poolId: string, waiting: boolean, familyCount: number) {
  if (waiting && familyCount > 1) return activePools.includes(poolId);
  return activePools.length === 0 || activePools.includes(poolId);
}

function ConcentricRingsGauge({
  provider,
  display,
  headline,
  activityState,
  activityIndicator,
  pulseActiveBar,
  activePools,
  signal
}: {
  provider: ProviderUsage;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activityState: string;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  /** Pools with a running conversation; empty when the pool is unknown, so every pool lights. */
  activePools: string[];
  signal: SlotSignal;
}) {
  const pools = antigravityPools(provider, headline, display);
  const remaining = providerHeadroom(provider, headline);
  const tone = quotaTone(remaining);

  const count = pools.length;
  const radii = count >= 3 ? [17.0, 13.5, 10.0] : count === 2 ? [16.8, 12.0] : [15];
  const strokeWidth = count >= 3 ? 2.2 : count === 2 ? 2.5 : 2.8;
  const iconSize = count >= 3 ? 11 : 12;

  return (
    <span
      className={"gauge gauge--circle gauge--concentric gauge--" + tone}
      data-activity={activityState}
      data-activity-indicator={activityIndicator}
      data-pulse-bar={pulseActiveBar === false ? "false" : undefined}
    >
      <svg
        viewBox="0 0 38 38"
        className="gauge__concentric-svg"
        width={38}
        height={38}
        aria-hidden="true"
      >
        {pools.map((pool, idx) => {
          const r = radii[idx] ?? 15;
          const c = 2 * Math.PI * r;
          const pct = clampPercent(pool.remainingPercent);
          const offset = c * (1 - pct / 100);
          const noticed = signal.wait != null || signal.done;
          const poolLit = familyPoolLit(activePools, pool.id, signal.wait != null, count);
          const isRingActive = !noticed && activityState === "working" && activityIndicator !== "none" && poolLit;
          const isSignalRing = noticed && poolLit;

          return (
            <g key={pool.id}>
              <circle
                cx={19}
                cy={19}
                r={r}
                fill="none"
                stroke={pool.trackColor || "var(--track)"}
                strokeWidth={strokeWidth}
              />
              {(pct > 0 || isSignalRing) && (
                <circle
                  cx={19}
                  cy={19}
                  r={r}
                  fill="none"
                  stroke={isRingActive ? "#ffffff" : pool.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={c}
                  strokeDashoffset={c * (1 - Math.max(pct, isSignalRing ? 12 : 0) / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 19 19)"
                  className={
                    isRingActive ? "gauge__concentric-ring--active" : isSignalRing ? "gauge__concentric-ring--signal" : undefined
                  }
                />
              )}
            </g>
          );
        })}
      </svg>
      <span className="gauge__face gauge__face--concentric">
        <SlotIcon providerId={provider.id} size={iconSize} signal={signal} />
      </span>
    </span>
  );
}

function HorizontalBarsGauge({
  provider,
  display,
  headline,
  activityState,
  activityIndicator,
  pulseActiveBar,
  activePools,
  signal
}: {
  provider: ProviderUsage;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activityState: string;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  /** Pools with a running conversation; empty when the pool is unknown, so every pool lights. */
  activePools: string[];
  signal: SlotSignal;
}) {
  const pools = antigravityPools(provider, headline, display);
  const remaining = providerHeadroom(provider, headline);
  const tone = quotaTone(remaining);

  const bars =
    pools.length > 0
      ? pools.map((p) => ({
          id: p.id,
          name: p.name,
          pct: clampPercent(p.remainingPercent),
          color: p.color
        }))
      : remaining != null
        ? [
            {
              id: provider.id,
              name: provider.name,
              pct: shownPercent(remaining, display, provider.id),
              color:
                tone === "good"
                  ? "var(--good)"
                  : tone === "warning"
                    ? "var(--warning)"
                    : tone === "danger"
                      ? "var(--danger)"
                      : "var(--text-3)"
            }
          ]
        : [];

  return (
    <div
      className={"gauge-bars gauge-bars--" + tone}
      data-activity={activityState}
      data-activity-indicator={activityIndicator}
      data-pulse-bar={pulseActiveBar === false ? "false" : undefined}
    >
      <span className="gauge-bars__icon">
        <SlotIcon providerId={provider.id} size={16} signal={signal} />
      </span>
      <div className="gauge-bars__stack" aria-hidden="true">
        {bars.length > 0 ? (
          bars.map((bar) => {
            const noticed = signal.wait != null || signal.done;
            const poolLit = familyPoolLit(activePools, bar.id, signal.wait != null, bars.length);
            const isBarActive = !noticed && activityState === "working" && activityIndicator !== "none" && poolLit;
            const isSignalBar = noticed && poolLit;

            return (
              <div
                key={bar.id}
                className={"gauge-bars__track" + (isBarActive ? " gauge-bars__track--active" : "")}
                title={`${bar.name}: ${bar.pct}%`}
              >
                <div
                  className={
                    "gauge-bars__fill" +
                    (isBarActive ? " gauge-bars__fill--active" : "") +
                    (isSignalBar ? " gauge-bars__fill--signal" : "")
                  }
                  style={{
                    width: `${bar.pct}%`,
                    backgroundColor: isBarActive ? "#ffffff" : bar.color
                  }}
                />
              </div>
            );
          })
        ) : (
          <div className="gauge-bars__track">
            <div className="gauge-bars__fill" style={{ width: "0%", backgroundColor: "var(--text-3)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function PillSlot({
  provider,
  mode,
  showSign,
  display,
  headline,
  antigravityGroupMode = "bars",
  activityIndicator = "sweep",
  pulseActiveBar = true,
  hideBarsNumber = false,
  animateActivity,
  activity,
  finished = false,
  status,
  interactive,
  onHover,
  onOpen
}: SlotProps) {
  const remaining = providerHeadroom(provider, headline);
  const effectiveIndicator = animateActivity === false ? "none" : (activityIndicator || "sweep");
  const isWorking = activity?.state === "working" && effectiveIndicator !== "none";
  const isWaiting = activity?.state === "waiting";
  const signal: SlotSignal = { wait: isWaiting ? waitKind(activity) : null, done: finished };
  const activityState = isWaiting ? "waiting" : isWorking ? "working" : "idle";
  const activePools = (activity?.sessions ?? []).flatMap((session) => (session.pool ? [session.pool] : []));
  // The first session is the conversation writing now; its pool sets the number shown.
  const activeModel = activePools[0];

  const isUnifiedAntigravity =
    provider.id.startsWith("antigravity") &&
    provider.windows.some((w) => w.id.startsWith("gemini")) &&
    provider.windows.some((w) => w.id.startsWith("claude-gpt") || w.id.startsWith("third-party"));

  const activeModelHeadroom = (() => {
    if (!activeModel || activityState !== "working" || !isUnifiedAntigravity) return null;
    const matching = provider.windows.filter((w) =>
      activeModel === "argon"
        ? w.id.startsWith("argon")
        : activeModel === "gemini"
          ? w.id.startsWith("gemini")
          : activeModel === "claude-gpt"
            ? w.id.startsWith("claude-gpt") || w.id.startsWith("third-party")
            : w.id.startsWith(activeModel)
    );
    if (matching.length === 0) return null;
    if (headline === "session") {
      const session = matching.find((w) => /session|5h/i.test(w.id));
      if (session) return session.remainingPercent;
    }
    return matching.reduce((min, w) => (w.remainingPercent < min ? w.remainingPercent : min), 100);
  })();

  const effectiveRemaining = activeModelHeadroom ?? remaining;
  const tone = quotaTone(effectiveRemaining);
  const label = percentLabel(effectiveRemaining, display, provider.id, showSign);
  const aria = slotLabel(provider, effectiveRemaining, display, activity, status);
  const incident = status ? <i className={"slot-incident slot-incident--" + status.level} aria-hidden="true" /> : null;
  const degrees = effectiveRemaining == null ? 0 : shownPercent(effectiveRemaining, display, provider.id) * 3.6;

  let body;
  if (mode === "classic") {
    body = (
      <span
        className="slot-tile"
        data-activity={activityState}
        data-activity-indicator={effectiveIndicator}
      >
        <SlotIcon providerId={provider.id} size={17} signal={signal} />
        <i className={"slot-dot slot-dot--" + tone} />
      </span>
    );
  } else if (mode === "percent") {
    body = (
      <>
        <SlotIcon providerId={provider.id} size={15} signal={signal} />
        <span
          className={"slot-chip slot-chip--" + tone}
          data-activity={activityState}
          data-activity-indicator={effectiveIndicator}
        >
          {label}
        </span>
      </>
    );
  } else if (mode === "bars" || (isUnifiedAntigravity && antigravityGroupMode === "bars")) {
    body = (
      <>
        <HorizontalBarsGauge
          provider={provider}
          display={display}
          headline={headline}
          activityState={activityState}
          activityIndicator={effectiveIndicator}
          pulseActiveBar={pulseActiveBar}
          activePools={activePools}
          signal={signal}
        />
        {!hideBarsNumber ? <span className="slot-value">{label}</span> : null}
      </>
    );
  } else if (mode === "ring" && isUnifiedAntigravity) {
    body = (
      <>
        <ConcentricRingsGauge
          provider={provider}
          display={display}
          headline={headline}
          activityState={activityState}
          activityIndicator={effectiveIndicator}
          pulseActiveBar={pulseActiveBar}
          activePools={activePools}
          signal={signal}
        />
        <span className="slot-value">{label}</span>
      </>
    );
  } else {
    body = (
      <>
        <span
          className={"gauge gauge--" + tone + (mode === "ring" ? " gauge--circle" : "")}
          data-activity={activityState}
          data-activity-indicator={effectiveIndicator}
          style={{ "--ring-value": degrees + "deg" } as CSSProperties}
        >
          <span className="gauge__face">
            <SlotIcon providerId={provider.id} size={mode === "ring" ? 16 : 14} signal={signal} />
          </span>
        </span>
        <span className="slot-value">{label}</span>
      </>
    );
  }

  if (!interactive) {
    return (
      <span
        className={"pill-slot pill-slot--" + mode}
        data-activity={activityState}
        data-activity-indicator={effectiveIndicator}
        data-wait={signal.wait ?? undefined}
        data-signal={!signal.wait && signal.done ? "done" : undefined}
        data-pulse-bar={pulseActiveBar === false ? "false" : undefined}
      >
        {body}
        {incident}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={"pill-slot pill-slot--" + mode}
      data-slot={provider.id}
      data-stale={provider.stale ? "true" : undefined}
      data-activity={activityState}
      data-activity-indicator={effectiveIndicator}
      data-wait={signal.wait ?? undefined}
      data-signal={!signal.wait && signal.done ? "done" : undefined}
      data-pulse-bar={pulseActiveBar === false ? "false" : undefined}
      aria-label={aria}
      title={aria}
      onMouseEnter={() => onHover?.(provider.id)}
      onFocus={() => onHover?.(provider.id)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(provider.id);
      }}
    >
      {body}
      {incident}
    </button>
  );
}

export function DockPill({
  slots,
  mode,
  showSign,
  display,
  headline,
  antigravityGroupMode = "bars",
  activityIndicator = "sweep",
  pulseActiveBar = true,
  hideBarsNumber = false,
  animateActivity,
  activities,
  finished,
  statuses = [],
  side,
  loading,
  mascot = true,
  mascotKind = "cat",
  glass = false,
  glassOpacity = 40,
  interactive = true,
  lockPosition = false,
  verticalOffset = 0,
  offsetRange,
  onOffsetChange,
  onOffsetCommit,
  pillRef,
  onOpen,
  onHoverSlot,
  onMascotOverlay,
  onSeen
}: {
  slots: ProviderUsage[];
  mode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  headline: HeadlineWindow;
  antigravityGroupMode?: AntigravityGroupMode;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  hideBarsNumber?: boolean;
  animateActivity?: boolean;
  activities: ProviderActivity[];
  finished?: ReadonlySet<string>;
  statuses?: ProviderStatus[];
  side: DockSide;
  loading: boolean;
  mascot?: boolean;
  mascotKind?: MascotKind;
  glass?: boolean;
  glassOpacity?: number;
  interactive?: boolean;
  lockPosition?: boolean;
  verticalOffset?: number;
  /** Where dock.rs says the pill meets the top and bottom edges. Dragging past them does nothing. */
  offsetRange?: { min: number; max: number };
  onOffsetChange?: (offset: number) => void;
  onOffsetCommit?: (offset: number) => void;
  pillRef?: Ref<HTMLDivElement>;
  onOpen?: (slotId?: string) => void;
  onHoverSlot?: (slotId: string) => void;
  onMascotOverlay?: (size: MascotOverlay) => Promise<void> | void;
  onSeen?: () => void;
}) {
  const [pillNode, setPillNode] = useState<HTMLDivElement | null>(null);
  const setPill = useCallback(
    (node: HTMLDivElement | null) => {
      setPillNode((current) => (current === node ? current : node));
      assignRef(pillRef, node);
    },
    [pillRef]
  );
  const isDraggingRef = useRef(false);
  const draggedGestureRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const dragStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || lockPosition) return;
    if (event.button !== 0) return;
    dragOriginRef.current = { x: event.screenX, y: event.screenY };
    dragStartOffsetRef.current = verticalOffset;
    isDraggingRef.current = false;
    draggedGestureRef.current = false;
    pendingOffsetRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.screenX - dragOriginRef.current.x;
    const dy = event.screenY - dragOriginRef.current.y;
    if (!isDraggingRef.current && Math.hypot(dx, dy) > 6) {
      isDraggingRef.current = true;
      draggedGestureRef.current = true;
      setDragging(true);
    }
    if (isDraggingRef.current) {
      const screenH = window.screen.height || 1080;
      const min = Math.max(-45, Math.min(offsetRange?.min ?? -45, 45));
      const max = Math.max(min, Math.min(offsetRange?.max ?? 45, 45));
      const wanted = dragStartOffsetRef.current + (dy / screenH) * 100;
      const clamped = Math.max(min, Math.min(max, wanted));
      if (clamped !== wanted) {
        // Against an edge: start counting again from here, so the way back moves at once.
        dragStartOffsetRef.current = clamped;
        dragOriginRef.current = { x: dragOriginRef.current.x, y: event.screenY };
      }
      // Tenths of a percent: a whole percent is about 11px and the drag felt stepped.
      const nextOffset = Math.round(clamped * 10) / 10;
      pendingOffsetRef.current = nextOffset;
      if (rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingOffsetRef.current != null) {
            onOffsetChange?.(pendingOffsetRef.current);
          }
        });
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const dragged = isDraggingRef.current;
    isDraggingRef.current = false;
    setDragging(false);
    if (!dragged) return;
    event.stopPropagation();
    if (pendingOffsetRef.current != null) {
      onOffsetChange?.(pendingOffsetRef.current);
      onOffsetCommit?.(pendingOffsetRef.current);
      pendingOffsetRef.current = null;
    }
  };

  const activityFor = (slotId: string) => activityForSlot(activities, slotId);
  const Chevron = side === "right" ? ChevronLeft : ChevronRight;
  const signalCount = mascot ? mascotNotices(slots, activities, finished).length : 0;

  return (
    <div
      ref={setPill}
      className={
        "dock-pill dock-pill--" +
        mode +
        " dock-pill--" +
        side +
        (mascot ? " dock-pill--mascot" : "") +
        (signalCount ? " dock-pill--signals" : "") +
        (glass ? " dock-pill--glass" : "") +
        (interactive ? "" : " dock-pill--preview") +
        (!lockPosition && interactive ? " dock-pill--draggable" : "") +
        (dragging ? " dock-pill--dragging" : "")
      }
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "AI Dock" : undefined}
      aria-hidden={interactive ? undefined : true}
      style={glass ? ({ "--glass-t": Math.min(100, Math.max(0, glassOpacity)) / 100 } as CSSProperties) : undefined}
      onClickCapture={(event) => {
        if (!draggedGestureRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseEnter={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".dock-signals")) return;
        onSeen?.();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={interactive ? () => {
        if (draggedGestureRef.current) return;
        onOpen?.();
      } : undefined}
    >
      {mascot ? (
        <MascotFigure
          slots={slots}
          activities={activities}
          finished={finished}
          side={side}
          kind={mascotKind}
          interactive={interactive}
          pill={pillNode}
          onOverlay={onMascotOverlay}
        />
      ) : null}
      {interactive ? (
        <button
          type="button"
          className="dock-pill__brand"
          aria-label={t("Abrir painel do AI Dock")}
          title={t("Abrir painel")}
          onClick={(event) => {
            event.stopPropagation();
            if (draggedGestureRef.current) return;
            onOpen?.();
          }}
        >
          <Sparkles size={16} />
          <span className="dock-word">AI</span>
        </button>
      ) : (
        <span className="dock-pill__brand">
          <Sparkles size={16} />
          <span className="dock-word">AI</span>
        </span>
      )}

      <div className="dock-pill__slots">
        {slots.length === 0 && loading
          ? [0, 1, 2, 3].map((index) => <span key={index} className="pill-slot pill-slot--skeleton" aria-hidden="true" />)
          : slots.map((provider) => (
              <PillSlot
                key={provider.id}
                provider={provider}
                mode={mode}
                showSign={showSign}
                display={display}
                headline={headline}
                antigravityGroupMode={antigravityGroupMode}
                activityIndicator={activityIndicator}
                pulseActiveBar={pulseActiveBar}
                hideBarsNumber={hideBarsNumber}
                animateActivity={animateActivity}
                activity={activityFor(provider.id)}
                finished={finished?.has(provider.id) ?? false}
                status={statusFor(statuses, baseProviderId(provider.id))}
                interactive={interactive}
                onHover={onHoverSlot}
                onOpen={(slotId) => {
                  if (draggedGestureRef.current) return;
                  onOpen?.(slotId);
                }}
              />
            ))}
      </div>

      {interactive ? (
        <button
          type="button"
          className="dock-pill__chevron"
          aria-label={t("Abrir painel")}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            if (draggedGestureRef.current) return;
            onOpen?.();
          }}
        >
          <Chevron size={15} />
        </button>
      ) : (
        <span className="dock-pill__chevron">
          <Chevron size={15} />
        </span>
      )}
    </div>
  );
}
