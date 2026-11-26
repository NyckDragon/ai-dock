import { useEffect, useRef, useState } from "react";
import { accountState, type AccountState } from "../lib/accounts";
import { t } from "../lib/i18n";
import type { ProviderUsage } from "../types";
import { ProviderChip } from "./ProviderIcon";

const STATE_TEXT: Record<AccountState, string | null> = {
  ok: null,
  stale: "Desatualizado",
  wrong: "Conta errada",
  error: "Sem acesso",
  off: null
};

const STATE_LABEL: Record<AccountState, string> = {
  ok: "Conectado",
  stale: "Desatualizado",
  wrong: "Conta errada",
  error: "Sem acesso",
  off: "Não conectado"
};

/**
 * Every account in the sidebar with a dot, like Claude Usage Tracker's profile
 * list: green reads fine, red is the wrong login or lost access, amber is an old
 * reading, gray was never connected. A click opens its page.
 */
export function SidebarAccounts({
  providers,
  selectedId,
  onSelect
}: {
  providers: ProviderUsage[];
  selectedId: string | null;
  onSelect: (providerId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // The bottom fades only while more accounts wait below.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const check = () => setMore(list.scrollTop + list.clientHeight < list.scrollHeight - 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(list);
    list.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", check);
    };
  }, [providers.length]);

  if (!providers.length) return null;
  return (
    <nav className="panel-nav__group nav-accounts" aria-label={t("Contas")}>
      <span className="panel-nav__label">{t("Contas")}</span>
      <div className={"nav-accounts__list" + (more ? " has-more" : "")} ref={listRef}>
        {providers.map((provider) => {
          const state = accountState(provider);
          const note = STATE_TEXT[state];
          const name = provider.name.replace(/^Antigravity\s*·\s*/i, "");
          const selected = provider.id === selectedId;
          return (
            <button
              type="button"
              key={provider.id}
              className={"panel-nav__item nav-account nav-account--" + state + (selected ? " is-selected" : "")}
              aria-current={selected ? "page" : undefined}
              aria-label={name + ": " + t(STATE_LABEL[state])}
              onClick={() => onSelect(provider.id)}
            >
              <ProviderChip providerId={provider.id} size={13} />
              <span className="nav-account__copy">
                <span className="nav-account__name">{name}</span>
                {note ? <small className="nav-account__note">{t(note)}</small> : null}
              </span>
              <i className="nav-account__dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
