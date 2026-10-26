import { COEFF } from '../lib/evidence';
import type { Impact } from '../lib/impact';
import { shadowOffset } from '../lib/sun';
import type { Spot } from '../lib/shade';
import type { Building } from '../lib/types';

export const Ref = ({ ids, open }: { ids: number[]; open: () => void }) => (
  <>{ids.map((i) => <button key={i} className="ref" onClick={open} title="Open sources">[{i}]</button>)}</>
);

const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
const drop = (n: number) => (n === 0 ? '0' : `−${n.toFixed(Math.abs(n) < 0.1 ? 2 : 1)}`);

/** Shaded share of the paved area, before and after. The lighter segment is what the plan adds. */
function ShadeBars({ before, after, labels = ['Now', 'After'] }: { before: number; after: number; labels?: [string, string] }) {
  return (
    <div className="bars" role="img" aria-label={`Shaded paving ${pct(before)} to ${pct(after)}`}>
      <div className="bar-row"><span>{labels[0]}</span><div className="track"><i style={{ width: `${before * 100}%` }} /></div><b>{pct(before)}</b></div>
      <div className="bar-row"><span>{labels[1]}</span><div className="track"><i style={{ width: `${before * 100}%` }} /><i className="add" style={{ width: `${Math.max(after - before, 0) * 100}%` }} /></div><b>{pct(after)}</b></div>
    </div>
  );
}

/** What a person standing in the new shade gets: the published shaded-vs-sunlit differences. */
function ShadeTiles({ open }: { open: () => void }) {
  const { surfaceShade: s, airShade: a, utciShade: u } = COEFF;
  return (
    <div className="tiles">
      <div><b>−{s.value} °C</b><span>paving surface</span><small>up to −{s.range[1]} °C <Ref ids={s.ref} open={open} /></small></div>
      <div><b>−{a.value} °C</b><span>air at street level</span><small><Ref ids={a.ref} open={open} /></small></div>
      <div><b>−{u.value} °C</b><span>feels-like (UTCI)</span><small><Ref ids={u.ref} open={open} /></small></div>
    </div>
  );
}

export function Hint({ children }: { children: React.ReactNode }) { return <div className="card hint"><p>{children}</p></div>; }

export function PreviewCard({ ok, reason, gainM2, pavedArea, open }: { ok: boolean; reason: string | null; gainM2: number; pavedArea: number; open: () => void }) {
  if (!ok) return <div className="card bad"><h3>Can’t plant here</h3><p>{reason}</p></div>;
  return (
    <div className="card">
      <h3>If you plant here</h3>
      <div className="hero"><b>+{gainM2.toFixed(0)} m²</b><span>of paving newly shaded ({pct(gainM2 / Math.max(pavedArea, 1))} of this area’s paving)</span></div>
      {gainM2 < 1
        ? <p className="muted">This spot adds almost no shade: the paving here is already shaded. Orange paving on the ground is sunlit.</p>
        : <><p className="eyebrow">For anyone standing in that new shade</p><ShadeTiles open={open} /></>}
      <p className="muted">Click to plant · click a planted tree to remove it</p>
    </div>
  );
}

export function PlanCard({ im, open }: { im: Impact; open: () => void }) {
  return (
    <div className="card">
      <h3>Your plan</h3>
      <ShadeBars before={im.shadeBefore} after={im.shadeAfter} />
      <div className="facts">
        {im.addedTrees > 0 && <p><b>{im.addedTrees}</b> trees · +{im.addedCanopyM2.toFixed(0)} m² canopy · <b>{im.newShadedM2.toFixed(0)} m²</b> paving newly shaded</p>}
        {im.greenRoofs > 0 && <p><b>{im.greenRoofs}</b> green roofs · {im.greenRoofM2.toFixed(0)} m² · roof surface −{im.roofSurface} °C <Ref ids={COEFF.roofSurface.ref} open={open} /></p>}
      </div>
      {im.addedTrees > 0 && <><p className="eyebrow">In the new shade</p><ShadeTiles open={open} /></>}
      <p className="eyebrow">Averaged over the whole area</p>
      <div className="facts"><p>Street air <b>{drop(im.areaMean.air)} °C</b> · feels-like <b>{drop(im.areaMean.utci)} °C</b>{im.roofAir > 0 && <> · roofs add <b>{drop(im.roofAir)} °C</b></>}</p></div>
      <p className="muted">Published differences scaled by the share of paving newly shaded. A planning estimate, not a simulation.</p>
    </div>
  );
}

