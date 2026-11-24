"use client";

/**
 * TEMPORARY: minimal scene preview, used only while src/features/scene is unfinished.
 *
 * tsconfig.json maps "@/features/scene" to this file so the app compiles and
 * can be tried end to end. Once the real scene exists, delete this folder and
 * that mapping. Do not build anything on top of this file.
 */

import { OrbitControls, Text } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as THREE from "three";
import type { AreaModel, Building, Road, Vec2 } from "@/domain/types";

export interface CityStageProps {
  area: AreaModel;
  playId: number;
  showLabels: boolean;
  selectedBuildingId: string | null;
  onSelectBuilding: (building: Building | null) => void;
  onIntroEnd?: () => void;
  skipIntro?: boolean;
  className?: string;
}

const COLORS = {
  background: "#10141b",
  ground: "#1a1f28",
  road: "#2b313c",
  footway: "#3a404b",
  park: "#3f5a46",
  building: "#e7e2d9",
  buildingHover: "#f3efe8",
  selected: "#5eead4",
  tree: "#4d6b4f",
  beacon: "#14b8a6",
  label: "#e8edf5",
} as const;

/** Domain [east, north] in meters → three.js (x, y, z) with north = -Z. */
function toWorld([x, y]: Vec2, height = 0): [number, number, number] {
  return [x, height, -y];
}

