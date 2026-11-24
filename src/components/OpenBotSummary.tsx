import { Bot } from "lucide-react";
import { wrongAccount } from "../lib/accounts";
import { sessionPools } from "../lib/accountsOverview";
import { t } from "../lib/i18n";
import { isOpenBotSlot, runtimeInfo } from "../lib/openbot";
import { displayWord, featuredWindow, shownPercent } from "../lib/quota";
import type { HeadlineWindow, PercentDisplay, ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";

/**
 * Everything inside OpenBot in one place: each Antigravity account it uses with
 * its Gemini and Claude + GPT sessions, then the other AIs it has installed,
 * with the dock's own reading when the dock follows that AI too.
 */
export function OpenBotSummary({
  provider,
  providers,
  runtimes,
  display,
  headline
}: {
  provider: ProviderUsage;
  /** Every provider the dock reads, for the other AIs' numbers. */
  providers: ProviderUsage[];
  runtimes: string[];
  display: PercentDisplay;
  headline: HeadlineWindow;
}) {
  const members = provider.members ?? [];
  return (
    <div className="openbot-summary">
      <div className="openbot-summary__head">
        <span className="openbot-summary__label">
          {members.length === 1 ? t("1 conta") : t("{count} contas", { count: String(members.length) })}
        </span>
        {members[0] ? <small>{"% " + displayWord(display, members[0].id)}</small> : null}
      </div>
      <div className="openbot-summary__accounts">
        {members.map((member) => {
          const pools = sessionPools(member);
          const wrong = wrongAccount(member);
          return (
            <div key={member.id} className={"openbot-account" + (member.connected && !member.stale ? "" : " is-off")}>
              <span className="openbot-account__name">
                <strong>{member.name.replace(/^Antigravity\s*·\s*/i, "")}</strong>
                {wrong ? (
                  <small className="is-wrong">{t("conta errada")}</small>
                ) : !isOpenBotSlot(member.id) ? (
                  <small>{t("também no Antigravity")}</small>
                ) : !member.connected ? (
                  <small>{t("fechado")}</small>
                ) : member.stale ? (
                  <small>{t("leitura antiga")}</small>
                ) : null}
              </span>
              {pools.length ? (
                pools.map((pool) => {
                  const value = shownPercent(pool.remaining, display, member.id);
                  return (
                    <span key={pool.id} className="openbot-account__pool">
                      <small>
                        {pool.label === "Claude" ? "Claude + GPT" : pool.label}
                        <b>{value}%</b>
                      </small>
                      <i className="accounts__track">
                        <i style={{ width: value + "%", background: pool.color }} />
                      </i>
                    </span>
                  );
                })
              ) : (
                <small className="openbot-account__empty">{t("sem dados de quota")}</small>
              )}
            </div>
          );
        })}
      </div>

      {runtimes.length ? (
        <>
          <span className="openbot-summary__label">{t("Outras IAs no OpenBot")}</span>
          <div className="openbot-summary__runtimes">
            {runtimes.map((runtime) => {
              const info = runtimeInfo(runtime);
              const reading = info.providerId ? providers.find((item) => item.id === info.providerId) : undefined;
              const window = reading ? featuredWindow(reading, headline) : null;
              const value = window && !window.amount ? shownPercent(window.remainingPercent, display, reading!.id) : null;
              return (
                <span key={runtime} className="openbot-runtime">
                  {info.providerId ? (
                    <ProviderChip providerId={info.providerId} size={12} />
                  ) : (
                    <span className="provider-chip openbot-runtime__generic" aria-hidden="true">
                      <Bot size={12} />
                    </span>
                  )}
                  <strong>{info.name}</strong>
                  {value != null ? (
                    <small>
                      {value}% {displayWord(display, reading!.id)}
                    </small>
                  ) : null}
                </span>
              );
            })}
          </div>
          <p className="openbot-summary__hint">{t("Os números das outras IAs são os que o dock lê da sua conta de cada uma.")}</p>
        </>
      ) : null}
    </div>
  );
}
