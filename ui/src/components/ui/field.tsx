import * as React from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
      ) : null}
      {children}
      {hint ? <span className="text-xs text-[var(--text-muted)]">{hint}</span> : null}
    </label>
  );
}

const controlClass =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlClass, className)} {...props} />
));
Input.displayName = "Input";

/** 存 `YYYY-MM-DD HH:mm`，控件内用 datetime-local 弹出日历 */
function toDatetimeLocal(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(" ", "T").slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace("T", " ").slice(0, 16);
}

function minDatetimeLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export const DateTimeInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
    value: string;
    onChange: (value: string) => void;
  }
>(({ className, value, onChange, disabled, ...props }, ref) => (
  <input
    ref={ref}
    type="datetime-local"
    step={60}
    min={minDatetimeLocal()}
    value={toDatetimeLocal(value)}
    disabled={disabled}
    onChange={(e) => onChange(fromDatetimeLocal(e.target.value))}
    className={cn(
      controlClass,
      "scheme-light [color-scheme:light] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 hover:[&::-webkit-calendar-picker-indicator]:opacity-100",
      className
    )}
    {...props}
  />
));
DateTimeInput.displayName = "DateTimeInput";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      controlClass,
      "h-auto min-h-[72px] resize-y py-2 leading-relaxed",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(controlClass, "pr-8", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export function CheckRow({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--text-secondary)]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-[var(--border)] accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

export function SectionCard({
  step,
  title,
  hint,
  children,
  className,
}: {
  step: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-soft",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          {hint ? <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p> : null}
        </div>
        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--text-muted)]">
          {step}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
    </section>
  );
}
