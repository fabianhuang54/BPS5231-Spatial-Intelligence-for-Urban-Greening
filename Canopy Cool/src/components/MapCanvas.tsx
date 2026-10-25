import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { distToPolyline, inRing } from '../lib/geo';
import { buildOverlay } from '../lib/ground';
import type { ShadeResult } from '../lib/shade';
import type { Pt, Site, Tree } from '../lib/types';

export type Hit =
  | { kind: 'tree'; tree: Tree }
  | { kind: 'building'; id: number; label: string }
  | { kind: 'road' | 'walkway'; label: string }
  | null;

interface Props {
  site: Site;
  trees: Tree[];
  res: ShadeResult;
  greenRoofs: Set<number>;
  suggestions: Pt[];
  onClick: (x: number, z: number, hit: Hit) => void;
  onHover: (hit: Hit) => void;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  onAspect: (a: number) => void;
}

export interface View { k: number; x: number; z: number } // zoom factor and pan centre in metres

export function hitTest(site: Site, trees: Tree[], x: number, z: number): Hit {
  for (const t of trees) if (Math.hypot(t.x - x, t.z - z) <= Math.max(t.radius * 0.6, 1.5)) return { kind: 'tree', tree: t };
  for (const b of site.buildings) if (inRing(x, z, b.ring)) return { kind: 'building', id: b.id, label: `${b.name ?? 'Building'} · ${b.height.toFixed(0)} m${b.heightTagged ? '' : ' (assumed)'}` };
  for (const l of site.walkways) if (distToPolyline(x, z, l.points) <= l.width / 2 + 0.5) return { kind: 'walkway', label: `${l.name ?? 'Footpath'} · ${l.kind}${l.covered ? ' · covered' : ''}` };
  for (const l of site.roads) if (distToPolyline(x, z, l.points) <= l.width / 2) return { kind: 'road', label: `${l.name ?? 'Unnamed road'} · ${l.kind} · ${l.width.toFixed(1)} m wide` };
  return null;
}

export function MapCanvas({ site, trees, res, greenRoofs, suggestions, onClick, onHover, view, setView, onAspect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const overlay = useMemo(() => buildOverlay(site, res), [site, res]);

  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => { setSize({ w: el.clientWidth, h: el.clientHeight }); onAspect(el.clientWidth / el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = (Math.min(size.w, size.h) / (2 * site.half)) * view.k;
  const toScreen = (x: number, z: number): Pt => [size.w / 2 + (x - view.x) * scale, size.h / 2 + (z - view.z) * scale];
  const toWorld = (sx: number, sy: number): Pt => [(sx - size.w / 2) / scale + view.x, (sy - size.h / 2) / scale + view.z];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b1117';
    ctx.fillRect(0, 0, size.w, size.h);

    const stroke = (pts: Pt[], w: number, color: string, dash: number[] = []) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const [sx, sy] = toScreen(x, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(w * scale, 1); ctx.lineJoin = 'round'; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    // site boundary
    const [x0, y0] = toScreen(-site.half, -site.half);
    ctx.strokeStyle = '#1f2a37'; ctx.strokeRect(x0, y0, 2 * site.half * scale, 2 * site.half * scale);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, 2 * site.half * scale, 2 * site.half * scale); ctx.clip();

    site.roads.forEach((l) => stroke(l.points, l.width, '#252f3b'));
    site.walkways.forEach((l) => stroke(l.points, l.width, l.covered ? '#8a99ab' : '#4b5a6b'));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(overlay, x0, y0, 2 * site.half * scale, 2 * site.half * scale);

    for (const b of site.buildings) {
      ctx.beginPath();
      b.ring.forEach(([x, z], i) => { const [sx, sy] = toScreen(x, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.closePath();
      const green = greenRoofs.has(b.id);
      ctx.fillStyle = green ? '#3f8f4f' : b.heightTagged ? '#6b7a8d' : '#4c5868';
      ctx.fill();
      ctx.strokeStyle = '#0b1117'; ctx.lineWidth = 1; ctx.stroke();
    }
    for (const t of trees) {
      const [sx, sy] = toScreen(t.x, t.z);
      const r = t.radius * scale;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = t.source === 'proposed' ? 'rgba(74,222,128,.55)' : t.source === 'nparks' ? 'rgba(250,204,21,.35)' : 'rgba(34,197,94,.30)';
      ctx.fill();
      ctx.strokeStyle = t.source === 'proposed' ? '#4ade80' : t.source === 'nparks' ? '#facc15' : '#22c55e';
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.setLineDash([4, 3]); ctx.strokeStyle = '#e2e8f0';
    for (const [x, z] of suggestions) { const [sx, sy] = toScreen(x, z); ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.restore();
  });

  const rel = (e: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); };

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Plan view of the site. Use the Suggest button in the side panel to add trees without the mouse."
      style={{ width: size.w, height: size.h, cursor: 'crosshair', touchAction: 'none' }}
      onWheel={(e) => setView((v) => ({ ...v, k: Math.min(8, Math.max(0.6, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) }))}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && e.buttons) {
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) { setView((v) => ({ ...v, x: v.x - dx / scale, z: v.z - dy / scale })); d.x = e.clientX; d.y = e.clientY; }
          return;
        }
        const [x, z] = rel(e);
        onHover(hitTest(site, trees, x, z));
      }}
      onPointerUp={(e) => {
        const d = drag.current; drag.current = null;
        if (d?.moved) return;
        const [x, z] = rel(e);
        onClick(x, z, hitTest(site, trees, x, z));
      }}
    />
  );
}
