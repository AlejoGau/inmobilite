import type { Vec2 } from "../types";

/** Minimal 2D vector helpers for the planar domain maths. */

export function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function scale(a: Vec2, k: number): Vec2 {
  return [a[0] * k, a[1] * k];
}

export function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** z component of the 3D cross product. Positive when b is CCW from a. */
export function cross(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function length(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Rounds to millimetres. Applied to every coordinate that leaves the domain,
 * so the JSON stays compact and float noise cannot break deep equality.
 */
export function roundVec(a: Vec2): Vec2 {
  return [round3(a[0]), round3(a[1])];
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
