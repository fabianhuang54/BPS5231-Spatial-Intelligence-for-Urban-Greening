import { cached, getJSON } from './cache';

const BASE = 'https://api-open.data.gov.sg/v2/real-time/api';

interface Station { id: string; name: string; location: { latitude: number; longitude: number } }
interface Reading { timestamp: string; data: { stationId: string; value: number }[] }
interface Feed { data: { stations: Station[]; readings: Reading[]; readingUnit: string } }

export interface Metric { value: number; unit: string; station: string; distanceKm: number; timestamp: string }
export interface Weather {
  airTemp?: Metric;
  humidity?: Metric;
  wind?: Metric;
  uv?: { value: number; hour: string };
  forecast?: { area: string; text: string; validTo: string };
}

function km(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180;
  const x = (lng2 - lng1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  return Math.hypot(x, (lat2 - lat1) * r) * 6371;
}

async function nearest(path: string, lat: number, lng: number): Promise<Metric | undefined> {
  const { data } = await cached(`nea:${path}`, 4 * 60000, () => getJSON<Feed>(`${BASE}/${path}`));
  const reading = data.readings[0];
  const byId = new Map(data.stations.map((s) => [s.id, s]));
  let best: Metric | undefined;
  for (const r of reading.data) {
    const s = byId.get(r.stationId);
    if (!s || r.value == null) continue;
    const d = km(lat, lng, s.location.latitude, s.location.longitude);
    if (!best || d < best.distanceKm) best = { value: r.value, unit: data.readingUnit, station: s.name, distanceKm: d, timestamp: reading.timestamp };
  }
  return best;
}

/** Latest NEA station readings nearest to (lat, lng), plus UV and the 2-hour forecast. Each part fails independently. */
export async function loadWeather(lat: number, lng: number): Promise<Weather> {
  const [airTemp, humidity, wind, uv, forecast] = await Promise.allSettled([
    nearest('air-temperature', lat, lng),
    nearest('relative-humidity', lat, lng),
    nearest('wind-speed', lat, lng),
    cached('nea:uv', 15 * 60000, () => getJSON<{ data: { records: { index: { hour: string; value: number }[] }[] } }>(`${BASE}/uv`)),
    cached('nea:2hr', 10 * 60000, () => getJSON<{ data: { area_metadata: { name: string; label_location: { latitude: number; longitude: number } }[]; items: { valid_period: { end: string }; forecasts: { area: string; forecast: string }[] }[] } }>(`${BASE}/two-hr-forecast`)),
  ]);
  const w: Weather = {};
  if (airTemp.status === 'fulfilled') w.airTemp = airTemp.value;
  if (humidity.status === 'fulfilled') w.humidity = humidity.value;
  if (wind.status === 'fulfilled') w.wind = wind.value;
  if (uv.status === 'fulfilled') {
    const latest = uv.value.data.records[0]?.index[0];
    if (latest) w.uv = { value: latest.value, hour: latest.hour };
  }
  if (forecast.status === 'fulfilled') {
    const d = forecast.value.data;
    const item = d.items[0];
    let area = '', best = Infinity;
    for (const a of d.area_metadata) {
      const dist = km(lat, lng, a.label_location.latitude, a.label_location.longitude);
      if (dist < best) { best = dist; area = a.name; }
    }
    const f = item?.forecasts.find((x) => x.area === area);
    if (f) w.forecast = { area, text: f.forecast, validTo: item.valid_period.end };
  }
  return w;
}
