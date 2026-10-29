/** Campus frame: x = east, z = south, metres from the NUS origin (matches screen y). */
export type Pt = [number, number];
/** Polygon with holes: first ring outer, rest holes (even-odd fill). */
export type Poly = Pt[][];

export interface Building {
  id: number;
  ring: Pt[];
  height: number;
  heightRecorded: boolean; // false = the layer has no height or floor count, so a default is used
  floors: number; // 0 = not recorded
  floorsBelow: number;
  footprint: number; // m²
  pvM2: number; // mapped rooftop PV (2019-2024 layer) on this building
  greenRoofM2: number; // mapped rooftop greenery (2019-2024 layer) on this building
  outside?: boolean; // in the shadow margin, beyond the selected area
}

export interface Tree {
  id: string; x: number; z: number; radius: number; height: number; source: 'nus' | 'proposed';
  /** Mapped crown centred on a building footprint (an overhanging crown): still shades, but isn't drawn as a tree standing on the roof. */
  overBuilding?: boolean;
}
/** A tree placed inside a dense canopy patch to show it as trees. Display only: not a surveyed location, and not used in the shade analysis. */
export interface GeneratedTree { x: number; z: number; radius: number }

/** Selected rectangle, in campus metres. */
export interface Area { cx: number; cz: number; w: number; d: number }

/** An Area re-centred on (0, 0) with the layers inside it. */
export interface Site {
  w: number;
  d: number;
  buildings: Building[];
  trees: Tree[];
  generated: GeneratedTree[];
  paved: Poly[]; roads: Poly[]; turf: Poly[]; shrubs: Poly[]; forest: Poly[]; roofGreen: Poly[]; pv: Poly[];
}
