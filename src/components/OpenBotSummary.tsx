import { Bot } from "lucide-react";
import { wrongAccount } from "../lib/accounts";
import { sessionPools } from "../lib/accountsOverview";
import { t } from "../lib/i18n";
import { isOpenBotSlot, runtimeInfo, type OpenBotTask } from "../lib/openbot";
import { displayWord, featuredWindow, shownPercent } from "../lib/quota";
import type { HeadlineWindow, PercentDisplay, ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";

type Row = { key: string; member?: ProviderUsage; number: number };

/**
 * The account rows: every account folder OpenBot has, in its order, so a
 * stopped account still shows as one. Without that list, the accounts with a
 * reading are enough.
 */
function accountRows(members: ProviderUsage[], accounts?: (string | null)[]): Row[] {
  if (!accounts?.length) return members.map((member, index) => ({ key: member.id, member, number: index + 1 }));
  const byId = new Map(members.map((member) => [member.id, member]));
  const seen = new Set<string>();
  const rows: Row[] = [];
  accounts.forEach((slot, index) => {
    if (slot && seen.has(slot)) return;
    if (slot) seen.add(slot);
    rows.push({ key: slot ?? "stopped-" + index, member: slot ? byId.get(slot) : undefined, number: index + 1 });
  });
  for (const member of members) {
    if (!seen.has(member.id)) rows.push({ key: member.id, member, number: rows.length + 1 });
  }
  return rows;
}

function RuntimeChip({ runtime, size = 12 }: { runtime: string; size?: number }) {
  const info = runtimeInfo(runtime);
  return info.providerId ? (
    <ProviderChip providerId={info.providerId} size={size} />
  ) : (
    <span className="provider-chip openbot-runtime__generic" aria-hidden="true">
      <Bot size={size} />
    </span>
  );
}

/**
 * Everything inside OpenBot in one place: each Antigravity account it has with
 * its Gemini and Claude + GPT sessions (a stopped one too), the other AIs it
 * has installed with the dock's own reading, and what runs in it right now.
 */
export function OpenBotSummary({
  provider,
  providers,
  runtimes,
  accounts,
  tasks = [],
  display,
  headline
}: {
  provider: ProviderUsage;
  /** Every provider the dock reads, for the other AIs' numbers. */
  providers: ProviderUsage[];
  runtimes: string[];
  accounts?: (string | null)[];
  tasks?: OpenBotTask[];
  display: PercentDisplay;
  headline: HeadlineWindow;
}) {
  const members = provider.members ?? [];
  const rows = accountRows(members, accounts);
  const busy = new Set(tasks.map((task) => task.runtime));
  return (
    <div className="openbot-summary">
      <div className="openbot-summary__head">
        <span className="openbot-summary__label">
          {rows.length === 1 ? t("1 conta") : t("{count} contas", { count: String(rows.length) })}
        </span>
        {members[0] ? <small>{"% " + displayWord(display, members[0].id)}</small> : null}
      </div>
      <div className="openbot-summary__accounts">
        {rows.map(({ key, member, number }) => {
          if (!member) {
            return (
              <div key={key} className="openbot-account is-off">
                <span className="openbot-account__name">
                  <strong>{t("Conta {number} do OpenBot", { number: String(number) })}</strong>
                  <small>{t("parada agora")}</small>
                </span>
                <small className="openbot-account__empty">{t("Sem leitura enquanto o OpenBot não usa esta conta.")}</small>
              </div>
            );
          }
          const pools = sessionPools(member);
          const wrong = wrongAccount(member);
          return (
            <div key={key} className={"openbot-account" + (member.connected && !member.stale ? "" : " is-off")}>
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
                <span key={runtime} className={"openbot-runtime" + (busy.has(runtime) ? " is-busy" : "")}>
                  <RuntimeChip runtime={runtime} />
                  <strong>{info.name}</strong>
                  {value != null ? (
                    <small>
                      {value}% {displayWord(display, reading!.id)}
                    </small>
                  ) : null}
                  {busy.has(runtime) ? <i className="openbot-runtime__busy" aria-label={t("trabalhando")} /> : null}
                </span>
              );
            })}
          </div>
          {tasks.length ? (
            <ul className="openbot-tasks" aria-label={t("Agora no OpenBot")}>
              {tasks.map((task) => (
                <li key={task.runtime + task.since}>
                  <RuntimeChip runtime={task.runtime} size={11} />
                  <span>
                    <strong>{runtimeInfo(task.runtime).name}</strong>
                    <small>{task.title || t("conversa sem título ainda")}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="openbot-summary__hint">{t("Os números das outras IAs são os que o dock lê da sua conta de cada uma.")}</p>
        </>
      ) : null}
    </div>
  );
}
