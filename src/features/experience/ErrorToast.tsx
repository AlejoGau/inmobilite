import { Button } from "@/ui/Button";
import { GlassPanel } from "@/ui/GlassPanel";
import { AlertIcon, ArrowLeftIcon, ReplayIcon } from "@/ui/icons";

interface ErrorToastProps {
  place: string;
  message: string;
  onRetry: () => void;
  onBack: () => void;
}

export function ErrorToast({ place, message, onRetry, onBack }: ErrorToastProps) {
  return (
    <div className="absolute inset-x-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-30 flex justify-center">
      <GlassPanel
        strong
        role="alert"
        className="animate-rise flex w-full max-w-lg flex-col gap-4 p-4 shadow-float sm:flex-row sm:items-center sm:pl-5"
      >
        <div className="flex min-w-0 flex-1 gap-3">
          <AlertIcon size={20} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-medium text-text">No pudimos modelar {place}</p>
            <p className="mt-0.5 text-sm text-text-muted">{message}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 max-sm:justify-end">
          <Button variant="ghost" icon={<ArrowLeftIcon size={18} />} onClick={onBack}>
            Volver
          </Button>
          <Button variant="primary" icon={<ReplayIcon size={18} />} onClick={onRetry} autoFocus>
            Reintentar
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}
