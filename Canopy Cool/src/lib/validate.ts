import { inPoly, nearRing } from './geo';
import { plantingBlock } from './planting';
import type { ShadeResult } from './shade';
import type { Pt, Poly, Site, Tree } from './types';

export interface Check { name: string; pass: boolean; detail: string }

const NEAR_BUILDING = 1.5; // must match the generator in scripts/build-nus-data.mjs
const box = (rings: Pt[][]) => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of rings.flat()) { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; }
  return { x0, z0, x1, z1 };
};
const within = (b: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, m = 0) => x >= b.x0 - m && x <= b.x1 + m && z >= b.z0 - m && z <= b.z1 + m;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// seeded, so a check gives the same answer every time
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Share of random points inside `polys` (an exact vector test), to compare with the raster the analysis uses. */
function vectorShare(polys: Poly[], w: number, d: number, n: number): { share: number; hit: (x: number, z: number) => boolean } {
  const boxes = polys.map((p) => box(p));
  const hit = (x: number, z: number) => polys.some((p, i) => within(boxes[i], x, z) && inPoly(x, z, p));
  const r = rng(7);
  let k = 0;
  for (let i = 0; i < n; i++) if (hit((r() - 0.5) * w, (r() - 0.5) * d)) k++;
  return { share: k / n, hit };
}

/** Share of the same random points that the analysis grid marks as covered. */
function gridShare(mask: Uint8Array, g: ShadeResult['grid'], n: number): number {
  const r = rng(7);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * g.w, z = (r() - 0.5) * g.d;
    const cx = Math.floor(((x + g.w / 2) * g.nx) / g.w), cz = Math.floor(((z + g.d / 2) * g.nz) / g.d);
    if (cx >= 0 && cz >= 0 && cx < g.nx && cz < g.nz && mask[cz * g.nx + cx]) k++;
  }
  return k / n;
}

/**
 * Checks on the area itself: generated trees sit inside the canopy outlines and off buildings, and the raster used for the
 * shade analysis agrees with the vector layers. Pure functions of the data, so tests run them on the real campus file.
 */
export function validateArea(site: Site, res?: ShadeResult | null): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const hw = site.w / 2, hd = site.d / 2;

  const stray = site.trees.filter((t) => Math.abs(t.x) > hw || Math.abs(t.z) > hd).length;
  add('Mapped trees are inside the selected area', stray === 0, `${site.trees.length} trees, ${stray} outside`);

  const patches = site.forest.map((p) => ({ p, b: box(p) }));
  const offPatch = site.generated.filter((g) => !patches.some(({ p, b }) => within(b, g.x, g.z) && inPoly(g.x, g.z, p))).length;
  add('Generated trees are inside a canopy or forest outline', offPatch === 0, `${site.generated.length} trees, ${offPatch} outside`);

  const blds = site.buildings.map((b) => ({ ring: b.ring, bx: box([b.ring]) }));
  const onBuilding = site.generated.filter((g) => blds.some(({ ring, bx }) => within(bx, g.x, g.z, NEAR_BUILDING) && nearRing(g.x, g.z, ring, NEAR_BUILDING))).length;
  add('Generated trees keep 1.5 m clear of buildings', onBuilding === 0, `${onBuilding} too close`);

  const badHeight = site.buildings.filter((b) => !(b.height > 0 && b.height <= 120) || !(b.footprint > 0)).length;
  add('Building heights and footprints are plausible', badHeight === 0, `${site.buildings.length} buildings, ${badHeight} implausible`);

  if (res) {
    const N = 4000;
    const pv = vectorShare(site.paved, site.w, site.d, N), pg = gridShare(res.masks.paved, res.grid, N);
    add('Paving: analysis grid matches the layer', Math.abs(pv.share - pg) <= 0.02, `layer ${pct(pv.share)}, grid ${pct(pg)}`);
    const bv = vectorShare(site.buildings.map((b) => [b.ring]), site.w, site.d, N), bg = gridShare(res.masks.building, res.grid, N);
    add('Buildings: analysis grid matches the layer', Math.abs(bv.share - bg) <= 0.02, `layer ${pct(bv.share)}, grid ${pct(bg)}`);
  }
  return checks;
}

/** Checks on your plan: planted trees and green roofs respect the layers, and planting never reduces shade. Cheap enough to run on every change. */
export function validatePlan(site: Site, trees: Tree[], greenRoofIds: Set<number>, res?: ShadeResult | null): Check[] {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const planted = trees.filter((t) => t.source === 'proposed');
  const blocked = planted.filter((t) => plantingBlock(site, [], t.x, t.z)).length;
  add('Planted trees are off buildings and paving, inside the area', blocked === 0, `${planted.length} planted, ${blocked} on a building, paving or outside`);
  const ids = new Set(site.buildings.filter((b) => !b.outside).map((b) => b.id));
  const missing = [...greenRoofIds].filter((id) => !ids.has(id)).length;
  add('Green roofs are on buildings inside the area', missing === 0, `${greenRoofIds.size} green roofs, ${missing} not found`);
  if (res) add('Planting never reduces shade', res.scenarioFrac >= res.baselineFrac - 1e-9, `${pct(res.baselineFrac)} → ${pct(res.scenarioFrac)}`);
  return checks;
}
