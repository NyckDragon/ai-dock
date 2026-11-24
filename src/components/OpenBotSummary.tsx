import { Bot } from "lucide-react";
import type { CSSProperties } from "react";
import { wrongAccount } from "../lib/accounts";
import { sessionPools } from "../lib/accountsOverview";
import { t } from "../lib/i18n";
import { botName, isOpenBotSlot, modelLabel, runtimeInfo, type OpenBotAccount, type OpenBotBot } from "../lib/openbot";
import { displayWord, featuredWindow, shownPercent } from "../lib/quota";
import type { HeadlineWindow, PercentDisplay, ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";

type Row = { key: string; ids: (string | null)[]; member?: ProviderUsage };

/**
 * One row per account: OpenBot's folders in order, the ones that turned out to
 * be the same account folded together. Without that list, the accounts with a
 * reading are enough.
 */
function accountRows(members: ProviderUsage[], accounts?: OpenBotAccount[]): Row[] {
  if (!accounts?.length) return members.map((member) => ({ key: member.id, ids: [], member }));
  const byId = new Map(members.map((member) => [member.id, member]));
  const rows: Row[] = [];
  for (const account of accounts) {
    const same = account.slot ? rows.find((row) => row.member?.id === account.slot || row.key === account.slot) : undefined;
    if (same) {
      same.ids.push(account.id);
      continue;
    }
    rows.push({ key: account.slot ?? "folder-" + account.id, ids: [account.id], member: account.slot ? byId.get(account.slot) : undefined });
  }
  for (const member of members) {
    if (!rows.some((row) => row.member?.id === member.id)) rows.push({ key: member.id, ids: [], member });
  }
  return rows;
}

function BotAvatar({ bot }: { bot: OpenBotBot }) {
  return (
    <span className="bot-avatar" style={{ "--bot-hue": bot.hue } as CSSProperties} aria-hidden="true">
      {botName(bot.name).tag}
    </span>
  );
}

function RuntimeChip({ runtime, size = 12 }: { runtime: string; size?: number }) {
  const info = runtimeInfo(runtime);
  if (runtime === "antigravity") return <ProviderChip providerId="antigravity" size={size} />;
  return info.providerId ? (
    <ProviderChip providerId={info.providerId} size={size} />
  ) : (
    <span className="provider-chip openbot-runtime__generic" aria-hidden="true">
      <Bot size={size} />
    </span>
  );
}

/**
 * Everything inside OpenBot: its bots (who is working now, and on the page all
 * of them), the Antigravity accounts they run on, and the engines installed,
 * with the dock's own reading when it follows that AI too.
 */
export function OpenBotSummary({
  provider,
  providers,
  runtimes,
  accounts,
  bots = [],
  display,
  headline,
  full = false
}: {
  provider: ProviderUsage;
  /** Every provider the dock reads, for the engines' numbers. */
  providers: ProviderUsage[];
  runtimes: string[];
  accounts?: OpenBotAccount[];
  bots?: OpenBotBot[];
  display: PercentDisplay;
  headline: HeadlineWindow;
  /** The provider page lists every bot; the hover card only the busy ones. */
  full?: boolean;
}) {
  const members = provider.members ?? [];
  const rows = accountRows(members, accounts);
  const running = bots.filter((bot) => bot.running);
  const botsOf = (row: Row) =>
    bots.filter((bot) => (bot.accountId != null && row.ids.includes(bot.accountId)) || (row.member && bot.account === row.member.id));
  const engines = [...new Set(["antigravity", ...runtimes, ...bots.map((bot) => bot.provider)])].filter(Boolean);
  let stopped = 0;

  return (
    <div className="openbot-summary">
      {bots.length ? (
        <>
          <div className="openbot-summary__head">
            <span className="openbot-summary__label">{bots.length === 1 ? t("1 bot") : t("{count} bots", { count: String(bots.length) })}</span>
            <small className={running.length ? "is-busy" : ""}>
              {running.length ? t("{count} trabalhando", { count: String(running.length) }) : t("todos parados")}
            </small>
          </div>
          {(full ? bots : running).length ? (
            <ul className="openbot-bots">
              {(full ? bots : running).map((bot) => {
                const { label } = botName(bot.name);
                const account = bot.account ? providers.find((item) => item.id === bot.account) : undefined;
                return (
                  <li key={bot.name} className={bot.running ? "is-running" : ""}>
                    <BotAvatar bot={bot} />
                    <span className="openbot-bots__copy">
                      <strong>{label}</strong>
                      <small>
                        {runtimeInfo(bot.provider).name}
                        {bot.model ? " · " + modelLabel(bot.model) : ""}
                        {account ? " · " + account.name.replace(/^Antigravity\s*·\s*/i, "") : ""}
                      </small>
                    </span>
                    {bot.running ? <i className="openbot-bots__live" aria-label={t("trabalhando")} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      ) : null}

      <div className="openbot-summary__head">
        <span className="openbot-summary__label">{rows.length === 1 ? t("1 conta") : t("{count} contas", { count: String(rows.length) })}</span>
        {members[0] ? <small>{"% " + displayWord(display, members[0].id)}</small> : null}
      </div>
      <div className="openbot-summary__accounts">
        {rows.map((row) => {
          const used = botsOf(row).length;
          const usedText = used ? (used === 1 ? t("1 bot") : t("{count} bots", { count: String(used) })) : null;
          const member = row.member;
          if (!member) {
            stopped += 1;
            return (
              <div key={row.key} className="openbot-account is-off">
                <span className="openbot-account__name">
                  <strong>{t("Conta parada {number}", { number: String(stopped) })}</strong>
                  <small>{usedText ? usedText + " · " + t("sem leitura agora") : t("sem leitura agora")}</small>
                </span>
              </div>
            );
          }
          const pools = sessionPools(member);
          const wrong = wrongAccount(member);
          const note = wrong
            ? t("conta errada")
            : !isOpenBotSlot(member.id)
              ? t("também no Antigravity")
              : !member.connected
                ? t("fechado")
                : member.stale
                  ? t("leitura antiga")
                  : null;
          return (
            <div key={row.key} className={"openbot-account" + (member.connected && !member.stale ? "" : " is-off")}>
              <span className="openbot-account__name">
                <strong>{member.name.replace(/^Antigravity\s*·\s*/i, "")}</strong>
                {note || usedText ? <small className={wrong ? "is-wrong" : ""}>{[usedText, note].filter(Boolean).join(" · ")}</small> : null}
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

      <span className="openbot-summary__label">{t("Motores")}</span>
      <div className="openbot-summary__runtimes">
        {engines.map((engine) => {
          const info = runtimeInfo(engine);
          const count = bots.filter((bot) => bot.provider === engine).length;
          const reading = info.providerId ? providers.find((item) => item.id === info.providerId) : undefined;
          const window = reading ? featuredWindow(reading, headline) : null;
          const value = window && !window.amount ? shownPercent(window.remainingPercent, display, reading!.id) : null;
          const busy = running.some((bot) => bot.provider === engine);
          return (
            <span key={engine} className={"openbot-runtime" + (busy ? " is-busy" : "")}>
              <RuntimeChip runtime={engine} />
              <strong>{engine === "antigravity" ? "Antigravity" : info.name}</strong>
              <small>
                {[count ? (count === 1 ? t("1 bot") : t("{count} bots", { count: String(count) })) : null, value != null ? value + "% " + displayWord(display, reading!.id) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {busy ? <i className="openbot-runtime__busy" aria-label={t("trabalhando")} /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
