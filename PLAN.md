# Inmobilite: plan del MVP

> Visor inmobiliario 3D: buscás una dirección, la cámara vuela en 3D hasta la calle (una calle
> estilizada, generada a partir de la ubicación), y la propiedad aparece modelada en 3D a partir de
> 4 fotos: 1 de fachada y 3 de ambientes.

## Decisiones tomadas

| Tema | Decisión | Por qué / cómo se cambia después |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript strict** | Rutas de API para el proxy de geocoding y, más adelante, páginas públicas con SEO. |
| Mapas y geocoding | **MapLibre GL + OpenFreeMap (tiles) + Photon (autocompletado)**, sin API keys | Todo detrás de interfaces `GeocodingProvider` / `MapProvider`. Google Places o Maps 3D se enchufan sin tocar las features. |
| Persistencia | **Solo navegador: IndexedDB (Dexie)** | Detrás de `PropertyRepository`. Migrar a Supabase es una implementación nueva de la interfaz, no una reescritura. |
| Las 4 fotos | **1 fachada + 3 ambientes** (living, cocina, dormitorio; editables) | La fachada genera la casa 3D en la calle; cada ambiente se ve como un diorama 3D con profundidad. |
| 3D "real" en el MVP | **Simulado pero dependiente de las fotos** | La paleta, las proporciones y la profundidad salen de cada imagen. El motor de reconstrucción es intercambiable (ver Fase 4). |
| Render vs Three.js | **Híbrido: Three.js/R3F en tiempo real es el producto; el render (Remotion) es solo para lo que se exporta** | Salió de una comparación con 3 jueces. Un video no puede ser el centro porque la dirección y las fotos se conocen recién en tiempo de uso, y HyperFrames no renderiza en el navegador. |
| Animación de la escena | **Un solo timeline central (el "director")** | Los componentes 3D reciben el estado del timeline por props (tiempo, pose de cámara, progreso), sin `useFrame` ni `Date.now`. El visor en vivo y el reel usan la misma escena; una regla de lint lo controla. |
| Barrios de CABA | **Calles y parques reales de OSM, edificios reales donde OSM los tiene, el resto procedural** | En OSM hay pocos edificios cargados en CABA (80 en 300 m alrededor de Acoyte y Rivadavia), así que los lotes vacíos se completan con edificios generados de forma determinista. |
| Geocoding | **USIG (CABA) → Georef (Argentina) → Photon (global)** | USIG resuelve intersecciones incompletas ("acoyte y riva"). Los tres son gratis y sin key. |
| Licencia Remotion | **Pendiente** | El reel va detrás de una interfaz: Remotion, o MediaRecorder si no hay licencia. Se decide antes de la Fase 6. |

## La experiencia (lo que ve el usuario)

1. **Landing con globo 3D oscuro** y un buscador central. Tipeás "Av. Libertador 4500" y aparecen sugerencias.
2. **Vuelo:** la cámara sale del globo, gira, baja con inclinación de 60° y se acerca a la cuadra (unos 3,5 s).
3. **Materialización (el momento "wow"):** al llegar a nivel calle, el mapa se desatura y se convierte
   en el piso de una **maqueta arquitectónica**. Las manzanas vecinas suben desde el suelo como
   bloques blancos tipo arcilla y se arman veredas, árboles y faroles. La propiedad se construye
   última, a todo color: suben las paredes, cae el techo y la foto de fachada se "imprime" en el frente.
   La calle es inventada pero **determinista**: la misma dirección siempre genera la misma calle.
4. **Exploración:** orbitar alrededor de la casa, hotspots en cada ambiente. Al hacer clic, la cámara
   entra al diorama del ambiente: la foto con profundidad real y parallax con el mouse o el giroscopio.
5. **Modo recorrido:** un tour automático con cámara cinematográfica (fachada → ambientes → vista aérea).
6. **Ficha:** precio, m², ambientes y descripción, en paneles de vidrio sobre el canvas 3D.
7. **Reel:** un botón exporta un video MP4 vertical de la propiedad para redes, renderizado en el navegador.

El estilo maqueta resuelve dos cosas a la vez: le da al producto una identidad que no se parece a
Google Maps, y hace que lo "ficticio" se lea como una decisión de diseño y no como una limitación.

## Stack

- **App:** Next.js (última estable), React 19, TypeScript strict, Tailwind v4, shadcn/ui (Radix), Lucide.
- **3D:** three, @react-three/fiber, @react-three/drei, @react-three/postprocessing (SSAO, bloom
  suave, tone mapping), `PerformanceMonitor` de drei para la calidad adaptativa.
