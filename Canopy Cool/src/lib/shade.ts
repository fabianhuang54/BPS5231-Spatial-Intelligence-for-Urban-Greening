import { ringArea } from './geo';
import { DEFAULT_TREE_HEIGHT } from './osm';
import { shadowOffset } from './sun';
import type { Building, Poly, Pt, Site, Tree } from './types';

export const CELL = 2; // metres per analysis cell

export interface Grid { n: number; half: number }
export const gridFor = (half: number): Grid => ({ n: Math.ceil((2 * half) / CELL), half });

function mkCanvas(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

const toCell = (g: Grid, v: number) => (v + g.half) / CELL;

function path(ctx: CanvasRenderingContext2D, g: Grid, pts: Pt[]) {
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(toCell(g, x), toCell(g, z)) : ctx.moveTo(toCell(g, x), toCell(g, z))));
}

function fillPolys(ctx: CanvasRenderingContext2D, g: Grid, polys: Poly[], dx = 0, dz = 0) {
  for (const poly of polys) {
    ctx.beginPath();
    for (const r of poly) { r.forEach(([x, z], i) => (i ? ctx.lineTo(toCell(g, x + dx), toCell(g, z + dz)) : ctx.moveTo(toCell(g, x + dx), toCell(g, z + dz)))); ctx.closePath(); }
    ctx.fill('evenodd');
  }
}

