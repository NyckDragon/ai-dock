import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { CSSProperties, Ref } from "react";
import { baseProviderId, displayWord, percentLabel, providerHeadroom, quotaTone, shownPercent } from "../lib/quota";
import type { CompactMode, DockSide, PercentDisplay, ProviderActivity, ProviderUsage } from "../types";
import { ProviderIcon } from "./ProviderIcon";

type SlotProps = {
  provider: ProviderUsage;
  mode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  activity?: ProviderActivity;
  interactive: boolean;
  onHover?: (slotId: string) => void;
  onOpen?: (slotId: string) => void;
};

function slotLabel(provider: ProviderUsage, remaining: number | null, display: PercentDisplay, activity?: ProviderActivity) {
  const quota =
    remaining == null
      ? provider.connected
        ? "sem dados de quota"
        : "não conectado"
      : shownPercent(remaining, display) + "% " + displayWord(display);
  const state =
    activity?.state === "waiting" ? ", esperando você" : activity?.state === "working" ? ", trabalhando" : "";
  return provider.name + ": " + quota + state;
}

function PillSlot({ provider, mode, showSign, display, activity, interactive, onHover, onOpen }: SlotProps) {
  const remaining = providerHeadroom(provider);
  const tone = quotaTone(remaining);
  const label = percentLabel(remaining, display, showSign);
  const activityState = activity?.state || "idle";
  const aria = slotLabel(provider, remaining, display, activity);
  const degrees = remaining == null ? 0 : shownPercent(remaining, display) * 3.6;

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
    return <span className={"pill-slot pill-slot--" + mode}>{body}</span>;
  }

  return (
    <button
      type="button"
      className={"pill-slot pill-slot--" + mode}
      data-slot={provider.id}
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
    </button>
  );
}

export function DockPill({
  slots,
  mode,
  showSign,
  display,
  activities,
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
  activities: ProviderActivity[];
  side: DockSide;
  loading: boolean;
  interactive?: boolean;
  pillRef?: Ref<HTMLDivElement>;
  onOpen?: (slotId?: string) => void;
  onHoverSlot?: (slotId: string) => void;
}) {
  const activityFor = (slotId: string) =>
    activities.find((activity) => activity.providerId === baseProviderId(slotId));
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
          aria-label="Abrir painel do AI Dock"
          title="Abrir painel"
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
                activity={activityFor(provider.id)}
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
          aria-label="Abrir painel"
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
