# Inmobilite: dónde quedó y cómo seguir

> Última actualización: 24/11/2026. Para retomar en otra máquina, con o sin Claude.
> El plan de producto completo y las decisiones están en [PLAN.md](PLAN.md).

## Qué es el demo

Escribís una esquina de Buenos Aires ("acoyte y riva") y la app:

1. la geocodifica (USIG → Georef → Photon, todo gratis y sin key);
2. vuela con un globo de MapLibre hasta la esquina;
3. pasa con un fundido a una maqueta 3D (React Three Fiber) con las calles, los parques y los árboles reales de OpenStreetMap, más los **20 edificios más cercanos** con su huella real;
4. al final podés orbitar y tocar un edificio para ver sus datos.

## Cómo levantarlo en casa

```bash
git clone https://github.com/AlejoGau/inmobilite.git
cd inmobilite
npm install                 # usé Node 24 (v24.14.1)
git config user.email "156323292+AlejoGau@users.noreply.github.com"   # email noreply, solo en este repo
npm run dev                 # http://localhost:3000
```

- `npm run dev` corre antes `predev`, que copia el worker de MapLibre a `public/vendor/` (ver "Arreglos ya hechos").
- `npm test` (Vitest): 86 tests, todos pasan.
- `npm run typecheck`: 0 errores fuera de la escena. Al momento del push había **1 error en la escena en construcción** (`src/features/scene/materials/beaconMaterials.ts`: `BeaconUniforms` no tiene index signature para `ShaderMaterial.uniforms`). No frena `npm run dev`, porque Turbopack no chequea tipos.
- Probá con el chip **"Acoyte y Rivadavia"** o escribí `acoyte y riva`.

## Estado

| Parte | Estado | Dónde |
|---|---|---|
| Plan y decisiones | ✅ | `PLAN.md` |
| Contrato de tipos compartido | ✅ | `src/domain/types.ts`, `src/domain/osm/overpass.ts` |
| Datos: geocoding, Overpass, modelo de la zona (20 edificios, calles, parques, árboles, etiquetas) | ✅ 62 tests | `src/domain/**`, `src/infra/**`, `src/app/api/**` |
| App: landing, buscador accesible, vuelo con globo, fundido, paneles, estados | ✅ 17 tests | `src/app/*`, `src/features/{experience,search,flight}`, `src/ui` |
| **Escena 3D final (lo más importante)** | 🟡 **a medias** | `src/features/scene/**` |
| Vista previa 3D temporal (para poder probar ya) | ✅ temporal | `src/dev/scene-preview/` + mapeo en `tsconfig.json` |

### La escena 3D a medias

Un agente la estaba construyendo cuando se hizo el push. Al momento del push existen:

- `director/` (timeline central con GSAP + test): `director.ts`, `cameraPose.ts`, `stagger.ts`.
- `geometry/` (constructores puros): calles en cinta con uniones, marcas viales, edificios, suelo, árboles.
- `config/palette.ts`, `testing/sampleArea.ts`.
- `materials/`, recién empezado: `groundFx.ts`, `beaconMaterials.ts` (con el error de tipos de arriba).

**Falta:** terminar los materiales (shader de ventanas de los edificios), los componentes R3F (edificios, calles, árboles, baliza, etiquetas), el `SceneDriver` y su contexto, la iluminación con sombras, el postprocesado, la interacción (hover, selección, CameraControls), `CityStage` y **`src/features/scene/index.ts`**, y la regla de ESLint.

La especificación completa está en **[docs/briefs/scene-3d.md](docs/briefs/scene-3d.md)**. Si el agente siguió trabajando en la máquina de la oficina después del push, ese avance quedó **solo ahí**. Antes de rehacer nada en casa, fijate si en GitHub hay un commit más nuevo.

## Qué hacer, en orden

1. **Terminar la escena 3D** según `docs/briefs/scene-3d.md`. Leé primero lo que ya existe en `src/features/scene/` y seguí desde ahí, no empieces de cero.
2. **Sacar la vista previa temporal** cuando exista `src/features/scene/index.ts`: borrá la línea `"@/features/scene": [...]` de `tsconfig.json` y la carpeta `src/dev/`.
3. **Globo demasiado oscuro.** El estilo "dark" de OpenFreeMap pinta la tierra `rgb(12,12,12)` y el agua `rgb(27,27,29)`, así que a zoom de globo parece un disco negro. Ya agregué `src/features/flight/globePalette.ts`, que recolorea con la paleta pizarra, pero en la última captura seguía muy oscuro. Revisar:
   - si `applyGlobePalette` corre (`style.load`);
   - si alguna capa del hero (`Hero.tsx` / `globals.css`) oscurece el mapa;
   - si conviene subir el contraste tierra/agua.
