import type { CSSProperties } from "react";

const ICONS: Record<string, string> = {
  claude: "/provider-icons/claude.svg",
  codex: "/provider-icons/codex.svg",
  cursor: "/provider-icons/cursor.svg",
  antigravity: "/provider-icons/antigravity.svg",
  deepseek: "/provider-icons/deepseek.svg",
  grok: "/provider-icons/grok.svg",
  "grok-bot": "/provider-icons/grok-bot.svg",
  "antigravity-gemini": "/provider-icons/gemini.svg",
  "antigravity-gpt": "/provider-icons/antigravity.svg",
  "antigravity-argon": "/provider-icons/gemini.svg"
};

/** The brand a provider id belongs to: "antigravity-3" is Antigravity, "grok-bot" is Grok. */
function brandOf(normalized: string) {
  if (normalized.startsWith("antigravity")) return "antigravity";
  if (normalized.startsWith("grok")) return "grok";
  return normalized.replace(/[^a-z0-9-]/g, "");
}

/** Class that sets `color` to the provider's brand color. */
export function brandColorClass(providerId: string) {
  return "provider-brand--" + brandOf(providerId.toLowerCase());
}

/** The provider icon on a tinted chip in its brand color, for card headers. */
export function ProviderChip({ providerId, size = 18 }: { providerId: string; size?: number }) {
  return (
    <span className={"provider-chip " + brandColorClass(providerId)} aria-hidden="true">
      <ProviderIcon providerId={providerId} size={size} />
    </span>
  );
}

export function ProviderIcon({
  providerId,
  size = 18,
  brand = false
}: {
  providerId: string;
  size?: number;
  /** Paints the icon in the provider's brand color instead of the text color. */
  brand?: boolean;
}) {
  const normalized = providerId.toLowerCase();
  let source = ICONS[normalized];
  if (!source) {
    if (normalized.endsWith("-gemini")) source = ICONS["antigravity-gemini"];
    else if (normalized.endsWith("-gpt")) source = ICONS["antigravity-gpt"];
    else if (normalized.endsWith("-argon") || normalized.includes("argon")) source = ICONS["antigravity-argon"];
    else if (normalized.startsWith("antigravity")) source = ICONS["antigravity"];
  }
  const brandClass = brand ? " provider-icon--brand provider-brand--" + normalized.replace(/[^a-z0-9-]/g, "") : "";

  if (!source) {
    return (
      <span
        className={"provider-icon provider-icon--fallback" + brandClass}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {providerId.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={"provider-icon" + brandClass}
      style={{
        width: size,
        height: size,
        "--provider-icon": "url('" + source + "')"
      } as CSSProperties}
      aria-hidden="true"
    />
  );
}
