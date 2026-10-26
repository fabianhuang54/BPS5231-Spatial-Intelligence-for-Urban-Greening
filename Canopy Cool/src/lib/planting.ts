import { inPoly, inRing } from './geo';
import type { Site, Tree } from './types';

/** Why a tree can't go at (x, z), or null if it can. */
export function plantingBlock(site: Site, trees: Tree[], x: number, z: number): string | null {
  if (Math.abs(x) > site.w / 2 || Math.abs(z) > site.d / 2) return 'Outside the selected area';
  if (site.buildings.some((b) => inRing(x, z, b.ring))) return 'Inside a building';
  if (site.paved.some((p) => inPoly(x, z, p))) return 'On a road or pavement';
  if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < Math.max(3, t.radius * 0.6))) return 'Too close to another tree';
  return null;
}
