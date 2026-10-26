// Converts the NUS Kent Ridge shapefiles and 2025 station CSVs into small JSON files the app bundles,
// so it works with no network. Usage: node scripts/build-nus-data.mjs <repo with SHP_files/ and data/raw/>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) throw new Error('usage: node scripts/build-nus-data.mjs <path to BPS5231 repo>');
const SHP = join(repo, 'SHP_files');

// ---- coordinate systems -> WGS84 lon/lat (inverse Transverse Mercator, WGS84 ellipsoid) ----
const A = 6378137, F = 1 / 298.257223563, E2 = 2 * F - F * F, EP2 = E2 / (1 - E2), RAD = Math.PI / 180;
const M = (p) => A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p) + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
const tmInverse = ({ lon0, lat0, k0, fe, fn }) => (x, y) => {
  const M0 = M(lat0 * RAD), Mm = M0 + (y - fn) / k0;
  const mu = Mm / (A * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C1 = EP2 * c * c, T1 = t * t, N1 = A / Math.sqrt(1 - E2 * s * s), R1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5, D = (x - fe) / (N1 * k0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = lon0 * RAD + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [lon / RAD, lat / RAD];
};
const CRS = {
  svy21: tmInverse({ lon0: 103.8333333333333, lat0: 1.36666666666667, k0: 1, fe: 28001.642, fn: 38744.572 }),
  utm48n: tmInverse({ lon0: 105, lat0: 0, k0: 0.9996, fe: 500000, fn: 0 }),
  wgs84: (x, y) => [x, y],
};
const crsOf = (prj) => (/UTM_Zone_48N/.test(prj) ? 'utm48n' : /SVY21/.test(prj) ? 'svy21' : 'wgs84');

// ---- minimal shapefile / dbf readers (polygon types 5 and 15) ----
function readShp(buf, convert) {
  const out = [];
  let o = 100;
  while (o + 8 <= buf.length) {
    const len = buf.readInt32BE(o + 4) * 2;
    const rec = o + 8;
    const type = buf.readInt32LE(rec);
    if (type === 5 || type === 15) {
      const nParts = buf.readInt32LE(rec + 36), nPts = buf.readInt32LE(rec + 40);
      const parts = Array.from({ length: nParts }, (_, i) => buf.readInt32LE(rec + 44 + 4 * i)).concat(nPts);
      const p0 = rec + 44 + 4 * nParts;
      const rings = [];
      for (let k = 0; k < nParts; k++) {
        const ring = [];
        for (let i = parts[k]; i < parts[k + 1]; i++) ring.push(convert(buf.readDoubleLE(p0 + 16 * i), buf.readDoubleLE(p0 + 16 * i + 8)));
        rings.push(ring);
      }
      out.push(rings);
    } else out.push(null);
    o += 8 + len;
  }
  return out;
}
function readDbf(buf) {
  const n = buf.readUInt32LE(4), hl = buf.readUInt16LE(8), rl = buf.readUInt16LE(10);
  const fields = [];
  for (let i = 32; buf[i] !== 0x0d; i += 32) fields.push([buf.toString('latin1', i, i + 11).replace(/\0.*/, ''), buf[i + 16]]);
  return Array.from({ length: n }, (_, k) => {
    let o = hl + k * rl + 1; const r = {};
    for (const [nm, l] of fields) { r[nm] = buf.toString('latin1', o, o + l).trim(); o += l; }
    return r;
  });
}
function layer(name) {
  const base = join(SHP, name);
  const crs = crsOf(readFileSync(base + '.prj', 'latin1'));
  return { crs, geoms: readShp(readFileSync(base + '.shp'), CRS[crs]), attrs: readDbf(readFileSync(base + '.dbf')) };
}

// ---- local frame: x east, z south (metres) around the campus boundary centre ----
const anchor = layer('nus_campus_map - Buildings'); // the boundary file spans more than the built campus
let lo = [1e9, 1e9], hi = [-1e9, -1e9];
anchor.geoms.filter(Boolean).flat(2).forEach(([x, y]) => { lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; });
const origin = { lng: (lo[0] + hi[0]) / 2, lat: (lo[1] + hi[1]) / 2 };
const KX = RAD * A * Math.cos(origin.lat * RAD), KZ = RAD * A;
const local = ([lng, lat]) => [+((lng - origin.lng) * KX).toFixed(1), +(-(lat - origin.lat) * KZ).toFixed(1)];

// Douglas-Peucker so the files stay small; 0.4 m is far below the layers' own accuracy
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = 0, idx = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - az) * dz) / l2));
      const d = Math.hypot(pts[i][0] - ax - t * dx, pts[i][1] - az - t * dz);
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const polys = (name, tol = 0.4) => {
  const { geoms, attrs } = layer(name);
  return geoms.map((g, i) => ({ g, a: attrs[i] })).filter((x) => x.g).map(({ g, a }) => ({
    rings: g.map((r) => simplify(r.map(local), tol)).filter((r) => r.length >= 4),
    a,
  })).filter((p) => p.rings.length);
};
const area = (ring) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

