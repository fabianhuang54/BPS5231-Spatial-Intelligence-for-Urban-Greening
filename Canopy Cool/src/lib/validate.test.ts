import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nearRing } from './geo';
import { nusSite, type NusData } from './nus';
import { plantingBlock } from './planting';
import type { Site, Tree } from './types';
import { validateArea, validatePlan } from './validate';

const data = JSON.parse(readFileSync('public/data/nus.json', 'utf8')) as NusData;
const sq = (x: number, z: number, s: number): [number, number][] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s], [x, z]];

describe('the real campus data', () => {
  it('passed every build-time check against the shapefiles', () => {
    const failed = data.validation.checks.filter((c) => !c.pass);
    expect(failed).toEqual([]);
    expect(data.validation.checks.length).toBeGreaterThan(20);
  });

  it.each([
    [0, 0, 300, 300],
    [-250, 300, 600, 400],
    [400, -300, 200, 500],
    [-900, 900, 80, 600],
  ])('area at (%i, %i) %i×%i m passes the layer checks', (cx, cz, w, d) => {
    const site = nusSite(data, { cx, cz, w, d });
    const failed = validateArea(site).filter((c) => !c.pass);
    expect(failed).toEqual([]);
  });

  it('passes the layer checks on 40 random areas across the campus', () => {
    let seed = 99;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 40; i++) {
      const area = { cx: -800 + rnd() * 1700, cz: -1000 + rnd() * 2000, w: 80 + rnd() * 520, d: 80 + rnd() * 520 };
      const failed = validateArea(nusSite(data, area)).filter((c) => !c.pass);
      expect({ area, failed }).toEqual({ area, failed: [] });
    }
  });

  it('keeps every building inside the area or flags it as outside', () => {
    const site = nusSite(data, { cx: 0, cz: 0, w: 300, d: 300 });
    for (const b of site.buildings) {
      const mx = b.ring.reduce((s, p) => s + p[0], 0) / b.ring.length, mz = b.ring.reduce((s, p) => s + p[1], 0) / b.ring.length;
      expect(!!b.outside).toBe(Math.abs(mx) > 150 || Math.abs(mz) > 150);
    }
  });
});

describe('the checks can fail', () => {
  const site: Site = {
    w: 100, d: 100, trees: [], buildings: [{ id: 1, ring: sq(-10, -10, 20), height: 12, heightRecorded: true, floors: 3, floorsBelow: 0, footprint: 400, pvM2: 0, greenRoofM2: 0 }],
    generated: [], paved: [[sq(30, -50, 10)]], roads: [], turf: [], shrubs: [], forest: [[sq(-45, 20, 30)]], roofGreen: [], pv: [],
  };
  const planted = (x: number, z: number): Tree => ({ id: 'p', x, z, radius: 4, height: 10, source: 'proposed' });

  it('passes on a clean area', () => {
    site.generated = [{ x: -30, z: 35, radius: 3 }];
    expect(validateArea(site).every((c) => c.pass)).toBe(true);
  });
  it('flags a generated tree outside every canopy outline', () => {
    const bad = { ...site, generated: [{ x: 40, z: 40, radius: 3 }] };
    expect(validateArea(bad).find((c) => c.name.includes('inside a canopy'))?.pass).toBe(false);
  });
  it('flags a generated tree on a building', () => {
    const bad = { ...site, forest: [[sq(-20, -20, 40)]], generated: [{ x: 0, z: 0, radius: 3 }] };
    expect(validateArea(bad).find((c) => c.name.includes('clear of buildings'))?.pass).toBe(false);
  });
  it('flags a planted tree on a building or on paving, accepts open ground', () => {
    expect(validatePlan(site, [planted(0, 0)], new Set()).find((c) => c.name.startsWith('Planted'))?.pass).toBe(false);
    expect(validatePlan(site, [planted(35, -45)], new Set()).find((c) => c.name.startsWith('Planted'))?.pass).toBe(false);
    expect(validatePlan(site, [planted(-40, 30)], new Set()).every((c) => c.pass)).toBe(true);
  });
  it('flags a green roof on an unknown building', () => {
    expect(validatePlan(site, [], new Set([99])).find((c) => c.name.startsWith('Green roofs'))?.pass).toBe(false);
  });
});

describe('planting rules', () => {
  const site = { w: 100, d: 100, trees: [], generated: [], paved: [[sq(30, -50, 10)]], buildings: [{ id: 1, ring: sq(-10, -10, 20), height: 12, heightRecorded: true, floors: 0, floorsBelow: 0, footprint: 400, pvM2: 0, greenRoofM2: 0 }] } as unknown as Site;
  it('blocks buildings, paving, the edge and crowding, allows open ground', () => {
    expect(plantingBlock(site, [], 0, 0)).toMatch(/building/);
    expect(plantingBlock(site, [], 35, -45)).toMatch(/pavement/);
    expect(plantingBlock(site, [], 80, 0)).toMatch(/Outside/);
    expect(plantingBlock(site, [{ id: 't', x: -40, z: 30, radius: 4, height: 10, source: 'nus' }], -41, 31)).toMatch(/close/);
    expect(plantingBlock(site, [], -40, 30)).toBeNull();
  });
  it('nearRing counts the edge margin', () => {
    expect(nearRing(10.8, 0, sq(-10, -10, 20), 1.5)).toBe(true);
    expect(nearRing(12, 0, sq(-10, -10, 20), 1.5)).toBe(false);
  });
});
