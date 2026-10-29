import { useEffect, useMemo, useRef, useState } from 'react';
import { AREA_COLORS, fillPolys } from '../lib/ground';
import { campusBounds, type NusData } from '../lib/nus';
import type { Area, Pt } from '../lib/types';

export const MIN_SIDE = 80, MAX_SIDE = 600; // metres; keeps the 3D scene and shade analysis quick
const CLICK_SIDE = 300; // a plain click selects a square of this size

interface Props { data: NusData; onSelect: (a: Area) => void }

/** The whole campus, drawn once. Drag a rectangle (or click) to pick an area to explore in 3D. */
export function CampusMap({ data, onSelect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const bounds = useMemo(() => campusBounds(data), [data]);

  useEffect(() => {
    const el = ref.current!.parentElement!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const pad = 24;
  const bw = bounds.x1 - bounds.x0, bh = bounds.z1 - bounds.z0;
  const scale = Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh);
  const ox = (size.w - bw * scale) / 2 - bounds.x0 * scale, oy = (size.h - bh * scale) / 2 - bounds.z0 * scale;
  const toPx = ([x, z]: Pt): Pt => [x * scale + ox, z * scale + oy];
  const toWorld = (px: number, py: number): Pt => [(px - ox) / scale, (py - oy) / scale];

  // the map itself, redrawn only when the window size changes
  const base = useMemo(() => {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const P = ([x, z]: Pt): Pt => [x * scale + ox, z * scale + oy];
    fillPolys(ctx, data.turf, P, AREA_COLORS.turf);
    fillPolys(ctx, data.shrubs, P, AREA_COLORS.shrubs);
    fillPolys(ctx, data.forest.map((f) => f.r), P, AREA_COLORS.forest);
    fillPolys(ctx, data.paved, P, AREA_COLORS.paved);
    fillPolys(ctx, data.paved.slice(0, data.roadCount), P, AREA_COLORS.roads);
    fillPolys(ctx, data.buildings.map((b) => [b.r]), P, AREA_COLORS.building);
    fillPolys(ctx, data.roofGreen, P, AREA_COLORS.roofGreen);
    fillPolys(ctx, data.pv, P, AREA_COLORS.pv);
    ctx.fillStyle = 'rgba(34,197,94,.45)';
    for (const [x, z, r] of data.trees) { const [px, py] = P([x, z]); ctx.beginPath(); ctx.arc(px, py, Math.max(r * scale, 0.8), 0, Math.PI * 2); ctx.fill(); }
    return c;
  }, [data, size.w, size.h, scale, ox, oy]);

  const rect = drag && clampRect(drag.a, drag.b);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#0b1117'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0);
    if (rect) {
      ctx.scale(dpr, dpr);
      const [x0, y0] = toPx([rect.cx - rect.w / 2, rect.cz - rect.d / 2]);
      ctx.fillStyle = 'rgba(45,212,191,.18)'; ctx.fillRect(x0, y0, rect.w * scale, rect.d * scale);
      ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, rect.w * scale, rect.d * scale);
      ctx.fillStyle = '#e5ebf1'; ctx.font = '12px system-ui';
      ctx.fillText(`${Math.round(rect.w)} × ${Math.round(rect.d)} m`, x0 + 6, y0 - 8 < 12 ? y0 + 16 : y0 - 8);
    }
  });

  const at = (e: React.PointerEvent): Pt => { const r = ref.current!.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); };

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Map of the NUS Kent Ridge campus. Drag a rectangle to explore that area in 3D."
      style={{ width: size.w, height: size.h, cursor: 'crosshair', touchAction: 'none', display: 'block' }}
      onPointerDown={(e) => { ref.current!.setPointerCapture(e.pointerId); const p = at(e); setDrag({ a: p, b: p }); }}
      onPointerMove={(e) => drag && setDrag({ a: drag.a, b: at(e) })}
      onPointerUp={() => {
        if (!drag) return;
        const moved = Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) * scale > 8;
        const [x, z] = drag.a;
        const pick: Area = moved && rect ? rect : { cx: x, cz: z, w: CLICK_SIDE, d: CLICK_SIDE };
        // keep the area's centre on the campus so a stray click doesn't open an empty patch of ground
        onSelect({ ...pick, cx: Math.min(bounds.x1, Math.max(bounds.x0, pick.cx)), cz: Math.min(bounds.z1, Math.max(bounds.z0, pick.cz)) });
        setDrag(null);
      }}
    />
  );
}

/** The dragged rectangle, limited to MIN_SIDE..MAX_SIDE per side (grown or shrunk about its centre). */
function clampRect(a: Pt, b: Pt): Area {
  const side = (v: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.abs(v)));
  return { cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, w: side(b[0] - a[0]), d: side(b[1] - a[1]) };
}
