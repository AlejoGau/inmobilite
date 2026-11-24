import type { ReactNode } from "react";
import { cn } from "./cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: ReactNode;
  className?: string;
}

/** A labelled on/off control (`role="switch"`), sized as a 44px row. */
export function Switch({ checked, onChange, label, icon, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "group inline-flex min-h-11 items-center gap-2.5 rounded-full pl-3.5 pr-2 text-sm font-medium text-text",
        "transition-colors duration-150 hover:bg-white/[0.06]",
        className,
      )}
    >
      {icon}
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative ml-1 inline-flex h-6 w-10 items-center rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-white/[0.14]",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 size-5 rounded-full bg-white transition-transform duration-200 ease-out-quint",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}
