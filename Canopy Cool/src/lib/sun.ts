const RAD = Math.PI / 180;

/** Solar altitude and azimuth (radians, azimuth clockwise from north). NOAA low-precision formulae. */
export function solarPosition(date: Date, lat: number, lng: number): { alt: number; az: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const H = ((gmst * 15 + lng) * RAD) - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

/** Ground offset (x east, z south) of the shadow tip of something `h` metres tall. Capped for low sun. */
export function shadowOffset(h: number, alt: number, az: number): [number, number] {
  const len = Math.min(h / Math.tan(Math.max(alt, 4 * RAD)), 250);
  return [-Math.sin(az) * len, Math.cos(az) * len];
}

/** A Date for a given Singapore (UTC+8) hour on today's date. */
export function sgDate(hour: number, base = new Date()): Date {
  const sg = new Date(base.getTime() + 8 * 3600000);
  return new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate()) + (hour - 8) * 3600000);
}

export function sgHourNow(): number {
  const sg = new Date(Date.now() + 8 * 3600000);
  return sg.getUTCHours() + sg.getUTCMinutes() / 60;
}
