"use client";

type AmountInputProps = {
  value: string;
  onChange: (value: string) => void;
  unit: string;
  placeholder?: string;
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
};

/** A decimal amount with its unit and an optional Max button. Validation belongs to the caller. */
export const AmountInput = ({ value, onChange, unit, placeholder, max, disabled, invalid, id }: AmountInputProps) => (
  <div className={`join w-full ${invalid ? "outline outline-1 outline-error rounded-field" : ""}`}>
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="input input-bordered join-item w-full"
      placeholder={placeholder ?? "0.0"}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    />
    {max !== undefined ? (
      <button type="button" className="btn join-item btn-ghost border border-base-300" onClick={() => onChange(max)}>
        Max
      </button>
    ) : null}
    <span className="join-item flex items-center border border-base-300 bg-base-200 px-3 text-sm font-medium">
      {unit}
    </span>
  </div>
);
