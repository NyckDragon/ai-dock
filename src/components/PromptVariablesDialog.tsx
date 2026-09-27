import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PromptVariable } from "../lib/promptTemplate";

/** Asks for the `{{variáveis}}` of a prompt before it is copied. */
export function PromptVariablesDialog({
  title,
  variables,
  onSubmit,
  onCancel
}: {
  title: string;
  variables: PromptVariable[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((variable) => [variable.name, variable.fallback]))
  );
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    firstRef.current?.select();
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-variables-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="dialog__head">
          <div>
            <span className="eyebrow">Preencher variáveis</span>
            <h3 id="prompt-variables-title">{title}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Cancelar">
            <X size={15} />
          </button>
        </div>
        <div className="dialog__fields">
          {variables.map((variable, index) => (
            <label className="field" key={variable.name}>
              <span>{variable.name}</span>
              <input
                ref={index === 0 ? firstRef : undefined}
                className="input"
                value={values[variable.name] || ""}
                placeholder={variable.fallback || variable.name}
                onChange={(event) => setValues((current) => ({ ...current, [variable.name]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button button--primary">
            Copiar prompt
          </button>
        </div>
      </form>
    </div>
  );
}
