export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export interface City {
  center: [number, number]
  bounds: Bounds
  /** Whether a courier can be at this point, e.g. not in a lake. */
  contains(lng: number, lat: number): boolean
}

/** Lake Ontario shoreline along Toronto, simplified, west to east. */
const TORONTO_SHORELINE: [number, number][] = [
  [-79.58, 43.585],
  [-79.54, 43.595],
  [-79.5, 43.61],
  [-79.47, 43.625],
  [-79.43, 43.632],
  [-79.39, 43.638],
  [-79.36, 43.645],
  [-79.33, 43.652],
  [-79.3, 43.665],
  [-79.27, 43.675],
  [-79.24, 43.69],
  [-79.2, 43.725],
  [-79.17, 43.755],
  [-79.15, 43.77],
]
/** Keeps couriers a few hundred metres off the water. */
const SHORE_MARGIN = 0.004

export const TORONTO: City = {
  center: [-79.4, 43.715],
  bounds: { west: -79.58, south: 43.585, east: -79.15, north: 43.84 },
  contains: (lng, lat) => lat > latitudeOnLine(TORONTO_SHORELINE, lng) + SHORE_MARGIN,
}

/** Latitude of a west-to-east polyline at `lng`, linearly interpolated. */
function latitudeOnLine(line: [number, number][], lng: number): number {
  const first = line[0]!
  const last = line[line.length - 1]!
  if (lng <= first[0]) return first[1]
  if (lng >= last[0]) return last[1]
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i]!
    if (lng <= x1) {
      const [x0, y0] = line[i - 1]!
      return y0 + ((lng - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return last[1]
}