function alphaMask(ctx: CanvasRenderingContext2D, n: number): Uint8Array {
  const d = ctx.getImageData(0, 0, n, n).data;
  const m = new Uint8Array(n * n);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

/** Cells covered by roads and footpaths (the paved street realm we measure shade on). */
export function pavedMask(site: Site, g: Grid): Uint8Array {
  const ctx = mkCanvas(g.n);
  ctx.fillStyle = ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round';
  fillPolys(ctx, g, site.paved);
  for (const l of [...site.roads, ...site.walkways]) {
    ctx.lineWidth = l.width / CELL;
    ctx.beginPath(); path(ctx, g, l.points); ctx.stroke();
  }
  return alphaMask(ctx, g.n);
}

export function buildingMask(buildings: Building[], g: Grid): Uint8Array {
  const ctx = mkCanvas(g.n);
  ctx.fillStyle = '#000';
  for (const b of buildings) { ctx.beginPath(); path(ctx, g, b.ring); ctx.fill(); }
  return alphaMask(ctx, g.n);
}

/** Building shadows: each footprint edge swept along the shadow vector. */
export function buildingShadow(buildings: Building[], g: Grid, alt: number, az: number): Uint8Array {
  const ctx = mkCanvas(g.n);
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
  return alphaMask(ctx, g.n);
}

/** Canopy shade: crown disc displaced by the shadow of the crown centre height. Overhead sun when alt ≈ 90°. */
export function canopyShade(trees: Tree[], g: Grid, alt: number, az: number, forest: Poly[] = []): Uint8Array {
  const ctx = mkCanvas(g.n);
  ctx.fillStyle = '#000';
  if (alt > 0.02) {
    for (const t of trees) {
      const [dx, dz] = shadowOffset(t.height * 0.75, alt, az);
      ctx.beginPath();
      ctx.arc(toCell(g, t.x + dx), toCell(g, t.z + dz), t.radius / CELL, 0, Math.PI * 2);
      ctx.fill();
    }
    const [fx, fz] = shadowOffset(DEFAULT_TREE_HEIGHT * 0.75, alt, az);
    fillPolys(ctx, g, forest, fx, fz);
  }
  return alphaMask(ctx, g.n);
}

export interface ShadeResult {
  pavedCells: number;
  baselineShaded: number; // paved cells shaded by buildings + existing trees
  scenarioShaded: number; // ... plus proposed trees
  pavedArea: number; // m²
  baselineFrac: number;
  scenarioFrac: number;
  masks: { paved: Uint8Array; building: Uint8Array; bShade: Uint8Array; baseTree: Uint8Array; allTree: Uint8Array };
}

export function analyse(site: Site, trees: Tree[], alt: number, az: number): ShadeResult {
  const g = gridFor(site.half);
  const paved = pavedMask(site, g);
  const building = buildingMask(site.buildings, g);
  const bShade = buildingShadow(site.buildings, g, alt, az);
  const existing = trees.filter((t) => t.source !== 'proposed');
  const baseTree = canopyShade(existing, g, alt, az, site.forest);
  const allTree = trees.length === existing.length ? baseTree : canopyShade(trees, g, alt, az, site.forest);
  let pavedCells = 0, b = 0, s = 0;
  for (let i = 0; i < paved.length; i++) {
    if (!paved[i] || building[i]) continue;
    pavedCells++;
    if (bShade[i] || baseTree[i]) b++;
    if (bShade[i] || allTree[i]) s++;
  }
  const d = Math.max(pavedCells, 1);
  return { pavedCells, baselineShaded: b, scenarioShaded: s, pavedArea: pavedCells * CELL * CELL, baselineFrac: b / d, scenarioFrac: s / d, masks: { paved, building, bShade, baseTree, allTree } };
}

/**
 * Greedy tree siting: candidate spots sit beside footpaths and roads, off the pavement and out of buildings.
 * Each pick maximises the paved, currently unshaded cells newly covered by its crown.
 */
export function recommend(site: Site, trees: Tree[], res: ShadeResult, count: number, radius: number, alt: number, az: number): Pt[] {
  const g = gridFor(site.half);
  const { paved, building, bShade, allTree } = res.masks;
  const shaded = new Uint8Array(paved.length);
  for (let i = 0; i < shaded.length; i++) shaded[i] = bShade[i] || allTree[i] ? 1 : 0;

  const lines = [...site.walkways, ...site.roads];
  const cands: Pt[] = [];
  for (const l of lines) {
    const off = l.width / 2 + 1.5;
    for (let i = 0; i < l.points.length - 1; i++) {
      const [ax, az0] = l.points[i], [bx, bz] = l.points[i + 1];
      const len = Math.hypot(bx - ax, bz - az0);
      if (len < 1) continue;
      const nx = -(bz - az0) / len, nz = (bx - ax) / len;
      for (let d = 0; d <= len; d += 6) {
        const x = ax + ((bx - ax) * d) / len, z = az0 + ((bz - az0) * d) / len;
        for (const s of [-1, 1]) cands.push([x + nx * off * s, z + nz * off * s]);
      }
    }
  }
  // Area-based sites (NUS polygons) have no centrelines: also try open ground within ~6 m of paved cells.
  for (let cz = 2; cz < g.n - 2; cz += 4) for (let cx = 2; cx < g.n - 2; cx += 4) {
    const k = cz * g.n + cx;
    if (paved[k] || building[k]) continue;
    let near = false;
    for (let j = -3; j <= 3 && !near; j++) for (let i = -3; i <= 3; i++) if (paved[(cz + j) * g.n + cx + i]) { near = true; break; }
    if (near) cands.push([(cx + 0.5) * CELL - g.half, (cz + 0.5) * CELL - g.half]);
  }
  const cellAt = (x: number, z: number) => {
    const cx = Math.floor((x + g.half) / CELL), cz = Math.floor((z + g.half) / CELL);
    return cx < 0 || cz < 0 || cx >= g.n || cz >= g.n ? -1 : cz * g.n + cx;
  };
  const [dx, dz] = shadowOffset(DEFAULT_TREE_HEIGHT * 0.75, alt, az);
  const gain = (x: number, z: number) => {
    let c = 0;
    const r = Math.ceil(radius / CELL);
    const cx0 = Math.floor((x + dx + g.half) / CELL), cz0 = Math.floor((z + dz + g.half) / CELL);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (i * i + j * j > (radius / CELL) ** 2) continue;
      const cx = cx0 + i, cz = cz0 + j;
      if (cx < 0 || cz < 0 || cx >= g.n || cz >= g.n) continue;
      const k = cz * g.n + cx;
      if (paved[k] && !building[k] && !shaded[k]) c++;
    }
    return { c, cx0, cz0, r };
  };
  const placed: Pt[] = [];
  const taken = [...trees.map((t): Pt => [t.x, t.z])];
  const ok = (x: number, z: number) => {
    const k = cellAt(x, z);
    return k >= 0 && !building[k] && !paved[k] && !taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < radius * 1.6);
  };
  for (let n = 0; n < count; n++) {
    let best: { p: Pt; c: number; cx0: number; cz0: number; r: number } | null = null;
    for (const p of cands) {
      if (!ok(p[0], p[1])) continue;
      const g2 = gain(p[0], p[1]);
      if (!best || g2.c > best.c) best = { p, ...g2 };
    }
    if (!best || best.c === 0) break;
    placed.push(best.p); taken.push(best.p);
    for (let j = -best.r; j <= best.r; j++) for (let i = -best.r; i <= best.r; i++) {
      if (i * i + j * j > (radius / CELL) ** 2) continue;
      const cx = best.cx0 + i, cz = best.cz0 + j;
      if (cx >= 0 && cz >= 0 && cx < g.n && cz < g.n) shaded[cz * g.n + cx] = 1;
    }
  }
  return placed;
}

export const roofArea = (b: Building) => ringArea(b.ring);
