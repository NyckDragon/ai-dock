import { wrongAccount } from "../lib/accounts";
import { t } from "../lib/i18n";
import { limitingWindow } from "../lib/quota";
import type { ProviderUsage } from "../types";

/** One line on the state of every provider, like ClaudeBar's "Healthy" badge. */
export function HealthChip({ providers }: { providers: ProviderUsage[] }) {
  const live = providers.filter((provider) => provider.connected && !provider.stale);
  const wrong = providers.filter(wrongAccount).length;
  const low = live.filter((provider) => {
    const window = limitingWindow(provider);
    return window != null && window.remainingPercent <= 25;
  }).length;

  const tone = wrong ? "danger" : low ? "warning" : "good";
  const text = wrong
    ? wrong === 1
      ? t("1 conta logada errado")
      : t("{count} contas logadas errado", { count: String(wrong) })
    : low
      ? t("{count} perto do limite", { count: String(low) })
      : t("Tudo com folga");

  return (
    <div className={"health-chip health-chip--" + tone} role="status">
      <i aria-hidden="true" />
      <span>{text}</span>
      <small>{t("{count} ativos", { count: String(live.length) })}</small>
    </div>
  );
}
