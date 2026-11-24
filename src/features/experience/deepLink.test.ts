import { describe, expect, it } from "vitest";
import { buildDeepLinkSearch, parseDeepLink } from "./deepLink";

describe("deep link", () => {
  it("round-trips a destination", () => {
    const search = buildDeepLinkSearch({ label: "Av. Acoyte y Av. Rivadavia", lat: -34.6183, lng: -58.43646 });
    expect(search).toBe("?lat=-34.618300&lng=-58.436460&q=Av.+Acoyte+y+Av.+Rivadavia");
    expect(parseDeepLink(new URLSearchParams(search))).toEqual({ label: "Av. Acoyte y Av. Rivadavia", lat: -34.6183, lng: -58.43646 });
  });

  it("needs both coordinates, finite and in range", () => {
    expect(parseDeepLink(new URLSearchParams(""))).toBeNull();
    expect(parseDeepLink(new URLSearchParams("lat=-34.6"))).toBeNull();
    expect(parseDeepLink(new URLSearchParams("lat=abc&lng=-58"))).toBeNull();
    expect(parseDeepLink(new URLSearchParams("lat=95&lng=-58"))).toBeNull();
    expect(parseDeepLink(new URLSearchParams("lat=&lng=-58"))).toBeNull();
  });

  it("falls back to a generic label", () => {
    expect(parseDeepLink(new URLSearchParams("lat=-34.6&lng=-58.4"))?.label).toBe("Ubicación compartida");
  });
});
