import type { GeocodeKind } from "@/domain/types";
import { IntersectionIcon, PinIcon, PlaceIcon, StreetIcon } from "@/ui/icons";

const ICONS = {
  intersection: IntersectionIcon,
  address: PinIcon,
  street: StreetIcon,
  place: PlaceIcon,
} satisfies Record<GeocodeKind, unknown>;

export const KIND_LABELS: Record<GeocodeKind, string> = {
  intersection: "Esquina",
  address: "Dirección",
  street: "Calle",
  place: "Lugar",
};

export function KindIcon({ kind, size = 18 }: { kind: GeocodeKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} />;
}
