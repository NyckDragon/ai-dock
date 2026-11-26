import { wrongAccount } from "../lib/accounts";
import { bestAccount, sessionPools, type SwitchSuggestion } from "../lib/accountsOverview";
import { t } from "../lib/i18n";
import type { ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";
import { SwitchHint } from "./SwitchHint";

/**
 * Every Antigravity account side by side, with the one that has the most room
 * right now on top. Clicking an account jumps to its card.
 */
export function AccountsOverview({
  accounts,
  onPick,
  suggestion
}: {
  accounts: ProviderUsage[];
  onPick: (providerId: string) => void;
  /** The account in use is nearly out: where to go next. */
  suggestion?: SwitchSuggestion | null;
}) {
  if (accounts.length < 2) return null;
  const best = bestAccount(accounts);

  return (
    <section className="accounts" aria-label={t("Contas do Antigravity")}>
      <header className="accounts__head">
        <ProviderChip providerId="antigravity" />
        <div>
          <strong>{t("Contas do Antigravity")}</strong>
          <small>{t("Sessão de 5h de cada conta")}</small>
        </div>
      </header>

      {suggestion ? (
        <SwitchHint suggestion={suggestion} />
      ) : best ? (
        <button type="button" className="accounts__best" onClick={() => onPick(best.id)}>
          <span>{t("Use agora")}</span>
          <strong>{shortName(best.name)}</strong>
          <small>{t("mais folga até o reset")}</small>
        </button>
      ) : null}

      <div className="accounts__grid" style={{ gridTemplateColumns: `repeat(${accounts.length}, minmax(0, 1fr))` }}>
        {accounts.map((account) => {
          const pools = sessionPools(account);
          const wrong = wrongAccount(account);
          return (
            <button
              type="button"
              key={account.id}
              className={
                "accounts__item" +
                (best?.id === account.id ? " is-best" : "") +
                (wrong ? " is-wrong" : "") +
                (account.connected ? "" : " is-off")
              }
              onClick={() => onPick(account.id)}
              title={wrong ? t("logada em outra conta") : account.name}
            >
              <strong>{shortName(account.name)}</strong>
              {pools.length ? (
                pools.map((pool) => (
                  <span key={pool.id} className="accounts__pool">
                    <small>
                      {pool.label} <b>{pool.remaining}%</b>
                    </small>
                    <i className="accounts__track">
                      <i style={{ width: pool.remaining + "%", background: pool.color }} />
                    </i>
                  </span>
                ))
              ) : (
                <small className="accounts__note">{account.connected ? t("sem dados de quota") : t("fechado")}</small>
              )}
              {wrong ? <small className="accounts__note accounts__note--wrong">{t("conta errada")}</small> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** "Antigravity · Conta 2" reads as "Conta 2"; a name the user gave stays as is. */
function shortName(name: string) {
  return name.replace(/^Antigravity\s*·\s*/i, "").replace(/\s*\(Principal\)$/i, "");
}
