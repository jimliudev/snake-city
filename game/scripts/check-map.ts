// Checks the rules in spec.md §3.2 on many generated cities, and the same street rules on the
// real district (§13.8). Run with `npm run check:map`; exits non-zero when any rule is broken.

import { MAP, SNAKE } from '../src/config';
import { DIRS, Terrain, opposite, type Grid } from '../src/grid';
import type { CityMap } from '../src/map/city';
import { loadEast } from '../src/map/east';
import { generateCity } from '../src/map/generate';
import { Rng } from '../src/rng';

const SEEDS = 500;

const failures: string[] = [];

const fail = (label: string, message: string) => {
  if (failures.length < 30) failures.push(`${label}: ${message}`);
  else if (failures.length === 30) failures.push('…');
};

function walkableCells(grid: Grid): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < grid.cellCount; cell++) if (grid.walkable(cell)) cells.push(cell);
  return cells;
}

/** Rules every map follows: connected, no dead ends, a legal spawn, lots only on buildings. */
function checkStreets(city: CityMap, label: string): number {
  const { grid } = city;
  const walkable = walkableCells(grid);

  const distance = grid.distances([walkable[0]], () => false, new Int16Array(grid.cellCount));
  const unreached = walkable.filter((cell) => distance[cell] < 0).length;
  if (unreached > 0) fail(label, `${unreached} street cells are cut off`);

  // Any street cell with only one way out is a dead end.
  for (const cell of walkable) {
    const exits = DIRS.filter((dir) => {
      const next = grid.neighbor(cell, dir);
      return next >= 0 && grid.walkable(next);
    }).length;
    if (exits < 2) fail(label, `dead end at (${grid.x(cell)}, ${grid.z(cell)})`);
  }

  // Spawn: on a main road, with the initial body behind it on walkable cells.
  let cell = city.spawn.cell;
  if (grid.terrain[cell] !== Terrain.ROAD) fail(label, 'spawn is not on a main road');
  for (let i = 1; i < SNAKE.INITIAL_LENGTH; i++) {
    cell = grid.neighbor(cell, opposite(city.spawn.dir));
    if (cell < 0 || !grid.walkable(cell)) fail(label, 'initial body does not fit behind the spawn');
  }
  const ahead = grid.neighbor(city.spawn.cell, city.spawn.dir);
  if (ahead < 0 || !grid.walkable(ahead)) fail(label, 'spawn faces a wall');

  if (city.entry.length === 0) fail(label, 'no ring-road cells for people to walk in from');

  // Lots cover only building cells, and never each other.
  const covered = new Uint8Array(grid.cellCount);
  for (const lot of city.lots) {
    for (let z = lot.z; z < lot.z + lot.d; z++) {
      for (let x = lot.x; x < lot.x + lot.w; x++) {
        const index = grid.index(x, z);
        if (!grid.inside(x, z) || grid.terrain[index] !== Terrain.BUILDING) fail(label, `lot at (${lot.x}, ${lot.z}) covers a street`);
        else if (covered[index]++) fail(label, `lots overlap at (${x}, ${z})`);
      }
    }
  }
  return walkable.length;
}

/** The generator's own promises: alleys end on roads at both ends and are exactly ALLEY_WIDTH wide. */
function checkAlleys(city: CityMap, label: string): void {
  const { grid } = city;
  const terrainAt = (x: number, z: number) => (grid.inside(x, z) ? grid.terrain[grid.index(x, z)] : -1);
  for (const alley of city.alleys) {
    const across = alley.axis === 'z' ? alley.w : alley.d;
    if (across !== MAP.ALLEY_WIDTH) fail(label, `alley at (${alley.x}, ${alley.z}) is ${across} wide`);
    // Ends: the row (or column) just past each end is main road.
    for (let i = 0; i < across; i++) {
      const ends =
        alley.axis === 'z'
          ? [terrainAt(alley.x + i, alley.z - 1), terrainAt(alley.x + i, alley.z + alley.d)]
          : [terrainAt(alley.x - 1, alley.z + i), terrainAt(alley.x + alley.w, alley.z + i)];
      if (ends.some((terrain) => terrain !== Terrain.ROAD)) fail(label, `alley at (${alley.x}, ${alley.z}) ends without a road`);
    }
    // Sides: buildings all along, so the alley is no wider than it says.
    const length = alley.axis === 'z' ? alley.d : alley.w;
    for (let i = 0; i < length; i++) {
      const sides =
        alley.axis === 'z'
          ? [terrainAt(alley.x - 1, alley.z + i), terrainAt(alley.x + alley.w, alley.z + i)]
          : [terrainAt(alley.x + i, alley.z - 1), terrainAt(alley.x + i, alley.z + alley.d)];
      if (sides.some((terrain) => terrain !== Terrain.BUILDING)) {
        fail(label, `alley at (${alley.x}, ${alley.z}) is wider than ${MAP.ALLEY_WIDTH} cells`);
        break;
      }
    }
  }
}

// Random cities.
const walkableCounts: number[] = [];
let alleyTotal = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const city = generateCity(new Rng(seed));
  walkableCounts.push(checkStreets(city, `seed ${seed}`));
  checkAlleys(city, `seed ${seed}`);
  alleyTotal += city.alleys.length;
}
const sorted = [...walkableCounts].sort((a, b) => a - b);
const mean = walkableCounts.reduce((sum, value) => sum + value, 0) / walkableCounts.length;
const total = MAP.SIZE * MAP.SIZE;
console.log(`${SEEDS} random cities, ${MAP.SIZE}×${MAP.SIZE}`);
console.log(
  `  walkable cells: min ${sorted[0]}, mean ${mean.toFixed(0)}, max ${sorted[sorted.length - 1]}` +
    ` (${((mean / total) * 100).toFixed(0)}% of the map)`,
);
console.log(`  alleys per city: ${(alleyTotal / SEEDS).toFixed(1)}`);

// The real district.
const east = loadEast();
const eastWalkable = checkStreets(east, '台北東區');
const { width, height } = east.grid;
console.log(`台北東區, ${width}×${height}`);
console.log(`  walkable cells: ${eastWalkable} (${((eastWalkable / (width * height)) * 100).toFixed(0)}% of the map), ${east.lots.length} lots`);

if (failures.length > 0) {
  console.error(`\n${failures.length} problems:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('all checks passed');
