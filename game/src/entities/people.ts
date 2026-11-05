import { PEOPLE } from '../config';
import { DIRS, opposite, type Dir, type Grid } from '../grid';
import type { Rng } from '../rng';

export type PersonState = 'entering' | 'wandering' | 'fleeing' | 'trapped';

export interface Person {
  id: number;
  cell: number;
  /** Cell before the last step, for drawing in between. */
  previous: number;
  dir: Dir;
  state: PersonState;
  enterLeft: number;
  /** Index into the shirt palette. */
  color: number;
}

export const SHIRT_COLORS = 6;

/** Unreached cells count as infinitely far from the snake. */
const far = (distance: number) => (distance < 0 ? 1e9 : distance);

export class People {
  list: Person[] = [];
  /** How many people the crowd is kept at; more in recording mode (spec §15.4). */
  target: number = PEOPLE.COUNT;
  /** Person id by cell, −1 where nobody stands. */
  readonly at: Int16Array;
  private nextId = 0;

  constructor(
    private readonly grid: Grid,
    /** Ring-road cells where replacements walk in. */
    private readonly entry: readonly number[],
    private readonly rng: Rng,
  ) {
    this.at = new Int16Array(grid.cellCount).fill(-1);
  }

  /** Walkable, and neither the snake nor another person is there. The snake is a wall (spec §5.2). */
  private free(cell: number, snake: Uint8Array): boolean {
    return cell >= 0 && this.grid.walkable(cell) && !snake[cell] && this.at[cell] < 0;
  }

  private openDirs(cell: number, snake: Uint8Array): Dir[] {
    return DIRS.filter((dir) => this.free(this.grid.neighbor(cell, dir), snake));
  }

  private add(cell: number, dir: Dir, state: PersonState): Person {
    const person: Person = {
      id: this.nextId++,
      cell,
      previous: cell,
      dir,
      state,
      enterLeft: state === 'entering' ? PEOPLE.ENTER_STEPS : 0,
      color: this.rng.int(0, SHIRT_COLORS - 1),
    };
    this.list.push(person);
    this.at[cell] = person.id;
    return person;
  }

  /** Scatter people away from the head until the crowd reaches `target` (spec §5.1). */
  populate(snake: Uint8Array, distance: Int16Array): void {
    const candidates: number[] = [];
    for (let cell = 0; cell < this.grid.cellCount; cell++) {
      if (this.free(cell, snake) && far(distance[cell]) >= PEOPLE.SPAWN_MIN_DIST) candidates.push(cell);
    }
    while (this.list.length < this.target && candidates.length > 0) {
      const cell = candidates.splice(this.rng.int(0, candidates.length - 1), 1)[0];
      const dirs = this.openDirs(cell, snake);
      this.add(cell, dirs.length > 0 ? this.rng.pick(dirs) : 0, 'wandering');
    }
  }

  /** Bring in a replacement on the ring road, far from the head, walking inward (spec §5.1). */
  spawnReplacement(snake: Uint8Array, distance: Int16Array): Person | null {
    const candidates = this.entry.filter((cell) => this.free(cell, snake));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => far(distance[b]) - far(distance[a]));
    const cell = this.rng.pick(candidates.slice(0, PEOPLE.SPAWN_FAR_PICK));
    return this.add(cell, this.inwardDir(cell), 'entering');
  }

  private inwardDir(cell: number): Dir {
    let best: Dir = 0;
    let bestEdge = -1;
    for (const dir of DIRS) {
      const next = this.grid.neighbor(cell, dir);
      if (next < 0) continue;
      const edge = this.grid.edgeDistance(next);
      if (edge > bestEdge) {
        best = dir;
        bestEdge = edge;
      }
    }
    return best;
  }

  remove(id: number): Person | null {
    const index = this.list.findIndex((person) => person.id === id);
    if (index < 0) return null;
    const [person] = this.list.splice(index, 1);
    this.at[person.cell] = -1;
    return person;
  }

  /** Everyone takes one step. `distance` is the head's step count with the body as walls. */
  step(snake: Uint8Array, distance: Int16Array): void {
    for (const person of this.list) {
      person.previous = person.cell;
      const near = distance[person.cell] >= 0 && distance[person.cell] <= PEOPLE.FLEE_RADIUS;
      if (near) person.state = 'fleeing';
      else if (person.state === 'fleeing' || person.state === 'trapped') person.state = 'wandering';

      const dirs = this.openDirs(person.cell, snake);
      if (dirs.length === 0) {
        if (near) person.state = 'trapped';
        continue;
      }

      let dir: Dir | null;
      switch (person.state) {
        case 'fleeing':
          dir = this.fleeDir(person, dirs, distance);
          break;
        case 'entering':
          dir = this.enterDir(person, dirs);
          if (--person.enterLeft <= 0) person.state = 'wandering';
          break;
        default:
          dir = this.wanderDir(person, dirs);
      }
      if (dir === null) continue;

      const next = this.grid.neighbor(person.cell, dir);
      this.at[person.cell] = -1;
      this.at[next] = person.id;
      person.cell = next;
      person.dir = dir;
    }
  }

  /** Step to the open neighbour furthest from the head, or stay if nowhere is better. */
  private fleeDir(person: Person, dirs: Dir[], distance: Int16Array): Dir | null {
    let best: Dir[] = [];
    let bestDistance = far(distance[person.cell]);
    for (const dir of dirs) {
      const d = far(distance[this.grid.neighbor(person.cell, dir)]);
      if (d > bestDistance) {
        best = [dir];
        bestDistance = d;
      } else if (d === bestDistance) {
        best.push(dir);
      }
    }
    return best.length > 0 ? this.rng.pick(best) : null;
  }

  private enterDir(person: Person, dirs: Dir[]): Dir {
    let best = dirs[0];
    let bestEdge = -1;
    for (const dir of dirs) {
      const edge = this.grid.edgeDistance(this.grid.neighbor(person.cell, dir));
      if (edge > bestEdge || (edge === bestEdge && dir === person.dir)) {
        best = dir;
        bestEdge = edge;
      }
    }
    return best;
  }

  /** Keep going straight, sometimes turning; only turn back at a dead stop. */
  private wanderDir(person: Person, dirs: Dir[]): Dir {
    const back = opposite(person.dir);
    const ahead = dirs.includes(person.dir);
    const sideways = dirs.filter((dir) => dir !== person.dir && dir !== back);
    if (ahead && (sideways.length === 0 || !this.rng.chance(PEOPLE.TURN_CHANCE))) return person.dir;
    if (sideways.length > 0) return this.rng.pick(sideways);
    return ahead ? person.dir : back;
  }
}
