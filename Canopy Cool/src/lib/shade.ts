import { DEFAULT_TREE_HEIGHT } from './defaults';
import { shadowOffset } from './sun';
import type { Building, Poly, Pt, Site, Tree } from './types';

export const CELL = 2; // metres per analysis cell

export interface Grid { nx: number; nz: number; w: number; d: number }
export const gridFor = (s: { w: number; d: number }): Grid => ({ nx: Math.ceil(s.w / CELL), nz: Math.ceil(s.d / CELL), w: s.w, d: s.d });
const cellArea = (g: Grid) => (g.w / g.nx) * (g.d / g.nz);
const cx = (g: Grid, x: number) => ((x + g.w / 2) * g.nx) / g.w;
const cz = (g: Grid, z: number) => ((z + g.d / 2) * g.nz) / g.d;

function mkCanvas(g: Grid) {
  const c = document.createElement('canvas');
  c.width = g.nx; c.height = g.nz;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function path(ctx: CanvasRenderingContext2D, g: Grid, pts: Pt[]) {
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(cx(g, x), cz(g, z)) : ctx.moveTo(cx(g, x), cz(g, z))));
}

function fillPolys(ctx: CanvasRenderingContext2D, g: Grid, polys: Poly[], dx = 0, dz = 0) {
  for (const poly of polys) {
    ctx.beginPath();
    for (const r of poly) { path(ctx, g, r.map(([x, z]): Pt => [x + dx, z + dz])); ctx.closePath(); }
    ctx.fill('evenodd');
  }
}

