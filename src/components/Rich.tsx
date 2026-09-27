import { Fragment, type ReactNode } from "react";

/**
 * Renders a translated sentence with light markup, so the whole sentence stays
 * one translation key: **bold**, `code` and [[key]] for keyboard keys.
 */
export function rich(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("[[") && part.endsWith("]]")) return <kbd key={index}>{part.slice(2, -2)}</kbd>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