const buildings = polys('nus_campus_map - Buildings').map(({ rings, a }) => {
  const h = parseFloat(a.height_ag), f = parseFloat(a.floors_ag);
  return { r: rings[0], h: h > 0 ? h : 0, f: f > 0 ? f : 0 }; // 0 = no height recorded
});
// Individual crowns (<= ~6 m radius) become circles; larger merged canopy patches keep their real outline.
const canopy = polys('nus_campus_map - TreeCanopy', 1.2); // crowns are drawn at 1 m accuracy at most
const trees = [], canopyPatches = [];
for (const { rings, a } of canopy) {
  const ring = rings[0], ar = area(ring), lai = parseFloat(a.TreeLAI) || 0;
  if (ar > Math.PI * 36) canopyPatches.push({ r: rings, lai });
  else {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    trees.push([+cx.toFixed(1), +cz.toFixed(1), +Math.sqrt(ar / Math.PI).toFixed(1), lai]);
  }
}
const plain = (name) => polys(name).map((p) => p.rings);
const zones = ['Zone1', 'Zone2', 'Zone3', 'Zone4', 'Zone7'].map((z) => {
  const ring = polys(`nus_campus_zones - ${z}`)[0].rings[0];
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  return { name: z.replace('Zone', 'Zone '), x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), z: Math.round((Math.min(...zs) + Math.max(...zs)) / 2) };
});

// ---- 2025 station data -> typical diurnal profiles ----
const meta = readFileSync(join(repo, 'data/processed/station_metadata.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const COLS = { t: 'AirTemp Ave (C)', rh: 'RelHum Ave (%)', ws: 'WindSpeed Ave (m/s)', rad: 'GlobalRad Ave (W/m2)' };
const stations = [];
for (const [id, lat, lon, elev, type] of meta) {
  const csv = readFileSync(join(repo, `data/raw/NUS_CAMPUS_${id}_2025_Hourly.csv`), 'utf8').trim().split('\n');
  const head = csv[0].split(','), ix = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, head.indexOf(c)]));
  const days = new Map(); // date -> rows
  for (const line of csv.slice(1)) {
    const c = line.split(','); const [date, time] = c[0].split(' ');
    const v = Object.fromEntries(Object.entries(ix).map(([k, i]) => [k, parseFloat(c[i])]));
    if (!Number.isFinite(v.t)) continue;
    (days.get(date) ?? days.set(date, []).get(date)).push({ h: +time.slice(0, 2), ...v });
  }
  const dayMax = [...days].map(([d, r]) => [d, Math.max(...r.map((x) => x.t))]).sort((a, b) => a[1] - b[1]);
  const hotDays = new Set(dayMax.slice(Math.floor(dayMax.length * 0.9)).map((x) => x[0]));
  const prof = (filter) => ['t', 'rh', 'ws', 'rad'].map((k) => Array.from({ length: 24 }, (_, h) => {
    const vals = [...days].filter(([d]) => filter(d)).flatMap(([, r]) => r.filter((x) => x.h === h && Number.isFinite(x[k])).map((x) => x[k]));
    return vals.length ? +(vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(2) : null;
  }));
  const [x, z] = local([+lon, +lat]);
  stations.push({ id, x, z, elev: +elev, type, year: prof(() => true), hot: prof((d) => hotDays.has(d)), days: days.size, hotDays: hotDays.size });
}

const nus = {
  source: 'NUS Kent Ridge campus GIS layers (BPS5231 project data) and City Syntax Lab 2025 hourly weather stations (Zenodo 10.5281/zenodo.20477761)',
  origin, profileOrder: ['air °C', 'RH %', 'wind m/s', 'global radiation W/m²'],
  boundary: plain('nus_campus_zones - Boundary 2017')[0],
  zones, buildings, trees,
  forest: [...polys('nus_campus_map - Forest').map((p) => ({ r: p.rings, lai: parseFloat(p.a.ForestLAI) || 0 })), ...canopyPatches], // dense canopy: treated as full shade
  paved: [...plain('nus_campus_map - MainRoads'), ...plain('nus_campus_map - Street'), ...plain('nus_campus_map - Pavement')],
  turf: plain('nus_campus_map - Turf'), shrubs: plain('nus_campus_map - Shrubs'),
  roofGreen: plain('nus_campus_map - 2019-2024 RooftopGreenery'), pv: plain('nus_campus_map - 2019-2024 RooftopPV'),
  sport: plain('nus_campus_map - SportField'), stations,
};
writeFileSync(new URL('../public/data/nus.json', import.meta.url), JSON.stringify(nus));
console.log('origin', origin, '\nbuildings', buildings.length, 'with height', buildings.filter((b) => b.h).length, '| tree circles', trees.length, '| canopy patches', canopyPatches.length, '| forest', nus.forest.length, '| paved', nus.paved.length, '| stations', stations.length);
const bb = (rings) => rings.flat().reduce((a, [x, z]) => [Math.min(a[0], x), Math.min(a[1], z), Math.max(a[2], x), Math.max(a[3], z)], [1e9, 1e9, -1e9, -1e9]);
console.log('layer extents (local m) buildings', bb(buildings.map((b) => b.r)).map(Math.round), 'trees', bb([trees.map((t) => [t[0], t[1]])]).map(Math.round), 'paved', bb(nus.paved.flat()).map(Math.round), 'roofGreen', bb(nus.roofGreen.flat()).map(Math.round), 'stations', bb([stations.map((s) => [s.x, s.z])]).map(Math.round));