export function SpotsCard({ now, withSpots, spots, onApply, onDismiss, open }: { now: Impact; withSpots: Impact; spots: Spot[]; onApply: () => void; onDismiss: () => void; open: () => void }) {
  const max = Math.max(...spots.map((s) => s.gainM2), 1);
  const gain = withSpots.newShadedM2 - now.newShadedM2;
  return (
    <div className="card">
      <h3>Recommended spots</h3>
      <p className="muted">Best places for {spots.length} trees: open ground next to sunlit paving, ranked by shade added.</p>
      <div className="row2"><button className="primary" onClick={onApply}>Plant these {spots.length}</button><button onClick={onDismiss}>Dismiss</button></div>
      <ShadeBars before={now.shadeAfter} after={withSpots.shadeAfter} labels={['Now', 'With spots']} />
      <div className="hero"><b>+{gain.toFixed(0)} m²</b><span>of paving newly shaded · +{(withSpots.addedCanopyM2 - now.addedCanopyM2).toFixed(0)} m² canopy</span></div>
      <ol className="spots">{spots.map((s, i) => (
        <li key={i}><span>{i + 1}</span><div className="track"><i style={{ width: `${(s.gainM2 / max) * 100}%` }} /></div><b>+{s.gainM2.toFixed(0)} m²</b></li>
      ))}</ol>
      <p className="eyebrow">In the new shade</p>
      <ShadeTiles open={open} />
      <p className="eyebrow">Averaged over the whole area</p>
      <div className="facts"><p>Street air <b>{drop(withSpots.areaMean.air - now.areaMean.air)} °C</b> · feels-like <b>{drop(withSpots.areaMean.utci - now.areaMean.utci)} °C</b> more than now</p></div>
    </div>
  );
}

export function BuildingCard({ b, hour, sun, greenRoof, onGreenRoof, onClose, open }: {
  b: Building; hour: string; sun: { alt: number; az: number }; greenRoof: boolean; onGreenRoof: () => void; onClose: () => void; open: () => void;
}) {
  const shadow = Math.hypot(...shadowOffset(b.height, sun.alt, sun.az));
  const row = (k: string, v: React.ReactNode) => <div className="row"><span>{k}</span><b>{v}</b></div>;
  return (
    <div className="card">
      <div className="card-head"><h3>Building</h3><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      {row('Height', <>{b.height.toFixed(1)} m <em className={b.heightRecorded ? 'tag' : 'tag warn'}>{b.heightRecorded ? 'recorded' : 'assumed'}</em></>)}
      {row('Floors', b.floors ? `${b.floors} above ground${b.floorsBelow ? ` · ${b.floorsBelow} below` : ''}` : 'not recorded')}
      {row('Footprint', `${b.footprint.toFixed(0)} m²`)}
      {b.floors > 0 && row('Floor area (est.)', `≈ ${(b.footprint * b.floors).toFixed(0)} m²`)}
      {row('Rooftop PV mapped', b.pvM2 > 0 ? `${b.pvM2.toFixed(0)} m²` : 'none')}
      {row('Rooftop greenery mapped', b.greenRoofM2 > 0 ? `${b.greenRoofM2.toFixed(0)} m²` : 'none')}
      {row(`Shadow at ${hour}`, sun.alt > 0.02 ? `${shadow.toFixed(0)} m long` : 'sun is down')}
      <div className="row"><span>Energy use (EUI)</span><b className="muted">no data provided</b></div>
      <p className="muted">Floor area is footprint × floors. EUI needs a per-building source: see Sources.</p>
      <button className={greenRoof ? 'primary' : ''} onClick={onGreenRoof}>{greenRoof ? 'Green roof added ✓' : 'Add a green roof'}</button>
      <p className="muted">A green roof runs about {COEFF.roofSurface.value} °C cooler at the roof surface than a bare roof <Ref ids={COEFF.roofSurface.ref} open={open} /></p>
    </div>
  );
}
