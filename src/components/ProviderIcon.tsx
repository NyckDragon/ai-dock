import type { CSSProperties } from "react";

const ICONS: Record<string, string> = {
  claude: "/provider-icons/claude.svg",
  codex: "/provider-icons/codex.svg",
  antigravity: "/provider-icons/antigravity.svg",
  "antigravity-gemini": "/provider-icons/gemini.svg",
  "antigravity-gpt": "/provider-icons/antigravity.svg"
};

export function ProviderIcon({
  providerId,
  size = 18,
  title
}: {
  providerId: string;
  size?: number;
  title?: string;
}) {
  const normalized = providerId.toLowerCase();
  const source = ICONS[normalized];

  if (!source) {
    return (
      <span
        className="provider-icon provider-icon--fallback"
        style={{ width: size, height: size }}
        title={title}
        aria-label={title}
      >
        {providerId.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={"provider-icon provider-icon--" + normalized.replace(/[^a-z0-9-]/g, "")}
      style={{
        width: size,
        height: size,
        "--provider-icon": "url('" + source + "')"
      } as CSSProperties}
      title={title}
      aria-label={title}
    />
  );
}
