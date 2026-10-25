import { bbox, toLocal } from './geo';
import { cached } from './cache';
import type { Building, Line, Pt, Site, Tree } from './types';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// OSM highway classes -> typical carriageway width (m). Used only when no width/lanes tag exists.
const ROAD_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 8, unclassified: 7, residential: 7,
  living_street: 6, service: 4.5, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 6,
};
const WALK_WIDTH: Record<string, number> = { footway: 2, pedestrian: 5, path: 2, steps: 2, cycleway: 2.5, corridor: 2.5 };

// Defaults when OSM carries no crown/height information. Shown to the user as assumptions.
export const DEFAULT_CROWN_RADIUS = 4;
export const DEFAULT_TREE_HEIGHT = 10;
export const DEFAULT_LEVEL_HEIGHT = 3.2;
export const DEFAULT_BUILDING_HEIGHT = 12;
const SHADOW_MARGIN = 80; // metres of extra buildings fetched so their shadows fall into the site

interface OsmEl {
  type: 'way' | 'node' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { role: string; geometry?: { lat: number; lon: number }[] }[];
}

async function overpass(query: string): Promise<OsmEl[]> {
  let lastErr: unknown;
  for (let round = 0; round < 2; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          signal: AbortSignal.timeout(25000),
        });
        if (res.ok) return (await res.json()).elements as OsmEl[];
        lastErr = new Error(`Overpass responded ${res.status}`);
      } catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 2000 * (round + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
}

const num = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : null; };

export async function loadOsm(lat: number, lng: number, half: number): Promise<Omit<Site, 'lat' | 'lng' | 'half'>> {
  const [s, w, n, e] = bbox(lat, lng, half);
  const [ms, mw, mn, me] = bbox(lat, lng, half + SHADOW_MARGIN);
  const site = `${s},${w},${n},${e}`, wide = `${ms},${mw},${mn},${me}`;
  const q = `[out:json][timeout:25];(way["highway"](${site});node["natural"="tree"](${site});way["building"](${wide});relation["building"](${wide}););out geom;`;
  const els = await cached(`osm2:${lat.toFixed(5)},${lng.toFixed(5)},${half}`, 7 * 86400000, () => overpass(q));

  const roads: Line[] = [], walkways: Line[] = [], buildings: Building[] = [], trees: Tree[] = [];
  for (const el of els) {
    const t = el.tags ?? {};
    if (el.type === 'node' && t.natural === 'tree' && el.lat != null && el.lon != null) {
      const [x, z] = toLocal(lat, lng, el.lat, el.lon);
      const crown = num(t.diameter_crown);
      trees.push({
        id: `osm${el.id}`, x, z, source: 'osm',
        radius: crown ? crown / 2 : DEFAULT_CROWN_RADIUS,
        height: num(t.height) ?? DEFAULT_TREE_HEIGHT,
        label: [t.species ?? t.genus, t['species:en'] ?? t.name].filter(Boolean).join(' · ') || undefined,
      });
      continue;
    }
    if (t.building) {
      // a way is one outline; a multipolygon relation contributes each outer ring (courtyard holes are ignored)
      const rings = el.type === 'way' ? [el.geometry] : (el.members ?? []).filter((m) => m.role === 'outer').map((m) => m.geometry);
      const levels = num(t['building:levels']);
      const h = num(t.height) ?? (levels ? levels * DEFAULT_LEVEL_HEIGHT : null);
      rings.forEach((g, i) => {
        if (!g || g.length < 4) return;
        const ring: Pt[] = g.map((p) => toLocal(lat, lng, p.lat, p.lon));
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        buildings.push({ id: el.type === 'way' ? el.id : el.id * 1000 + i, name: t.name ?? null, ring, height: h ?? DEFAULT_BUILDING_HEIGHT, heightTagged: h != null, outside: Math.abs(cx) > half || Math.abs(cz) > half });
      });
      continue;
    }
    if (el.type !== 'way' || !el.geometry || !t.highway) continue;
    const pts: Pt[] = el.geometry.map((g) => toLocal(lat, lng, g.lat, g.lon));
    // not at ground level: tunnels, bridges and flyovers would be drawn as paving on top of the streets below
    if (t.tunnel === 'yes' || t.area === 'yes' || t.bridge || (t.layer && +t.layer !== 0)) continue;
    if (t.highway in ROAD_WIDTH) {
      const lanes = num(t.lanes);
      roads.push({ id: el.id, name: t.name ?? null, kind: t.highway, points: pts, width: num(t.width) ?? (lanes ? lanes * 3.4 : ROAD_WIDTH[t.highway]) });
    } else if (t.highway in WALK_WIDTH) {
      walkways.push({ id: el.id, name: t.name ?? null, kind: t.footway ?? t.highway, points: pts, width: num(t.width) ?? WALK_WIDTH[t.highway], covered: t.covered === 'yes' || t.tunnel === 'building_passage' });
    }
  }
  return { roads, walkways, buildings, trees };
}
