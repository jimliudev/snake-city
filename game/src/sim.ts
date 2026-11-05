// The whole game's rules, without rendering: snake ticks, people, hunger, scoring, death.

import { HUNGER, PEOPLE, RECORDING, SNAKE } from './config';
import { People } from './entities/people';
import { Snake } from './entities/snake';
import type { Dir } from './grid';
import type { CityMap, MapId } from './map/city';
import { loadEast } from './map/east';
import { generateCity } from './map/generate';
import { Rng } from './rng';

export type DeathCause = 'wall' | 'self' | 'starve';
export type SimState = 'ready' | 'playing' | 'dead';

export type SimEvent =
  | { type: 'eat'; cell: number; color: number }
  | { type: 'shrink'; cell: number }
  | { type: 'die'; cause: DeathCause };

export function speedFor(length: number): number {
  return Math.min(SNAKE.SPEED_MAX, SNAKE.SPEED_BASE + (length - SNAKE.INITIAL_LENGTH) * SNAKE.SPEED_K);
}

export class Sim {
  readonly city: CityMap;
  readonly snake: Snake;
  readonly people: People;
  /** Steps from the head with the body as walls; recomputed every snake tick. */
  readonly distance: Int16Array;

  state: SimState = 'ready';
  cause: DeathCause | null = null;
  score = 0;
  /** Time since the last meal. */
  hungerMs = 0;
  /** Milliseconds into the current snake tick and people step, for drawing in between. */
  snakeMs = 0;
  peopleMs = 0;
  events: SimEvent[] = [];

  private shrinks = 0;
  private readonly rng: Rng;

  /** The random city is generated from `seed`; a real district is fixed and only the people use it. */
  constructor(
    readonly seed: number,
    readonly mapId: MapId = 'random',
  ) {
    this.rng = new Rng(seed);
    this.city = mapId === 'east' ? loadEast() : generateCity(this.rng);
    const grid = this.city.grid;
    this.snake = new Snake(grid, this.city.spawn.cell, this.city.spawn.dir);
    this.people = new People(grid, this.city.entry, this.rng);
    this.distance = new Int16Array(grid.cellCount);
    this.updateDistance();
    this.people.populate(this.snake.occupied, this.distance);
  }

  get tickMs(): number {
    return 1000 / speedFor(this.snake.length);
  }

  /** 0 → 1 through the current snake tick. */
  get snakeAlpha(): number {
    return this.state === 'playing' ? Math.min(1, this.snakeMs / this.tickMs) : 1;
  }

  get peopleAlpha(): number {
    return this.state === 'playing' ? Math.min(1, this.peopleMs / PEOPLE.STEP_MS) : 1;
  }

  /** Share of the grace period left before starving starts, 1 → 0. */
  get hungerLeft(): number {
    return Math.max(0, 1 - this.hungerMs / HUNGER.GRACE_MS);
  }

  get starving(): boolean {
    return this.hungerMs >= HUNGER.GRACE_MS;
  }

  /** A direction key. The first one starts the game (a reversal into the body is ignored). */
  turn(dir: Dir): void {
    if (this.state === 'dead') return;
    const accepted = this.snake.enqueue(dir);
    if (this.state === 'ready' && (accepted || dir === this.snake.dir)) this.state = 'playing';
  }

  update(deltaMs: number): void {
    if (this.state !== 'playing') return;

    this.snakeMs += deltaMs;
    while (this.state === 'playing' && this.snakeMs >= this.tickMs) {
      this.snakeMs -= this.tickMs;
      this.tick();
    }

    this.peopleMs += deltaMs;
    while (this.state === 'playing' && this.peopleMs >= PEOPLE.STEP_MS) {
      this.peopleMs -= PEOPLE.STEP_MS;
      this.people.step(this.snake.occupied, this.distance);
    }

    if (this.state === 'playing') this.updateHunger(deltaMs);
  }

  /** One snake step (spec §4.2). */
  private tick(): void {
    const grid = this.city.grid;
    const next = this.snake.turnAndLook(grid);
    if (next < 0 || !grid.walkable(next)) return this.die('wall');

    const prey = this.people.at[next];
    const grow = prey >= 0;
    if (this.snake.bites(next, grow)) return this.die('self');

    if (grow) {
      const person = this.people.remove(prey)!;
      this.score++;
      this.hungerMs = 0;
      this.shrinks = 0;
      this.events.push({ type: 'eat', cell: next, color: person.color });
    }
    this.snake.move(next, grow);
    this.updateDistance();
    if (grow && this.people.list.length < this.people.target) this.people.spawnReplacement(this.snake.occupied, this.distance);
  }

  /**
   * Recording mode keeps a bigger crowd: the gap is filled right away. Turned off before the first
   * move, the crowd goes straight back to normal; mid-game, the extra people stay until eaten
   * (spec §15.4).
   */
  setRecording(on: boolean): void {
    const grid = this.city.grid;
    let walkable = 0;
    for (let cell = 0; cell < grid.cellCount; cell++) if (grid.walkable(cell)) walkable++;
    this.people.target = on ? Math.max(PEOPLE.COUNT, Math.round(walkable / RECORDING.CELLS_PER_PERSON)) : PEOPLE.COUNT;
    if (this.state === 'ready') {
      // The extra people were added after the normal crowd, so dropping the newest restores it.
      while (this.people.list.length > this.people.target) this.people.remove(this.people.list[this.people.list.length - 1].id);
    }
    if (this.state !== 'dead') this.people.populate(this.snake.occupied, this.distance);
  }

  /** After the grace period, lose a segment every SHRINK_MS; below the initial length, starve (spec §6). */
  private updateHunger(deltaMs: number): void {
    this.hungerMs += deltaMs;
    const due = Math.floor((this.hungerMs - HUNGER.GRACE_MS) / HUNGER.SHRINK_MS);
    if (this.shrinks >= due) return;
    while (this.shrinks < due && this.state === 'playing') {
      this.shrinks++;
      const cell = this.snake.shrink();
      this.events.push({ type: 'shrink', cell });
      if (this.snake.length < SNAKE.INITIAL_LENGTH) this.die('starve');
    }
    this.updateDistance();
  }

  private updateDistance(): void {
    const occupied = this.snake.occupied;
    this.city.grid.distances([this.snake.head], (cell) => occupied[cell] === 1, this.distance);
  }

  private die(cause: DeathCause): void {
    this.state = 'dead';
    this.cause = cause;
    this.snake.settle();
    for (const person of this.people.list) person.previous = person.cell;
    this.events.push({ type: 'die', cause });
  }

  takeEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
