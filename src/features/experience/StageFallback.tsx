"use client";

import { useEffect } from "react";
import { Button } from "@/ui/Button";
import { GlassPanel } from "@/ui/GlassPanel";
import { AlertIcon, ReplayIcon } from "@/ui/icons";

interface StageFallbackProps {
  /** A new play while the fallback is up "ends" at once too. */
  playId: number;
  onIntroEnd: () => void;
  onRetry: () => void;
}

/**
 * Stands in for the 3D stage when it cannot load or crashes (no WebGL2, a chunk
 * that did not download). It keeps the stage's contract of reporting the end of
 * each play, at once since nothing plays, so the explore controls and the search
 * appear now instead of after the intro safety timer.
 */
export function StageFallback({ playId, onIntroEnd, onRetry }: StageFallbackProps) {
  useEffect(() => {
    onIntroEnd();
  }, [playId, onIntroEnd]);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <GlassPanel strong role="alert" className="animate-rise flex w-full max-w-md flex-col gap-4 p-5 shadow-float">
        <div className="flex gap-3">
          <AlertIcon size={20} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-medium text-text">No pudimos mostrar la maqueta 3D en este dispositivo.</p>
            <p className="mt-0.5 text-sm text-text-muted">Revisá la conexión o probá con otro navegador.</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" icon={<ReplayIcon size={18} />} onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}
