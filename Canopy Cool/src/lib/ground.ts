import { gridFor, type ShadeResult } from './shade';
import type { Pt, Site } from './types';

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
  }
  return c;
}
