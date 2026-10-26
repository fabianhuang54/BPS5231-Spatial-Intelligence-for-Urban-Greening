import { COEFF } from './evidence';
import type { ShadeResult } from './shade';
import type { Site, Tree } from './types';

export interface Impact {
  addedTrees: number;
  addedCanopyM2: number;
  shadeBefore: number; // share of paved area shaded
  shadeAfter: number;
  newShadedM2: number; // paved area newly shaded
  /** Published shaded-vs-sunlit differences: what a person standing in the new shade gets. */
  inShade: { surface: number; air: number; utci: number };
  /** Those differences scaled by the share of the area's paving newly shaded. */
  areaMean: { surface: number; air: number; utci: number };
  greenRoofs: number;
  greenRoofM2: number;
  roofSurface: number;
  roofAir: number; // area-scaled by the share of roof area greened
  airTotal: number; // street air + roof air, area-scaled
}

/**
 * Linear scaling of the published shaded-vs-sunlit differences by the share of paved area that the plan newly
 * shades. This is a planning approximation, not a validated simulation.
 */
export function computeImpact(site: Site, trees: Tree[], res: ShadeResult, greenRoofIds: Set<number>): Impact {
  const added = trees.filter((t) => t.source === 'proposed');
  const dFrac = Math.max(0, res.scenarioFrac - res.baselineFrac);
  const inSite = site.buildings.filter((b) => !b.outside); // margin buildings only cast shadows
  const roofTotal = inSite.reduce((s, b) => s + b.footprint, 0);
  const greenM2 = inSite.filter((b) => greenRoofIds.has(b.id)).reduce((s, b) => s + b.footprint, 0);
  const roofShare = roofTotal > 0 ? greenM2 / roofTotal : 0;
  const inShade = { surface: COEFF.surfaceShade.value, air: COEFF.airShade.value, utci: COEFF.utciShade.value };
  const roofAir = COEFF.roofAir.value * roofShare;
  const areaMean = { surface: inShade.surface * dFrac, air: inShade.air * dFrac, utci: inShade.utci * dFrac };
  return {
    addedTrees: added.length,
    addedCanopyM2: added.reduce((s, t) => s + Math.PI * t.radius * t.radius, 0),
    shadeBefore: res.baselineFrac,
    shadeAfter: res.scenarioFrac,
    newShadedM2: res.newShadedM2,
    inShade, areaMean,
    greenRoofs: greenRoofIds.size,
    greenRoofM2: greenM2,
    roofSurface: COEFF.roofSurface.value,
    roofAir,
    airTotal: areaMean.air + roofAir,
  };
}
