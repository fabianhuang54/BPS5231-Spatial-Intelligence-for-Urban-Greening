import { paintBuildingShadow, paintCanopyShade, type Grid } from './shade';
import type { Poly, Pt, Site, Tree } from './types';

export const AREA_COLORS = { turf: '#14301f', shrubs: '#175c33', forest: '#0f4429', paved: '#46566a', roads: '#1c242e', roofGreen: '#3f8f4f', pv: '#1d4ed8', building: '#6b7a8d' };

/** Fill polygons (with holes) using any campus-metre -> pixel mapping. */
export function fillPolys(ctx: CanvasRenderingContext2D, polys: Poly[], P: (p: Pt) => Pt, color: string) {
  ctx.fillStyle = color;
  for (const poly of polys) {
    ctx.beginPath();
    for (const r of poly) { r.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    ctx.fill('evenodd');
  }
}

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Pixel size for the ground picture: about 0.25 m per pixel, within what a GPU texture handles comfortably. */
export const groundWidth = (siteW: number) => Math.min(4096, Math.max(1024, Math.round(siteW / 0.25)));

/**
 * Top-down picture of the ground for the 3D view, drawn from the vector layers at full resolution so edges stay sharp when zoomed:
 * green areas, pavement and roads, then shade. Paving is tinted warm where sunlit and cool where shaded (same shapes as the analysis);
 * shade on grass and planting beds is a plain darkening.
 */
export function drawGround(site: Site, trees: Tree[], alt: number, az: number, W: number): HTMLCanvasElement {
  const H = Math.round((W * site.d) / site.w);
  const g: Grid = { nx: W, nz: H, w: site.w, d: site.d };
  const P = ([x, z]: Pt): Pt => [((x + site.w / 2) * W) / site.w, ((z + site.d / 2) * H) / site.d];
  const out = canvas(W, H);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#0e151c';
  ctx.fillRect(0, 0, W, H);
  fillPolys(ctx, site.turf, P, AREA_COLORS.turf);
  fillPolys(ctx, site.shrubs, P, AREA_COLORS.shrubs);
  fillPolys(ctx, site.forest, P, AREA_COLORS.forest);
  fillPolys(ctx, site.paved, P, AREA_COLORS.paved);
  fillPolys(ctx, site.roads, P, AREA_COLORS.roads);

  // all shadows, as one opaque shape set
  const shadow = canvas(W, H), sctx = shadow.getContext('2d')!;
  sctx.fillStyle = '#000';
  paintBuildingShadow(sctx, g, site.buildings, alt, az);
  paintCanopyShade(sctx, g, trees, alt, az, site.forest);

  // paved area only, as a mask
  const paved = canvas(W, H), pctx = paved.getContext('2d')!;
  fillPolys(pctx, site.paved, P, '#000');

  // shade everywhere: a soft darkening
  ctx.globalAlpha = 0.32; ctx.drawImage(shadow, 0, 0); ctx.globalAlpha = 1;

  // paving: sunlit tint, then the shaded part in teal
  const sun = canvas(W, H), uctx = sun.getContext('2d')!;
  uctx.drawImage(paved, 0, 0); uctx.globalCompositeOperation = 'source-in'; uctx.fillStyle = 'rgba(249,115,22,0.42)'; uctx.fillRect(0, 0, W, H);
  const shade = canvas(W, H), hctx = shade.getContext('2d')!;
  hctx.drawImage(shadow, 0, 0); hctx.globalCompositeOperation = 'destination-in'; hctx.drawImage(paved, 0, 0);
  hctx.globalCompositeOperation = 'source-in'; hctx.fillStyle = 'rgba(45,212,191,0.75)'; hctx.fillRect(0, 0, W, H);
  ctx.drawImage(sun, 0, 0); ctx.drawImage(shade, 0, 0);

  // crisp edges on paving and roads
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, (0.3 * W) / site.w); ctx.strokeStyle = 'rgba(11,17,23,0.55)';
  for (const poly of [...site.paved, ...site.roads]) {
    ctx.beginPath();
    for (const r of poly) { r.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    ctx.stroke();
  }
  return out;
}
