// d3-geo-projection ships no types; declare only what we use.
declare module 'd3-geo-projection' {
  import type { GeoProjection } from 'd3-geo';
  export function geoRobinson(): GeoProjection;
}
