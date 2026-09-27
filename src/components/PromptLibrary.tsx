import { Check, Clipboard, FolderOpen, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadPromptUsage, recordPromptUse, type PromptUsage } from "../lib/prompts";
import { fillPrompt, promptPreview, promptVariables } from "../lib/promptTemplate";
import type { PromptItem } from "../types";
import { PromptVariablesDialog } from "./PromptVariablesDialog";

const PAGE = 30;
type Filter = { kind: "all" } | { kind: "favorites" } | { kind: "recent" } | { kind: "category"; value: string };

function sameFilter(a: Filter, b: Filter) {
  return a.kind === b.kind && (a.kind !== "category" || a.value === (b as { value: string }).value);
}

export function PromptLibrary({
  prompts,
  obsidianPath,
  scanning,
  error,
  focusKey,
  onChooseFolder,
  onRescan,
  onCopied
}: {
  prompts: PromptItem[];
  obsidianPath: string | null;
  scanning: boolean;
  error: string | null;
  /** Changes whenever the search box should take focus (global shortcut). */
  focusKey: number;
  onChooseFolder: () => void;
  onRescan: () => void;
  /** Runs after a prompt lands on the clipboard. */
  onCopied?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [limit, setLimit] = useState(PAGE);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [usage, setUsage] = useState<PromptUsage>(loadPromptUsage);
  const [pending, setPending] = useState<PromptItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusKey]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const prompt of prompts) {
      if (prompt.category) counts.set(prompt.category, (counts.get(prompt.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
  }, [prompts]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    let list = prompts;
    if (filter.kind === "favorites") list = list.filter((prompt) => prompt.favorite);
    if (filter.kind === "recent") list = list.filter((prompt) => usage[prompt.path]);
    if (filter.kind === "category") list = list.filter((prompt) => prompt.category === filter.value);
    if (normalized) {
      list = list.filter((prompt) =>
        [prompt.title, prompt.category, prompt.tags.join(" "), prompt.content]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(normalized)
      );
    }

    const titleMatch = (prompt: PromptItem) =>
      normalized && prompt.title.toLocaleLowerCase("pt-BR").includes(normalized) ? 1 : 0;
    return [...list].sort((a, b) => {
      if (filter.kind === "recent") return (usage[b.path]?.lastUsed || 0) - (usage[a.path]?.lastUsed || 0);
      return (
        titleMatch(b) - titleMatch(a) ||
        Number(b.favorite) - Number(a.favorite) ||
        (usage[b.path]?.count || 0) - (usage[a.path]?.count || 0) ||
        a.title.localeCompare(b.title, "pt-BR")
      );
    });
  }, [prompts, query, filter, usage]);

  useEffect(() => {
    setActive(0);
    setLimit(PAGE);
  }, [query, filter]);

  const visible = filtered.slice(0, limit);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-index="' + active + '"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function copyText(prompt: PromptItem, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopied(prompt.path);
      setUsage((current) => recordPromptUse(current, prompt.path));
      onCopied?.();
      window.setTimeout(() => setCopied((value) => (value === prompt.path ? null : value)), 1400);
    } catch {
      setCopyError("Não foi possível copiar para a área de transferência.");
    }
  }

  function choose(prompt: PromptItem) {
    if (promptVariables(prompt.content).length) setPending(prompt);
    else void copyText(prompt, prompt.content);
  }

  const chips: { filter: Filter; label: string }[] = [
    { filter: { kind: "all" }, label: "Todos" },
    { filter: { kind: "favorites" }, label: "Favoritos" },
    { filter: { kind: "recent" }, label: "Recentes" },
    ...categories.map((value) => ({ filter: { kind: "category", value } as Filter, label: value }))
  ];

  if (!obsidianPath) {
    return (
      <section className="prompt-section">
        <button type="button" className="empty-state" onClick={onChooseFolder}>
          <FolderOpen size={22} />
          <span>Vincular pasta de prompts</span>
          <small>Escolha o Vault do Obsidian ou uma subpasta com arquivos .md.</small>
        </button>
      </section>
    );
  }

  const copiedPrompt = prompts.find((prompt) => prompt.path === copied);

  return (
    <section className="prompt-section">
      <div className="search-row">
        <label className="search-box">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            aria-label="Pesquisar prompts"
            placeholder="Pesquisar prompts…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, visible.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && visible[active]) {
                event.preventDefault();
                choose(visible[active]);
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </label>
        <button
          type="button"
          className={"icon-button" + (scanning ? " is-spinning" : "")}
          onClick={onRescan}
          aria-label="Recarregar prompts"
          title="Recarregar prompts"
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onChooseFolder}
          aria-label="Trocar pasta do Obsidian"
          title={obsidianPath}
        >
          <FolderOpen size={15} />
        </button>
      </div>

      <div className="chips" role="toolbar" aria-label="Filtrar prompts">
        {chips.map((chip) => (
          <button
            type="button"
            key={chip.label + chip.filter.kind}
            className={"chip" + (sameFilter(chip.filter, filter) ? " is-selected" : "")}
            aria-pressed={sameFilter(chip.filter, filter)}
            onClick={() => setFilter(chip.filter)}
          >
            {chip.filter.kind === "favorites" ? <Star size={11} aria-hidden="true" /> : null}
            {chip.label}
          </button>
        ))}
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}
      {copyError ? <div className="notice notice--error">{copyError}</div> : null}

      <div className="prompt-count">
        {filtered.length === prompts.length
          ? prompts.length + (prompts.length === 1 ? " prompt" : " prompts")
          : filtered.length + " de " + prompts.length}
        <span>Enter copia · ↑↓ navega</span>
      </div>

      <div className="prompt-list" ref={listRef} role="listbox" aria-label="Prompts">
        {visible.map((prompt, index) => {
          const isCopied = copied === prompt.path;
          const hasVariables = promptVariables(prompt.content).length > 0;
          return (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              data-index={index}
              className={"prompt-row" + (index === active ? " is-active" : "")}
              key={prompt.path}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(prompt)}
              title={hasVariables ? "Preencher variáveis e copiar" : "Copiar prompt"}
            >
              <span className="prompt-row__content">
                <span className="prompt-row__title">
                  {prompt.favorite ? <Star size={12} className="favorite-star" aria-label="Favorito" /> : null}
                  {prompt.title}
                </span>
                <span className="prompt-row__meta">
                  {prompt.category || prompt.tags.slice(0, 2).join(" · ") || "Prompt"}
                  {hasVariables ? <em>variáveis</em> : null}
                </span>
                <span className="prompt-row__preview">{promptPreview(prompt.content)}</span>
              </span>
              <span className={"copy-icon" + (isCopied ? " is-copied" : "")} aria-hidden="true">
                {isCopied ? <Check size={15} /> : <Clipboard size={15} />}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="no-results">
            {prompts.length === 0 ? "Nenhum arquivo .md encontrado nesta pasta." : "Nenhum prompt encontrado."}
          </div>
        ) : null}
        {filtered.length > limit ? (
          <button type="button" className="button button--ghost button--block" onClick={() => setLimit((value) => value + PAGE)}>
            Mostrar mais ({filtered.length - limit} restantes)
          </button>
        ) : null}
      </div>

      <div className="sr-only" aria-live="polite">
        {copiedPrompt ? "Copiado: " + copiedPrompt.title : ""}
      </div>

      {pending ? (
        <PromptVariablesDialog
          title={pending.title}
          variables={promptVariables(pending.content)}
          onCancel={() => {
            setPending(null);
            searchRef.current?.focus();
          }}
          onSubmit={(values) => {
            const prompt = pending;
            setPending(null);
            void copyText(prompt, fillPrompt(prompt.content, values));
            searchRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
