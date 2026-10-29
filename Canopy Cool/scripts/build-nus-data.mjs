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
  const rawAreas = []; // net area of each record in the file's own units (metres² for the projected layers)
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
      let raw = 0;
      for (let k = 0; k < nParts; k++) {
        const ring = [], src = [];
        for (let i = parts[k]; i < parts[k + 1]; i++) {
          const x = buf.readDoubleLE(p0 + 16 * i), y = buf.readDoubleLE(p0 + 16 * i + 8);
          src.push([x, y]); ring.push(convert(x, y));
        }
        raw += src.reduce((t, p, i) => { const q = src[(i + 1) % src.length]; return t + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
        rings.push(ring);
      }
      out.push(rings); rawAreas.push(Math.abs(raw));
    } else { out.push(null); rawAreas.push(0); }
    o += 8 + len;
  }
  out.rawAreas = rawAreas;
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
const layerCache = new Map();
function layer(name) {
  if (layerCache.has(name)) return layerCache.get(name);
  const l = readLayer(name);
  layerCache.set(name, l);
  return l;
}
function readLayer(name) {
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
const signedArea = (r) => r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]; return t + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
const netArea = (rings) => Math.abs(rings.reduce((t, r) => t + signedArea(r), 0)); // holes subtract
const area = (ring) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

const buildings = polys('nus_campus_map - Buildings').map(({ rings, a }) => {
  const h = parseFloat(a.height_ag), f = parseFloat(a.floors_ag), fb = parseFloat(a.floors_bg);
  return { r: rings[0], h: h > 0 ? h : 0, f: f > 0 ? f : 0, fb: fb > 0 ? fb : 0 }; // 0 = not recorded
});
// Individual crowns (<= ~6 m radius) become circles of the same area, measured on the full outline so none are lost;
// larger merged canopy patches keep their real outline (simplified to 0.6 m).
const canopyLayer = layer('nus_campus_map - TreeCanopy');
const trees = [], canopyPatches = [];
canopyLayer.geoms.forEach((g, i) => {
  if (!g) return;
  const rings = g.map((r) => r.map(local)), ar = netArea(rings), lai = parseFloat(canopyLayer.attrs[i].TreeLAI) || 0;
  if (ar > Math.PI * 36) {
    const kept = rings.map((r) => simplify(r, 0.6)).filter((r) => r.length >= 4);
    if (kept.length) canopyPatches.push({ r: kept, lai });
  } else {
    const [cx, cz] = [rings[0].reduce((t, p) => t + p[0], 0) / rings[0].length, rings[0].reduce((t, p) => t + p[1], 0) / rings[0].length];
    trees.push([+cx.toFixed(1), +cz.toFixed(1), +Math.sqrt(ar / Math.PI).toFixed(2), lai]);
  }
});

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
  stations.push({ id, x, z, year: prof(() => true), hot: prof((d) => hotDays.has(d)) });
}


