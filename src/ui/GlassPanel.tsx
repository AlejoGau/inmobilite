import type { HTMLAttributes } from "react";
import { cn } from "./cn";

interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "aside" | "header";
  /** Denser glass for content that sits over busy parts of the scene. */
  strong?: boolean;
}

/** Translucent panel over the map or the 3D stage. See `.glass` in globals.css. */
export function GlassPanel({ as: Tag = "div", strong = false, className, ...props }: GlassPanelProps) {
  return <Tag className={cn(strong ? "glass-strong" : "glass", "rounded-panel", className)} {...props} />;
}
