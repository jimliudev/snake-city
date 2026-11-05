// City generation by recursive subdivision (spec §3). Every road and alley runs the full
// length of the rectangle it splits, so both of its ends meet another road: the street
// network is connected and has no dead ends by construction. scripts/check-map.ts verifies it.

import { MAP } from '../config';
import { Grid, Terrain } from '../grid';
import type { Rng } from '../rng';
import { BUILDING_COLORS, finishCity, type CityMap, type Lot, type Rect, type Strip } from './city';

function fill(grid: Grid, rect: Rect, terrain: Terrain): void {
  for (let z = rect.z; z < rect.z + rect.d; z++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) grid.terrain[grid.index(x, z)] = terrain;
  }
}

export function generateCity(rng: Rng): CityMap {
  const size = MAP.SIZE;
  const road = MAP.ROAD_WIDTH;
  const alley = MAP.ALLEY_WIDTH;
  const grid = new Grid(size, size);
  const roads: Strip[] = [];
  const alleys: Strip[] = [];
  const lots: Lot[] = [];

  // Ring road along the edge.
  roads.push(
    { axis: 'x', x: 0, z: 0, w: size, d: road },
    { axis: 'x', x: 0, z: size - road, w: size, d: road },
    { axis: 'z', x: 0, z: 0, w: road, d: size },
    { axis: 'z', x: size - road, z: 0, w: road, d: size },
  );

  // Split the inside with main roads until every piece is a block.
  const blocks: Rect[] = [];
  const pending: Rect[] = [{ x: road, z: road, w: size - 2 * road, d: size - 2 * road }];
  while (pending.length > 0) {
    const rect = pending.pop()!;
    if (Math.max(rect.w, rect.d) <= MAP.BLOCK_MAX) {
      blocks.push(rect);
      continue;
    }
    if (rect.w >= rect.d) {
      const at = rng.int(rect.x + MAP.BLOCK_MIN, rect.x + rect.w - MAP.BLOCK_MIN - road);
      roads.push({ axis: 'z', x: at, z: rect.z, w: road, d: rect.d });
      pending.push({ ...rect, w: at - rect.x }, { ...rect, x: at + road, w: rect.x + rect.w - at - road });
    } else {
      const at = rng.int(rect.z + MAP.BLOCK_MIN, rect.z + rect.d - MAP.BLOCK_MIN - road);
      roads.push({ axis: 'x', x: rect.x, z: at, w: rect.w, d: road });
      pending.push({ ...rect, d: at - rect.z }, { ...rect, z: at + road, d: rect.z + rect.d - at - road });
    }
  }

  // Cut some blocks with an alley across their long side, leaving ≥ 2 cells either side.
  const plots: Rect[] = [];
  for (const block of blocks) {
    const long = Math.max(block.w, block.d);
    if (long < MAP.ALLEY_MIN_BLOCK || !rng.chance(MAP.ALLEY_CHANCE)) {
      plots.push(block);
      continue;
    }
    if (block.w >= block.d) {
      const at = rng.int(block.x + 2, block.x + block.w - 2 - alley);
      alleys.push({ axis: 'z', x: at, z: block.z, w: alley, d: block.d });
      plots.push({ ...block, w: at - block.x }, { ...block, x: at + alley, w: block.x + block.w - at - alley });
    } else {
      const at = rng.int(block.z + 2, block.z + block.d - 2 - alley);
      alleys.push({ axis: 'x', x: block.x, z: at, w: block.w, d: alley });
      plots.push({ ...block, d: at - block.z }, { ...block, z: at + alley, d: block.z + block.d - at - alley });
    }
  }

  // Buildings: each plot is cut into lots with their own height and colour.
  const cutLots = (rect: Rect): void => {
    if (rect.w > MAP.LOT_MAX && rect.w >= rect.d) {
      const at = rng.int(2, rect.w - 2);
      cutLots({ ...rect, w: at });
      cutLots({ ...rect, x: rect.x + at, w: rect.w - at });
    } else if (rect.d > MAP.LOT_MAX) {
      const at = rng.int(2, rect.d - 2);
      cutLots({ ...rect, d: at });
      cutLots({ ...rect, z: rect.z + at, d: rect.d - at });
    } else {
      lots.push({ ...rect, floors: rng.int(MAP.FLOORS_MIN, MAP.FLOORS_MAX), color: rng.int(0, BUILDING_COLORS - 1) });
    }
  };
  plots.forEach(cutLots);

  // Terrain is BUILDING (0) by default; paint the streets.
  for (const strip of roads) fill(grid, strip, Terrain.ROAD);
  for (const strip of alleys) fill(grid, strip, Terrain.ALLEY);

  return finishCity('random', grid, lots, alleys);
}
