import { useEffect, useRef } from 'react';
import { COEFF, REFS } from '../lib/evidence';
import type { Check } from '../lib/validate';
import { DEFAULT_BUILDING_HEIGHT, DEFAULT_CROWN_RADIUS, DEFAULT_TREE_HEIGHT } from '../lib/defaults';

/** Everything behind the numbers: published studies, how they are applied, the data used, and what is still missing. */
function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => <li key={c.name} className={c.pass ? 'ok' : 'bad'}><b>{c.pass ? '✓' : '✗'}</b> {c.name} <small>{c.detail}</small></li>)}
    </ul>
  );
}

/** `build` = checks run against the shapefiles when the data file was made; `area` = checks on the area you have open. */
export function Sources({ onClose, build, area }: { onClose: () => void; build: Check[]; area: Check[] }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { sheet.current?.focus(); }, []); // keyboard users land in the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={onClose}>
      <div ref={sheet} tabIndex={-1} className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Sources and method">
        <div className="card-head"><h2>Sources & method</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>

        <h4>Published figures used</h4>
        <ol className="refs">
          {REFS.map((r) => (
            <li key={r.id} id={`ref${r.id}`}>
              {r.cite} <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>
              <em>{r.finding}</em>
              {r.note && <span className="warn">{r.note}</span>}
            </li>
          ))}
        </ol>

        <h4>How they are applied</h4>
        <p>Surface −{COEFF.surfaceShade.value} °C, air −{COEFF.airShade.value} °C and feels-like −{COEFF.utciShade.value} °C are the measured differences between shaded and sunlit spots. They are quoted for anyone standing in newly shaded paving. The “whole area” figures multiply them by the share of the area’s paving that becomes shaded, which is a linear planning assumption, not a validated simulation. The surface figure comes from small plots in housing estates and is applied to all paving here.</p>
        <p>Shade is computed for the selected time from the real sun position, using building heights and tree crowns from the NUS layers.</p>

        <h4>Data in the app</h4>
        <ul>
          <li>NUS Kent Ridge campus GIS layers from the BPS5231 project: buildings (height, floors), tree canopy (crown outlines), forest, roads, streets and pavement, turf, shrubs, rooftop greenery and PV (2019–2024).</li>
          <li>NUS 2025 hourly weather, 40 stations (City Syntax Lab, Zenodo 10.5281/zenodo.20477761): typical and hot-afternoon values at the selected hour.</li>
        </ul>

        <h4>Checked against the layers</h4>
        <p>Everything derived or generated is checked against the source layers. A failing check stops the data file being built, and shows a warning here if it happens on screen.</p>
        <p><b>When the data was built</b> ({build.filter((c) => c.pass).length} of {build.length} passed): counts and areas against the shapefiles, layers against each other, and the generated trees.</p>
        <CheckList checks={build} />
        {area.length > 0 && <><p><b>The area you have open</b> ({area.filter((c) => c.pass).length} of {area.length} passed):</p><CheckList checks={area} /></>}

        <h4>Assumptions where the data is silent</h4>
        <ul>
          <li>Buildings with no height or floor count: {DEFAULT_BUILDING_HEIGHT} m. Floors recorded but no height: 3.2 m per floor.</li>
          <li>Tree height: {DEFAULT_TREE_HEIGHT} m (the layers have crown outlines but no heights). Trees you plant: {DEFAULT_CROWN_RADIUS * 2} m crown.</li>
          <li>Small crowns are drawn as circles of the same area as the mapped canopy; large merged patches keep their outline and shade fully.</li>
          <li>Inside those dense patches the 3D view shows generated trees: random positions (seeded, so repeatable) with crown sizes taken from the layer’s own individual crowns. They are for display only. They are not surveyed locations, you can’t select them, and the shade figures use the patch outlines, not these trees.</li>
        </ul>

        <h4>Still needed from you</h4>
        <ul>
          <li><b>Energy use intensity (EUI) per building.</b> Not in the provided data. The building layer has no names or IDs, so it also needs a table linking each building to its EUI (for example from NUS Estate / Campus Sustainability or BCA Green Mark data).</li>
          <li>Tree heights or species (for example LiDAR or a campus tree survey) to replace the {DEFAULT_TREE_HEIGHT} m assumption.</li>
          <li>The Xu et al. (2024) paper itself, to confirm the air and UTCI figures.</li>
        </ul>
      </div>
    </div>
  );
}
