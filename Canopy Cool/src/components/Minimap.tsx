import { useEffect, useMemo, useRef } from 'react';
import { buildOverlay, drawGround } from '../lib/ground';
import type { ShadeResult } from '../lib/shade';
import type { Site } from '../lib/types';
import type { View } from './MapCanvas';

const PX = 180;

/** Overview of the whole site with a box marking the area currently in view; click or drag to move the view. */
export function Minimap({ site, res, view, aspect, setView }: { site: Site; res: ShadeResult; view: View; aspect: number; setView: (v: View) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => drawGround(site, buildOverlay(site, res), PX, true), [site, res]);

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    // visible area: the map shows `2·half / k` metres along its shorter side
    const s = PX / (2 * site.half);
    const short = (2 * site.half) / view.k, long = short * Math.max(aspect, 1 / aspect);
    const w = (aspect >= 1 ? long : short) * s, h = (aspect >= 1 ? short : long) * s;
    ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 2;
    ctx.strokeRect((view.x + site.half) * s - w / 2, (view.z + site.half) * s - h / 2, w, h);
  }, [base, view, aspect, site.half]);

  const move = (e: React.PointerEvent) => {
    if (e.type === 'pointermove' && !e.buttons) return;
    const r = ref.current!.getBoundingClientRect();
    const f = (v: number) => Math.max(-site.half, Math.min(site.half, (v / PX) * 2 * site.half - site.half));
    setView({ ...view, x: f(e.clientX - r.left), z: f(e.clientY - r.top) });
  };

  return <canvas ref={ref} className="minimap" width={PX} height={PX} onPointerDown={move} onPointerMove={move} title="Site overview — click or drag to move the view (north is up)" />;
}
