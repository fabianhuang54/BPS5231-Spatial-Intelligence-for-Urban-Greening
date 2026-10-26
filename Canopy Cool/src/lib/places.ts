import { NUS_LL } from './nus';
import type { Place } from './types';

/** Starting points. NUS zones use the bundled campus layers (work offline); the rest are fetched live and need a network. */
export const PLACES: Place[] = [
  // centres of the NUS zone polygons (see scripts/build-nus-data.mjs)
  { name: 'NUS · Zone 1', ...NUS_LL, nus: { x: -370, z: 55 } },
  { name: 'NUS · Zone 2', ...NUS_LL, nus: { x: 221, z: 306 } },
  { name: 'NUS · Zone 3', ...NUS_LL, nus: { x: 536, z: 355 } },
  { name: 'NUS · Zone 4', ...NUS_LL, nus: { x: -227, z: 643 } },
  { name: 'NUS · Zone 7', ...NUS_LL, nus: { x: -131, z: -638 } },
  { name: 'Tanjong Pagar (live)', lat: 1.278, lng: 103.845 },
  { name: 'Bras Basah (live)', lat: 1.298, lng: 103.852 },
  { name: 'Marina Bay (live)', lat: 1.2796, lng: 103.8545 },
  { name: 'Punggol (live)', lat: 1.405, lng: 103.902 },
  { name: 'Jurong Lake (live)', lat: 1.332, lng: 103.738 },
];
