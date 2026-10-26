/** Local metre grid centred on the site: x = east, z = south (matches screen y). */
export type Pt = [number, number];
/** Polygon with holes: first ring outer, rest holes (even-odd fill). */
export type Poly = Pt[][];

export interface Line { id: number; name: string | null; kind: string; width: number; points: Pt[]; covered?: boolean }
export interface Building { id: number; name: string | null; ring: Pt[]; height: number; heightTagged: boolean; outside?: boolean /* in the shadow margin, beyond the site box */ }
export interface Tree { id: string; x: number; z: number; radius: number; height: number; source: 'osm' | 'nparks' | 'nus' | 'proposed'; label?: string }

export interface Site {
  lat: number;
  lng: number;
  half: number; // half-side of the square site, metres
  roads: Line[];
  walkways: Line[];
  buildings: Building[];
  trees: Tree[];
  /** Area layers (NUS campus data). Empty for sites built from OpenStreetMap lines. */
  paved: Poly[]; turf: Poly[]; shrubs: Poly[]; forest: Poly[]; roofGreen: Poly[]; pv: Poly[];
}

export interface Place { name: string; lat: number; lng: number; nus?: { x: number; z: number } /* bundled NUS data window centre, metres from the NUS origin */ }

export const NO_AREAS = { paved: [], turf: [], shrubs: [], forest: [], roofGreen: [], pv: [] } satisfies Pick<Site, 'paved' | 'turf' | 'shrubs' | 'forest' | 'roofGreen' | 'pv'>;
