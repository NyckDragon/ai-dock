import { AlertTriangle, Wrench } from "lucide-react";
import { t } from "../lib/i18n";
import { openStatusPage } from "../lib/tauri";
import type { ProviderStatus } from "../types";

export function statusText(status: ProviderStatus) {
  if (status.level === "maintenance") return t("Manutenção");
  if (status.level === "minor") return t("Instabilidade");
  return t("Fora do ar");
}

/** Incident from the provider's official status page, with a link to it. */
export function StatusBadge({ status }: { status: ProviderStatus }) {
  const Icon = status.level === "maintenance" ? Wrench : AlertTriangle;
  const tone = status.level === "maintenance" ? "info" : status.level === "minor" ? "warning" : "danger";
  return (
    <div className={"status-banner status-banner--" + tone}>
      <Icon size={13} aria-hidden="true" />
      <span>
        <strong>{statusText(status)}</strong>
        {status.summary ? <small>{status.summary}</small> : null}
      </span>
      <button
        type="button"
        className="text-button"
        onClick={(event) => {
          event.stopPropagation();
          void openStatusPage(status.providerId).catch(() => undefined);
        }}
      >
        {t("Ver status")}
      </button>
    </div>
  );
}
