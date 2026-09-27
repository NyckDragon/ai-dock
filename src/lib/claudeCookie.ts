const CLAUDE_COOKIE_NAMES = new Set([
  "sessionKey",
  "cf_clearance",
  "__cf_bm",
  "anthropic-device-id"
]);

/** Turns a pasted DevTools cookie table, Cookie header or bare sessionKey into the header AI Dock stores. */
export function normalizeClaudeCookieInput(raw: string) {
  const trimmed = raw.trim();
  const pairs: string[] = [];
  const seen = new Set<string>();

  const addPair = (rawName: string, rawValue: string) => {
    const name = rawName.replace(/\\_/g, "_").replace(/`/g, "").trim();
    const value = rawValue.replace(/`/g, "").trim();
    if (!CLAUDE_COOKIE_NAMES.has(name) || !value || seen.has(name)) return;
    seen.add(name);
    pairs.push(name + "=" + value);
  };

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("|")) {
      const columns = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((part) => part.trim());
      if (columns.length >= 2) addPair(columns[0], columns[1]);
    }

    const tabColumns = line.split("\t").map((part) => part.trim());
    if (tabColumns.length >= 2) addPair(tabColumns[0], tabColumns[1]);
  }

  if (seen.has("sessionKey")) return pairs.join("; ");

  const cookieLine = trimmed
    .split(/\r?\n/)
    .find((line) => line.trim().toLowerCase().startsWith("cookie:"));
  if (cookieLine) {
    const separator = cookieLine.indexOf(":");
    if (separator >= 0) return cookieLine.slice(separator + 1).trim();
  }

  return trimmed;
}