/** Flat ribbon of quads plus an octagon at each vertex, so bends have no gaps. */
function buildRibbonGeometry(roads: Road[], elevation: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTriangle = (a: Vec2, b: Vec2, c: Vec2) => {
    for (const p of [a, b, c]) positions.push(p[0], elevation, -p[1]);
  };

  for (const road of roads) {
    const half = road.width / 2;
    for (let i = 0; i < road.points.length - 1; i++) {
      const [ax, ay] = road.points[i];
      const [bx, by] = road.points[i + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue;
      const nx = (-(by - ay) / length) * half;
      const ny = ((bx - ax) / length) * half;
      const a1: Vec2 = [ax + nx, ay + ny];
      const a2: Vec2 = [ax - nx, ay - ny];
      const b1: Vec2 = [bx + nx, by + ny];
      const b2: Vec2 = [bx - nx, by - ny];
      pushTriangle(a1, a2, b2);
      pushTriangle(a1, b2, b1);
    }
    for (const [cx, cy] of road.points) {
      const sides = 8;
      for (let s = 0; s < sides; s++) {
        const t0 = (s / sides) * Math.PI * 2;
        const t1 = ((s + 1) / sides) * Math.PI * 2;
        pushTriangle(
          [cx, cy],
          [cx + Math.cos(t0) * half, cy + Math.sin(t0) * half],
          [cx + Math.cos(t1) * half, cy + Math.sin(t1) * half],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function ringToShape(ring: Vec2[]): THREE.Shape {
  return new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
}

function useDisposable<T extends { dispose(): void }>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function Roads({ roads }: { roads: Road[] }) {
  const carriageways = useDisposable(
    () => buildRibbonGeometry(roads.filter((r) => r.cls !== "footway"), 0.02),
    [roads],
  );
  const footways = useDisposable(
    () => buildRibbonGeometry(roads.filter((r) => r.cls === "footway"), 0.05),
    [roads],
  );
  return (
    <>
      <mesh geometry={carriageways} receiveShadow>
        <meshStandardMaterial color={COLORS.road} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={footways} receiveShadow>
        <meshStandardMaterial color={COLORS.footway} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function Parks({ area }: { area: AreaModel }) {
  const geometries = useDisposable(() => {
    const list = area.parks.map((park) => new THREE.ShapeGeometry(ringToShape(park.polygon)));
    return Object.assign(list, { dispose: () => list.forEach((g) => g.dispose()) });
  }, [area]);
  return (
    <>
      {geometries.map((geometry, i) => (
        <mesh key={area.parks[i].id} geometry={geometry} rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow>
          <meshStandardMaterial color={COLORS.park} roughness={1} />
        </mesh>
      ))}
    </>
  );
}

function Trees({ area }: { area: AreaModel }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useDisposable(() => new THREE.IcosahedronGeometry(2.4, 0), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    area.trees.forEach((tree, i) => {
      const s = tree.scale;
      matrix.makeScale(s, s * 1.25, s).setPosition(...toWorld(tree.position, 4 * s));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [area]);

  if (area.trees.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, area.trees.length]} castShadow receiveShadow>
      <meshStandardMaterial color={COLORS.tree} roughness={0.9} flatShading />
    </instancedMesh>
  );
}

function BuildingMesh({
  building,
  selected,
  onSelect,
}: {
  building: Building;
  selected: boolean;
  onSelect: (building: Building) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const geometry = useDisposable(
    () =>
      new THREE.ExtrudeGeometry(ringToShape(building.footprint), {
        depth: building.height,
        bevelEnabled: false,
      }),
    [building],
  );
  const color = selected ? COLORS.selected : hovered ? COLORS.buildingHover : COLORS.building;

  return (
    <mesh
      geometry={geometry}
      rotation-x={-Math.PI / 2}
      castShadow
      receiveShadow
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(building);
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.85}
        emissive={selected ? COLORS.selected : "#000000"}
        emissiveIntensity={selected ? 0.25 : 0}
      />
    </mesh>
  );
}

function Labels({ area }: { area: AreaModel }) {
  return (
    <>
      {area.labels.map((label) => (
        <Text
          key={label.name}
          position={toWorld(label.position, 0.25)}
          rotation={[-Math.PI / 2, 0, label.angle]}
          fontSize={6}
          letterSpacing={0.12}
          color={COLORS.label}
          fillOpacity={0.85}
          anchorX="center"
          anchorY="middle"
        >
          {label.name.toUpperCase()}
        </Text>
      ))}
    </>
  );
}

function Beacon() {
  return (
    <group>
      <mesh position={[0, 30, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 60, 12, 1, true]} />
        <meshBasicMaterial color={COLORS.beacon} transparent opacity={0.65} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
        <ringGeometry args={[5, 6.2, 48]} />
        <meshBasicMaterial color={COLORS.beacon} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

export function CityStage({
  area,
  playId,
  showLabels,
  selectedBuildingId,
  onSelectBuilding,
  onIntroEnd,
  className,
}: CityStageProps): JSX.Element {
  // Keep the latest callback without restarting the timer on every parent render.
  const onIntroEndRef = useRef(onIntroEnd);
  useEffect(() => {
    onIntroEndRef.current = onIntroEnd;
  }, [onIntroEnd]);

  useEffect(() => {
    const timer = window.setTimeout(() => onIntroEndRef.current?.(), 400);
    return () => window.clearTimeout(timer);
  }, [playId]);

  const groundRadius = area.radius + 80;

  return (
    <div className={className} style={{ position: "relative" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [150, 140, 170], fov: 40, near: 1, far: 2000 }}
        onPointerMissed={() => onSelectBuilding(null)}
        aria-label={`Vista 3D de ${area.stats.streets.slice(0, 2).join(" y ")}`}
      >
        <color attach="background" args={[COLORS.background]} />
        <fog attach="fog" args={[COLORS.background, 260, 560]} />
        <hemisphereLight args={["#b7c4d8", "#262b33", 0.7]} />
        <directionalLight
          position={[-180, 160, 80]}
          intensity={2.2}
          color="#ffe2c4"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-260}
          shadow-camera-right={260}
          shadow-camera-top={260}
          shadow-camera-bottom={-260}
          shadow-camera-far={800}
          shadow-bias={-0.0004}
        />

        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[groundRadius, 96]} />
          <meshStandardMaterial color={COLORS.ground} roughness={1} />
        </mesh>

        <Roads roads={area.roads} />
        <Parks area={area} />
        <Trees area={area} />
        {area.buildings.map((building) => (
          <BuildingMesh
            key={building.id}
            building={building}
            selected={building.id === selectedBuildingId}
            onSelect={onSelectBuilding}
          />
        ))}
        <Beacon />
        {showLabels && <Labels area={area} />}

        <OrbitControls
          makeDefault
          target={[0, 0, 0]}
          enableDamping
          minDistance={40}
          maxDistance={460}
          maxPolarAngle={Math.PI * 0.45}
        />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          padding: "6px 10px",
          borderRadius: 999,
          fontSize: 12,
          letterSpacing: "0.02em",
          color: "#cbd5e1",
          background: "rgba(15, 20, 27, 0.7)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          pointerEvents: "none",
        }}
      >
        Vista previa · la escena final está en construcción
      </div>
    </div>
  );
}
