import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useRef, useState, type CSSProperties, type Ref } from "react";
import { t } from "../lib/i18n";
import {
  activityForSlot,
  antigravityPools,
  baseProviderId,
  clampPercent,
  displayWord,
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

  let quota: string;
  if (isUnified) {
    const pools = antigravityPools(provider);
    quota = pools.map((p) => `${p.name}: ${p.remainingPercent}%`).join(", ");
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

function ConcentricRingsGauge({
  provider,
  display,
  headline,
  activityState,
  activityIndicator,
  pulseActiveBar,
  activePools
}: {
  provider: ProviderUsage;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activityState: string;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  /** Pools with a running conversation; empty when the pool is unknown, so every pool lights. */
  activePools: string[];
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
          const isRingActive =
            activityState === "working" &&
            activityIndicator !== "none" &&
            (activePools.length === 0 || activePools.includes(pool.id));

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
              {pct > 0 && (
                <circle
                  cx={19}
                  cy={19}
                  r={r}
                  fill="none"
                  stroke={isRingActive ? "#ffffff" : pool.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={c}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  transform="rotate(-90 19 19)"
                  className={isRingActive ? "gauge__concentric-ring--active" : undefined}
                />
              )}
            </g>
          );
        })}
      </svg>
      <span className="gauge__face gauge__face--concentric">
        <ProviderIcon providerId={provider.id} size={iconSize} />
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
  activePools
}: {
  provider: ProviderUsage;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activityState: string;
  activityIndicator?: ActivityIndicator;
  pulseActiveBar?: boolean;
  /** Pools with a running conversation; empty when the pool is unknown, so every pool lights. */
  activePools: string[];
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
        <ProviderIcon providerId={provider.id} size={16} />
      </span>
      <div className="gauge-bars__stack" aria-hidden="true">
        {bars.length > 0 ? (
          bars.map((bar) => {
            const isBarActive =
              activityState === "working" &&
              activityIndicator !== "none" &&
              (activePools.length === 0 || activePools.includes(bar.id));

            return (
              <div
                key={bar.id}
                className={"gauge-bars__track" + (isBarActive ? " gauge-bars__track--active" : "")}
                title={`${bar.name}: ${bar.pct}%`}
              >
                <div
                  className={"gauge-bars__fill" + (isBarActive ? " gauge-bars__fill--active" : "")}
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
  status,
  interactive,
  onHover,
  onOpen
}: SlotProps) {
  const remaining = providerHeadroom(provider, headline);
  const effectiveIndicator = animateActivity === false ? "none" : (activityIndicator || "sweep");
  const isWorking = activity?.state === "working" && effectiveIndicator !== "none";
  const isWaiting = activity?.state === "waiting";
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
        <ProviderIcon providerId={provider.id} size={17} />
        <i className={"slot-dot slot-dot--" + tone} />
      </span>
    );
  } else if (mode === "percent") {
    body = (
      <>
        <ProviderIcon providerId={provider.id} size={15} />
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
            <ProviderIcon providerId={provider.id} size={mode === "ring" ? 16 : 14} />
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
  statuses = [],
  side,
  loading,
  interactive = true,
  lockPosition = false,
  verticalOffset = 0,
  onOffsetChange,
  onOffsetCommit,
  pillRef,
  onOpen,
  onHoverSlot
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
  statuses?: ProviderStatus[];
  side: DockSide;
  loading: boolean;
  interactive?: boolean;
  lockPosition?: boolean;
  verticalOffset?: number;
  onOffsetChange?: (offset: number) => void;
  onOffsetCommit?: (offset: number) => void;
  pillRef?: Ref<HTMLDivElement>;
  onOpen?: (slotId?: string) => void;
  onHoverSlot?: (slotId: string) => void;
}) {
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || lockPosition) return;
    if (event.button !== 0) return;
    dragStartYRef.current = event.screenY;
    dragStartOffsetRef.current = verticalOffset;
    isDraggingRef.current = false;
    pendingOffsetRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const deltaY = event.screenY - dragStartYRef.current;
    if (!isDraggingRef.current && Math.abs(deltaY) > 5) {
      isDraggingRef.current = true;
      setDragging(true);
    }
    if (isDraggingRef.current) {
      const screenH = window.screen.height || 1080;
      const deltaPercent = (deltaY / screenH) * 100;
      const nextOffset = Math.round(Math.max(-45, Math.min(45, dragStartOffsetRef.current + deltaPercent)));
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
    if (isDraggingRef.current) {
      event.stopPropagation();
      isDraggingRef.current = false;
      setDragging(false);
      if (pendingOffsetRef.current != null) {
        onOffsetChange?.(pendingOffsetRef.current);
        onOffsetCommit?.(pendingOffsetRef.current);
        pendingOffsetRef.current = null;
      }
      return;
    }
    setDragging(false);
  };

  const activityFor = (slotId: string) => activityForSlot(activities, slotId);
  const Chevron = side === "right" ? ChevronLeft : ChevronRight;

  return (
    <div
      ref={pillRef}
      className={
        "dock-pill dock-pill--" +
        mode +
        (interactive ? "" : " dock-pill--preview") +
        (!lockPosition && interactive ? " dock-pill--draggable" : "") +
        (dragging ? " dock-pill--dragging" : "")
      }
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "AI Dock" : undefined}
      aria-hidden={interactive ? undefined : true}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={interactive ? () => {
        if (isDraggingRef.current) return;
        onOpen?.();
      } : undefined}
    >
      {interactive ? (
        <button
          type="button"
          className="dock-pill__brand"
          aria-label={t("Abrir painel do AI Dock")}
          title={t("Abrir painel")}
          onClick={(event) => {
            event.stopPropagation();
            if (isDraggingRef.current) return;
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
                status={statusFor(statuses, baseProviderId(provider.id))}
                interactive={interactive}
                onHover={onHoverSlot}
                onOpen={onOpen}
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
            if (isDraggingRef.current) return;
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
