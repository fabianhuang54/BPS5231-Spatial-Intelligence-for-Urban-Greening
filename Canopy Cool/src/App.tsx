import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BuildingCard, Hint, PlanCard, PreviewCard, SpotsCard } from './components/Cards';
import { CampusMap } from './components/CampusMap';
import { Sources } from './components/Sources';
import { DEFAULT_CROWN_RADIUS, DEFAULT_TREE_HEIGHT } from './lib/defaults';
import { computeImpact } from './lib/impact';
import { loadNus, NUS_LL, nusSite, nusWeather, type NusData } from './lib/nus';
import { plantingBlock } from './lib/planting';
import { analyse, recommend, shadeGain, type Spot } from './lib/shade';
import { solarPosition, sgDate } from './lib/sun';
import type { Area, Tree } from './lib/types';

const Scene3D = lazy(() => import('./components/Scene3D')); // Three.js loads only when an area is opened

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const proposedTree = (id: string, x: number, z: number): Tree => ({ id, x, z, radius: DEFAULT_CROWN_RADIUS, height: DEFAULT_TREE_HEIGHT, source: 'proposed' });

export default function App() {
  const [data, setData] = useState<NusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [hour, setHour] = useState(14); // a hot afternoon
  const [proposed, setProposed] = useState<Tree[]>([]);
  const [greenRoofs, setGreenRoofs] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [plantMode, setPlantMode] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [hoverPt, setHoverPt] = useState<{ x: number; z: number } | null>(null);
  const [sources, setSources] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { loadNus().then(setData, (e) => setError(String(e.message ?? e))); }, []);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 2800); };
  const openArea = (a: Area) => { setArea(a); setProposed([]); setGreenRoofs(new Set()); setSelectedId(null); setPlantMode(false); setSpots([]); setHoverPt(null); };

  const site = useMemo(() => (data && area ? nusSite(data, area) : null), [data, area]);
  const trees = useMemo(() => (site ? [...site.trees, ...proposed] : []), [site, proposed]);
  const sun = useMemo(() => solarPosition(sgDate(hour), NUS_LL.lat, NUS_LL.lng), [hour]);
  const res = useMemo(() => (site ? analyse(site, trees, sun.alt, sun.az) : null), [site, trees, sun]);
  const impact = useMemo(() => (site && res ? computeImpact(site, trees, res, greenRoofs) : null), [site, trees, res, greenRoofs]);
  const weather = useMemo(() => (data && area ? nusWeather(data, area, hour) : null), [data, area, hour]);

  // recommendations are for the current plan and time: drop them when either changes
  useEffect(() => { setSpots([]); }, [proposed, hour, area]);
  const spotImpact = useMemo(() => {
    if (!site || !impact || !spots.length) return null;
    const all = [...trees, ...spots.map((s, i) => proposedTree(`spot${i}`, s.x, s.z))];
    return computeImpact(site, all, analyse(site, all, sun.alt, sun.az), greenRoofs);
  }, [site, impact, spots, trees, sun, greenRoofs]);

  const block = site && hoverPt ? plantingBlock(site, trees, hoverPt.x, hoverPt.z) : null;
  const ghost = plantMode && hoverPt ? { ...hoverPt, radius: DEFAULT_CROWN_RADIUS, ok: !block } : null;
  const gain = ghost?.ok && res ? shadeGain(res, ghost.x, ghost.z, DEFAULT_CROWN_RADIUS, sun.alt, sun.az) : 0;
  const selected = site?.buildings.find((b) => b.id === selectedId) ?? null;

  const onPick = (id: number | null, x: number, z: number) => {
    if (!site) return;
    if (!plantMode) { setSelectedId(id); return; }
    const hit = proposed.find((t) => Math.hypot(t.x - x, t.z - z) <= t.radius * 0.6);
    if (hit) { setProposed((p) => p.filter((t) => t.id !== hit.id)); return; }
    const why = id != null ? 'Inside a building' : plantingBlock(site, trees, x, z);
    if (why) return flash(why);
    setProposed((p) => [...p, proposedTree(`p${Date.now()}`, x, z)]);
  };

  const suggest = () => {
    if (!site || !res) return;
    const found = recommend(site, trees, res, 8, DEFAULT_CROWN_RADIUS, sun.alt, sun.az);
    setSpots(found);
    setPlantMode(false);
    if (!found.length) flash('No sunlit paving left to improve here');
  };
  const applySpots = () => { setProposed((p) => [...p, ...spots.map((s, i) => proposedTree(`p${Date.now()}_${i}`, s.x, s.z))]); };
  const toggleRoof = (id: number) => setGreenRoofs((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const changed = !!impact && (impact.addedTrees > 0 || impact.greenRoofs > 0);

  let card = <Hint>Click a building for its details, or press <b>Plant trees</b> and click the ground. <b>Recommend</b> finds the best spots.</Hint>;
  if (impact && res && site) {
    if (spots.length && spotImpact) card = <SpotsCard now={impact} withSpots={spotImpact} spots={spots} onApply={applySpots} onDismiss={() => setSpots([])} open={() => setSources(true)} />;
    else if (plantMode && ghost) card = <PreviewCard ok={ghost.ok} reason={block} gainM2={gain} pavedArea={res.pavedArea} open={() => setSources(true)} />;
    else if (selected && !plantMode) card = <BuildingCard b={selected} hour={fmtHour(hour)} sun={sun} greenRoof={greenRoofs.has(selected.id)} onGreenRoof={() => toggleRoof(selected.id)} onClose={() => setSelectedId(null)} open={() => setSources(true)} />;
    else if (changed) card = <PlanCard im={impact} open={() => setSources(true)} />;
    else if (plantMode) card = <Hint>Move over the ground: orange paving is sunlit, teal is shaded. Click to plant.</Hint>;
  }

  return (
    <div className="app">
      {!area || !site || !res ? (
        <>
          <div className="map">{data ? <CampusMap data={data} onSelect={openArea} /> : <div className="center">{error ? `Couldn’t load the campus data: ${error}` : 'Loading campus data…'}</div>}</div>
          <header className="top">
            <div><h1>CanopyCool</h1><span>NUS Kent Ridge</span></div>
            <p className="pill">Drag a rectangle over any area to explore it in 3D · or click to pick a {300} m square</p>
            <button className="link" onClick={() => setSources(true)}>Sources</button>
          </header>
          <div className="legend"><i style={{ background: '#6b7a8d' }} />Buildings <i style={{ background: '#22a85a' }} />Trees <i style={{ background: '#0f4429' }} />Dense canopy <i style={{ background: '#2b3644' }} />Paving <i style={{ background: '#1d4ed8' }} />Rooftop PV</div>
        </>
      ) : (
        <>
          <Suspense fallback={<div className="center">Loading 3D…</div>}>
            <Scene3D
              key={`${area.cx},${area.cz},${area.w},${area.d}`}
              site={site} trees={trees} res={res} greenRoofs={greenRoofs} sun={sun}
              selectedId={selectedId} plantMode={plantMode} ghost={ghost} spots={spots}
              onHoverGround={setHoverPt} onPick={onPick}
            />
          </Suspense>
          <header className="top">
            <button onClick={() => setArea(null)}>← Campus</button>
            <p className="pill">{Math.round(area.w)} × {Math.round(area.d)} m · {site.buildings.filter((b) => !b.outside).length} buildings · {site.trees.length} trees</p>
            <button className="link" onClick={() => setSources(true)}>Sources</button>
          </header>
          <aside className="side">{card}</aside>
          <div className="bar">
            <button className={plantMode ? 'primary' : ''} onClick={() => { setPlantMode((m) => !m); setSelectedId(null); setSpots([]); }}>🌳 Plant trees</button>
            <button onClick={suggest}>✨ Recommend</button>
            <button onClick={() => { setProposed([]); setGreenRoofs(new Set()); setSpots([]); }} disabled={!changed}>Reset</button>
            <div className="time">
              <label>{fmtHour(hour)} · sun {Math.round((sun.alt * 180) / Math.PI)}° high
                <input type="range" aria-label="Time of day" min={7} max={18.5} step={0.25} value={hour} onChange={(e) => setHour(+e.target.value)} />
              </label>
              {weather && <small>{weather.station}: typical {weather.year[0].toFixed(1)} °C · hot afternoons {weather.hot[0].toFixed(1)} °C</small>}
            </div>
          </div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
      {sources && <Sources onClose={() => setSources(false)} />}
    </div>
  );
}
