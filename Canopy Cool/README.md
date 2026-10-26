# CanopyCool Singapore

Explore the NUS Kent Ridge campus, see where paving is sunlit, and test where trees and green roofs would help. Works offline; no API keys.

1. The whole campus opens first.
2. Drag a rectangle (or click for a 300 m square) to open that area in 3D.
3. Click a building for its height, floors, footprint, rooftop PV/greenery and shadow length.
4. **Plant trees** to place trees: a live card shows the paving each would newly shade.
5. **Recommend** ranks the best planting spots and shows what they would change before you accept them.

Every temperature figure is a published, cited difference (see **Sources** in the app, or `src/lib/evidence.ts`).

## Run

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests
npm run build
```

## Data

**Offline first.** The default sites (`NUS · Zone 1 … 7`) use the NUS Kent Ridge campus layers bundled in `public/data/nus.json`, so they need no network: buildings (with recorded heights), tree canopy, forest, paved areas, turf, shrubs, existing green roofs and rooftop PV, plus typical hourly conditions from the 40 campus weather stations (2025). After the first visit a service worker keeps the app and data available offline (production build only).

Rebuild the bundle from the project repo (`SHP_files/` and `data/raw/`):

```bash
node scripts/build-nus-data.mjs "<path to the BPS5231 repo>"
```

The earlier live OpenStreetMap, NEA and NParks loaders were removed to keep the app lean; they are in git history (commit `dee45fc`).

## Cooling figures

All coefficients live in `src/lib/evidence.ts` with the study each comes from; the app lists the references. They are scaled linearly by the share of street area newly shaded, which is a planning estimate, not a validated simulation. The Xu et al. (2024) figures come from secondary coverage and still need checking against the paper.
