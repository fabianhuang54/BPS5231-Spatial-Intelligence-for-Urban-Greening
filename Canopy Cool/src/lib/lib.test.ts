import { describe, expect, it } from 'vitest';
import { toLocal, inRing, distToPolyline } from './geo';
import { computeImpact } from './impact';
import { COEFF } from './evidence';
import { shadowOffset, solarPosition } from './sun';
import type { ShadeResult } from './shade';
import { NO_AREAS, type Site, type Tree } from './types';

const deg = (r: number) => (r * 180) / Math.PI;

describe('sun', () => {
  it('is near-overhead at solar noon on the equator at the March equinox', () => {
    // 2026-03-20 is within a day of the equinox; ~12:07 local solar noon at 103.8°E is ~05:00 UTC
    const { alt } = solarPosition(new Date('2026-03-20T05:07:00Z'), 0, 103.8);
    expect(deg(alt)).toBeGreaterThan(85);
  });
  it('is below the horizon at local midnight', () => {
    expect(solarPosition(new Date('2026-06-21T16:00:00Z'), 1.28, 103.85).alt).toBeLessThan(0);
  });
  it('casts the shadow away from the sun: afternoon sun in the west puts shade to the east (+x)', () => {
    const [dx] = shadowOffset(10, Math.PI / 4, (270 * Math.PI) / 180);
    expect(dx).toBeGreaterThan(9);
  });
});

describe('geo', () => {
  it('puts north at negative z and east at positive x', () => {
    const [x, z] = toLocal(1.28, 103.85, 1.281, 103.851);
    expect(x).toBeGreaterThan(100);
    expect(z).toBeLessThan(-100);
  });
  it('point-in-ring and polyline distance', () => {
    expect(inRing(1, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true);
    expect(inRing(3, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(false);
    expect(distToPolyline(5, 3, [[0, 0], [10, 0]])).toBe(3);
  });
});

describe('impact', () => {
  const sq = (x: number): [number, number][] => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]];
  const site = {
    lat: 1.28, lng: 103.85, half: 150, roads: [], walkways: [], trees: [], ...NO_AREAS,
    buildings: [
      { id: 1, name: null, ring: sq(0), height: 10, heightTagged: true },
      { id: 2, name: null, ring: sq(50), height: 10, heightTagged: true },
      { id: 3, name: null, ring: sq(500), height: 10, heightTagged: true, outside: true },
    ],
  } as Site;
  const res = (b: number, s: number) => ({ baselineFrac: b, scenarioFrac: s, baselineShaded: 0, scenarioShaded: 0 } as ShadeResult);
  const tree: Tree = { id: 'p', x: 0, z: 0, radius: 4, height: 10, source: 'proposed' };

  it('reports zero cooling when nothing changes', () => {
    const im = computeImpact(site, [], res(0.3, 0.3), new Set());
    expect(im.airTotal).toBe(0);
    expect(im.utci).toBe(0);
  });
  it('scales the published coefficients by the extra shaded share', () => {
    const im = computeImpact(site, [tree], res(0.2, 0.3), new Set());
    expect(im.airStreet).toBeCloseTo(COEFF.airShade.value * 0.1);
    expect(im.utci).toBeCloseTo(COEFF.utciShade.value * 0.1);
    expect(im.addedCanopyM2).toBeCloseTo(Math.PI * 16);
  });
  it('green roof share ignores buildings outside the site box', () => {
    const im = computeImpact(site, [], res(0, 0), new Set([1]));
    expect(im.roofShare).toBeCloseTo(0.5); // 1 of the 2 in-site buildings
    expect(im.roofAir).toBeCloseTo(COEFF.roofAir.value * 0.5);
  });
});
