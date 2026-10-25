# CanopyCool Singapore

Plan street trees and green roofs on a real Singapore site and see the shade and cooling they add. No API keys needed.

## Run

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests
npm run build
```

## Data (all fetched live in the browser)

| What | Source |
|---|---|
| Roads, footpaths, buildings, trees | OpenStreetMap via Overpass API (© OpenStreetMap contributors, ODbL) |
| Air temperature, humidity, wind, UV, 2-hour forecast | NEA real-time API on data.gov.sg |
| Heritage trees | NParks Heritage Trees register on data.gov.sg |

NParks' full street-tree inventory (TreesSG) has no open API, so tree coverage depends on what OpenStreetMap contains. The free Overpass servers are sometimes busy; the app retries and caches results for 7 days.

## Cooling figures

All coefficients live in `src/lib/evidence.ts` with the study each comes from; the app lists the references. They are scaled linearly by the share of street area newly shaded, which is a planning estimate, not a validated simulation. The Xu et al. (2024) figures come from secondary coverage and still need checking against the paper.
