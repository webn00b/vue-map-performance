export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

/** Roughly the area inside the Moscow ring road. */
export const MOSCOW: Bounds = { west: 37.37, south: 55.58, east: 37.84, north: 55.91 }

export const MOSCOW_CENTER: [number, number] = [37.6176, 55.7558]
