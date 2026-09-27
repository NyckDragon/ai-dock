import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { t } from "../lib/i18n";
import type { ProviderUsage, Settings } from "../types";
import { Segmented } from "./controls";
import { ProviderIcon } from "./ProviderIcon";
import { CompactModePicker } from "./SettingsPanel";

const STEPS = ["Seus providers", "Conectar o Claude", "Visual do dock"];
const stepTitle = (index: number) => t(STEPS[index]);

/** First-run tour: what was detected, how to connect Claude, how the dock should look. */
export function Onboarding({
  providers,
  loading,
  settings,
  update,
  onOpenConnections,
  onFinish
}: {
  providers: ProviderUsage[];
  loading: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onOpenConnections: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const claude = providers.find((provider) => provider.id === "claude");

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding__progress" aria-label={t("Passo {step} de {total}", { step: step + 1, total: STEPS.length })}>
        {STEPS.map((label, index) => (
          <i key={label} className={index <= step ? "is-done" : ""} />
        ))}
      </div>
      <span className="eyebrow">
        {t("Passo {step} de {total}", { step: step + 1, total: STEPS.length })}
      </span>
      <h2 id="onboarding-title">{stepTitle(step)}</h2>

      {step === 0 ? (
        <>
          <p className="hint">
            {t("O AI Dock lê a quota de cada ferramenta direto deste PC, sem pedir senha. Estes são os que ele já encontrou:")}
          </p>
          <ul className="detect-list">
            {providers.map((provider) => (
              <li key={provider.id}>
                <ProviderIcon providerId={provider.id} size={16} brand />
                <span className="detect-list__name">{provider.name}</span>
                {provider.connected ? (
                  <CheckCircle2 size={15} className="tone-text--good" aria-label={t("Conectado")} />
                ) : (
                  <Circle size={15} className="muted" aria-label={t("Não encontrado")} />
                )}
              </li>
            ))}
            {!providers.length && loading ? <li className="muted">{t("Procurando…")}</li> : null}
          </ul>
          <p className="hint">{t("Os que faltam podem ser conectados depois em Configurações → Conexões.")}</p>
        </>
      ) : null}

      {step === 1 ? (
        claude?.connected ? (
          <p className="hint">
            <CheckCircle2 size={14} className="tone-text--good" /> {t("O Claude já está conectado. Nada a fazer aqui.")}
          </p>
        ) : (
          <>
            <p className="hint">
              {t(
                "O Claude Desktop não informa a quota. Entre uma vez na sua conta do claude.ai numa janela do AI Dock; depois ele renova a sessão sozinho."
              )}
            </p>
            <button type="button" className="button button--primary button--block" onClick={onOpenConnections}>
              {t("Entrar com claude.ai")}
            </button>
            <p className="hint">{t("Se preferir, pule e faça isso depois.")}</p>
          </>
        )
      ) : null}

      {step === 2 ? (
        <>
          <p className="hint">{t("Como o dock deve aparecer recolhido na borda da tela?")}</p>
          <CompactModePicker value={settings.compactMode} onChange={(compactMode) => update({ compactMode })} />
          <Segmented
            label={t("Lado da tela")}
            value={settings.side}
            onChange={(side) => update({ side })}
            options={[
              { value: "left", label: t("Esquerda") },
              { value: "right", label: t("Direita") }
            ]}
          />
        </>
      ) : null}

      <div className="onboarding__actions">
        <button type="button" className="text-button" onClick={onFinish}>
          {t("Pular")}
        </button>
        <span />
        {step > 0 ? (
          <button type="button" className="button button--ghost" onClick={() => setStep(step - 1)}>
            {t("Voltar")}
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button type="button" className="button button--primary" onClick={() => setStep(step + 1)}>
            {t("Continuar")}
          </button>
        ) : (
          <button type="button" className="button button--primary" onClick={onFinish}>
            {t("Concluir")}
          </button>
        )}
      </div>
    </div>
  );
}
