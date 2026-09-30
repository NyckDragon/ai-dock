import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { CSSProperties, Ref } from "react";
import { t } from "../lib/i18n";
import { activityForSlot, baseProviderId, displayWord, percentLabel, providerHeadroom, quotaTone, shownPercent } from "../lib/quota";
import type { CompactMode, DockSide, HeadlineWindow, PercentDisplay, ProviderActivity, ProviderStatus, ProviderUsage } from "../types";
import { statusFor } from "../hooks/useProviderStatus";
import { ProviderIcon } from "./ProviderIcon";
import { statusText } from "./StatusBadge";

type SlotProps = {
  provider: ProviderUsage;
  mode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  headline: HeadlineWindow;
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
  const quota =
    remaining == null
      ? provider.connected
        ? t("sem dados de quota")
        : t("não conectado")
      : shownPercent(remaining, display, provider.id) + "% " + displayWord(display, provider.id);
  const state =
    activity?.state === "waiting" ? ", " + t("esperando você") : activity?.state === "working" ? ", " + t("trabalhando") : "";
  const stale = provider.stale && remaining != null ? " (" + t("última leitura, não atualizou") + ")" : "";
  const incident = status ? " · " + statusText(status) : "";
  return provider.name + ": " + quota + stale + state + incident;
}

function PillSlot({ provider, mode, showSign, display, headline, activity, status, interactive, onHover, onOpen }: SlotProps) {
  const remaining = providerHeadroom(provider, headline);
  const tone = quotaTone(remaining);
  const label = percentLabel(remaining, display, provider.id, showSign);
  const activityState = activity?.state || "idle";
  const aria = slotLabel(provider, remaining, display, activity, status);
  const incident = status ? <i className={"slot-incident slot-incident--" + status.level} aria-hidden="true" /> : null;
  const degrees = remaining == null ? 0 : shownPercent(remaining, display, provider.id) * 3.6;

  let body;
  if (mode === "classic") {
    body = (
      <span className="slot-tile" data-activity={activityState}>
        <ProviderIcon providerId={provider.id} size={17} />
        <i className={"slot-dot slot-dot--" + tone} />
      </span>
    );
  } else if (mode === "percent") {
    body = (
      <>
        <ProviderIcon providerId={provider.id} size={15} />
        <span className={"slot-chip slot-chip--" + tone} data-activity={activityState}>
          {label}
        </span>
      </>
    );
  } else {
    body = (
      <>
        <span
          className={"gauge gauge--" + tone + (mode === "ring" ? " gauge--circle" : "")}
          data-activity={activityState}
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
      <span className={"pill-slot pill-slot--" + mode}>
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
  activities,
  statuses = [],
  side,
  loading,
  interactive = true,
  pillRef,
  onOpen,
  onHoverSlot
}: {
  slots: ProviderUsage[];
  mode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activities: ProviderActivity[];
  statuses?: ProviderStatus[];
  side: DockSide;
  loading: boolean;
  interactive?: boolean;
  pillRef?: Ref<HTMLDivElement>;
  onOpen?: (slotId?: string) => void;
  onHoverSlot?: (slotId: string) => void;
}) {
  const activityFor = (slotId: string) => activityForSlot(activities, slotId);
  const Chevron = side === "right" ? ChevronLeft : ChevronRight;

  return (
    <div
      ref={pillRef}
      className={"dock-pill dock-pill--" + mode + (interactive ? "" : " dock-pill--preview")}
      role={interactive ? "group" : undefined}
      aria-label={interactive ? "AI Dock" : undefined}
      aria-hidden={interactive ? undefined : true}
      onClick={interactive ? () => onOpen?.() : undefined}
    >
      {interactive ? (
        <button
          type="button"
          className="dock-pill__brand"
          aria-label={t("Abrir painel do AI Dock")}
          title={t("Abrir painel")}
          onClick={(event) => {
            event.stopPropagation();
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
