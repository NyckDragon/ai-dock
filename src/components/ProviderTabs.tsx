import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { wrongAccount } from "../lib/accounts";
import { t } from "../lib/i18n";
import { featuredWindow, quotaTone, shownPercent } from "../lib/quota";
import type { HeadlineWindow, PercentDisplay, ProviderActivity, ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";

/**
 * Every provider in one row, like CodexBar's tabs: icon, name and a small usage
 * bar under each, so all of them read at a glance and one click opens a page.
 */
export function ProviderTabs({
  providers,
  selectedId,
  display,
  headline,
  activityFor,
  onSelect,
  onBack
}: {
  providers: ProviderUsage[];
  selectedId?: string | null;
  display: PercentDisplay;
  headline: HeadlineWindow;
  activityFor: (providerId: string) => ProviderActivity | undefined;
  onSelect: (providerId: string) => void;
  /** On a provider page: the way back to the list. */
  onBack?: () => void;
}) {
  const rowRef = useRef<HTMLElement>(null);
  useEffect(() => {
    rowRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className="provider-switch">
      {onBack ? (
        <button type="button" className="provider-tabs__back" onClick={onBack} aria-label={t("Voltar para o Uso")}>
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
      ) : null}
      <nav className="provider-tabs" aria-label={t("Provedores")} ref={rowRef}>
        {providers.map((provider) => {
          const window = featuredWindow(provider, headline);
          const remaining = window && !window.amount ? window.remainingPercent : null;
          const value = remaining == null ? 0 : shownPercent(remaining, display, provider.id);
          const tone = quotaTone(remaining);
          const working = activityFor(provider.id)?.state === "working";
          const waiting = activityFor(provider.id)?.state === "waiting";
          const wrong = wrongAccount(provider);
          const selected = provider.id === selectedId;
          return (
            <button
              type="button"
              key={provider.id}
              className={"provider-tab" + (selected ? " is-selected" : "") + (provider.stale || !provider.connected ? " is-dim" : "")}
              aria-current={selected ? "page" : undefined}
              aria-label={provider.name + (remaining == null ? "" : ": " + value + "%")}
              onClick={() => onSelect(provider.id)}
            >
              <span className="provider-tab__icon">
                <ProviderChip providerId={provider.id} size={16} />
                {wrong ? (
                  <i className="provider-tab__dot provider-tab__dot--wrong" aria-hidden="true" />
                ) : waiting ? (
                  <i className="provider-tab__dot provider-tab__dot--waiting" aria-hidden="true" />
                ) : working ? (
                  <i className="provider-tab__dot provider-tab__dot--working" aria-hidden="true" />
                ) : null}
              </span>
              <span className="provider-tab__name">{provider.name.replace(/^Antigravity\s*·\s*/i, "")}</span>
              <span className={"provider-tab__bar provider-tab__bar--" + tone} aria-hidden="true">
                <i style={{ width: value + "%" }} />
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
