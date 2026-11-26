import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFacadePhoto,
  isInCaba,
  parseParenthesizedJson,
  parsePhotoDate,
  parseReverseGeocoding,
  pickNewestPhoto,
  reverseGeocodeSmp,
} from "./fotos";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("USIG cadastral services", () => {
  it("unwraps the parenthesised JSON, and accepts plain JSON too", () => {
    expect(parseParenthesizedJson(' ({"parcela":"45-068-020C"})\n')).toEqual({ parcela: "45-068-020C" });
    expect(parseParenthesizedJson('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(() => parseParenthesizedJson("(nope)")).toThrow();
  });

  it("reads the parcel of a reverse geocoding and zero-pads its SMP", () => {
    expect(parseReverseGeocoding({ parcela: "45-068-020C", puerta: "RIVADAVIA AV. 5003" })).toBe("045-068-020C");
    expect(parseReverseGeocoding({ parcela: null })).toBeNull();
    expect(parseReverseGeocoding({})).toBeNull();
  });

  it("asks the reverse geocoder with x = lng and y = lat", async () => {
    const fetchMock = stubFetch('({"parcela":"45-068-020C","esquina":"ACOYTE AV."})');
    await expect(reverseGeocodeSmp({ lat: -34.61831, lng: -58.43646 })).resolves.toBe("045-068-020C");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("x=-58.43646&y=-34.61831");
  });

  it("picks the newest photo, keeping the service's index", () => {
    const entries = [{ fecha: "07/07/2005" }, { fecha: "3/1/2006" }, { fecha: null }, { fecha: "02/01/2006" }];
    expect(pickNewestPhoto("045-079-013B", entries)).toEqual({
      url: "https://fotos.usig.buenosaires.gob.ar/getFoto?smp=045-079-013B&i=1&w=1024",
      date: "2006-01-03",
    });
    expect(pickNewestPhoto("045-079-013B", [{}])).toEqual({ url: "https://fotos.usig.buenosaires.gob.ar/getFoto?smp=045-079-013B&i=0&w=1024" });
    expect(pickNewestPhoto("045-079-013B", [])).toBeNull();
    expect(parsePhotoDate("2006-07-07")).toBeUndefined();
  });

  it("fetches a parcel's photo data with the padded SMP", async () => {
    const fetchMock = stubFetch('([{"alto":"411","ancho":"550","fecha":"07/07/2006","oficial":"True"}])');
    const photo = await fetchFacadePhoto("45-79-13b");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("smp=045-079-013B");
    expect(photo).toEqual({ url: "https://fotos.usig.buenosaires.gob.ar/getFoto?smp=045-079-013B&i=0&w=1024", date: "2006-07-07" });
  });

  it("only treats points in the city as CABA", () => {
    expect(isInCaba({ lat: -34.61831, lng: -58.43646 })).toBe(true);
    expect(isInCaba({ lat: -31.42, lng: -64.18 })).toBe(false);
  });
});
