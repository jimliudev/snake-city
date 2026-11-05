// Plays many games with a simple greedy bot and checks the rules hold every frame:
// the snake never overlaps itself, people never stand on the snake or a building, the
// crowd stays at full size. Also prints how long a meal takes, to sanity-check the hunger
// numbers (spec §6). Run with `npm run check:sim`; exits non-zero when any rule is broken.

import { HUNGER, PEOPLE, SNAKE } from '../src/config';
import { DIRS, opposite, type Dir } from '../src/grid';
import type { MapId } from '../src/map/city';
import { Sim, type DeathCause } from '../src/sim';

const SEEDS = 80;
const EAST_SEEDS = 40;
const FRAME_MS = 1000 / 60;
const MAX_MS = 10 * 60 * 1000;

const failures: string[] = [];
const fail = (label: string, message: string) => {
  if (failures.length < 30) failures.push(`${label}: ${message}`);
};

/** Head towards the nearest person, never into a wall or the body if it can help it. */
function choose(sim: Sim, preyDistance: Int16Array): Dir {
  const { grid } = sim.city;
  const snake = sim.snake;
  sim.city.grid.distances(
    sim.people.list.map((person) => person.cell),
    (cell) => snake.occupied[cell] === 1 && cell !== snake.head,
    preyDistance,
  );
  let best = snake.dir;
  let bestScore = Infinity;
  for (const dir of DIRS) {
    if (dir === opposite(snake.dir)) continue;
    const next = grid.neighbor(snake.head, dir);
    if (next < 0 || !grid.walkable(next) || snake.bites(next, sim.people.at[next] >= 0)) continue;
    const d = preyDistance[next] < 0 ? 1e6 : preyDistance[next];
    const score = d + (dir === snake.dir ? 0 : 0.5);
    if (score < bestScore) {
      best = dir;
      bestScore = score;
    }
  }
  return best;
}

function checkInvariants(sim: Sim, label: string): void {
  const { grid } = sim.city;
  const seen = new Set<number>();
  for (const cell of sim.snake.cells) {
    if (seen.has(cell)) return fail(label, 'snake overlaps itself');
    seen.add(cell);
    if (!sim.snake.occupied[cell]) return fail(label, 'snake cell not marked occupied');
  }
  const marked = sim.snake.occupied.reduce((sum, value) => sum + value, 0);
  if (marked !== sim.snake.length) fail(label, `occupancy has ${marked} cells, snake has ${sim.snake.length}`);

  for (const person of sim.people.list) {
    if (!grid.walkable(person.cell)) fail(label, 'person inside a building');
    if (sim.snake.occupied[person.cell]) fail(label, 'person on the snake');
    if (sim.people.at[person.cell] !== person.id) fail(label, 'person index out of sync');
  }
  if (sim.state === 'playing' && sim.people.list.length !== sim.people.target) {
    fail(label, `crowd is ${sim.people.list.length}, expected ${sim.people.target}`);
  }
}

