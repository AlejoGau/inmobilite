# Inmobilite: dónde quedó y cómo seguir

> Última actualización: 24/11/2026 (noche). Para retomar en otra máquina, con o sin Claude.
> El plan de producto completo y las decisiones están en [PLAN.md](PLAN.md).

## Fase 1 "edificios reales": ✅ terminada (26/11/2026, sin commitear)

- **Volumen real de los 20 edificios** con el Tejido Urbano 3D del GCBA (`src/infra/gcba`, `src/domain/area/gcbaBuildings.ts`): altura medida, basamento + torre, retiros. En Acoyte y Rivadavia: 20 edificios, 194 volúmenes, torres de 44,8 y 42 m, 0 alturas estimadas.
- **Calles, parques y comercios desde tiles de OpenFreeMap** (`src/infra/openfreemap`, `src/domain/area/tileContext.ts`); Overpass solo como complemento opcional (3 s) para árboles y nombres.
- **Composición** en `src/domain/area/composeArea.ts` + `areaFromTiles.ts`; los edificios toman nombre del comercio que tienen adentro (Mostaza, La Rocka…).
- `/api/area`: header `X-Area-Source: tiles+gcba | tiles | fixture`; fallback offline con tiles guardados (`src/infra/offline/tileFixture.ts`, incluidos en el deploy vía `outputFileTracingIncludes`).
- Panel: "alturas medidas" y atribución obligatoria del GCBA (CC BY 2.5 AR).
- Escena: edificios de varias partes en una sola geometría por edificio, ventanas por piso real (2,8 m), sin tanques procedurales en datos GCBA. Toma final más abierta (45°, 150-210 m) para que las torres no tapen la esquina — **verificarla a ojo**.
- 267 tests, typecheck, lint y build en verde.

**Cosas a saber:**
- Un tile del GCBA "frío" tardó ~9 s; los límites quedaron en 10 s por tile / 12 s total (`src/infra/gcba/tejido.ts`).
- **Probar con Playwright contra `next start`, no contra `next dev`**: el log de consola que Playwright escribe en `.playwright-mcp/` dispara el watcher de Next y genera un loop de recompilación.
- El 26/11 la GPU de la PC de la oficina estaba lenta (1 FPS incluso con la versión anterior); no es una regresión del código, pero conviene revisar FPS en otra máquina.
- ECC (everything-claude-code) instalado localmente en `.claude/` (perfil minimal, sin hooks, solo reglas common/typescript/react/web); está en `.gitignore` y en los ignores de ESLint.

## Qué es el demo

Escribís una esquina de Buenos Aires ("acoyte y riva") y la app:

1. la geocodifica (USIG → Georef → Photon, todo gratis y sin key);
2. vuela con un globo de MapLibre hasta la esquina (5 s);
3. pasa con un fundido a una maqueta 3D al atardecer (React Three Fiber) con las calles, los parques y los árboles reales de OpenStreetMap, más los **20 edificios más cercanos** con su huella real. La intro dura 8,2 s;
4. al final podés orbitar, tocar un edificio para ver sus datos, repetir el recorrido o buscar otra esquina.

## Cómo levantarlo en casa

```bash
git clone https://github.com/AlejoGau/inmobilite.git
cd inmobilite
npm install                 # usé Node 24 (v24.14.1)
git config user.email "156323292+AlejoGau@users.noreply.github.com"   # email noreply, solo en este repo
npm run dev                 # http://localhost:3000
```

- `npm run dev` corre antes `predev`, que copia el worker de MapLibre a `public/vendor/`.
- `npm test`: 181 tests en 30 archivos.
- `npm run typecheck`: hace `next typegen && tsc --noEmit`, así que anda en un clon nuevo.
- `npm run lint` y `npm run build` salen limpios.
- Probá con el chip **"Acoyte y Rivadavia"** o escribí `acoyte y riva`.

## Estado

