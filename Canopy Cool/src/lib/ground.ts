import type { ShadeResult } from './shade';
import type { Poly, Pt, Site } from './types';

export const AREA_COLORS = { turf: '#14301f', shrubs: '#175c33', forest: '#0f4429', paved: '#2b3644', roofGreen: '#3f8f4f', pv: '#1d4ed8', building: '#6b7a8d' };

/** Fill polygons (with holes) using any campus-metre -> pixel mapping. */
export function fillPolys(ctx: CanvasRenderingContext2D, polys: Poly[], P: (p: Pt) => Pt, color: string) {
  ctx.fillStyle = color;
  for (const poly of polys) {
    ctx.beginPath();
    for (const r of poly) { r.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    ctx.fill('evenodd');
  }
}

/** One pixel per analysis cell: unshaded paving warm, shaded paving cool, building shadow dark. */
export function buildOverlay(res: ShadeResult): HTMLCanvasElement {
  const { nx, nz } = res.grid;
  const c = document.createElement('canvas');
  c.width = nx; c.height = nz;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(nx, nz);
  const { paved, building, bShade, allTree } = res.masks;
  for (let i = 0; i < paved.length; i++) {
    const shaded = bShade[i] || allTree[i];
    let rgba: number[] | null = null;
    if (paved[i] && !building[i]) rgba = shaded ? [45, 212, 191, 170] : [249, 115, 22, 150];
    else if (bShade[i] && !building[i]) rgba = [0, 0, 0, 90];
    else if (allTree[i] && !building[i]) rgba = [34, 197, 94, 50];
    if (rgba) img.data.set(rgba, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Top-down picture of the ground (green areas, paving and the shade overlay), used as the 3D ground texture. */
export function drawGround(site: Site, overlay: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const w = px, h = Math.round((px * site.d) / site.w);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const P = ([x, z]: Pt): Pt => [((x + site.w / 2) * w) / site.w, ((z + site.d / 2) * h) / site.d];
  ctx.fillStyle = '#0e151c';
  ctx.fillRect(0, 0, w, h);
  fillPolys(ctx, site.turf, P, AREA_COLORS.turf);
  fillPolys(ctx, site.shrubs, P, AREA_COLORS.shrubs);
  fillPolys(ctx, site.forest, P, AREA_COLORS.forest);
  fillPolys(ctx, site.paved, P, AREA_COLORS.paved);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overlay, 0, 0, w, h);
  return c;
}
