import { SNAKE } from '../config';
import { opposite, type Dir, type Grid } from '../grid';

export class Snake {
  /** Head first. */
  cells: number[] = [];
  /** Where each segment was before the last tick, for drawing in between (spec §7.3). */
  previous: number[] = [];
  dir: Dir;
  /** Occupancy by cell: 1 where a segment (head included) is. */
  readonly occupied: Uint8Array;
  private readonly queue: Dir[] = [];

  constructor(grid: Grid, head: number, dir: Dir) {
    this.dir = dir;
    this.occupied = new Uint8Array(grid.cellCount);
    let cell = head;
    for (let i = 0; i < SNAKE.INITIAL_LENGTH; i++) {
      this.cells.push(cell);
      this.occupied[cell] = 1;
      cell = grid.neighbor(cell, opposite(dir));
    }
    this.previous = [...this.cells];
  }

  get head(): number {
    return this.cells[0];
  }

  get tail(): number {
    return this.cells[this.cells.length - 1];
  }

  get length(): number {
    return this.cells.length;
  }

  /** The direction the snake will be heading once every queued turn is used. */
  get plannedDir(): Dir {
    return this.queue.length > 0 ? this.queue[this.queue.length - 1] : this.dir;
  }

  /**
   * Queue a turn. Repeats and 180° reversals are judged against the last queued direction,
   * so two quick presses make a tight U-turn without biting the neck (spec §4.4).
   */
  enqueue(dir: Dir): boolean {
    const last = this.plannedDir;
    if (dir === last || dir === opposite(last) || this.queue.length >= SNAKE.INPUT_QUEUE) return false;
    this.queue.push(dir);
    return true;
  }

  /** Take the next queued turn and return the cell the head is about to enter (−1 off the map). */
  turnAndLook(grid: Grid): number {
    const next = this.queue.shift();
    if (next !== undefined) this.dir = next;
    return grid.neighbor(this.head, this.dir);
  }

  /** Whether moving into `cell` bites the body. The tail is fine unless it stays put to grow. */
  bites(cell: number, growing: boolean): boolean {
    if (!this.occupied[cell]) return false;
    return growing || cell !== this.tail;
  }

  move(cell: number, grow: boolean): void {
    const old = this.cells;
    const cells = [cell, ...old];
    // Clear the tail before marking the head: they are the same cell when following the tail.
    if (!grow) this.occupied[cells.pop()!] = 0;
    this.occupied[cell] = 1;
    this.cells = cells;
    // Segment i moves from where segment i was to where segment i − 1 was. A segment added
    // by growing has no earlier position and stays put.
    this.previous = cells.map((current, index) => old[index] ?? current);
  }

  /** Drop the last segment (starving) and return its cell. */
  shrink(): number {
    const cell = this.cells.pop()!;
    this.previous.pop();
    this.occupied[cell] = 0;
    return cell;
  }

  /** Forget in-between positions, e.g. after a death freezes the snake. */
  settle(): void {
    this.previous = [...this.cells];
  }
}
