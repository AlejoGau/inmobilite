export interface StitchedRing<T> {
  /** Closed: the last point repeats the first. */
  points: T[];
  /** Indices of the input paths it was built from, in the order they were joined. */
  parts: number[];
}

/**
 * Joins paths that share endpoints into closed rings, reversing them where needed. This is how OSM
 * maps big outlines: one multipolygon ring is often split across several open ways (Plaza de Mayo's
 * across eight). Endpoints match by `key`. At a junction the first unused path in input order wins,
 * so the result is deterministic. A chain that never closes (a member is missing) is dropped rather
 * than drawn half open.
 */
export function stitchRings<T>(paths: readonly (readonly T[])[], key: (point: T) => string): StitchedRing<T>[] {
  const ends = paths.map((path) => (path.length >= 2 ? { first: key(path[0]), last: key(path[path.length - 1]) } : null));

  // Endpoint → open paths that start or end there. A path that is closed already is its own ring,
  // never a continuation: splicing it into a chain that touches it would merge two outlines.
  const byEndpoint = new Map<string, number[]>();
  ends.forEach((end, index) => {
    if (!end || end.first === end.last) return;
    for (const point of [end.first, end.last]) {
      const list = byEndpoint.get(point);
      if (list) list.push(index);
      else byEndpoint.set(point, [index]);
    }
  });

  const used = new Array<boolean>(paths.length).fill(false);
  const rings: StitchedRing<T>[] = [];
  paths.forEach((path, start) => {
    const startEnds = ends[start];
    if (used[start] || !startEnds) return;
    used[start] = true;
    const points = [...path];
    const parts = [start];
    let tail = startEnds.last;
    while (tail !== startEnds.first) {
      const next = byEndpoint.get(tail)?.find((index) => !used[index]);
      if (next === undefined) break;
      used[next] = true;
      parts.push(next);
      const forward = ends[next]?.first === tail;
      const oriented = forward ? paths[next] : [...paths[next]].reverse();
      points.push(...oriented.slice(1));
      tail = key(points[points.length - 1]);
    }
    // Four points is the smallest closed ring with an area: a triangle plus its closing point.
    if (tail === startEnds.first && points.length >= 4) rings.push({ points, parts });
  });
  return rings;
}
