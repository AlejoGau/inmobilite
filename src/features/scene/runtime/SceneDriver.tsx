"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { PerspectiveCamera, type Camera } from "three";
import { createEmptyFrame, type DirectorFrame } from "../director/director";
import { useSceneRuntime } from "./SceneRuntime";

/** A long frame (tab switch, GC pause, heavy first upload) must not skip half of the intro. */
const MAX_STEP = 1 / 20;

/** Runs before CameraControls (-1) and before the composer renders (1). */
const DRIVER_PRIORITY = -2;

export interface SceneDriverProps {
  /** Where the play starts, in seconds (the end of the intro to skip it). */
  startAt: number;
  /** Set to true to jump to the end of the intro (a click during the intro, reduced motion turned on later). */
  skipRequested: RefObject<boolean>;
  /** Called once, from the render loop, when the intro reaches its end. */
  onIntroEnd: () => void;
}

function applyCamera(camera: Camera, frame: DirectorFrame): void {
  const { position, target, fov } = frame.camera;
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  if (camera instanceof PerspectiveCamera && camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/**
 * The only clock of the scene, and the only useFrame in it. It advances t
 * with real elapsed time, samples the director, flies the camera while the
 * intro plays, and publishes the frame to every subscriber.
 *
 * Remount it (React key) to replay the intro from its start.
 */
export function SceneDriver({ startAt, skipRequested, onIntroEnd }: SceneDriverProps) {
  const { director, bus, exploring } = useSceneRuntime();
  const camera = useThree((s) => s.camera);
  const frame = useMemo(() => createEmptyFrame(), []);
  const time = useRef(startAt);
  const ended = useRef(false);
  const introActive = useRef(!exploring);
  const notifyEnd = useRef(onIntroEnd);

  useLayoutEffect(() => {
    introActive.current = !exploring;
    notifyEnd.current = onIntroEnd;
  });

  // Put the camera and every subscriber on the first frame before anything is drawn.
  useLayoutEffect(() => {
    director.sampleInto(time.current, frame);
    if (introActive.current) applyCamera(camera, frame);
    bus.publish(frame);
  }, [director, bus, camera, frame]);

  useFrame((_, delta) => {
    let t = time.current + Math.min(Math.max(delta, 0), MAX_STEP);
    if (skipRequested.current && t < director.duration) t = director.duration;
    time.current = t;

    director.sampleInto(t, frame);
    if (introActive.current) applyCamera(camera, frame);
    bus.publish(frame);

    if (!ended.current && t >= director.duration) {
      ended.current = true;
      notifyEnd.current();
    }
  }, DRIVER_PRIORITY);

  return null;
}