| Parte | Estado |
|---|---|
| Plan y decisiones (`PLAN.md`) | ✅ |
| Datos y API: geocoding, Overpass con carrera entre mirrors y límite de 10 s, multipolígonos, fallback offline | ✅ |
| App: landing, buscador accesible, vuelo, fundido, paneles, error boundary, estado de error con "Reintentar" | ✅ |
| **Escena 3D** (`src/features/scene`), integrada | ✅ |
| Revisión de código: 4 revisores + verificadores escépticos. 16 hallazgos confirmados y **arreglados**, cada uno con un test que primero fallaba; 3 descartados | ✅ |

La escena 3D incluye el director central, la maqueta con veredas y cordón, las sendas peatonales en la esquina, las ventanas encendidas, los tanques de agua, el sol bajo con sombras, AO, bloom, la calidad adaptativa, las etiquetas de calles y la selección de edificios.

**Probado en un navegador real** (Chrome con GPU Intel UHD 630):

- flujo completo en Acoyte y Rivadavia: vuelo de 5,1 s, intro de 8,2 s y modo exploración;
- 1440×900, 1366×650 y celular de 390×844 (hoja inferior);
- "Nueva búsqueda" y el estado de error, con 0 errores en la consola.

## Problema nº 1: Overpass (hay que decidir)

Los servidores públicos de Overpass (de donde salen los datos de OSM) **fallan seguido**: el 24/11 estuvieron caídos varias veces, con 502, 504 y errores de red. Desde los arreglos, la app falla en 10 s como máximo, con el mensaje "No pudimos modelar … Reintentar". Pero hoy **solo Acoyte y Rivadavia anda siempre**, gracias al fixture offline. Otras esquinas, como Corrientes y Callao, dependen de que Overpass responda.

Hay dos caminos; **es una decisión de diseño, así que se pregunta antes de elegir**:

- **Dejarlo así:** queda la carrera entre mirrors con límite de 10 s, que ya está hecha. Es simple, pero el demo depende de un servicio inestable.
- **Robusto:** sacar los datos de los **tiles vectoriales de OpenFreeMap**, los mismos que ya descarga el mapa, servidos desde un CDN que no se cae. Con Overpass caído, el mapa de Corrientes y Callao igual mostraba las huellas de los edificios. Las capas son `building` (con `render_height`), `transportation`, `transportation_name` y `park`. Hace falta decodificar MVT (`@mapbox/vector-tile` + `pbf`) y quedaría detrás de la misma interfaz que hoy usa Overpass. Overpass queda como complemento para los nombres de los edificios y los árboles.

## Qué hacer, en orden

1. **Decidir la fuente de datos** (ver arriba) e implementarla.
2. **Pruebas manuales que no se pudieron automatizar acá:**
   - con emulación de celular (pointer táctil, DPR 3), la calidad baja se mantiene en DPR 1 después de la intro (`canvas.width / canvas.clientWidth` = 1);
   - en un navegador sin WebGL2 aparece el aviso "No pudimos mostrar la maqueta 3D…" y el resto de la app sigue andando;
   - un deep link con la red en Slow 4G: el mapa queda visible hasta que carga la escena y no hay corte brusco;
   - rotar el celular durante el vuelo no rompe la escala del fundido;
   - un clic sobre un edificio para saltear la intro **no** lo selecciona.
3. **Decisión de producto chica:** si la escena 3D falla, el fallback da la intro por terminada y muestra el panel de inmediato (`src/features/experience/StageFallback.tsx`, un solo efecto). Confirmar si se quiere así.
4. Opcional: `src/app/global-error.tsx` como página de último recurso.
5. **Después del demo, volver al plan:**
   - las 4 fotos (Fases 3-4);
   - el reel con Remotion (Fase 6). La **licencia está pendiente**: es gratis hasta 3 personas, y después cuesta USD 0,01 por render con un mínimo de USD 100 por mes;
   - el video demo con HyperFrames (Fase 7).

## Arreglos ya hechos (para no repetirlos)

**Integración:**

