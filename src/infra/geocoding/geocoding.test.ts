import { describe, expect, it, vi } from "vitest";
import type { GeocodeResult } from "@/domain/types";
import { formatStreetName, joinIntersection, titleCase } from "./format";
import { parseUsigResponse } from "./usig";
import { parseGeorefResponse } from "./georef";
import { parsePhotonResponse } from "./photon";
import { dedupeByDistance, geocodeWithProviders } from "./index";
import type { GeocodingProvider } from "./provider";

// Shapes recorded from the live APIs (curl, 2026-11-24), trimmed.
const USIG_ACOYTE = {
  direccionesNormalizadas: [
    {
      altura: null, cod_calle: 1007, cod_calle_cruce: 19046, cod_partido: "caba",
      coordenadas: { srid: 4326, x: "-58.436460", y: "-34.618299" },
      direccion: "ACOYTE AV. y RIVADAVIA AV., CABA", nombre_calle: "ACOYTE AV.", nombre_calle_cruce: "RIVADAVIA AV.",
      nombre_localidad: "CABA", nombre_partido: "CABA", tipo: "calle_y_calle",
    },
  ],
};
const USIG_MIXED = {
  direccionesNormalizadas: [
    {
      altura: 2000, cod_calle: 3005, cod_calle_cruce: null, cod_partido: "caba",
      coordenadas: { srid: 4326, x: "-58.455896", y: "-34.563151" },
      nombre_calle: "CABILDO AV.", nombre_calle_cruce: "", nombre_localidad: "CABA", nombre_partido: "CABA", tipo: "calle_altura",
    },
    {
      altura: null, cod_calle: 75674, cod_calle_cruce: 197413, cod_partido: "moron",
      coordenadas: { srid: 4326, x: -58.6424211, y: -34.6959371 },
      nombre_calle: "Corrientes", nombre_calle_cruce: "Avenida Callao", nombre_localidad: "Castelar", nombre_partido: "Morón",
      tipo: "calle_y_calle",
    },
    // Bare street: no coordinates, must be skipped.
    { altura: null, cod_calle: 54104, cod_partido: "avellaneda", nombre_calle: "Madres de Plaza de Mayo", tipo: "calle" },
  ],
};
const GEOREF_SAMPLE = {
  direcciones: [
    {
      altura: { unidad: null, valor: 2000 }, calle: { categoria: "CALLE", id: "0625201001050", nombre: "CABILDO" },
      calle_cruce_1: { categoria: null, id: null, nombre: null }, departamento: { id: "06252", nombre: "Escobar" },
      localidad_censal: { id: "06252010", nombre: "Escobar" }, provincia: { id: "06", nombre: "Buenos Aires" },
      ubicacion: { lat: -34.4218, lon: -58.7403 },
    },
    {
      altura: { unidad: null, valor: null }, calle: { categoria: "CALLE", id: "2215401000155", nombre: "MADRES DE PLAZA DE MAYO" },
      calle_cruce_1: { nombre: null }, provincia: { nombre: "Chaco" }, ubicacion: { lat: -26.8, lon: -59.55 },
    },
  ],
};
const PHOTON_SAMPLE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        osm_type: "R", osm_id: 17076039, osm_key: "leisure", type: "other", name: "Plaza de Mayo",
        district: "Monserrat", city: "Buenos Aires", state: "Ciudad Autónoma de Buenos Aires", country: "Argentina",
      },
      geometry: { type: "Point", coordinates: [-58.3721787, -34.6084453] },
    },
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [1, 2] } },
  ],
};

describe("format", () => {
  it("writes street names the way people do", () => {
    expect(formatStreetName("ACOYTE AV.")).toBe("Av. Acoyte");
    expect(formatStreetName("JUSTO, JUAN B. AV.")).toBe("Av. Juan B. Justo");
    expect(formatStreetName("Avenida Callao")).toBe("Av. Callao");
    expect(formatStreetName("MADRES DE PLAZA DE MAYO")).toBe("Madres de Plaza de Mayo");
    expect(titleCase("PIO XII")).toBe("Pio XII");
    expect(titleCase("O'HIGGINS")).toBe("O'Higgins");
  });

  // Raw names recorded from USIG (2026-11-24): "SURNAME, GIVEN, TITLE", plus the diagonals' popular name.
  it("puts a USIG title before the given name and drops the diagonal's popular name", () => {
    expect(formatStreetName("ROCA, JULIO A., PRESIDENTE DIAGONAL SUR AV.")).toBe("Av. Presidente Julio A. Roca");
    expect(formatStreetName("SAENZ PEÑA, ROQUE, PRES. DIAGONAL NORTE AV.")).toBe("Av. Pres. Roque Saenz Peña");
    expect(joinIntersection(formatStreetName("ROCA, JULIO A., PRESIDENTE DIAGONAL SUR AV."), formatStreetName("BOLIVAR"))).toBe(
      "Av. Presidente Julio A. Roca y Bolivar",
    );
  });

  it("moves an article that USIG writes last back to the front", () => {
    expect(formatStreetName("BARCO CENTENERA DEL")).toBe("Del Barco Centenera");
    expect(formatStreetName("BARCO CENTENERA DEL AV.")).toBe("Av. Del Barco Centenera");
    expect(formatStreetName("ALVEAR, MARCELO T. DE AV.")).toBe("Av. Marcelo T. de Alvear");
  });

  it("does not mistake Object.prototype keys for street types", () => {
    expect(formatStreetName("CONSTRUCTOR BENITEZ")).toBe("Constructor Benitez");
  });

  it("uses 'e' before an i sound", () => {
    expect(joinIntersection("Corrientes", "Independencia")).toBe("Corrientes e Independencia");
    expect(joinIntersection("Av. Acoyte", "Av. Rivadavia")).toBe("Av. Acoyte y Av. Rivadavia");
    expect(joinIntersection("Sarmiento", "Hielo")).toBe("Sarmiento y Hielo");
  });
});

