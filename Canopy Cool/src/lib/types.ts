/** Local metre grid centred on the site: x = east, z = south (matches screen y). */
export type Pt = [number, number];

export interface Line { id: number; name: string | null; kind: string; width: number; points: Pt[]; covered?: boolean }
export interface Building { id: number; name: string | null; ring: Pt[]; height: number; heightTagged: boolean; outside?: boolean /* in the shadow margin, beyond the site box */ }
export interface Tree { id: string; x: number; z: number; radius: number; height: number; source: 'osm' | 'nparks' | 'proposed'; label?: string }

export interface Site {
  lat: number;
  lng: number;
  half: number; // half-side of the square site, metres
  roads: Line[];
  walkways: Line[];
  buildings: Building[];
  trees: Tree[];
}

export interface Place { name: string; lat: number; lng: number }