- **Mapa:** maplibre-gl (proyección globo) + react-map-gl/maplibre, estilo OpenFreeMap.
- **Animación:** GSAP para la secuencia cinematográfica (un timeline que se puede scrubbear y testear);
  Motion para la UI. Una herramienta por capa, sin mezclarlas.
- **Procesamiento de imágenes, en un Web Worker (Comlink):** resize a WebP de 2048 px,
  corrección EXIF, extracción de paleta y mapa de profundidad con
  **transformers.js + Depth Anything V2 small** (WebGPU, con WASM de respaldo).
- **Estado y datos:** Dexie + dexie-react-hooks (`useLiveQuery`), Zustand para el estado de la
  escena, Zod para validar todo lo que entra de afuera.
- **Video:** Remotion (`<Player>` para la vista previa + `@remotion/web-renderer` para exportar el MP4 en el navegador).
- **Calidad:** Vitest (+ fake-indexeddb), Playwright para e2e y capturas visuales, ESLint y Prettier.

## Arquitectura

```
src/
  app/                      # rutas (delgadas: solo componen features)
    page.tsx                # landing + globo + buscador
    p/[id]/page.tsx         # experiencia 3D de la propiedad
    p/[id]/editar/page.tsx  # carga de fotos y ficha
    api/geocode/route.ts    # proxy a Photon: debounce, caché y rate limit
  domain/                   # TS puro, sin React ni three: lo más testeado
    property.ts             # tipos + esquemas Zod
    seed.ts                 # semilla determinista desde lat/lng
    street/generateStreet.ts   # (seed) -> StreetLayout (datos, no meshes)
    house/generateHouse.ts     # (seed, FacadeAnalysis) -> HouseSpec
  features/
    search/                 # autocompletado, selección de resultado
    flight/                 # globo + vuelo MapLibre + handoff a three
    scene/                  # render R3F de StreetLayout / HouseSpec / dioramas
    upload/                 # 4 slots, drag & drop, progreso del pipeline
    reconstruction/         # motores intercambiables (ver Fase 4)
    reel/                   # composiciones Remotion + export
  infra/
    geocoding/              # PhotonProvider (hoy), GooglePlacesProvider (mañana)
    storage/                # DexiePropertyRepository (hoy), SupabaseRepository (mañana)
    workers/                # image-pipeline.worker.ts
  ui/                       # design system: tokens + componentes base
```

**Regla central:** los generadores devuelven *datos* (`StreetLayout`, `HouseSpec`), no objetos de
three. El renderer los consume. Así la lógica procedural se testea con snapshots, sin WebGL, y se
puede reemplazar por datos reales (OSM, IA) sin tocar el render.

### Modelo de datos

```ts
Property {
  id; createdAt; updatedAt
  address: { label; lat; lng; provider: 'photon' | 'google'; providerId }
  listing: { price?; currency; m2?; rooms?; baths?; description? }
  sceneSeed: number                 // derivado de lat/lng, guardado para estabilidad
  photos: {
    facade?: PhotoRef
    rooms: Array<PhotoRef & { kind: 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'other'; label }>  // máx. 3
  }
}
Photo { id; propertyId; blob; width; height; palette: string[]; depth?: Blob; analysis?: FacadeAnalysis }
```

## Fases

Tamaños: **S** ≈ 1 día · **M** ≈ 2-3 días · **L** ≈ 4-5 días (un dev trabajando con Claude).

### Fase 0: Setup y design system (M)
- Scaffold de Next.js, tooling, estructura de carpetas y CI local (lint, typecheck, test).
- **Design system:** se parte del resultado de `ui-ux-pro-max` (abajo) y se refina con
  `design-taste-frontend` para no quedar en lo genérico. Se persiste como `design-system/MASTER.md`
  + tokens en CSS.
- Componentes base: Button, Input, Combobox (buscador), GlassPanel, Sheet, Toast, Progress.
- **Hecho cuando:** la landing estática pasa el checklist de accesibilidad (contraste 4.5:1, foco visible, `prefers-reduced-motion`).

### Fase 1: Búsqueda y vuelo (M)
- `/api/geocode` con Photon: debounce de 250 ms, caché en memoria por query, límite por IP y
  validación Zod. *Nominatim no sirve acá: su política prohíbe usarlo para autocompletar.*