- **El worker de MapLibre daba 404 con Turbopack.** `scripts/copy-maplibre-worker.mjs` lo copia a `public/vendor/` (en `predev` y `prebuild`) y `src/features/flight/maplibreWorker.ts` llama a `setWorkerUrl`.
- **El globo se veía negro** con el estilo "dark". `src/features/flight/globePalette.ts` lo recolorea con la paleta pizarra.
- **Fundido sin salto:** la pose donde termina el vuelo y empieza la intro está en un solo lugar, `src/domain/handoffCamera.ts`. El zoom de llegada se calcula a partir del alto de la pantalla (`zoomForCameraDistance`, con test) y el fov de MapLibre queda fijo.
- **Pre-calentado:** la geometría del suelo (las operaciones booleanas) se calcula durante el vuelo (`prewarmStage`).
- **El panel de info se superponía en pantallas de 650 px de alto.** Ahora scrollea la zona de calles.
- **Rutas de la API:** usan `unstable_rethrow`. Con `cacheComponents`, el `try/catch` se tragaba el error interno con el que Next sale del prerender.
- **Con un error de compilación, Next en desarrollo responde 500 en todas las rutas.** Si `/api/*` falla, mirá primero si la página compila.

**De la revisión de código** (cada uno con su test):

- **Escena 3D:**
  - la calidad baja se mantiene en DPR 1 aunque R3F reconfigure el Canvas;
  - el toque que saltea la intro no selecciona edificios;
  - el hover iniciado durante la intro se ve apenas termina;
  - el encuadre al seleccionar edificios alejados es correcto;
  - no hay bajón de resolución en la transición.
- **App:**
  - "Reintentar" ya no queda trabado si el área falla después de aterrizar;
  - hay un error boundary con reintento alrededor de la escena;
  - los chips no pisan una búsqueda más nueva;
  - el resize durante el vuelo no rompe la escala;
  - el fundido espera a que cargue la escena.
- **Datos:**
  - Overpass corre como carrera entre mirrors con un límite total de unos 10 s;
  - se descargan los edificios y parques multipolígono (los anillos interiores, como los patios, todavía se ignoran);
  - el radio del fallback es coherente con el fixture;
  - se corrigió el formato de nombres como Diagonal Norte o Del Barco Centenera.
- **Build:**
  - `typecheck` funciona en un clon nuevo;
  - el lint ignora `public/vendor/`.

**Otros:**

- `.gitignore` ignora `/.playwright-mcp/` (capturas de prueba) y `/public/vendor/` (generado).
- La fuente Geist (`public/fonts/`) va con su licencia `OFL.txt`, que el repo es público.

## Notas del código

- **Contrato:** `src/domain/types.ts`. Las coordenadas son metros locales `[este, norte]` y en three.js se mapean a `(x, altura, -y)`.
- **Regla de la escena:** un solo director (timeline GSAP en pausa) es la única fuente de tiempo. **Nada de `useFrame` salvo en `runtime/SceneDriver.tsx`**, y ESLint lo controla. Nada de `Date.now` ni `Math.random`: se usa el PRNG con semilla de `src/domain/seed.ts`. Así el reel exportado va a salir idéntico a la vista en vivo.
- **Interacción de la escena:** `runtime/stageInteraction.ts` decide cuándo un clic puede seleccionar.
- **Calidad:** `runtime/QualityController.tsx` (alta/baja) junto con `PerformanceMonitor`.
- **Tests de R3F en node:** `src/features/scene/testing/r3fHarness.ts` levanta un root real de R3F con un renderer falso, sin navegador.
- **Alturas:** casi ningún edificio de CABA tiene `building:levels` en OSM, así que se estiman de forma determinista (`src/domain/area/buildingHeight.ts`) y se marcan como `heightSource: "estimated"`.
- **Next 16 tiene cambios que rompen cosas:** antes de tocar código de Next, leer `node_modules/next/dist/docs/` (lo dice `AGENTS.md`).

## Herramientas de Claude que se usaron (instalar en casa si querés las mismas)

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
