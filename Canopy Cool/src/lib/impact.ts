import { COEFF } from './evidence';
import { roofArea, type ShadeResult } from './shade';
import type { Site, Tree } from './types';

export interface Impact {
  addedTrees: number;
  addedCanopyM2: number;
  shadeBefore: number;
  shadeAfter: number;
  surfaceShadedM2: number; // paved area newly shaded
  surfaceUnderCanopy: number; // °C, per newly shaded cell
  surfaceMean: number; // °C averaged over all paved cells
  airStreet: number;
  utci: number;
  greenRoofs: number;
  greenRoofM2: number;
  roofShare: number;
  roofSurface: number;
  roofAir: number;
  airTotal: number;
}

/**
 * Linear scaling of the published shaded-vs-sunlit differences by the share of paved street area
 * that the scenario newly shades. This is a planning approximation, not a validated model.
 */
export function computeImpact(site: Site, trees: Tree[], res: ShadeResult, greenRoofIds: Set<number>): Impact {
  const added = trees.filter((t) => t.source === 'proposed');
  const dFrac = Math.max(0, res.scenarioFrac - res.baselineFrac);
  const inSite = site.buildings.filter((b) => !b.outside); // margin buildings only cast shadows
  const roofTotal = inSite.reduce((s, b) => s + roofArea(b), 0);
  const greenM2 = inSite.filter((b) => greenRoofIds.has(b.id)).reduce((s, b) => s + roofArea(b), 0);
  const roofShare = roofTotal > 0 ? greenM2 / roofTotal : 0;
  const airStreet = COEFF.airShade.value * dFrac;
  const roofAir = COEFF.roofAir.value * roofShare;
  return {
    addedTrees: added.length,
    addedCanopyM2: added.reduce((s, t) => s + Math.PI * t.radius * t.radius, 0),
    shadeBefore: res.baselineFrac,
    shadeAfter: res.scenarioFrac,
    surfaceShadedM2: (res.scenarioShaded - res.baselineShaded) * 4,
    surfaceUnderCanopy: COEFF.surfaceShade.value,
    surfaceMean: COEFF.surfaceShade.value * dFrac,
    airStreet,
    utci: COEFF.utciShade.value * dFrac,
    greenRoofs: greenRoofIds.size,
    greenRoofM2: greenM2,
    roofShare,
    roofSurface: COEFF.roofSurface.value,
    roofAir,
    airTotal: airStreet + roofAir,
  };
}