function alphaMask(ctx: CanvasRenderingContext2D, g: Grid): Uint8Array {
  const d = ctx.getImageData(0, 0, g.nx, g.nz).data;
  const m = new Uint8Array(g.nx * g.nz);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/** Roads, pavements and streets (the paved realm we measure shade on). */
export function pavedMask(site: Site, g: Grid): Uint8Array {
  const ctx = mkCanvas(g);
  ctx.fillStyle = '#000';
  fillPolys(ctx, g, site.paved);
  return alphaMask(ctx, g);
}

export function buildingMask(buildings: Building[], g: Grid): Uint8Array {
  const ctx = mkCanvas(g);
  ctx.fillStyle = '#000';
  for (const b of buildings) { ctx.beginPath(); path(ctx, g, b.ring); ctx.fill(); }
  return alphaMask(ctx, g);
}

/** Building shadows: each footprint edge swept along the shadow vector. */
export function buildingShadow(buildings: Building[], g: Grid, alt: number, az: number): Uint8Array {
  const ctx = mkCanvas(g);
  ctx.fillStyle = '#000';
  if (alt > 0.02) {
    for (const b of buildings) {
      const [dx, dz] = shadowOffset(b.height, alt, az);
      for (let i = 0; i < b.ring.length - 1; i++) {
        const [ax, az0] = b.ring[i], [bx, bz] = b.ring[i + 1];
        ctx.beginPath();
        path(ctx, g, [[ax, az0], [bx, bz], [bx + dx, bz + dz], [ax + dx, az0 + dz]]);
        ctx.fill();
      }
    }
  }
  return alphaMask(ctx, g);
}

/** Canopy shade: crown discs and dense canopy patches, displaced by the shadow of the crown height. */
export function canopyShade(trees: Tree[], g: Grid, alt: number, az: number, forest: Poly[] = []): Uint8Array {
  const ctx = mkCanvas(g);
  ctx.fillStyle = '#000';
  if (alt > 0.02) {
    for (const t of trees) {
      const [dx, dz] = shadowOffset(t.height * 0.75, alt, az);
      ctx.beginPath();
      ctx.ellipse(cx(g, t.x + dx), cz(g, t.z + dz), (t.radius * g.nx) / g.w, (t.radius * g.nz) / g.d, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const [fx, fz] = shadowOffset(DEFAULT_TREE_HEIGHT * 0.75, alt, az);
    fillPolys(ctx, g, forest, fx, fz);
  }
  return alphaMask(ctx, g);
}

export interface ShadeResult {
  grid: Grid;
  pavedArea: number; // m²
  baselineFrac: number; // share of paved area shaded by buildings + existing trees
  scenarioFrac: number; // ... plus proposed trees
  newShadedM2: number; // paved area newly shaded by the proposals
  masks: { paved: Uint8Array; building: Uint8Array; bShade: Uint8Array; baseTree: Uint8Array; allTree: Uint8Array };
}

export function analyse(site: Site, trees: Tree[], alt: number, az: number): ShadeResult {
  const grid = gridFor(site);
  const paved = pavedMask(site, grid);
  const building = buildingMask(site.buildings, grid);
  const bShade = buildingShadow(site.buildings, grid, alt, az);
  const existing = trees.filter((t) => t.source !== 'proposed');
  const baseTree = canopyShade(existing, grid, alt, az, site.forest);
  const allTree = trees.length === existing.length ? baseTree : canopyShade(trees, grid, alt, az, site.forest);
  let cells = 0, b = 0, s = 0;
  for (let i = 0; i < paved.length; i++) {
    if (!paved[i] || building[i]) continue;
    cells++;
    if (bShade[i] || baseTree[i]) b++;
    if (bShade[i] || allTree[i]) s++;
  }
  const d = Math.max(cells, 1), a = cellArea(grid);
  return { grid, pavedArea: cells * a, baselineFrac: b / d, scenarioFrac: s / d, newShadedM2: (s - b) * a, masks: { paved, building, bShade, baseTree, allTree } };
}

/** Visit the grid cells under a crown whose shadow is displaced by the shadow of its centre height. */
function eachCell(g: Grid, x: number, z: number, radius: number, alt: number, az: number, f: (k: number) => void) {
  const [dx, dz] = shadowOffset(DEFAULT_TREE_HEIGHT * 0.75, alt, az);
  const px = cx(g, x + dx), pz = cz(g, z + dz), rx = (radius * g.nx) / g.w, rz = (radius * g.nz) / g.d;
  for (let j = Math.floor(pz - rz); j <= Math.ceil(pz + rz); j++) for (let i = Math.floor(px - rx); i <= Math.ceil(px + rx); i++) {
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
    if (((i + 0.5 - px) / rx) ** 2 + ((j + 0.5 - pz) / rz) ** 2 <= 1) f(j * g.nx + i);
  }
}

/** Paved area (m²) a tree at (x, z) would newly shade, given what is shaded now. */
export function shadeGain(res: ShadeResult, x: number, z: number, radius: number, alt: number, az: number, shaded?: Uint8Array): number {
  const { paved, building, bShade, allTree } = res.masks;
  let c = 0;
  eachCell(res.grid, x, z, radius, alt, az, (k) => { if (paved[k] && !building[k] && !(shaded ? shaded[k] : bShade[k] || allTree[k])) c++; });
  return c * cellArea(res.grid);
}

export interface Spot { x: number; z: number; gainM2: number }

/**
 * Greedy tree siting: candidates are open ground within ~6 m of paved cells (off the pavement, outside buildings).
 * Each pick maximises the paved, currently unshaded area its crown newly covers.
 */
export function recommend(site: Site, trees: Tree[], res: ShadeResult, count: number, radius: number, alt: number, az: number): Spot[] {
  const g = res.grid, { paved, building, bShade, allTree } = res.masks;
  const shaded = new Uint8Array(paved.length);
  for (let i = 0; i < shaded.length; i++) shaded[i] = bShade[i] || allTree[i] ? 1 : 0;

  const cands: Pt[] = [];
  for (let j = 3; j < g.nz - 3; j += 3) for (let i = 3; i < g.nx - 3; i += 3) {
    const k = j * g.nx + i;
    if (paved[k] || building[k]) continue;
    let near = false;
    for (let b = -3; b <= 3 && !near; b++) for (let a = -3; a <= 3; a++) if (paved[(j + b) * g.nx + i + a]) { near = true; break; }
    if (near) cands.push([((i + 0.5) * g.w) / g.nx - g.w / 2, ((j + 0.5) * g.d) / g.nz - g.d / 2]);
  }
  const taken = trees.map((t): Pt => [t.x, t.z]);
  const spots: Spot[] = [];
  for (let n = 0; n < count; n++) {
    let best: Spot | null = null;
    for (const [x, z] of cands) {
      if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < radius * 1.6)) continue;
      const gain = shadeGain(res, x, z, radius, alt, az, shaded);
      if (!best || gain > best.gainM2) best = { x, z, gainM2: gain };
    }
    if (!best || best.gainM2 <= 0) break;
    spots.push(best); taken.push([best.x, best.z]);
    eachCell(g, best.x, best.z, radius, alt, az, (k) => { shaded[k] = 1; });
  }
  return spots;
}
