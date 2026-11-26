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

const monthYear = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

/** ISO date "2006-07-07" -> "julio de 2006"; null for anything else. Read in UTC so the month never shifts a day. */
export function formatMonthYear(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : monthYear.format(date);
}
