import { DEFAULT_BUILDING_HEIGHT, DEFAULT_LEVEL_HEIGHT, DEFAULT_TREE_HEIGHT } from './defaults';
import { inRing, ringArea } from './geo';
import type { Area, Building, Poly, Pt, Site, Tree } from './types';

/** NUS Kent Ridge layers bundled in public/data/nus.json (built by scripts/build-nus-data.mjs). */
export const NUS_LL = { lat: 1.2993, lng: 103.7751 };

type Profile = (number | null)[][]; // [air °C, RH %, wind m/s, radiation W/m²] x 24 hours
interface Station { id: string; x: number; z: number; type: string; year: Profile; hot: Profile; days: number; hotDays: number }
export interface NusData {
  buildings: { r: Pt[]; h: number; f: number; fb: number }[];
  trees: [number, number, number, number][]; // x, z, crown radius, LAI
  forest: { r: Poly; lai: number }[]; // dense canopy patches
  paved: Poly[]; turf: Poly[]; shrubs: Poly[]; roofGreen: Poly[]; pv: Poly[];
  stations: Station[];
}

let loading: Promise<NusData> | null = null;
export function loadNus(): Promise<NusData> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/nus.json`).then((r) => {
    if (!r.ok) throw new Error(`nus.json ${r.status}`);
    return r.json() as Promise<NusData>;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

/** Extent of the built campus (buildings and tree crowns), padded. */
export function campusBounds(d: NusData): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  const add = (x: number, z: number) => { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; };
  d.buildings.forEach((b) => b.r.forEach(([x, z]) => add(x, z)));
  d.trees.forEach(([x, z]) => add(x, z));
  return { x0: x0 - 40, z0: z0 - 40, x1: x1 + 40, z1: z1 + 40 };
}

const hits = (pts: Pt[], x0: number, z0: number, x1: number, z1: number) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const [x, z] of pts) { if (x < a) a = x; if (z < b) b = z; if (x > c) c = x; if (z > d) d = z; }
  return c >= x0 && a <= x1 && d >= z0 && b <= z1;
};
const MARGIN = 80; // buildings this far outside the area still cast shadows into it

/** The part of the campus inside `area`, re-centred so (0, 0) is the area centre. */
export function nusSite(d: NusData, { cx, cz, w, d: depth }: Area): Site {
  const win = [cx - w / 2, cz - depth / 2, cx + w / 2, cz + depth / 2] as const;
  const wide = [win[0] - MARGIN, win[1] - MARGIN, win[2] + MARGIN, win[3] + MARGIN] as const;
  const shift = (r: Pt[]): Pt[] => r.map(([x, z]) => [+(x - cx).toFixed(1), +(z - cz).toFixed(1)]);
  const polys = (all: Poly[]): Poly[] => all.filter((p) => hits(p[0], ...win)).map((p) => p.map(shift));

  const buildings: Building[] = [];
  d.buildings.forEach((b, i) => {
    if (!hits(b.r, ...wide)) return;
    const ring = shift(b.r);
    const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length, mz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const recorded = b.h > 0 || b.f > 0;
    buildings.push({
      id: i, ring, footprint: ringArea(ring), floors: b.f, floorsBelow: b.fb,
      height: b.h || (b.f ? b.f * DEFAULT_LEVEL_HEIGHT : DEFAULT_BUILDING_HEIGHT), heightRecorded: recorded,
      pvM2: 0, greenRoofM2: 0, outside: Math.abs(mx) > w / 2 || Math.abs(mz) > depth / 2,
    });
  });
  // rooftop PV / greenery polygons belong to the building that contains their centre
  const assign = (all: Poly[], key: 'pvM2' | 'greenRoofM2') => all.forEach((p) => {
    const o = shift(p[0]);
    const x = o.reduce((s, q) => s + q[0], 0) / o.length, z = o.reduce((s, q) => s + q[1], 0) / o.length;
    const host = buildings.find((b) => inRing(x, z, b.ring));
    if (host) host[key] += ringArea(o);
  });
  assign(d.pv, 'pvM2');
  assign(d.roofGreen, 'greenRoofM2');

  const trees: Tree[] = [];
  d.trees.forEach(([x, z, r], i) => {
    if (x < win[0] || x > win[2] || z < win[1] || z > win[3] || r < 0.5) return;
    trees.push({ id: `nus${i}`, x: x - cx, z: z - cz, radius: r, height: DEFAULT_TREE_HEIGHT, source: 'nus' });
  });
  return {
    w, d: depth, buildings, trees,
    paved: polys(d.paved), turf: polys(d.turf), shrubs: polys(d.shrubs), roofGreen: polys(d.roofGreen), pv: polys(d.pv),
    forest: polys(d.forest.map((f) => f.r)),
  };
}

export interface NusWeather { station: string; type: string; distanceM: number; year: number[]; hot: number[] }

/** Typical 2025 conditions at `hour` from the campus station nearest the area centre. */
export function nusWeather(d: NusData, area: Area, hour: number): NusWeather | null {
  let best: Station | null = null, bd = Infinity;
  for (const s of d.stations) { const dist = Math.hypot(s.x - area.cx, s.z - area.cz); if (dist < bd) { bd = dist; best = s; } }
  if (!best) return null;
  const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, f = hour - Math.floor(hour);
  const at = (p: Profile) => p.map((row) => { const a = row[h0], b = row[h1]; return a == null || b == null ? NaN : a + (b - a) * f; });
  return { station: best.id, type: best.type, distanceM: bd, year: at(best.year), hot: at(best.hot) };
}
