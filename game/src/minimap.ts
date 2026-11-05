// Whole-city map in the corner; M enlarges it (spec §7.2).

import { MINIMAP, PEOPLE } from './config';
import { Terrain } from './grid';
import { BUILDING_PALETTE, COLORS, SHIRT_PALETTE } from './render/palette';
import type { Sim } from './sim';

const TERRAIN_COLORS: Record<Terrain, string> = {
  [Terrain.BUILDING]: COLORS.sidewalk,
  [Terrain.ROAD]: COLORS.road,
  [Terrain.STREET]: COLORS.street,
  [Terrain.ALLEY]: COLORS.alley,
};

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly background = document.createElement('canvas');
  private enlarged = false;
  private cellPx = 0;
  private builtFor: Sim | null = null;

  constructor(
    parent: HTMLElement,
    private readonly debug: boolean,
  ) {
    this.canvas.className = 'minimap';
    parent.append(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    this.layout();
  }

  toggle(): void {
    this.enlarged = !this.enlarged;
    this.layout();
  }

  /** Size the canvas for its on-screen size and the pixel ratio. Call on resize too. */
  layout(): void {
    this.builtFor = null;
  }

  /** Size the canvas for the map's shape, its on-screen size and the pixel ratio. */
  private fit(width: number, height: number): void {
    const longest = Math.max(width, height);
    const cssLongest = this.enlarged
      ? Math.floor(Math.min(window.innerWidth / width, window.innerHeight / height) * longest * MINIMAP.ENLARGED)
      : MINIMAP.CORNER_PX;
    const cssCell = cssLongest / longest;
    this.canvas.classList.toggle('enlarged', this.enlarged);
    this.canvas.style.width = `${Math.round(cssCell * width)}px`;
    this.canvas.style.height = `${Math.round(cssCell * height)}px`;
    this.cellPx = Math.max(1, Math.round(cssCell * window.devicePixelRatio));
    this.canvas.width = this.cellPx * width;
    this.canvas.height = this.cellPx * height;
  }

  private buildBackground(sim: Sim): void {
    const grid = sim.city.grid;
    this.fit(grid.width, grid.height);
    const px = this.cellPx;
    this.background.width = px * grid.width;
    this.background.height = px * grid.height;
    const context = this.background.getContext('2d')!;
    for (let cell = 0; cell < grid.cellCount; cell++) {
      context.fillStyle = TERRAIN_COLORS[grid.terrain[cell] as Terrain];
      context.fillRect(grid.x(cell) * px, grid.z(cell) * px, px, px);
    }
    // Tint buildings with their lot colour, faded, so blocks read at a glance.
    context.globalAlpha = 0.55;
    for (const lot of sim.city.lots) {
      context.fillStyle = BUILDING_PALETTE[lot.color];
      context.fillRect(lot.x * px + 1, lot.z * px + 1, lot.w * px - 2, lot.d * px - 2);
    }
    context.globalAlpha = 1;
    this.builtFor = sim;
  }

  draw(sim: Sim, view: Array<{ x: number; z: number }>): void {
    if (this.builtFor !== sim) this.buildBackground(sim);
    const context = this.context;
    const px = this.cellPx;
    const grid = sim.city.grid;
    context.drawImage(this.background, 0, 0);

    if (this.debug) {
      // Cells where people would start fleeing.
      context.fillStyle = 'rgba(255, 80, 80, 0.25)';
      for (let cell = 0; cell < grid.cellCount; cell++) {
        const d = sim.distance[cell];
        if (d >= 0 && d <= PEOPLE.FLEE_RADIUS) context.fillRect(grid.x(cell) * px, grid.z(cell) * px, px, px);
      }
    }

    context.fillStyle = COLORS.snake;
    for (const cell of sim.snake.cells) context.fillRect(grid.x(cell) * px, grid.z(cell) * px, px, px);
    context.fillStyle = '#ffe14d';
    const head = sim.snake.head;
    context.fillRect(grid.x(head) * px - px * 0.25, grid.z(head) * px - px * 0.25, px * 1.5, px * 1.5);

    for (const person of sim.people.list) {
      const x = (grid.x(person.cell) + 0.5) * px;
      const z = (grid.z(person.cell) + 0.5) * px;
      context.fillStyle = SHIRT_PALETTE[person.color];
      context.beginPath();
      context.arc(x, z, Math.max(1.5, px * 0.8), 0, Math.PI * 2);
      context.fill();
      context.lineWidth = Math.max(1, px * 0.25);
      context.strokeStyle = this.debug && person.state !== 'wandering' ? '#000000' : '#ffffff';
      context.stroke();
    }

    if (view.length === 4) {
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      context.lineWidth = Math.max(1, px * 0.3);
      context.beginPath();
      view.forEach((corner, index) => {
        const method = index === 0 ? 'moveTo' : 'lineTo';
        context[method](corner.x * px, corner.z * px);
      });
      context.closePath();
      context.stroke();
    }
  }
}