- Globo MapLibre + `flyTo` con curva, inclinación y bearing animados. Deep link `/?q=` y `/p/[id]`.
- **Hecho cuando:** buscar una dirección vuela hasta ahí y crea la `Property` en IndexedDB.

### Fase 2: Calle procedural y transición 3D (L, el corazón del producto)
- `generateStreet(seed)`: calle, veredas, manzanas con lotes de alturas variadas, árboles, faroles.
  Low-poly e instanciado (`InstancedMesh`) para mantener 60 fps.
- **Spike del handoff mapa → three** (1 día, antes de construir el resto). Se prueban dos opciones:
  - **A.** three dentro de MapLibre como *custom layer* (misma cámara: el empalme es perfecto, pero más complejo).
  - **B.** Captura del canvas del mapa como textura del piso, cámara de three alineada y crossfade (más simple; el fundido tapa errores chicos).
  Se elige según el resultado visual. Mi apuesta es B.
- Coreografía con GSAP: desaturación → suben los bloques (escalonados por distancia) → se arma la casa → la cámara baja a calle.
- `prefers-reduced-motion`: corte directo a la escena final, sin vuelo.
- **Hecho cuando:** la misma dirección genera siempre la misma calle (test de snapshot) y la transición corre a ≥50 fps en una notebook media.

### Fase 3: Carga de fotos y pipeline local (M)
- UI de 4 slots (1 fachada + 3 ambientes con tipo editable): drag & drop, cámara en mobile, reordenar y reemplazar.
- Worker: corrección EXIF → resize a WebP → paleta (k-means sobre una muestra) → profundidad.
- Modelo de profundidad cargado a demanda, con progreso visible y caché del navegador;
  `navigator.storage.persist()` para que Safari no borre los datos.
- **Fotos de demo:** 2 o 3 propiedades de ejemplo precargadas, con fotos de licencia libre (Unsplash/Pexels) y su atribución.
- **Hecho cuando:** subir 4 fotos deja todo procesado y persistido, y sobrevive a recargar la página.

### Fase 4: La propiedad en 3D (L)
Motores de reconstrucción detrás de una sola interfaz:

```ts
interface FacadeReconstructor { reconstruct(photo): Promise<HouseSpec | GltfAsset> }
interface RoomReconstructor   { reconstruct(photo): Promise<RoomDiorama> }
```

| Motor | Fachada | Ambientes | Estado |
|---|---|---|---|
| `procedural` | Casa paramétrica: la proporción de la foto define el ancho y la altura, la paleta define paredes y techo, la foto va proyectada al frente | Profundidad falsa (luminancia + gradiente) | **MVP: primero este** |
| `depth-local` | (igual que el anterior) | Depth Anything V2 en el navegador → malla desplazada con corte en bordes | **MVP** |
| `vision` | La Claude API analiza la foto → JSON (pisos, tipo de techo, materiales) → `generateHouse` | (igual que el anterior) | Post-MVP, necesita API key |
| `image-to-3d` | TRELLIS / Hunyuan3D vía fal o Replicate → GLB real | Gaussian splats desde un video | Post-MVP, pago por uso |

- Hotspots por ambiente, cámara que entra al diorama, parallax con mouse o giroscopio, modo recorrido.
- **Hecho cuando:** dos fachadas distintas producen dos casas visiblemente distintas, y cada ambiente se ve con profundidad.

### Fase 5: Ficha, pulido y rendimiento (M)
- Ficha editable, panel de vidrio, captura de pantalla de la escena (PNG).
- Exportar e importar una propiedad como `.zip`, para pasarla entre equipos ya que no hay backend.
- Rendimiento: DPR limitado, LOD, texturas comprimidas, carga diferida del modelo de profundidad.
  Fallback 2D (galería) si no hay WebGL2.
- **Hecho cuando:** Lighthouse ≥90 en la landing y la escena es usable en un Android de gama media.

### Fase 6: Reel de la propiedad con Remotion (M)
- Composición vertical 1080×1920 de unos 20 s: toma de mapa (técnica MapLibre de `remotion-maps`),
  fachada, ambientes con parallax de profundidad, precio y CTA.
- `<Player>` para la vista previa dentro de la app y `renderMediaOnWeb` para exportar el MP4 sin servidor.
- **Spike temprano:** el renderer web soporta solo un subconjunto de elementos. Hay que confirmar si
  captura un canvas WebGL; si no, las tomas 3D se resuelven con frames pre-capturados.