// ---- generated trees: fill the dense canopy patches with individual crowns (for display only) ----
// Crown radii are drawn from the real individual crowns in the same layer; positions are random but seeded, so the
// result is repeatable. They are NOT survey locations: shading still comes from the patch outlines themselves.
const SPACING = 0.6; // min centre distance as a share of the two crown radii: crowns in a closed canopy overlap
const GEN_COVER = 0.6; // total crown area as a multiple of patch area
const realRadii = trees.map((t) => t[2]).filter((r) => r >= 1);
let seed = 20250;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const inRing = (x, z, ring) => { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) o = !o; } return o; };
const bBoxes = buildings.map(({ r }) => ({ r, x0: Math.min(...r.map((p) => p[0])), x1: Math.max(...r.map((p) => p[0])), z0: Math.min(...r.map((p) => p[1])), z1: Math.max(...r.map((p) => p[1])) }));
const nearBuilding = (x, z, m) => bBoxes.some(({ r, x0, x1, z0, z1 }) => {
  if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) return false;
  if (inRing(x, z, r)) return true;
  for (let i = 0; i < r.length - 1; i++) {
    const [ax, az] = r[i], [bx, bz] = r[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    if (Math.hypot(x - ax - t * dx, z - az - t * dz) < m) return true;
  }
  return false;
});
const patches = [...polys('nus_campus_map - Forest').map((p) => p.rings), ...canopyPatches.map((p) => p.r)];
const generated = [];
let fillableArea = 0; // patch area minus what lies on or within 1.5 m of a building (canopy outlines overhang buildings)
for (const rings of patches) {
  const all = rings.flat(); // multi-part patches: sample over every part, not just the first ring
  const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const inside = (x, z) => rings.reduce((n, ring) => n + inRing(x, z, ring), 0) % 2 === 1;
  // estimate the share of the patch where a tree may stand, from 300 random points inside it
  let seen = 0, free = 0;
  for (let guard = 0; seen < 300 && guard < 300 * 60; guard++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!inside(x, z)) continue;
    seen++; if (!nearBuilding(x, z, 1.5)) free++;
  }
  const fillable = netArea(rings) * (seen ? free / seen : 0); // net of holes; later rings can also be extra outer parts
  fillableArea += fillable;
  const target = fillable * GEN_COVER;
  const placed = []; const grid = new Map(); let cover = 0;
  const cap = Math.max(4000, target); // attempts that landed inside the patch; the guard stops a hopeless patch
  for (let tries = 0, guard = 0; cover < target && tries < cap && guard < cap * 60; guard++) {
    const x = +(x0 + rnd() * (x1 - x0)).toFixed(1), z = +(z0 + rnd() * (z1 - z0)).toFixed(1), r = +realRadii[Math.floor(rnd() * realRadii.length)].toFixed(1);
    if (!inside(x, z)) continue; // outside, or inside a hole
    tries++;
    if (cover + Math.PI * r * r > target * 1.25) continue; // never overshoot the target: tiny patches only get crowns that fit
    if (nearBuilding(x, z, 1.5)) continue; // canopy outlines overhang buildings; don't stand trees on them
    const gx = Math.floor(x / 8), gz = Math.floor(z / 8);
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) for (const q of grid.get(`${gx + i},${gz + j}`) ?? []) if (Math.hypot(q[0] - x, q[1] - z) < SPACING * (q[2] + r)) { ok = false; break; }
    if (!ok) continue;
    const t = [x, z, r];
    placed.push(t); (grid.get(`${gx},${gz}`) ?? grid.set(`${gx},${gz}`, []).get(`${gx},${gz}`)).push(t); cover += Math.PI * r * r;
  }
  generated.push(...placed);
}
console.log('generated trees', generated.length);

const nus = {
  source: 'NUS Kent Ridge campus GIS layers (BPS5231 project data) and City Syntax Lab 2025 hourly weather stations (Zenodo 10.5281/zenodo.20477761)',
  origin, profileOrder: ['air °C', 'RH %', 'wind m/s', 'global radiation W/m²'],
  boundary: plain('nus_campus_zones - Boundary 2017')[0],
  zones, buildings, trees, generated,
  forest: [...polys('nus_campus_map - Forest').map((p) => ({ r: p.rings, lai: parseFloat(p.a.ForestLAI) || 0 })), ...canopyPatches], // dense canopy: treated as full shade
  // everything paved (analysis); the first `roadCount` entries are carriageways (MainRoads + Street), drawn darker
  paved: [...plain('nus_campus_map - MainRoads'), ...plain('nus_campus_map - Street'), ...plain('nus_campus_map - Pavement')],
  roadCount: plain('nus_campus_map - MainRoads').length + plain('nus_campus_map - Street').length,
  turf: plain('nus_campus_map - Turf'), shrubs: plain('nus_campus_map - Shrubs'),
  roofGreen: plain('nus_campus_map - 2019-2024 RooftopGreenery'), pv: plain('nus_campus_map - 2019-2024 RooftopPV'),
  stations,
};