describe("providers", () => {
  it("parses USIG corners with title-cased labels and CABA as secondary", () => {
    expect(parseUsigResponse(USIG_ACOYTE)).toEqual([
      {
        id: "usig:caba:1007:19046",
        label: "Av. Acoyte y Av. Rivadavia",
        secondary: "CABA",
        lat: -34.618299,
        lng: -58.43646,
        kind: "intersection",
        provider: "usig",
      },
    ]);
  });

  it("parses USIG addresses and conurbano results, skipping entries without coordinates", () => {
    const results = parseUsigResponse(USIG_MIXED);
    expect(results.map((r) => [r.label, r.secondary, r.kind])).toEqual([
      ["Av. Cabildo 2000", "CABA", "address"],
      ["Corrientes y Av. Callao", "Castelar, Morón", "intersection"],
    ]);
  });

  it("handles a USIG error message as no results", () => {
    expect(parseUsigResponse({ direccionesNormalizadas: [], errorMessage: "Calle inexistente: zzz" })).toEqual([]);
  });

  it("keeps only Georef results pinned by a number or a corner", () => {
    const results = parseGeorefResponse(GEOREF_SAMPLE);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ label: "Cabildo 2000", secondary: "Escobar, Buenos Aires", kind: "address" });
  });

  it("parses Photon places with barrio and CABA", () => {
    const results = parsePhotonResponse(PHOTON_SAMPLE);
    expect(results).toEqual([
      {
        id: "photon:R17076039",
        label: "Plaza de Mayo",
        secondary: "Monserrat, CABA",
        lat: -34.6084453,
        lng: -58.3721787,
        kind: "place",
        provider: "photon",
      },
    ]);
  });
});

describe("geocodeWithProviders", () => {
  const result = (id: string, lat: number, lng: number): GeocodeResult => ({
    id, label: id, lat, lng, kind: "place", provider: "photon",
  });
  const provider = (name: GeocodeResult["provider"], impl: () => Promise<GeocodeResult[]>): GeocodingProvider => ({
    name,
    search: vi.fn(impl),
  });

  it("stops at the first provider with results", async () => {
    const usig = provider("usig", async () => [result("a", -34.6, -58.4)]);
    const photon = provider("photon", async () => [result("b", 0, 0)]);
    const outcome = await geocodeWithProviders("acoyte y riva", [usig, photon]);
    expect(outcome).toEqual({ results: [result("a", -34.6, -58.4)], degraded: false, allFailed: false });
    expect(photon.search).not.toHaveBeenCalled();
  });

  it("falls through empty and failing providers, flagging the degradation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const usig = provider("usig", async () => []);
    const georef = provider("georef", async () => {
      throw new Error("rate limited");
    });
    const photon = provider("photon", async () => [result("c", 1, 1)]);
    const outcome = await geocodeWithProviders("plaza de mayo", [usig, georef, photon]);
    expect(outcome.results.map((r) => r.id)).toEqual(["c"]);
    expect(outcome.degraded).toBe(true);
    expect(outcome.allFailed).toBe(false);
  });

  it("reports when every provider failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = provider("usig", async () => {
      throw new Error("down");
    });
    expect(await geocodeWithProviders("x y z", [down, down])).toEqual({ results: [], degraded: true, allFailed: true });
  });

  it("dedupes results within 30 m, keeping the first", () => {
    const deduped = dedupeByDistance([
      result("a", -34.6183, -58.43646),
      result("b", -34.61831, -58.43647), // ~1.5 m away
      result("c", -34.6203, -58.43646), // ~220 m away
    ]);
    expect(deduped.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("dedupes the same label within 250 m (a plaza and its bus stops)", () => {
    const plaza = (id: string, lat: number): GeocodeResult => ({ ...result(id, lat, -58.3722), label: "Plaza de Mayo" });
    const deduped = dedupeByDistance([plaza("park", -34.6084), plaza("stop", -34.6078), plaza("far", -34.62)]);
    expect(deduped.map((r) => r.id)).toEqual(["park", "far"]);
  });
});
