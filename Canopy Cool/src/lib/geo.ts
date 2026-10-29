import type { Pt } from './types';

export function inRing(px: number, pz: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd containment across all rings, so holes are respected. */
export function inPoly(px: number, pz: number, poly: Pt[][]): boolean {
  let n = 0;
  for (const r of poly) if (inRing(px, pz, r)) n++;
  return n % 2 === 1;
}

export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

/** Inside the ring, or within `margin` metres of its edge. */
export function nearRing(px: number, pz: number, ring: Pt[], margin: number): boolean {
  if (inRing(px, pz, ring)) return true;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    if (Math.hypot(px - ax - t * dx, pz - az - t * dz) < margin) return true;
  }
  return false;
}
