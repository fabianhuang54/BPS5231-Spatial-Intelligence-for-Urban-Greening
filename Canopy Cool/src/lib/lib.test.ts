import { describe, expect, it } from 'vitest';
import { inRing, inPoly, ringArea } from './geo';
import { computeImpact } from './impact';
import { COEFF } from './evidence';
import { shadowOffset, solarPosition } from './sun';
import type { ShadeResult } from './shade';
import type { Site, Tree } from './types';

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
  const sq: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
  it('point in ring, and holes are respected', () => {
    expect(inRing(1, 1, sq)).toBe(true);
    expect(inRing(3, 1, sq)).toBe(false);
    const hole: [number, number][] = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]];
    expect(inPoly(1, 1, [sq, hole])).toBe(false);
    expect(inPoly(0.2, 0.2, [sq, hole])).toBe(true);
  });
  it('ring area', () => { expect(ringArea(sq)).toBe(4); });
});

describe('impact', () => {
  const sq = (x: number): [number, number][] => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]];
  const b = (id: number, x: number, outside = false) => ({ id, ring: sq(x), height: 10, heightRecorded: true, floors: 0, floorsBelow: 0, footprint: 100, pvM2: 0, greenRoofM2: 0, outside });
  const site: Site = { w: 300, d: 300, trees: [], generated: [], buildings: [b(1, 0), b(2, 50), b(3, 500, true)], paved: [], roads: [], turf: [], shrubs: [], forest: [], roofGreen: [], pv: [] };
  const res = (before: number, after: number) => ({ baselineFrac: before, scenarioFrac: after, newShadedM2: 0 } as ShadeResult);
  const tree: Tree = { id: 'p', x: 0, z: 0, radius: 4, height: 10, source: 'proposed' };

  it('reports zero cooling when nothing changes', () => {
    const im = computeImpact(site, [], res(0.3, 0.3), new Set());
    expect(im.airTotal).toBe(0);
    expect(im.areaMean.utci).toBe(0);
  });
  it('scales the published coefficients by the extra shaded share', () => {
    const im = computeImpact(site, [tree], res(0.2, 0.3), new Set());
    expect(im.areaMean.air).toBeCloseTo(COEFF.airShade.value * 0.1);
    expect(im.areaMean.utci).toBeCloseTo(COEFF.utciShade.value * 0.1);
    expect(im.inShade.air).toBe(COEFF.airShade.value); // people in the new shade get the full measured difference
    expect(im.addedCanopyM2).toBeCloseTo(Math.PI * 16);
  });
  it('green roof share ignores buildings outside the selected area', () => {
    const im = computeImpact(site, [], res(0, 0), new Set([1]));
    expect(im.roofAir).toBeCloseTo(COEFF.roofAir.value * 0.5); // 1 of the 2 buildings inside
  });
});
