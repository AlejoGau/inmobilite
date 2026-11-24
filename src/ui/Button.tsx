import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "bg-white/[0.07] text-text hover:bg-white/[0.12]",
  ghost: "text-text-muted hover:bg-white/[0.06] hover:text-text",
};

/** Every control is at least 44px tall: the touch target floor. */
const BASE =
  "inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full px-4 text-sm font-medium " +
  "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] " +
  "disabled:pointer-events-none disabled:opacity-50";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", icon, className, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(BASE, VARIANTS[variant], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  /** Required: an icon-only control needs an accessible name. */
  label: string;
  icon: ReactNode;
  variant?: Variant;
}

export function IconButton({ label, icon, variant = "ghost", className, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANTS[variant], "w-11 shrink-0 px-0", className)}
      {...props}
    >
      {icon}
    </button>
  );
}