4. **Overpass inestable: es el riesgo nº 1 del demo.** El 24/11 los tres mirrors públicos fallaban (502/504/timeout). El fallback offline (`src/infra/osm/offlineFallback.ts`) solo cubre Acoyte y Rivadavia, y tarda hasta unos 40-60 s en activarse porque no hay un límite de tiempo total. Hay dos caminos; **es una decisión de diseño, así que se pregunta antes de elegir**:
   - **Corto:** consultar los mirrors en paralelo (`Promise.any`) con un límite total de 8-10 s, más el fixture.
   - **Robusto:** usar como fuente principal o de respaldo los **tiles vectoriales de OpenFreeMap**, que son los mismos datos de OSM servidos por un CDN rápido (capas `building` con `render_height`, `transportation`, `transportation_name`, `park`). Hace falta decodificar MVT (`@mapbox/vector-tile` + `pbf`).
5. **Verificar todo en el navegador**: vuelo de unos 5 s, fundido de 700 ms, intro, que `onIntroEnd` muestre el panel, selección de edificio, "Nueva búsqueda", deep link `/?lat=-34.6183&lng=-58.43646&q=...`, mobile a 390 px y `prefers-reduced-motion`.
6. **`npm run build`** sin errores. Next 16 con `cacheComponents` chequea `Suspense` y `useSearchParams`.
7. Después del demo, volver al plan: fotos (Fases 3-4), reel con Remotion (Fase 6, **licencia pendiente**: gratis hasta 3 personas, después USD 0,01 por render con un mínimo de USD 100 por mes) y video demo con HyperFrames (Fase 7).

## Arreglos ya hechos en la integración (para no repetirlos)

- **El worker de MapLibre daba 404 con Turbopack** y el mapa no cargaba ningún tile. `scripts/copy-maplibre-worker.mjs` lo copia a `public/vendor/` con la versión en el nombre (corre en `predev` y `prebuild`), y `src/features/flight/maplibreWorker.ts` llama a `setWorkerUrl` antes de crear el mapa.
- **Mientras haya un error de compilación, Next en desarrollo responde 500 en todas las rutas** (las de la API también). Si `/api/*` falla, mirá primero si la página compila.
- `.gitignore` ignora `/.playwright-mcp/` (capturas de prueba) y `/public/vendor/` (generado).

## Notas del código

- **Contrato:** `src/domain/types.ts`. Las coordenadas son metros locales `[este, norte]` y en three.js se mapean a `(x, altura, -y)`.
- **Regla de la escena (decidida):** un solo director (timeline GSAP en pausa) es la única fuente de tiempo. Los componentes visuales son funciones del frame del director: **nada de `useFrame` salvo en `SceneDriver.tsx`**, y nada de `Date.now` ni `Math.random` (se usa el PRNG con semilla de `src/domain/seed.ts`). Así el reel exportado sale idéntico a la vista en vivo.
- **Alturas:** casi ningún edificio de CABA tiene `building:levels` en OSM, así que se estiman de forma determinista (`src/domain/area/buildingHeight.ts`) y se marcan como `heightSource: "estimated"`.
- **Next 16 tiene cambios que rompen cosas:** antes de tocar código de Next, leer `node_modules/next/dist/docs/` (lo dice `AGENTS.md`).
- **Pendientes menores que reportaron los agentes:**
  - no hay rate limit por IP en la API;
  - los cachés son en memoria;
  - no hay botón "Saltar intro";
  - después de "Nueva búsqueda" el foco no vuelve al buscador (con `/` se enfoca).

## Herramientas de Claude que se usaron (instalar en casa si querés las mismas)

En la máquina de la oficina están instaladas a nivel usuario. En casa:

```bash
# Skills de Remotion (oficiales)
git clone --depth 1 https://github.com/remotion-dev/skills /tmp/remotion-skills
cp -r /tmp/remotion-skills/skills/* ~/.claude/skills/

# UI UX Pro Max
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill /tmp/uiux
cp -r /tmp/uiux/.claude/skills/ui-ux-pro-max ~/.claude/skills/

# MCP oficial de HyperFrames (HeyGen). Después: /mcp → hyperframes → iniciar sesión
claude mcp add --transport http hyperframes https://mcp.heygen.com/mcp/hyperframes/ --scope user
```

Las skills de HyperFrames (`hyperframes`, `hyperframes-animation`, etc.) están en `github.com/heygen-com/hyperframes`, carpeta `skills/`.
