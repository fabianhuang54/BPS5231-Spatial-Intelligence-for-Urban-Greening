/**
 * Every cooling coefficient used by the simulator, with the published study it comes from.
 * Nothing else in the app produces a temperature figure.
 */
export interface Ref { id: number; cite: string; doi: string; finding: string; note?: string }

export const REFS: Ref[] = [
  {
    id: 1,
    cite: 'Ow, L.F., Ghosh, S. & Mohd Yusof, M.L. (2020). The benefits of tree shade and turf on globe and surface temperatures in an urban tropical environment. Arboriculture & Urban Forestry 46(3):228–244.',
    doi: '10.48044/jauf.2020.017',
    finding: 'Singapore field plots: sunlit concrete peaked at 53 °C vs 48 °C in tree shade (−5 °C); the authors report tree shade lowering surface temperature by up to 12 °C.',
  },
  {
    id: 2,
    cite: 'Xu, L., Bardhan, R., Mei, H., Gopalakrishnan, S., Zheng, X. & Schroepfer, T. (2024). Harnessing street shade to mitigate heat stress: an in-situ parallel investigation under extreme heat conditions in tropical Singapore. Science of the Total Environment 958:177864 (2025; online 13 Dec 2024).',
    doi: '10.1016/j.scitotenv.2024.177864',
    finding: 'Paired sunlit/shaded street locations (PubMed 39674147): shade lowered air temperature by 0.8 °C and UTCI by 3.1 °C on average.',
  },
  {
    id: 3,
    cite: 'Meili, N., Acero, J.A., Peleg, N., Manoli, G., Burlando, P. & Fatichi, S. (2021). Vegetation cover and plant-trait effects on outdoor thermal comfort in a tropical city. Building and Environment 195:107733.',
    doi: '10.1016/j.buildenv.2021.107733',
    finding: 'Singapore model study: tree and ground vegetation cover lowered midday UTCI by 0.9–2.9 °C.',
  },
  {
    id: 4,
    cite: 'Qin, X., Wu, X., Chiew, Y.-M. & Li, Y. (2012). A green roof test bed for stormwater management and reduction of urban heat island effect in Singapore. British Journal of Environment & Climate Change 2(4):410–420 (online 19 Jan 2013).',
    doi: '10.5281/zenodo.8073',
    finding: 'NTU test bed, 10:00–16:00: green roofs averaged 7.3 °C cooler roof surface and 0.5 °C cooler air than a bare roof.',
  },
];

/** Central value and the range reported in the literature. `ref` indexes REFS. */
export const COEFF = {
  /** Surface temperature under tree shade vs sunlit hard surface, °C. Measured on small plots in housing estates, applied here to all paved street area. */
  surfaceShade: { value: 5, range: [5, 12] as [number, number], ref: [1] },
  /** Air temperature difference, shaded vs sunlit street, °C. */
  airShade: { value: 0.8, ref: [2] },
  /** UTCI (perceived heat) difference, shaded vs sunlit, °C. */
  utciShade: { value: 3.1, ref: [2, 3] },
  /** Green roof vs bare roof: roof surface and ambient air, °C. */
  roofSurface: { value: 7.3, ref: [4] },
  roofAir: { value: 0.5, ref: [4] },
};
