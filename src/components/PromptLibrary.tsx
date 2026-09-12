import { Check, Clipboard, FolderOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PromptItem } from "../types";

export function PromptLibrary({
  prompts,
  obsidianPath,
  onChooseFolder
}: {
  prompts: PromptItem[];
  obsidianPath: string | null;
  onChooseFolder: () => void;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const list = normalized
      ? prompts.filter((prompt) =>
          [prompt.title, prompt.category, prompt.tags.join(" "), prompt.content]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(normalized)
        )
      : prompts;

    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }, [prompts, query]);

  async function copy(prompt: PromptItem) {
    await navigator.clipboard.writeText(prompt.content);
    setCopied(prompt.path);
    window.setTimeout(() => setCopied(null), 1200);
  }

  return (
    <section className="prompt-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PROMPTS</span>
          <h2>Obsidian</h2>
        </div>
        <button className="icon-button" onClick={onChooseFolder} title="Selecionar pasta do Obsidian">
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="search-box">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pesquisar prompts..."
        />
      </div>

      {!obsidianPath ? (
        <button className="empty-state" onClick={onChooseFolder}>
          <FolderOpen size={20} />
          <span>Vincular pasta de prompts</span>
          <small>Selecione seu Vault ou uma subpasta.</small>
        </button>
      ) : (
        <div className="prompt-list">
          {filtered.slice(0, 30).map((prompt) => (
            <button className="prompt-row" key={prompt.path} onClick={() => copy(prompt)}>
              <div className="prompt-row__content">
                <div className="prompt-title">
                  {prompt.favorite ? <span className="favorite-star">★</span> : null}
                  {prompt.title}
                </div>
                <div className="prompt-tags">
                  {prompt.category || prompt.tags.slice(0, 2).join(" · ") || "Prompt"}
                </div>
              </div>
              <div className="copy-icon">
                {copied === prompt.path ? <Check size={15} /> : <Clipboard size={15} />}
              </div>
            </button>
          ))}
          {filtered.length === 0 ? <div className="no-results">Nenhum prompt encontrado.</div> : null}
        </div>
      )}
    </section>
  );
}
