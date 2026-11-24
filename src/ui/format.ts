const integer = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** Meters with at most one decimal: "12,5 m". */
export function formatMeters(value: number): string {
  return `${oneDecimal.format(value)} m`;
}

export function formatSquareMeters(value: number): string {
  return `${integer.format(value)} m²`;
}

/** "1 edificio" / "20 edificios". */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
