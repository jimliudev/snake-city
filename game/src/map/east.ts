// The 台北東區 map, converted ahead of time from OpenStreetMap by scripts/build-map.ts (spec §13).

import { Grid, Terrain } from '../grid';
import { finishCity, type CityMap, type Lot } from './city';
import data from './east.json';

export interface DistrictData {
  name: string;
  attribution: string;
  width: number;
  height: number;
  /** One string per row: '#' building, 'R' main road, 'S' street, 'A' alley. */
  rows: string[];
  /** [x, z, w, d, floors, color] */
  lots: Array<[number, number, number, number, number, number]>;
}

export const TERRAIN_CHARS: Record<string, Terrain> = {
  '#': Terrain.BUILDING,
  R: Terrain.ROAD,
  S: Terrain.STREET,
  A: Terrain.ALLEY,
};

export function districtGrid(district: DistrictData): Grid {
  const grid = new Grid(district.width, district.height);
  district.rows.forEach((row, z) => {
    [...row].forEach((char, x) => {
      const terrain = TERRAIN_CHARS[char];
      if (terrain === undefined) throw new Error(`Unknown map character '${char}' at (${x}, ${z}).`);
      grid.terrain[grid.index(x, z)] = terrain;
    });
  });
  return grid;
}

export const EAST = data as DistrictData;

export function loadEast(): CityMap {
  const lots: Lot[] = EAST.lots.map(([x, z, w, d, floors, color]) => ({ x, z, w, d, floors, color }));
  return finishCity('east', districtGrid(EAST), lots, []);
}
