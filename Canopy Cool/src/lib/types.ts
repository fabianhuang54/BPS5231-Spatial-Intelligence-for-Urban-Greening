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

export interface Tree { id: string; x: number; z: number; radius: number; height: number; source: 'nus' | 'proposed' }

/** Selected rectangle, in campus metres. */
export interface Area { cx: number; cz: number; w: number; d: number }

/** An Area re-centred on (0, 0) with the layers inside it. */
export interface Site {
  w: number;
  d: number;
  buildings: Building[];
  trees: Tree[];
  paved: Poly[]; turf: Poly[]; shrubs: Poly[]; forest: Poly[]; roofGreen: Poly[]; pv: Poly[];
}