// ---- validation: check everything derived against the raw layers, and refuse to write a file that disagrees ----
// Each check compares our output with the shapefiles themselves (counts, areas in the source CRS) or with another layer.
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });
const sumArea = (polyList) => polyList.reduce((t, p) => t + netArea(p), 0);
const parity = (rings, x, z) => rings.reduce((n, r) => n + inRing(x, z, r), 0) % 2 === 1;
const centroid = (ring) => [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
const raw = (name) => {
  const { geoms } = layer(name);
  let n = 0, a = 0;
  geoms.forEach((g, i) => { if (g) { n++; a += geoms.rawAreas[i]; } });
  return { n, a };
};

// 1. counts and areas against the source files (the areas use the file's own projected metres, so they test our CRS conversion too)
const roadN = nus.roadCount;
const AREA_LAYERS = [
  ['Buildings', 'nus_campus_map - Buildings', buildings.map((b) => [b.r])],
  ['Roads + streets', null, nus.paved.slice(0, roadN), ['nus_campus_map - MainRoads', 'nus_campus_map - Street']],
  ['Pavement', 'nus_campus_map - Pavement', nus.paved.slice(roadN)],
  ['Turf', 'nus_campus_map - Turf', nus.turf],
  ['Shrubs', 'nus_campus_map - Shrubs', nus.shrubs],
  ['Forest', 'nus_campus_map - Forest', nus.forest.slice(0, raw('nus_campus_map - Forest').n).map((f) => f.r)],
  ['Rooftop greenery', 'nus_campus_map - 2019-2024 RooftopGreenery', nus.roofGreen],
  ['Rooftop PV', 'nus_campus_map - 2019-2024 RooftopPV', nus.pv],
];
for (const [label, file, out, files] of AREA_LAYERS) {
  const src = (files ?? [file]).map(raw).reduce((t, r) => ({ n: t.n + r.n, a: t.a + r.a }), { n: 0, a: 0 });
  const outA = sumArea(out), dA = src.a ? (100 * Math.abs(outA - src.a)) / src.a : 0;
  // a few tiny pavement fragments collapse to nothing when simplified; the area check below shows the loss is negligible
  check(`${label}: record count matches the layer`, out.length >= src.n - Math.max(2, src.n * 0.03) && out.length <= src.n, `${out.length} of ${src.n} records`);
  check(`${label}: area matches the layer`, dA <= 1.5, `${Math.round(outA)} m² vs ${Math.round(src.a)} m² in the file (${dA.toFixed(2)}% apart)`);
}
// the canopy layer is in degrees, so compare it with its own unsimplified conversion instead
const canopyRaw = layer('nus_campus_map - TreeCanopy').geoms.filter(Boolean).reduce((t, g) => t + netArea(g.map((r) => r.map(local))), 0);
const canopyOut = trees.reduce((t, c) => t + Math.PI * c[2] * c[2], 0) + sumArea(canopyPatches.map((p) => p.r));
check('Tree canopy: every record kept (circle or outline)', trees.length + canopyPatches.length === canopyLayer.geoms.filter(Boolean).length, `${trees.length + canopyPatches.length} of ${canopyLayer.geoms.filter(Boolean).length} records`);
check('Tree canopy: total area kept after simplifying', (100 * Math.abs(canopyOut - canopyRaw)) / canopyRaw <= 3, `${Math.round(canopyOut)} m² vs ${Math.round(canopyRaw)} m² in the layer`);
check('Buildings: heights from the layer only', buildings.every((b) => b.h === 0 || (b.h > 0 && b.h <= 120)) && buildings.filter((b) => b.h).length === polys('nus_campus_map - Buildings').filter((p) => parseFloat(p.a.height_ag) > 0).length, `${buildings.filter((b) => b.h).length} with a recorded height, all ≤ 120 m`);

// 2. layers agree with each other (they come in three different coordinate systems)
const boundary = plain('nus_campus_zones - Boundary 2017');
const inBoundary = (x, z) => boundary.some((p) => parity(p, x, z));
const share = (items, f) => items.filter(f).length / Math.max(items.length, 1);
const pctOf = (v) => `${(v * 100).toFixed(1)}%`;
const bIn = share(buildings, (b) => inBoundary(...centroid(b.r)));
const tIn = share(trees, (t) => inBoundary(t[0], t[1]));
const sIn = share(stations, (st) => inBoundary(st.x, st.z));
// the boundary file is dated 2017 and the other layers are newer, so a few percent outside is expected; near 0% would mean misregistration
check('Buildings lie inside the 2017 campus boundary', bIn >= 0.9, pctOf(bIn));
check('Tree crowns lie inside the 2017 campus boundary', tIn >= 0.9, pctOf(tIn));
check('Weather stations lie inside the campus boundary', sIn >= 0.95, pctOf(sIn));
const pvOn = share(nus.pv, (p) => buildings.some((b) => inRing(...centroid(p[0]), b.r)));
const grOn = share(nus.roofGreen, (p) => buildings.some((b) => inRing(...centroid(p[0]), b.r)));
check('Rooftop PV sits on buildings (UTM layer vs SVY21 layer)', pvOn >= 0.8, pctOf(pvOn));
check('Rooftop greenery sits on buildings (UTM layer vs SVY21 layer)', grOn >= 0.7, pctOf(grOn));

// 3. generated trees must trace back to the layers
const realR = new Set(realRadii.map((r) => +r.toFixed(1)));
const boxed = patches.map((rings) => { const pts = rings.flat(); return { rings, x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) }; });
const inPatch = share(generated, (g) => boxed.some((b) => g[0] >= b.x0 && g[0] <= b.x1 && g[1] >= b.z0 && g[1] <= b.z1 && parity(b.rings, g[0], g[1])));
const bbox = buildings.map((b) => ({ b, x0: Math.min(...b.r.map((p) => p[0])) - 1.5, x1: Math.max(...b.r.map((p) => p[0])) + 1.5, z0: Math.min(...b.r.map((p) => p[1])) - 1.5, z1: Math.max(...b.r.map((p) => p[1])) + 1.5 }));
const onBuilding = generated.filter((g) => bbox.some((k) => g[0] >= k.x0 && g[0] <= k.x1 && g[1] >= k.z0 && g[1] <= k.z1) && nearBuilding(g[0], g[1], 1.5)).length;
const patchArea = fillableArea;
const crownArea = generated.reduce((t, g) => t + Math.PI * g[2] * g[2], 0);
check('Generated trees: all inside a canopy or forest outline', inPatch === 1, pctOf(inPatch));
check('Generated trees: none on or within 1.5 m of a building', onBuilding === 0, `${onBuilding} found`);
check('Generated trees: crown sizes come from the layer’s own crowns', generated.every((g) => realR.has(g[2])), `${realR.size} sizes in the layer`);
check('Generated trees: crown cover reaches the target', crownArea / patchArea >= 0.85 * GEN_COVER && crownArea / patchArea <= 1.25 * GEN_COVER, `${(crownArea / patchArea).toFixed(2)}× the ${Math.round(patchArea)} m² of canopy not under buildings (target ${GEN_COVER})`);

nus.validation = { checks };
const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(c.pass ? '  ok  ' : '  FAIL', c.name, '—', c.detail);
if (failed.length) { console.error(`\n${failed.length} validation check(s) failed; nus.json not written.`); process.exit(1); }

writeFileSync(new URL('../public/data/nus.json', import.meta.url), JSON.stringify(nus));
console.log('origin', origin, '\nbuildings', buildings.length, 'with height', buildings.filter((b) => b.h).length, '| tree circles', trees.length, '| canopy patches', canopyPatches.length, '| forest', nus.forest.length, '| paved', nus.paved.length, '| stations', stations.length);
const bb = (rings) => rings.flat().reduce((a, [x, z]) => [Math.min(a[0], x), Math.min(a[1], z), Math.max(a[2], x), Math.max(a[3], z)], [1e9, 1e9, -1e9, -1e9]);
console.log('layer extents (local m) buildings', bb(buildings.map((b) => b.r)).map(Math.round), 'trees', bb([trees.map((t) => [t[0], t[1]])]).map(Math.round), 'paved', bb(nus.paved.flat()).map(Math.round), 'roofGreen', bb(nus.roofGreen.flat()).map(Math.round), 'stations', bb([stations.map((s) => [s.x, s.z])]).map(Math.round));