/** Play `games` bot games on one map, checking the rules every frame, and print a summary. */
function playMany(mapId: MapId, games: number, recording = false): void {
  const causes: Record<DeathCause | 'alive', number> = { wall: 0, self: 0, starve: 0, alive: 0 };
  const scores: number[] = [];
  let mealGaps = 0;
  let mealMsTotal = 0;
  let longestMealMs = 0;
  let maxLength = 0;
  let trappedSeen = 0;
  const firstTenSeconds: number[] = [];

  for (let seed = 1; seed <= games; seed++) {
    const label = `${mapId} seed ${seed}`;
    const sim = new Sim(seed, mapId);
    const preyDistance = new Int16Array(sim.city.grid.cellCount);
    if (sim.snake.length !== SNAKE.INITIAL_LENGTH) fail(label, 'wrong initial length');
    if (sim.people.list.length !== PEOPLE.COUNT) fail(label, 'wrong starting crowd');
    if (recording) sim.setRecording(true);
    let mealsByTen = 0;

    sim.turn(sim.snake.dir);
    let elapsed = 0;
    let lastMeal = 0;
    while (sim.state === 'playing' && elapsed < MAX_MS) {
      const dir = choose(sim, preyDistance);
      if (dir !== sim.snake.dir) sim.turn(dir);
      sim.update(FRAME_MS);
      elapsed += FRAME_MS;
      for (const event of sim.takeEvents()) {
        if (event.type !== 'eat') continue;
        const gap = elapsed - lastMeal;
        mealMsTotal += gap;
        mealGaps++;
        longestMealMs = Math.max(longestMealMs, gap);
        lastMeal = elapsed;
        if (elapsed <= 10_000) mealsByTen++;
      }
      trappedSeen += sim.people.list.some((person) => person.state === 'trapped') ? 1 : 0;
      maxLength = Math.max(maxLength, sim.snake.length);
      checkInvariants(sim, label);
    }
    causes[sim.cause ?? 'alive']++;
    scores.push(sim.score);
    firstTenSeconds.push(mealsByTen);
  }

  scores.sort((a, b) => a - b);
  firstTenSeconds.sort((a, b) => a - b);
  console.log(`${mapId}${recording ? ' (recording mode)' : ''}: ${games} games with a greedy bot`);
  console.log(`  score: min ${scores[0]}, median ${scores[games >> 1]}, max ${scores[games - 1]}; longest snake ${maxLength}`);
  console.log(`  deaths: wall ${causes.wall}, self ${causes.self}, starve ${causes.starve}, still alive after 10 min ${causes.alive}`);
  console.log(
    `  time per meal: mean ${(mealMsTotal / Math.max(1, mealGaps) / 1000).toFixed(1)} s, longest ${(longestMealMs / 1000).toFixed(1)} s`,
  );
  console.log(`  meals in the first 10 s: min ${firstTenSeconds[0]}, median ${firstTenSeconds[games >> 1]}, max ${firstTenSeconds[games - 1]}`);
  console.log(`  frames with someone trapped: ${trappedSeen}`);
}

playMany('random', SEEDS);
playMany('east', EAST_SEEDS);
playMany('random', SEEDS, true);
playMany('east', EAST_SEEDS, true);

// Starving: with nobody to eat and the snake only dodging walls, the first shrink after the
// grace period takes it below the initial length, so it starves at GRACE + SHRINK (spec §6).
{
  const sim = new Sim(1);
  for (const person of [...sim.people.list]) sim.people.remove(person.id);
  sim.turn(sim.snake.dir);
  let elapsed = 0;
  let shrinkEvents = 0;
  while (sim.state === 'playing' && elapsed < 60_000) {
    const { grid } = sim.city;
    const snake = sim.snake;
    const safe = DIRS.filter((dir) => {
      const next = grid.neighbor(snake.head, dir);
      return dir !== opposite(snake.dir) && next >= 0 && grid.walkable(next) && !snake.bites(next, false);
    });
    if (safe.length > 0 && !safe.includes(snake.dir)) sim.turn(safe[0]);
    sim.update(FRAME_MS);
    elapsed += FRAME_MS;
    shrinkEvents += sim.takeEvents().filter((event) => event.type === 'shrink').length;
  }
  const expected = HUNGER.GRACE_MS + HUNGER.SHRINK_MS;
  if (sim.cause !== 'starve') fail('starving', `starving scenario ended by ${sim.cause ?? 'nothing'}`);
  else if (Math.abs(elapsed - expected) > FRAME_MS * 2) fail('starving', `starved after ${elapsed.toFixed(0)} ms, expected ${expected}`);
  if (shrinkEvents !== 1) fail('starving', `starving scenario shrank ${shrinkEvents} times, expected 1`);
  console.log(`starving: died after ${(elapsed / 1000).toFixed(2)} s (expected ${expected / 1000} s)`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problems:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('all checks passed');
