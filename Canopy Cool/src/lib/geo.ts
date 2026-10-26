import type { Pt } from './types';

const R = 6371008.8;
const RAD = Math.PI / 180;

export function toLocal(lat0: number, lng0: number, lat: number, lng: number): Pt {
  return [(lng - lng0) * RAD * R * Math.cos(lat0 * RAD), -(lat - lat0) * RAD * R];
}

export function bbox(lat: number, lng: number, half: number): [number, number, number, number] {
  const dLat = half / (RAD * R);
  const dLng = half / (RAD * R * Math.cos(lat * RAD));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

export function distToPolyline(px: number, pz: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return best;
}

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
