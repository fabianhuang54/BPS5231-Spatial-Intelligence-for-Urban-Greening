import { cached, getJSON } from './cache';
import { bbox, toLocal } from './geo';
import { DEFAULT_CROWN_RADIUS, DEFAULT_TREE_HEIGHT } from './osm';
import type { Tree } from './types';

// NParks Heritage Trees register, published on data.gov.sg (Singapore Open Data Licence).
const DATASET = 'd_644ff187b6d14d6316f47284a4a6c81f';

interface Collection { features: { geometry: { coordinates: [number, number] }; properties: { NAME: string; DESCRIPTION: string; HT: string } }[] }

export async function loadHeritageTrees(lat: number, lng: number, half: number): Promise<Tree[]> {
  const all = await cached('nparks:heritage', 7 * 86400000, async () => {
    const { data } = await getJSON<{ data: { url: string } }>(`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET}/poll-download`);
    const fc = await getJSON<Collection>(data.url, undefined, 60000);
    // keep only what we use so the cached copy stays small
    return fc.features.map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: f.properties.NAME, ref: f.properties.HT, desc: f.properties.DESCRIPTION }));
  });
  const [s, w, n, e] = bbox(lat, lng, half);
  return all
    .filter((t) => t.lat >= s && t.lat <= n && t.lng >= w && t.lng <= e)
    .map((t) => {
      const [x, z] = toLocal(lat, lng, t.lat, t.lng);
      return { id: `ht${t.ref}`, x, z, radius: DEFAULT_CROWN_RADIUS, height: DEFAULT_TREE_HEIGHT, source: 'nparks' as const, label: `${t.name} (${t.ref})` };
    });
}
