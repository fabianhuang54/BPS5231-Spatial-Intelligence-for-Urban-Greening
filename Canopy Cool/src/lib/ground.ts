import { gridFor, type ShadeResult } from './shade';
import type { Poly, Pt, Site } from './types';

/** Fill polygons (with holes) using any local-metre -> pixel mapping. */
export function fillPolys(ctx: CanvasRenderingContext2D, polys: Poly[], P: (p: Pt) => Pt, color: string) {
  ctx.fillStyle = color;
  for (const poly of polys) {
    ctx.beginPath();
    for (const r of poly) { r.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    ctx.fill('evenodd');
  }
}

export const AREA_COLORS = { turf: '#14301f', shrubs: '#175c33', forest: '#0f4429', paved: '#252f3b', roofGreen: '#3f8f4f', pv: '#1d4ed8' };

/** Rasterised shade overlay: unshaded paved cells warm, shaded cool, building shadow dark. */
export function buildOverlay(site: Site, res: ShadeResult): HTMLCanvasElement {
  const g = gridFor(site.half);
  const c = document.createElement('canvas');
  c.width = c.height = g.n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.n, g.n);
  const { paved, building, bShade, allTree } = res.masks;
  for (let i = 0; i < paved.length; i++) {
    const shaded = bShade[i] || allTree[i];
    let rgba: number[] | null = null;
    if (paved[i] && !building[i]) rgba = shaded ? [45, 212, 191, 150] : [249, 115, 22, 120];
    else if (bShade[i] && !building[i]) rgba = [0, 0, 0, 80];
    else if (allTree[i] && !building[i]) rgba = [34, 197, 94, 60];
    if (rgba) img.data.set(rgba, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Top-down picture of roads, footpaths and the shade overlay (no buildings). Used as the 3D ground and the minimap. */
export function drawGround(site: Site, overlay: HTMLCanvasElement, px: number, withBuildings = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const s = px / (2 * site.half);
  const P = ([x, z]: Pt): Pt => [(x + site.half) * s, (z + site.half) * s];
  ctx.fillStyle = '#0b1117';
  ctx.fillRect(0, 0, px, px);
  const stroke = (pts: Pt[], w: number, color: string) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(w * s, 1); ctx.lineJoin = 'round'; ctx.stroke();
  };
  fillPolys(ctx, site.turf, P, AREA_COLORS.turf); fillPolys(ctx, site.shrubs, P, AREA_COLORS.shrubs); fillPolys(ctx, site.forest, P, AREA_COLORS.forest);
  fillPolys(ctx, site.paved, P, AREA_COLORS.paved);
  site.roads.forEach((l) => stroke(l.points, l.width, '#252f3b'));
  site.walkways.forEach((l) => stroke(l.points, l.width, l.covered ? '#8a99ab' : '#4b5a6b'));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overlay, 0, 0, px, px);
  if (withBuildings) {
    ctx.fillStyle = '#6b7a8d';
    for (const b of site.buildings) {
      ctx.beginPath();
      b.ring.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.fill();
    }
    fillPolys(ctx, site.roofGreen, P, AREA_COLORS.roofGreen); fillPolys(ctx, site.pv, P, AREA_COLORS.pv);
  }
  return c;
}
