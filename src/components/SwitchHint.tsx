import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";
import type { SwitchSuggestion } from "../lib/accountsOverview";
import { t } from "../lib/i18n";
import { focusAntigravityWindow } from "../lib/tauri";

function shortName(name: string) {
  return name.replace(/^Antigravity\s*·\s*/i, "").replace(/\s*\(Principal\)$/i, "");
}

/**
 * "Nyck is at 8% of Gemini; Jessy has 91%": one click brings Jessy's
 * Antigravity window to the front. When that window is closed, it says so.
 */
export function SwitchHint({ suggestion }: { suggestion: SwitchSuggestion }) {
  const [closed, setClosed] = useState(false);
  const from = shortName(suggestion.from.name);
  const to = shortName(suggestion.to.name);
  const pool = suggestion.pool === "Claude" ? "Claude + GPT" : suggestion.pool;
  return (
    <div className="switch-hint" role="status" onClick={(event) => event.stopPropagation()}>
      <span className="switch-hint__icon" aria-hidden="true">
        <ArrowRightLeft size={14} />
      </span>
      <span className="switch-hint__copy">
        <strong>{t("{from} está com {value}% no {pool}", { from, value: String(suggestion.fromRemaining), pool })}</strong>
        <small>
          {closed
            ? t("Abra a janela de {to} no Antigravity para continuar lá.", { to })
            : t("{to} tem {value}% livre. Continue a tarefa lá.", { to, value: String(suggestion.toRemaining) })}
        </small>
      </span>
      <button
        type="button"
        className="switch-hint__go"
        onClick={() => {
          void focusAntigravityWindow(suggestion.to.id).then((ok) => setClosed(!ok));
        }}
      >
        {t("Ir para {to}", { to })}
      </button>
    </div>
  );
}
