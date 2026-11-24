import type { ReactNode, SVGProps } from "react";

/**
 * Inline stroke icons on a 24px grid, drawn for this product.
 * They inherit `currentColor` and are decorative by default; the control that
 * holds one carries the accessible name.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 20, strokeWidth = 1.75, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Svg>
  );
}

/** Two streets crossing: the product's unit of search. */
export function IntersectionIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v18M16 3v18M3 8h18M3 16h18" opacity="0.45" />
      <path d="M8 8h8v8H8z" />
    </Svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </Svg>
  );
}

export function StreetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 21 10 3M17 21 14 3" />
      <path d="M12 6v2M12 11v2M12 16v2" />
    </Svg>
  );
}

export function PlaceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h16M6 20V9l6-4 6 4v11" />
      <path d="M10 20v-5h4v5" />
    </Svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 21V5.5L13 3v18M13 9l6 2v10M3 21h18" />
      <path d="M8.5 8h1M8.5 12h1M8.5 16h1M16 14h.5M16 17.5h.5" />
    </Svg>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4.5h4.5" />
    </Svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0Z" />
      <circle cx="8" cy="8" r="1.25" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4 2.8 19.5h18.4Z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  );
}