### Fase 7: Video demo del producto con HyperFrames (S-M)
- Video de lanzamiento de unos 45 s para presentarle Inmobilite a las inmobiliarias: capturas reales
  de la app, kinetic type y transiciones. Se hace con las skills `hyperframes-*` y se renderiza en
  local con la CLI o en la nube con el MCP.

### Fase 8: QA (transversal, cierre S)
- Vitest: generadores (determinismo), repositorio, parsers de geocoding.
- Playwright: buscar → volar → subir 4 fotos → ver 3D → exportar reel; capturas visuales por breakpoint (375/768/1024/1440).

**Total estimado del MVP: unas 4 semanas de un dev.** Las fases 2 y 4 son las que más riesgo
tienen, por eso cada una arranca con un spike.

## Qué skill o MCP se usa en cada fase

| Skill / MCP | Fases | Para qué |
|---|---|---|
| `ui-ux-pro-max` | 0, 5 | Design system, reglas UX, checklist previo a entregar |
| `design-taste-frontend`, `frontend-design` | 0, 2, 5 | Dirección de arte y revisión visual contra capturas |
| `remotion-saas`, `remotion-best-practices`, `remotion-maps`, `remotion-render` | 6 | Player en la app, toma de mapa, export en el navegador |
| `hyperframes`, `hyperframes-animation`, `hyperframes-creative`, MCP `hyperframes` | 7 | Video demo del producto |
| Playwright MCP | 1-8 | Ver la app corriendo, capturas, e2e |

## Design system inicial (salida de `ui-ux-pro-max`)

`search.py "real estate property 3D immersive viewer premium" --design-system` devolvió:

- **Patrón:** hero-centric, un solo CTA dominante (el buscador).
- **Estilo:** glassmorphism, con desenfoque de 10-20 px y bordes de 1 px blancos al 20% sobre el canvas 3D.
- **Colores:** primario `#0F766E` (teal), secundario `#14B8A6`, acento `#0369A1`, foreground `#134E4A`.
- **Tipografía:** Cinzel / Josefin Sans.
- **Evitar:** fotos pobres y no tener tour virtual.

Es un punto de partida, no la versión final. Para una experiencia 3D, el modo oscuro tiene que ir
primero (hace resaltar la maqueta blanca y la casa a color). Cinzel también es discutible: tiene un
tono "lujo clásico" que choca con un producto tech. Ambas cosas se definen en la Fase 0.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo de profundidad pesa unos 25-50 MB | Carga a demanda, progreso visible, caché; el motor `procedural` funciona sin el modelo |
| WebGPU no disponible | WASM de respaldo (más lento); el pipeline corre en un worker y no congela la UI |
| Photon público tiene uso justo | Proxy con caché y rate limit; si no alcanza, MapTiler (free tier) o Google, todo detrás del adapter |
| Cuota de IndexedDB o borrado en Safari | WebP comprimido, `storage.persist()`, export a `.zip` |
| El renderer web de Remotion no captura WebGL | Spike temprano en la Fase 6; plan B con frames pre-capturados |
| **Licencia de Remotion** | Gratis hasta 3 personas. Por encima de eso, el plan "Automators" cuesta USD 0,01 por render con un mínimo de USD 100 por mes, y `<Player>` y `renderMediaOnWeb` cuentan como automatización ([pricing](https://www.remotion.dev/docs/license/pricing), [FAQ](https://www.remotion.dev/docs/license/faq)). Hay que definir quién es el licenciatario. La alternativa sin licencia es MediaRecorder. |
| Export de video en el navegador no verificado | Nadie confirmó que `renderMediaOnWeb` capture bien `<ThreeCanvas>` con postprocesado, ni cuánto tarda en Android. La prueba se adelanta a la semana 1, y el mapa del reel va como imagen fija |
| Créditos de HeyGen | El render por MCP consume créditos de la cuenta; la CLI local no |
| Atribución de mapas | Mostrar "© OpenStreetMap contributors / OpenFreeMap" (obligatorio) |

## Después del MVP

1. Motor `vision` con la Claude API: la casa pasa a parecerse de verdad a la foto.
2. `SupabaseRepository`: links compartibles, multiusuario, panel para la inmobiliaria.
3. Huellas reales de edificios de OSM en lugar de manzanas inventadas (calle semi-real).
4. `image-to-3d` y Gaussian splats para clientes premium.
5. Adapter de Google Places y Maps 3D cuando haya API key.
