import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { SourceStatus, Tool } from '../App';
import { COEFF, REFS } from '../lib/evidence';
import type { Impact } from '../lib/impact';
import type { Weather } from '../lib/nea';
import type { NusWeather } from '../lib/nus';
import { DEFAULT_BUILDING_HEIGHT, DEFAULT_CROWN_RADIUS, DEFAULT_TREE_HEIGHT } from '../lib/osm';
import { PLACES } from '../lib/places';
import type { Place, Pt, Site, Tree } from '../lib/types';

interface Props {
  place: Place; setPlace: (p: Place) => void;
  half: number; setHalf: (n: number) => void;
  status: Record<'osm' | 'nparks' | 'nea', SourceStatus>;
  weather: Weather | null; profile: NusWeather | null; site: Site | null;
  sun: { alt: number; az: number };
  hour: number; setHour: Dispatch<SetStateAction<number>>;
  tool: Tool; setTool: (t: Tool) => void;
  radius: number; setRadius: (n: number) => void;
  impact: Impact | null; proposed: Tree[]; suggestions: Pt[];
  onSuggest: (n: number) => void; onAccept: () => void; onReset: () => void;
}

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }) : '');
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);

const Refs = ({ ids }: { ids: number[] }) => <>{ids.map((i) => <a key={i} className="ref" href={`#ref${i}`}>[{i}]</a>)}</>;
const Row = ({ k, v, children }: { k: string; v: ReactNode; children?: ReactNode }) => <div className="row"><span>{k}</span><b>{v}{children}</b></div>;
const Dot = ({ s }: { s: SourceStatus }) => <i className={`dot ${s.state}`} title={s.note ?? s.state} />;

