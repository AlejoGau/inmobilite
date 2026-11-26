import { z } from "zod";
import { normalizeSmp, type FacadePhotoSource } from "@/domain/area/facade";
import type { LngLat } from "@/domain/types";
import { fetchJson, UpstreamError } from "../http/fetchJson";

/**
 * GCBA/USIG cadastral services: the reverse geocoder (point -> parcel) and
 * the street-level facade photos per parcel (2005-2006, watermarked). Both
 * free, no key; both answer JSON wrapped in parentheses, JSONP style.
 */

export const REVERSE_GEOCODER_URL = "https://ws.usig.buenosaires.gob.ar/geocoder/2.2/reversegeocoding";
export const PHOTO_DATA_URL = "https://fotos.usig.buenosaires.gob.ar/getDatosFotos";
export const PHOTO_URL = "https://fotos.usig.buenosaires.gob.ar/getFoto";
/** The service never upscales: asking 1024 returns the native ~550 px, the best it has. */
export const PHOTO_WIDTH = 1024;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * A generous box around the city. Only a cheap guard so a search in Córdoba
 * does not wait on a service that cannot answer; the geocoder itself is the
 * real authority on what is inside CABA.
 */
const CABA_BOUNDS = { minLat: -34.71, maxLat: -34.52, minLng: -58.54, maxLng: -58.33 } as const;

export function isInCaba({ lat, lng }: LngLat): boolean {
  return lat >= CABA_BOUNDS.minLat && lat <= CABA_BOUNDS.maxLat && lng >= CABA_BOUNDS.minLng && lng <= CABA_BOUNDS.maxLng;
}

/** `({...})` -> the JSON inside. Plain JSON passes through, so a service dropping the wrapper does not break us. */
export function parseParenthesizedJson(text: string): unknown {
  const trimmed = text.trim();
  const inner = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
  return JSON.parse(inner);
}

const reverseSchema = z.object({ parcela: z.string().nullish() }).passthrough();

/** The parcel's SMP from a reverse-geocoder answer, normalised; null when the point is not on a parcel. */
export function parseReverseGeocoding(body: z.infer<typeof reverseSchema>): string | null {
  return body.parcela ? normalizeSmp(body.parcela) : null;
}

export async function reverseGeocodeSmp(origin: LngLat, signal?: AbortSignal): Promise<string | null> {
  const url = `${REVERSE_GEOCODER_URL}?${new URLSearchParams({ x: String(origin.lng), y: String(origin.lat) })}`;
  const body = await fetchJson(url, reverseSchema, { timeoutMs: REQUEST_TIMEOUT_MS, signal, parseBody: parseParenthesizedJson });
  return parseReverseGeocoding(body);
}

const photoEntrySchema = z.object({ fecha: z.string().nullish() }).passthrough();
const photoListSchema = z.array(photoEntrySchema);

/** "07/07/2006" (dd/mm/yyyy) -> "2006-07-07"; anything else -> undefined. */
export function parsePhotoDate(raw: string | null | undefined): string | undefined {
  const match = raw ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim()) : null;
  if (!match) return undefined;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function photoUrl(smp: string, index: number): string {
  return `${PHOTO_URL}?${new URLSearchParams({ smp, i: String(index), w: String(PHOTO_WIDTH) })}`;
}

/**
 * The newest photo of a parcel. Its index is its position in the service's
 * list (that is what getFoto's `i` means). Undated photos only win when none
 * is dated; ties keep the first, so the choice is stable.
 */
export function pickNewestPhoto(smp: string, entries: z.infer<typeof photoListSchema>): FacadePhotoSource | null {
  let best: { index: number; date?: string } | null = null;
  entries.forEach((entry, index) => {
    const date = parsePhotoDate(entry.fecha);
    if (!best || (date !== undefined && (best.date === undefined || date > best.date))) best = { index, date };
  });
  if (!best) return null;
  const { index, date } = best as { index: number; date?: string };
  return date ? { url: photoUrl(smp, index), date } : { url: photoUrl(smp, index) };
}

/** The newest facade photo of a parcel, or null when it has none. */
export async function fetchFacadePhoto(rawSmp: string, signal?: AbortSignal): Promise<FacadePhotoSource | null> {
  const smp = normalizeSmp(rawSmp);
  if (!smp) throw new UpstreamError(`Not an SMP: ${rawSmp}`);
  const url = `${PHOTO_DATA_URL}?${new URLSearchParams({ smp })}`;
  const entries = await fetchJson(url, photoListSchema, { timeoutMs: REQUEST_TIMEOUT_MS, signal, parseBody: parseParenthesizedJson });
  return pickNewestPhoto(smp, entries);
}
