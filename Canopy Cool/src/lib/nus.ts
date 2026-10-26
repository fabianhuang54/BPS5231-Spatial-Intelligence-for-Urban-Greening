import { DEFAULT_BUILDING_HEIGHT, DEFAULT_LEVEL_HEIGHT, DEFAULT_TREE_HEIGHT } from './osm';
import type { Building, Poly, Pt, Site, Tree } from './types';

/** NUS Kent Ridge layers bundled in public/data/nus.json (built by scripts/build-nus-data.mjs). */
export const NUS_LL = { lat: 1.2993, lng: 103.7751 };

type Profile = (number | null)[][]; // [air °C, RH %, wind m/s, radiation W/m²] x 24 hours
interface Station { id: string; x: number; z: number; elev: number; type: string; year: Profile; hot: Profile; days: number; hotDays: number }
export interface NusData {
  source: string;
  buildings: { r: Pt[]; h: number; f: number }[];
  trees: [number, number, number, number][]; // x, z, crown radius, LAI
  forest: { r: Poly; lai: number }[];
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

const hits = (pts: Pt[], x0: number, z0: number, x1: number, z1: number) => {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const [x, z] of pts) { if (x < a) a = x; if (z < b) b = z; if (x > c) c = x; if (z > d) d = z; }
  return c >= x0 && a <= x1 && d >= z0 && b <= z1;
};
const MARGIN = 80; // buildings this far outside the window still cast shadows into it

/** A square window of the campus, re-centred so (0, 0) is the window centre. */
export function nusSite(d: NusData, cx: number, cz: number, half: number): Site {
  const w = [cx - half, cz - half, cx + half, cz + half] as const;
  const m = [w[0] - MARGIN, w[1] - MARGIN, w[2] + MARGIN, w[3] + MARGIN] as const;
  const shift = (r: Pt[]): Pt[] => r.map(([x, z]) => [+(x - cx).toFixed(1), +(z - cz).toFixed(1)]);
  const polys = (all: Poly[]): Poly[] => all.filter((p) => hits(p[0], ...w)).map((p) => p.map(shift));

  const buildings: Building[] = [];
  d.buildings.forEach((b, i) => {
    if (!hits(b.r, ...m)) return;
    const ring = shift(b.r);
    const mx = ring.reduce((s, p) => s + p[0], 0) / ring.length, mz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const height = b.h || (b.f ? b.f * DEFAULT_LEVEL_HEIGHT : DEFAULT_BUILDING_HEIGHT);
    buildings.push({ id: i, name: null, ring, height, heightTagged: b.h > 0 || b.f > 0, outside: Math.abs(mx) > half || Math.abs(mz) > half });
  });
  const trees: Tree[] = [];
  d.trees.forEach(([x, z, r], i) => {
    if (x < w[0] || x > w[2] || z < w[1] || z > w[3] || r < 0.5) return;
    trees.push({ id: `nus${i}`, x: x - cx, z: z - cz, radius: r, height: DEFAULT_TREE_HEIGHT, source: 'nus' });
  });
  return {
    lat: NUS_LL.lat, lng: NUS_LL.lng, half, roads: [], walkways: [], buildings, trees,
    paved: polys(d.paved), turf: polys(d.turf), shrubs: polys(d.shrubs), roofGreen: polys(d.roofGreen), pv: polys(d.pv),
    forest: polys(d.forest.map((f) => f.r)),
  };
}

export interface NusWeather { station: string; type: string; distanceM: number; days: number; hotDays: number; year: number[]; hot: number[] }

/** Typical 2025 conditions at `hour` from the campus station nearest the window centre. */
export function nusWeather(d: NusData, cx: number, cz: number, hour: number): NusWeather | null {
  let best: Station | null = null, bd = Infinity;
  for (const s of d.stations) { const dist = Math.hypot(s.x - cx, s.z - cz); if (dist < bd) { bd = dist; best = s; } }
  if (!best) return null;
  const h0 = Math.floor(hour) % 24, h1 = (h0 + 1) % 24, f = hour - Math.floor(hour);
  const at = (p: Profile) => p.map((row) => { const a = row[h0], b = row[h1]; return a == null || b == null ? NaN : a + (b - a) * f; });
  return { station: best.id, type: best.type, distanceM: bd, days: best.days, hotDays: best.hotDays, year: at(best.year), hot: at(best.hot) };
}
