import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="setting-row"
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="setting-row__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className={"switch" + (checked ? " is-on" : "")} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "is-selected" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  label,
  description,
  value,
  options,
  onChange,
  disabled
}: {
  label: string;
  description?: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={"select-setting-row" + (disabled ? " is-disabled" : "")}>
      <div className="select-setting-row__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      <div className="select-wrapper">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
          className="select-input"
          aria-label={label}
        >
          {options.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
      </div>
    </div>
  );
}
