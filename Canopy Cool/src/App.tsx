import { useEffect, useMemo, useState } from 'react';
import { lazy, Suspense } from 'react';
import { MapCanvas, type Hit, type View } from './components/MapCanvas';
import { Minimap } from './components/Minimap';
import { Panel } from './components/Panel';
import { loadOsm, DEFAULT_CROWN_RADIUS, DEFAULT_TREE_HEIGHT } from './lib/osm';
import { loadNus, nusSite, nusWeather, type NusData } from './lib/nus';
import { loadHeritageTrees } from './lib/nparks';
import { loadWeather, type Weather } from './lib/nea';
import { solarPosition, sgDate, sgHourNow } from './lib/sun';
import { analyse, recommend } from './lib/shade';
import { computeImpact } from './lib/impact';
import { inRing, inPoly, distToPolyline } from './lib/geo';
import { PLACES } from './lib/places';
import { NO_AREAS, type Place, type Pt, type Site, type Tree } from './lib/types';

const Scene3D = lazy(() => import('./components/Scene3D')); // Three.js loads only when 3D is opened

export type Tool = 'tree' | 'roof';
export interface SourceStatus { state: 'loading' | 'ok' | 'error' | 'skipped'; note?: string }

const clampHour = (h: number) => Math.min(18.5, Math.max(7, h));

