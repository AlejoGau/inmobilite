/**
 * Turns the SHOUTED, inverted names that Argentine geocoders return
 * ("JUSTO, JUAN B. AV.") into what a person would write ("Av. Juan B. Justo").
 */

/** Lowercase inside a name unless they open it ("Plaza de Mayo", "Del Barco Centenera"). */
const LOWERCASE_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "al", "a"]);

/** Street-type words that USIG writes as a suffix and people write as a prefix. */
const TYPE_PREFIXES: Record<string, string> = {
  "av.": "Av.",
  av: "Av.",
  avenida: "Av.",
  "pje.": "Pje.",
  pasaje: "Pje.",
  "bv.": "Bv.",
  boulevard: "Bv.",
  "diag.": "Diag.",
  diagonal: "Diag.",
};

const ROMAN_NUMERAL = /^(x{0,3})(ix|iv|v?i{0,3})$/i;

export const CABA_LABEL = "CABA";
const CABA_NAMES = new Set(["caba", "ciudad autónoma de buenos aires", "ciudad autonoma de buenos aires", "capital federal"]);

export function isCaba(name: string | null | undefined): boolean {
  return Boolean(name && CABA_NAMES.has(name.trim().toLowerCase()));
}

export function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word, index) => capitalizeWord(word, index === 0))
    .join(" ");
}

function capitalizeWord(word: string, isFirst: boolean): string {
  const lower = word.toLocaleLowerCase("es-AR");
  if (word.length >= 2 && ROMAN_NUMERAL.test(word)) return word.toUpperCase();
  if (!isFirst && LOWERCASE_WORDS.has(lower)) return lower;
  // Capitalise each part of hyphenated or apostrophe names ("O'Higgins", "Sáenz-Peña").
  return lower.replace(/(^|[-'’(])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase("es-AR"));
}

/**
 * Formats a street name: title case, street type moved to the front, and
 * "SURNAME, NAME" swapped to natural order.
 */
export function formatStreetName(raw: string): string {
  let words = raw.trim().split(/\s+/);
  let prefix: string | undefined;

  const last = words[words.length - 1]?.toLowerCase();
  const first = words[0]?.toLowerCase();
  if (words.length > 1 && last && TYPE_PREFIXES[last]) {
    prefix = TYPE_PREFIXES[last];
    words = words.slice(0, -1);
  } else if (words.length > 1 && first && TYPE_PREFIXES[first]) {
    prefix = TYPE_PREFIXES[first];
    words = words.slice(1);
  }

  let name = words.join(" ");
  const comma = name.indexOf(",");
  if (comma > 0) {
    const surname = name.slice(0, comma).trim();
    const given = name.slice(comma + 1).trim();
    name = given ? `${given} ${surname}` : surname;
  }

  const formatted = titleCase(name);
  return prefix ? `${prefix} ${formatted}` : formatted;
}

/** "Acoyte y Rivadavia", but "Corrientes e Independencia" (Spanish euphony rule). */
export function joinIntersection(a: string, b: string): string {
  const conjunction = /^h?i(?![aeiouáéíóú])/i.test(b) ? "e" : "y";
  return `${a} ${conjunction} ${b}`;
}

/** Joins non-empty, non-repeated parts: ["Castelar", "Morón"] → "Castelar, Morón". */
export function joinPlace(parts: (string | null | undefined)[]): string | undefined {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    kept.push(value);
  }
  return kept.length > 0 ? kept.join(", ") : undefined;
}
