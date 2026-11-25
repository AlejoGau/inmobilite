/**
 * Turns the SHOUTED, inverted names that Argentine geocoders return
 * ("JUSTO, JUAN B. AV.") into what a person would write ("Av. Juan B. Justo").
 */

/** Lowercase inside a name unless they open it ("Plaza de Mayo", "Del Barco Centenera"). */
const LOWERCASE_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "al", "a"]);

/**
 * Street-type words that USIG writes as a suffix and people write as a prefix. A Map, not an object
 * literal, so a street word like "constructor" never resolves to Object.prototype.
 */
const TYPE_PREFIXES = new Map<string, string>([
  ["av.", "Av."],
  ["av", "Av."],
  ["avenida", "Av."],
  ["pje.", "Pje."],
  ["pasaje", "Pje."],
  ["bv.", "Bv."],
  ["boulevard", "Bv."],
  ["diag.", "Diag."],
  ["diagonal", "Diag."],
]);

/** USIG appends the popular name of the two diagonals to their title: "PRESIDENTE DIAGONAL SUR". */
const DIAGONAL_ALIAS = /\s*\bdiagonal\s+(norte|sur)$/i;

/** Articles that USIG moves after the name ("BARCO CENTENERA DEL") and people write first. */
const TRAILING_ARTICLE = /^(.+?)\s+(de la|de las|de los|del|de|la|las|los|el)$/i;

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
 * USIG's inverted order put back the way people write it.
 */
export function formatStreetName(raw: string): string {
  let words = raw.trim().split(/\s+/);
  let prefix: string | undefined;

  const last = TYPE_PREFIXES.get(words[words.length - 1]?.toLowerCase() ?? "");
  const first = TYPE_PREFIXES.get(words[0]?.toLowerCase() ?? "");
  if (words.length > 1 && last) {
    prefix = last;
    words = words.slice(0, -1);
  } else if (words.length > 1 && first) {
    prefix = first;
    words = words.slice(1);
  }

  const formatted = titleCase(naturalOrder(words.join(" ")));
  return prefix ? `${prefix} ${formatted}` : formatted;
}

/**
 * USIG writes "SURNAME, GIVEN, TITLE" ("ROCA, JULIO A., PRESIDENTE DIAGONAL SUR") and moves a
 * leading article to the end ("BARCO CENTENERA DEL"). People write "Presidente Julio A. Roca" and
 * "Del Barco Centenera".
 */
function naturalOrder(name: string): string {
  const [surname = "", given, ...qualifiers] = name
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (given === undefined) return surname.replace(TRAILING_ARTICLE, "$2 $1");
  // The diagonals' popular name is dropped: the label shows the street's own name, like every other street.
  const title = qualifiers.join(" ").replace(DIAGONAL_ALIAS, "");
  return [title, given, surname].filter(Boolean).join(" ");
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
