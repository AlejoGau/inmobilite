import type { DirectorFrame } from "../director/director";

export type FrameListener = (frame: DirectorFrame) => void;

/**
 * Fan-out of the current director frame to imperative listeners (uniforms,
 * refs). Publishing never goes through React, so nothing re-renders at
 * 60 fps. The frame object is reused by the driver: listeners read it and
 * must not keep it.
 */
export class FrameBus {
  private listeners: FrameListener[] = [];
  private latest: DirectorFrame;

  constructor(initial: DirectorFrame) {
    this.latest = initial;
  }

  get current(): DirectorFrame {
    return this.latest;
  }

  publish(frame: DirectorFrame): void {
    this.latest = frame;
    // Indexed loop over a copy-on-write array: no iterator allocation per frame.
    const listeners = this.listeners;
    for (let i = 0; i < listeners.length; i++) listeners[i](frame);
  }

  /** Subscribes and immediately replays the current frame, so late mounts are never a frame behind. */
  subscribe(listener: FrameListener): () => void {
    this.listeners = [...this.listeners, listener];
    listener(this.latest);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
