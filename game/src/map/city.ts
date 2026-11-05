// What every map provides, whether generated (§3) or converted from a real district (§13).

import { MAP, SNAKE } from '../config';
import { Terrain, type Dir, type Grid } from '../grid';

export type MapId = 'random' | 'east';

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** A straight strip of road. 'x' strips run east–west, 'z' strips run north–south. */
export interface Strip extends Rect {
  axis: 'x' | 'z';
}

/** What a building is used for, from OpenStreetMap; it picks the building's look (spec §14.4). */
export const BuildingKind = {
  APARTMENT: 0,
  OFFICE: 1,
  MALL: 2,
  SCHOOL: 3,
  HOSPITAL: 4,
  PUBLIC: 5,
} as const;
export type BuildingKind = (typeof BuildingKind)[keyof typeof BuildingKind];

export interface Lot extends Rect {
  floors: number;
  /** Index into the building palette. */
  color: number;
  /** Real districts only; generated cities leave it out and every building looks alike. */
  kind?: BuildingKind;
  /**
   * Lots with the same group are parts of one real building and are drawn joined, with no gap
   * or inside walls between them. Generated cities leave it out: every lot stands alone.
   */
  group?: number;
}

export interface CityMap {
  id: MapId;
  grid: Grid;
  lots: Lot[];
  /** Alleys cut by the generator; empty for real districts. Only the checks use them. */
  alleys: Strip[];
  /** Head cell and facing for a new snake, body trailing behind. */
  spawn: { cell: number; dir: Dir };
  /** Ring-road cells where replacement people walk in (spec §5.1). */
  entry: number[];
}

export const BUILDING_COLORS = 8;

export function finishCity(id: MapId, grid: Grid, lots: Lot[], alleys: Strip[]): CityMap {
  const entry: number[] = [];
  for (let cell = 0; cell < grid.cellCount; cell++) {
    if (grid.terrain[cell] === Terrain.ROAD && grid.edgeDistance(cell) < MAP.ROAD_WIDTH) entry.push(cell);
  }
  return { id, grid, lots, alleys, spawn: findSpawn(grid), entry };
}

/** Straight walkable cells from `cell` in `dir`, not counting `cell` itself. */
function straightRun(grid: Grid, cell: number, dir: Dir): number {
  let run = 0;
  for (let next = grid.neighbor(cell, dir); next >= 0 && grid.walkable(next); next = grid.neighbor(next, dir)) run++;
  return run;
}

/**
 * The main-road cell nearest the map centre, facing the direction with the longest straight
 * run that still leaves room behind it for the initial body (spec §4.1).
 */
function findSpawn(grid: Grid): CityMap['spawn'] {
  const centreX = (grid.width - 1) / 2;
  const centreZ = (grid.height - 1) / 2;
  const candidates: number[] = [];
  for (let cell = 0; cell < grid.cellCount; cell++) {
    if (grid.terrain[cell] === Terrain.ROAD) candidates.push(cell);
  }
  const offset = (cell: number) => Math.abs(grid.x(cell) - centreX) + Math.abs(grid.z(cell) - centreZ);
  candidates.sort((a, b) => offset(a) - offset(b));

  for (const cell of candidates) {
    let best: CityMap['spawn'] | null = null;
    let bestRun = 0;
    for (const dir of [0, 1, 2, 3] as const) {
      const behind = ((dir + 2) % 4) as Dir;
      if (straightRun(grid, cell, behind) < SNAKE.INITIAL_LENGTH - 1) continue;
      const run = straightRun(grid, cell, dir);
      if (run > bestRun) {
        best = { cell, dir };
        bestRun = run;
      }
    }
    if (best && bestRun >= 3) return best;
  }
  throw new Error('No road cell can hold the initial snake.');
}