export default function App() {
  const [place, setPlace] = useState<Place>(PLACES[0]);
  const [half, setHalf] = useState(250);
  const [nus, setNus] = useState<NusData | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [status, setStatus] = useState<Record<'osm' | 'nparks' | 'nea', SourceStatus>>({ osm: { state: 'loading' }, nparks: { state: 'loading' }, nea: { state: 'loading' } });
  const [weather, setWeather] = useState<Weather | null>(null);
  const [hour, setHour] = useState(() => clampHour(sgHourNow()));
  const [proposed, setProposed] = useState<Tree[]>([]);
  const [greenRoofs, setGreenRoofs] = useState<Set<number>>(new Set());
  const [suggestions, setSuggestions] = useState<Pt[]>([]);
  const [tool, setTool] = useState<Tool>('tree');
  const [radius, setRadius] = useState(DEFAULT_CROWN_RADIUS);
  const [hover, setHover] = useState<Hit>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode3d, setMode3d] = useState(false);
  const [view, setView] = useState<View>({ k: 1, x: 0, z: 0 });
  const [aspect, setAspect] = useState(1);

  // keep the same state object while the label is unchanged so mouse moves don't re-render the whole app
  const hoverKey = (h: Hit) => (!h ? '' : h.kind === 'tree' ? h.tree.id : h.label);
  const onHover = (h: Hit) => setHover((prev) => (hoverKey(prev) === hoverKey(h) ? prev : h));
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3000); };

  // Map data: OSM roads, footpaths, buildings and trees + NParks heritage trees.
  useEffect(() => {
    let live = true;
    setView({ k: 1, x: 0, z: 0 }); setSite(null); setProposed([]); setGreenRoofs(new Set()); setSuggestions([]);
    setStatus((s) => ({ ...s, osm: { state: 'loading' }, nparks: { state: 'loading' } }));
    if (place.nus) {
      // bundled NUS campus layers: no network needed
      const { x, z } = place.nus;
      loadNus().then((d) => {
        if (!live) return;
        setNus(d);
        setSite(nusSite(d, x, z, half));
        setStatus((s) => ({ ...s, osm: { state: 'ok', note: 'bundled' }, nparks: { state: 'skipped' } }));
      }, (e) => live && setStatus((s) => ({ ...s, osm: { state: 'error', note: String(e.message ?? e) } })));
      return () => { live = false; };
    }
    const osm = loadOsm(place.lat, place.lng, half);
    const nparks = loadHeritageTrees(place.lat, place.lng, half);
    Promise.allSettled([osm, nparks]).then(([o, n]) => {
      if (!live) return;
      if (o.status === 'rejected') { setStatus((s) => ({ ...s, osm: { state: 'error', note: String(o.reason.message ?? o.reason) } })); return; }
      const heritage = n.status === 'fulfilled' ? n.value : [];
      // an OSM node within 3 m of a heritage tree is the same tree: keep the NParks one
      const osmTrees = o.value.trees.filter((t) => !heritage.some((h) => Math.hypot(h.x - t.x, h.z - t.z) < 3));
      setSite({ lat: place.lat, lng: place.lng, half, ...NO_AREAS, ...o.value, trees: [...osmTrees, ...heritage] });
      setStatus((s) => ({ ...s, osm: { state: 'ok' }, nparks: n.status === 'fulfilled' ? { state: 'ok' } : { state: 'error', note: String(n.reason.message ?? n.reason) } }));
    });
    return () => { live = false; };
  }, [place, half, attempt]);

  useEffect(() => {
    let live = true;
    setStatus((s) => ({ ...s, nea: { state: 'loading' } }));
    if (!navigator.onLine) { setWeather(null); setStatus((s) => ({ ...s, nea: { state: 'error', note: 'offline' } })); return; }
    loadWeather(place.lat, place.lng).then(
      (w) => { if (live) { setWeather(w); setStatus((s) => ({ ...s, nea: w.airTemp ? { state: 'ok' } : { state: 'error', note: 'no readings' } })); } },
      (e) => { if (live) setStatus((s) => ({ ...s, nea: { state: 'error', note: String(e.message ?? e) } })); },
    );
    return () => { live = false; };
  }, [place]);

  const trees = useMemo(() => (site ? [...site.trees, ...proposed] : []), [site, proposed]);
  const profile = useMemo(() => (nus && place.nus ? nusWeather(nus, place.nus.x, place.nus.z, hour) : null), [nus, place, hour]);
  const sun = useMemo(() => solarPosition(sgDate(hour), place.lat, place.lng), [hour, place]);
  const res = useMemo(() => (site ? analyse(site, trees, sun.alt, sun.az) : null), [site, trees, sun]);
  const impact = useMemo(() => (site && res ? computeImpact(site, trees, res, greenRoofs) : null), [site, trees, res, greenRoofs]);

  const plant = (x: number, z: number, hit: Hit) => {
    if (!site) return;
    if (tool === 'roof') {
      if (hit?.kind !== 'building') return flash('Click a building to toggle its green roof');
      setGreenRoofs((s) => { const n = new Set(s); n.has(hit.id) ? n.delete(hit.id) : n.add(hit.id); return n; });
      return;
    }
    if (hit?.kind === 'tree') {
      if (hit.tree.source === 'proposed') setProposed((p) => p.filter((t) => t.id !== hit.tree.id));
      else flash('Existing trees (OSM / NParks) can’t be removed here');
      return;
    }
    if (site.buildings.some((b) => inRing(x, z, b.ring))) return flash('Can’t plant inside a building');
    if (site.roads.some((l) => distToPolyline(x, z, l.points) <= l.width / 2) || site.paved.some((p) => inPoly(x, z, p))) return flash('Can’t plant on a road or pavement');
    if (site.walkways.some((l) => distToPolyline(x, z, l.points) <= l.width / 2)) return flash('Keep footpaths clear');
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) return flash('Too close to another tree');
    setProposed((p) => [...p, { id: `p${Date.now()}`, x, z, radius, height: DEFAULT_TREE_HEIGHT, source: 'proposed' }]);
    setSuggestions([]);
  };

  const suggest = (n: number) => {
    if (!site || !res) return;
    const spots = recommend(site, trees, res, n, radius, sun.alt, sun.az);
    setSuggestions(spots);
    if (!spots.length) flash('No unshaded street area left to improve');
  };
  const acceptSuggestions = () => {
    setProposed((p) => [...p, ...suggestions.map((s, i): Tree => ({ id: `p${Date.now()}_${i}`, x: s[0], z: s[1], radius, height: DEFAULT_TREE_HEIGHT, source: 'proposed' }))]);
    setSuggestions([]);
  };

  return (
    <div className="app">
      <div className="map">
        {site && res ? (
          <>
            {mode3d ? (
              <Suspense fallback={<div className="center">Loading 3D…</div>}>
                <Scene3D site={site} trees={trees} res={res} greenRoofs={greenRoofs} sun={sun} onClick={plant} onHover={onHover} onView={setView} />
              </Suspense>
            ) : (
              <MapCanvas site={site} trees={trees} res={res} greenRoofs={greenRoofs} suggestions={suggestions} onClick={plant} onHover={onHover} view={view} setView={setView} onAspect={setAspect} />
            )}
            <div className="seg"><button className={!mode3d ? 'on' : ''} onClick={() => setMode3d(false)}>2D</button><button className={mode3d ? 'on' : ''} onClick={() => setMode3d(true)}>3D</button></div>
            <Minimap site={site} res={res} view={view} aspect={mode3d ? 1 : aspect} setView={(v) => setView(v)} />
          </>
        ) : (
          <div className="center">
            {status.osm.state === 'error' ? (
              <div>
                <p>Couldn’t load OpenStreetMap data ({status.osm.note}). The free public Overpass servers are sometimes busy.</p>
                <button onClick={() => setAttempt((a) => a + 1)}>Retry</button>
              </div>
            ) : 'Loading map data from OpenStreetMap (can take up to a minute when the public servers are busy)…'}
          </div>
        )}
        <div className="hud">{hover ? (hover.kind === 'tree' ? `${hover.tree.source === 'nparks' ? 'NParks heritage tree' : hover.tree.source === 'osm' ? 'OSM tree' : 'Proposed tree'}${hover.tree.label ? ' · ' + hover.tree.label : ''} · crown ⌀ ${(hover.tree.radius * 2).toFixed(0)} m` : hover.label) : 'Hover a feature to see its source data'}</div>
        {toast && <div className="toast">{toast}</div>}
      </div>
      <Panel
        place={place} setPlace={setPlace} half={half} setHalf={setHalf}
        status={status} weather={weather} profile={profile} site={site} sun={sun} hour={hour} setHour={setHour}
        tool={tool} setTool={setTool} radius={radius} setRadius={setRadius}
        impact={impact} proposed={proposed} suggestions={suggestions} onSuggest={suggest} onAccept={acceptSuggestions}
        onReset={() => { setProposed([]); setGreenRoofs(new Set()); setSuggestions([]); }}
      />
    </div>
  );
}

