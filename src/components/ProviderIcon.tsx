import type { CSSProperties } from "react";

const ICONS: Record<string, string> = {
  claude: "/provider-icons/claude.svg",
  codex: "/provider-icons/codex.svg",
  cursor: "/provider-icons/cursor.svg",
  antigravity: "/provider-icons/antigravity.svg",
  "antigravity-gemini": "/provider-icons/gemini.svg",
  "antigravity-gpt": "/provider-icons/antigravity.svg",
  "antigravity-argon": "/provider-icons/gemini.svg"
};

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
