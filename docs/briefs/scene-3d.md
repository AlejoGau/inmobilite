# Brief: Inmobilite 3D scene (`src/features/scene`)

> Spec for finishing the real-time 3D scene. Written for whoever picks it up (a person or Claude).
> Part of it already exists: read `src/features/scene/**` first and continue from there.
> Context: [HANDOFF.md](../../HANDOFF.md), [PLAN.md](../../PLAN.md), the contract in `src/domain/types.ts`.

## Goal

A premium, smooth, "aceitado" real-time architectural model of the searched street corner. The
user's top priority is that the 3D looks professional. It should hold a steady 60 fps on a
mid-range laptop and stay usable on a mid-range phone. It is not a game look.

## Public API (the app already consumes it; do not change it)

`src/features/scene/index.ts` is a `'use client'` module, safe to load with `next/dynamic({ ssr: false })`:

```ts
export interface CityStageProps {
  area: AreaModel;
  /** Changing this number replays the intro from t=0. */
  playId: number;
  showLabels: boolean;
  /** Building the user selected (null = none). Controlled by the parent. */
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  /** Fired once each time the intro reaches its end. */
  onIntroEnd?: () => void;
  /** If true, skip straight to the end of the intro (reduced motion, deep links). */
  skipIntro?: boolean;
  className?: string;
}
export function CityStage(props: CityStageProps): JSX.Element; // fills its parent
```

The app loads it via `src/features/experience/stageLoader.ts` (`m.CityStage`). While it is missing,
`tsconfig.json` maps `@/features/scene` to the temporary preview in `src/dev/scene-preview/`.
Remove that mapping when this module exists.

## Mandatory architecture

- **One director is the only time source.** `director/director.ts` exports
  `createDirector(area): { duration; sample(t): DirectorFrame }`. It is built on a paused GSAP
  timeline that tweens a plain proxy object, and `sample(t)` seeks it (suppressing events) and
  returns a copy. It is a pure function of `t`, with unit tests for determinism and boundary frames.
  DirectorFrame holds at least:
  - `t`
  - `camera { position, target, fov }`
  - progress values from 0 to 1: `groundReveal`, `roadsReveal`, `buildingRise` (each building delayed by its `distance`, so they rise from the corner outward), `treesReveal`, `labels`, `beacon`.
- **Visual components are pure functions of the current frame.** They must not call `useFrame`
  and must not read clocks. The only component that uses `useFrame` is `runtime/SceneDriver.tsx`.
  It:
  - advances `t` (real elapsed time, clamped delta);
  - calls `director.sample(t)`;
  - applies the camera during the intro;
  - publishes the frame through a context: `useDirectorFrame(callback)` registers an imperative callback that updates uniforms or refs. Nothing re-renders through React at 60 fps.
- Enforce the rule in `eslint.config.mjs` with `no-restricted-imports` of `useFrame` from
  `@react-three/fiber` for `src/features/scene/**`, except `SceneDriver.tsx`.
- **Explore mode:** after the intro (or with `skipIntro`), hand over to drei `<CameraControls>`
  starting exactly at the final director pose, with no jump.
  - Limit the polar angle (never go under the ground).
  - Distance 40-420 m, smooth damping, target bounded to the area.
  - A new `playId` restarts the intro with controls disabled. `onIntroEnd` fires once per play.
- Geometry builders stay pure (`geometry/*.ts`, BufferGeometry only, no React) and are unit-tested in node.

## Intro choreography (about 7-9 s, cinematic)

1. Start about 380 m above, looking down (matches the end of the MapLibre flight).
2. The ground and roads reveal from the centre; the camera glides down along an orbit arc.
3. The buildings rise staggered (expo.out / back.out(1.2)), the trees pop in, and the beacon and labels fade in.
4. End at a 3/4 hero view of the corner, about 110-150 m away at a pitch of about 40°, framing all buildings. Power and expo eases only, never linear.

## Art direction: "maqueta arquitectónica al atardecer"

- **Palette:** a deep blue-slate background and fog (`#0e1218` to `#161b24`), with the fog fading the edge of the 300 m disc smoothly. Asphalt a slightly lighter slate. Sidewalks a warm grey, raised 0.15 m as curbs. Parks a muted sage green, slightly raised.
- **Buildings:** warm off-white clay (`#e9e5de`, with a tiny seeded variation), MeshStandardMaterial with roughness about 0.85. Facade detail comes from an `onBeforeCompile` shader:
  - **Window grid:** world-space facade UVs (u = distance along the perimeter, v = height), a floor every 3 m, windows about 1.4 m wide every 2.6 m. At dusk, 35-55% of the windows glow amber (`#ffb86b`, seeded per window).
  - **Facade details:** a glass storefront band on the ground floor of commercial/retail buildings, floor slab lines, and a roof parapet.
  - **Rooftops:** buildings over 6 levels get a seeded water tank or machine room (typical Buenos Aires).
  - **Rise:** buildings grow through a uniform (scale y with a per-building delay), with a soft emissive line on the rising edge.
- **Light:** a low warm sun (about 18° elevation, from the west-northwest) with soft shadows: one directional shadow map fitted to the area bounds, 2048, with correct bias. Add a cool hemisphere fill and an environment built from `<Lightformer>` (offline, no HDR download).
- **Postprocessing:** N8AO (key for the maquette look), subtle Bloom (high threshold, so only windows and the beacon glow), SMAA, AgX or ACES tone mapping, and a gentle vignette. Quality tiers with `<PerformanceMonitor>` + `<AdaptiveDpr>`: low = no AO, a smaller shadow map, DPR 1. Clamp DPR to [1, 2].
- **Roads:**
  - Ribbons with miter joins and a miter limit.
  - Dashed centre lines and solid edge lines on primary and secondary roads.
  - **Zebra crosswalks** on every leg of the main intersection.
  - Layer heights that avoid z-fighting: ground 0, road 0.02, markings 0.035, sidewalk 0.15, park 0.08.
- **Trees:** an InstancedMesh (trunk + low-poly crown, per-instance colour variation), with a "pop" reveal driven by `treesReveal` + a per-instance delay.
- **Beacon at the origin:** a slim additive light column with a gradient, plus two pulsing rings on the ground in teal `#14B8A6`. The pulse is computed from `frame.t`, so it is deterministic.
- **Labels:** drei `<Text>` lying flat on the road (rotation `[-π/2, 0, angle]`), uppercase, letter-spaced, white at 85% opacity. They fade with `frame.labels` and `showLabels`. The anchors already come in `area.labels`.
- **Interaction:**
  - **Hover** a building: a teal rim or tint plus a pointer cursor.
  - **Click** a building: `onSelectBuilding(b)` and the camera eases to frame it. Clicking the ground calls `onSelectBuilding(null)`.
  - **Selected** building: keeps the highlight and gets an `<Html>` tag with the name (or "Edificio"), the levels, and "altura estimada" when `heightSource === 'estimated'`.

## Performance and robustness

- Build geometries once per area (`useMemo`) and dispose them on change.
- Merge static roads by material.
- No allocations inside the driver loop.
- Use colour spaces correctly (sRGB colours, linear lighting).
- If `skipIntro` or `prefers-reduced-motion` is set, start at the final pose.
- Give the canvas an `aria-label`.

## Done when

- `npm test` and `npm run typecheck` pass, and ESLint is clean with the `useFrame` rule active.
- The intro at Acoyte y Rivadavia runs at ≥50 fps on a mid-range notebook, and the same address always produces the same scene.
- Visual check in the browser: no z-fighting, no shadow acne, no hard edge at the end of the disc, no jump between the intro and the controls.