export function Panel(p: Props) {
  const { impact: im, weather: w, site } = p;
  const inSite = site ? site.buildings.filter((b) => !b.outside) : [];
  const untagged = inSite.filter((b) => !b.heightTagged).length;
  const tc = (n: number) => (n === 0 ? '0.0' : (-n).toFixed(Math.abs(n) < 0.1 ? 2 : 1));

  return (
    <aside className="panel">
      <h1>CanopyCool <small>Singapore</small></h1>

      <section>
        <h2>Site</h2>
        <select value={PLACES.findIndex((x) => x.name === p.place.name)} onChange={(e) => p.setPlace(PLACES[+e.target.value] ?? p.place)}>
          {PLACES.map((x, i) => <option key={x.name} value={i}>{x.name}</option>)}
          {PLACES.every((x) => x.name !== p.place.name) && <option value={-1}>{p.place.name}</option>}
        </select>
        <div className="inline">
          <input aria-label="latitude" defaultValue={p.place.lat} key={'a' + p.place.lat} onBlur={(e) => { const v = +e.target.value; if (v !== p.place.lat && v > 1.15 && v < 1.5) p.setPlace({ name: 'Custom', lat: v, lng: p.place.lng }); }} />
          <input aria-label="longitude" defaultValue={p.place.lng} key={'b' + p.place.lng} onBlur={(e) => { const v = +e.target.value; if (v !== p.place.lng && v > 103.6 && v < 104.1) p.setPlace({ name: 'Custom', lat: p.place.lat, lng: v }); }} />
          <select value={p.half} onChange={(e) => p.setHalf(+e.target.value)}>{[100, 150, 250, 500].map((n) => <option key={n} value={n}>{2 * n} m</option>)}</select>
        </div>
      </section>

      {p.profile && (
        <section>
          <h2>Campus stations <small>NUS 2025 hourly · offline</small></h2>
          <Row k="Typical air temperature" v={`${p.profile.year[0].toFixed(1)} °C`} />
          <Row k={`Hot afternoons (top 10% of days)`} v={`${p.profile.hot[0].toFixed(1)} °C`} />
          <Row k="Relative humidity" v={`${p.profile.year[1].toFixed(0)} %`} />
          <Row k="Wind · global radiation" v={`${p.profile.year[2].toFixed(1)} m/s · ${p.profile.year[3].toFixed(0)} W/m²`} />
          <p className="note">{p.profile.station} ({p.profile.type}), {p.profile.distanceM.toFixed(0)} m from the site centre. Mean of {p.profile.days} days at this hour; hot = the {p.profile.hotDays} days with the highest daily maximum. Follows the time slider.</p>
        </section>
      )}

      <section>
        <h2>Live weather <small>NEA · data.gov.sg</small> <Dot s={p.status.nea} /></h2>
        {w?.airTemp ? (
          <>
            <Row k="Air temperature" v={`${w.airTemp.value.toFixed(1)} °C`} />
            {w.humidity && <Row k="Relative humidity" v={`${w.humidity.value.toFixed(0)} %`} />}
            {w.wind && <Row k="Wind" v={`${w.wind.value.toFixed(1)} ${w.wind.unit.replace('knots', 'kn')}`} />}
            {w.uv && <Row k="UV index" v={`${w.uv.value} (${time(w.uv.hour)})`} />}
            {w.forecast && <Row k={`2-hr forecast · ${w.forecast.area}`} v={w.forecast.text} />}
            <p className="note">{w.airTemp.station}, {w.airTemp.distanceKm.toFixed(1)} km away · {time(w.airTemp.timestamp)}</p>
          </>
        ) : <p className="note">{p.status.nea.state === 'loading' ? 'Loading…' : `Unavailable (${p.status.nea.note}). The app works without it.`}</p>}
      </section>

      <section>
        <h2>Time of day</h2>
        <input aria-label="Time of day" type="range" min={7} max={18.5} step={0.25} value={p.hour} onChange={(e) => p.setHour(+e.target.value)} />
        <Row k={`${fmtHour(p.hour)} SGT`} v={`sun ${deg(p.sun.alt)}° high, bearing ${deg(p.sun.az)}°`} />
      </section>

      <section>
        <h2>Plan</h2>
        <div className="inline">
          <button className={p.tool === 'tree' ? 'on' : ''} onClick={() => p.setTool('tree')}>Plant trees</button>
          <button className={p.tool === 'roof' ? 'on' : ''} onClick={() => p.setTool('roof')}>Green roofs</button>
        </div>
        <label className="inline">Crown radius <input aria-label="Crown radius" type="range" min={2} max={8} step={0.5} value={p.radius} onChange={(e) => p.setRadius(+e.target.value)} /> <b>{p.radius} m</b></label>
        <div className="inline">
          {p.suggestions.length ? <button className="on" onClick={p.onAccept}>Accept {p.suggestions.length} spots</button> : <button onClick={() => p.onSuggest(10)}>Suggest 10 spots</button>}
          <button onClick={p.onReset} disabled={!p.proposed.length && !im?.greenRoofs}>Reset</button>
        </div>
        <p className="note">{p.tool === 'tree' ? 'Click the map to plant; click a proposed tree to remove it.' : 'Click a building to toggle a green roof.'} Orange = unshaded street, teal = shaded.</p>
      </section>

      {im && (
        <section>
          <h2>Microclimate impact</h2>
          <Row k="Shaded street area" v={`${(im.shadeBefore * 100).toFixed(0)}% → ${(im.shadeAfter * 100).toFixed(0)}%`} />
          <Row k="Trees added · crown area" v={`${im.addedTrees} · ${im.addedCanopyM2.toFixed(0)} m²`} />
          <Row k="Surface, under new canopy" v={im.addedTrees || im.shadeAfter > im.shadeBefore ? `${tc(im.surfaceUnderCanopy)} °C` : '—'}><Refs ids={COEFF.surfaceShade.ref} /></Row>
          <p className="note">Literature range up to −{COEFF.surfaceShade.range[1]} °C.</p>
          <Row k="Surface, street average" v={`${tc(im.surfaceMean)} °C`} />
          <Row k="Air temperature, street" v={`${tc(im.airStreet)} °C`}><Refs ids={COEFF.airShade.ref} /></Row>
          <Row k="Perceived heat (UTCI)" v={`${tc(im.utci)} °C`}><Refs ids={COEFF.utciShade.ref} /></Row>
          {im.greenRoofs > 0 && <>
            <Row k={`Green roofs · ${im.greenRoofM2.toFixed(0)} m²`} v={`${tc(im.roofSurface)} °C roof surface`}><Refs ids={COEFF.roofSurface.ref} /></Row>
            <Row k="Air temperature, roofs" v={`${tc(im.roofAir)} °C`}><Refs ids={COEFF.roofAir.ref} /></Row>
          </>}
          <Row k="Total air temperature" v={`${tc(im.airTotal)} °C`} />
          <p className="note">Coefficients are measured shaded-vs-sunlit (or green-vs-bare roof) differences from the studies below, scaled linearly by the share of street area newly shaded or roof area greened. A planning estimate, not a validated simulation. The surface figure comes from small plots in housing estates and is applied here to all paved street area, including asphalt. Shade is calculated for the selected time using real sun position.</p>
        </section>
      )}

      <section>
        <h2>Data in view</h2>
        {site && p.place.nus ? (
          <>
            <Row k="Buildings" v={`${inSite.length} (${untagged} assumed ${DEFAULT_BUILDING_HEIGHT} m)`}><Dot s={p.status.osm} /></Row>
            <Row k="Tree crowns · forest patches" v={`${site.trees.length} · ${site.forest.length}`} />
            <Row k="Paved areas · turf · shrubs" v={`${site.paved.length} · ${site.turf.length} · ${site.shrubs.length}`} />
            <Row k="Existing green roofs · PV" v={`${site.roofGreen.length} · ${site.pv.length}`} />
            <p className="note">Bundled NUS Kent Ridge campus GIS layers (BPS5231 project data), so this works offline. Each crown is drawn as a circle of the same area as its mapped canopy. Buildings without a recorded height or floor count are assumed {DEFAULT_BUILDING_HEIGHT} m, and trees are assumed {DEFAULT_TREE_HEIGHT} m tall. Forest patches shade fully.</p>
          </>
        ) : site ? (
          <>
            <Row k="Roads · footpaths" v={`${site.roads.length} · ${site.walkways.length}`}><Dot s={p.status.osm} /></Row>
            <Row k="Buildings" v={`${inSite.length} (${untagged} assumed ${DEFAULT_BUILDING_HEIGHT} m)`} />
            <Row k="Trees: OSM · NParks heritage" v={`${site.trees.filter((t) => t.source === 'osm').length} · ${site.trees.filter((t) => t.source === 'nparks').length}`}><Dot s={p.status.nparks} /></Row>
            {p.status.nparks.state === 'error' && <p className="note">NParks heritage trees unavailable: {p.status.nparks.note}</p>}
            <p className="note">Live data, needs a network (cached for 7 days). Buildings up to 80 m outside the box are loaded only so their shadows fall in. Bridges and tunnels are left out. Roads, footpaths, buildings and trees © OpenStreetMap contributors (ODbL). Heritage trees: NParks via data.gov.sg. Where OSM has no crown size or height we assume a {DEFAULT_CROWN_RADIUS * 2} m crown and {DEFAULT_TREE_HEIGHT} m tree. NParks’ full street-tree inventory (TreesSG) has no open API.</p>
          </>
        ) : <p className="note">Loading…</p>}
      </section>

      <section>
        <h2>References</h2>
        <ol className="refs">
          {REFS.map((r) => (
            <li key={r.id} id={`ref${r.id}`}>
              {r.cite} <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>
              <em>{r.finding}</em>
              {r.note && <span className="warn">{r.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
