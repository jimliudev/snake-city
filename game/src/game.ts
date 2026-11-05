import * as THREE from 'three';
import { Audio } from './audio';
import { CAMERA, DEATH, RECORDING, SCORE } from './config';
import { Hud } from './hud';
import { listenForKeys, type Action } from './input';
import type { MapId } from './map/city';
import { EAST } from './map/east';
import { Minimap } from './minimap';
import { Actors } from './render/actors';
import { FollowCamera } from './render/camera';
import { CityView } from './render/city';
import { Scooters } from './render/scooters';
import { COLORS, SHIRT_PALETTE, SKIN_PALETTE } from './render/palette';
import { Sim, speedFor } from './sim';

function loadHighScore(map: MapId): number {
  try {
    const storage = window.localStorage;
    const legacy = storage.getItem(SCORE.LEGACY_KEY);
    if (legacy !== null) {
      // Scores from before the map choice were all on random cities.
      if (storage.getItem(SCORE.STORAGE_PREFIX + 'random') === null) storage.setItem(SCORE.STORAGE_PREFIX + 'random', legacy);
      storage.removeItem(SCORE.LEGACY_KEY);
    }
    return Number(storage.getItem(SCORE.STORAGE_PREFIX + map)) || 0;
  } catch {
    return 0;
  }
}

function saveHighScore(map: MapId, value: number): void {
  try {
    window.localStorage.setItem(SCORE.STORAGE_PREFIX + map, String(value));
  } catch {
    // Private windows and blocked storage: the high score just is not remembered.
  }
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

export class Game {
  readonly scene = new THREE.Scene();
  readonly followCamera = new FollowCamera();
  readonly hud: Hud;
  readonly minimap: Minimap;

  private sim: Sim;
  private city: CityView;
  private readonly actors = new Actors();
  /** Parked scooters, in real districts only (spec §14.6). */
  private scooters: Scooters | null = null;
  private readonly audio = new Audio();
  private readonly sun = new THREE.DirectionalLight('#fff4e0', 2.4);

  private mapId: MapId;
  private highScore: number;
  private newBest = false;
  private deadMs = 0;

  constructor(
    private readonly fixedSeed: number | null,
    mapId: MapId,
    overlay: HTMLElement,
    debug: boolean,
    /** Recording mode for vertical short videos (R, `?record`; spec §15). */
    private recording: boolean,
  ) {
    this.mapId = mapId;
    this.highScore = loadHighScore(mapId);
    this.hud = new Hud(overlay);
    this.minimap = new Minimap(overlay, debug);

    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, CAMERA.DISTANCE + 20, CAMERA.DISTANCE + 70);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b9a98f', 1.6));
    // The sun sits to the north-west, so shadows fall towards the camera's side and stay readable.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -22;
    shadow.right = shadow.top = 22;
    shadow.near = 1;
    shadow.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.actors.object);

    this.sim = new Sim(this.fixedSeed ?? randomSeed(), this.mapId);
    this.city = new CityView(this.sim.city);
    this.scene.add(this.city.object);
    this.applyRecording();
    this.startRound();

    listenForKeys((action) => this.onAction(action));
  }

  private startRound(): void {
    this.newBest = false;
    this.deadMs = 0;
    if (this.scooters) {
      this.scene.remove(this.scooters.object);
      this.scooters.dispose();
      this.scooters = null;
    }
    if (this.sim.mapId === 'east') {
      this.scooters = new Scooters(this.sim.city.grid, this.sim.seed);
      this.scene.add(this.scooters.object);
    }
    this.actors.reset(this.sim);
    this.followCamera.snap(this.actors.headPosition);
  }

  private newGame(): void {
    this.scene.remove(this.city.object);
    this.city.dispose();
    this.sim = new Sim(this.fixedSeed ?? randomSeed(), this.mapId);
    this.city = new CityView(this.sim.city);
    this.scene.add(this.city.object);
    this.applyRecording();
    this.startRound();
  }

  /** Recording only changes the look, the camera and the size of the crowd (spec §15). */
  private applyRecording(): void {
    this.sim.setRecording(this.recording);
    this.actors.setRecording(this.recording);
    if (this.recording) this.followCamera.setFraming(RECORDING.CAMERA_DISTANCE, RECORDING.FOLLOW);
    else this.followCamera.setFraming(CAMERA.DISTANCE, CAMERA.FOLLOW);
  }

  private onAction(action: Action): void {
    this.audio.unlock();
    switch (action.type) {
      case 'turn': {
        const wasReady = this.sim.state === 'ready';
        this.sim.turn(action.dir);
        if (wasReady && this.sim.state === 'playing') this.audio.play('start');
        break;
      }
      case 'confirm':
        if (this.sim.state === 'dead' && this.deadMs >= DEATH.RESTART_DELAY_MS) this.newGame();
        break;
      case 'minimap':
        this.minimap.toggle();
        break;
      case 'record':
        this.recording = !this.recording;
        this.applyRecording();
        this.hud.toast(this.recording ? '錄影模式 開' : '錄影模式 關');
        break;
    }
  }

  update(deltaMs: number): void {
    this.sim.update(deltaMs);
    const grid = this.sim.city.grid;
    for (const event of this.sim.takeEvents()) {
      switch (event.type) {
        case 'eat':
          this.audio.play('eat');
          this.audio.play('scream');
          this.actors.burst(grid, event.cell, [SHIRT_PALETTE[event.color], SKIN_PALETTE[0], '#ffffff', '#ffe14d'], 28, 1);
          this.actors.eat();
          break;
        case 'shrink':
          this.audio.play('shrink');
          this.actors.burst(grid, event.cell, [COLORS.shrinkPuff, COLORS.snake], 10, 0.5);
          break;
        case 'die':
          this.audio.play('hit');
          if (this.sim.score > this.highScore) {
            this.highScore = this.sim.score;
            this.newBest = true;
            saveHighScore(this.mapId, this.highScore);
          }
          break;
      }
    }
    if (this.sim.state === 'dead') this.deadMs += deltaMs;

    if (this.scooters) {
      if (this.sim.state === 'playing' && this.scooters.hit(this.sim.snake.head, this.sim.snake.dir) > 0) this.audio.play('crash');
      this.scooters.update(deltaMs);
    }
    this.actors.update(this.sim, deltaMs);
    this.followCamera.follow(this.actors.headPosition, deltaMs);
    this.city.updateOcclusion(this.actors.headPosition);

    const focus = this.followCamera.focus;
    this.sun.position.set(focus.x - 14, 30, focus.z - 10);
    this.sun.target.position.copy(focus);

    this.minimap.draw(this.sim, this.followCamera.groundCorners());
    this.hud.update({
      screen: this.sim.state,
      score: this.sim.score,
      best: Math.max(this.highScore, this.sim.score),
      length: this.sim.snake.length,
      speed: speedFor(this.sim.snake.length),
      hungerLeft: this.sim.hungerLeft,
      starving: this.sim.starving,
      cause: this.sim.cause,
      newBest: this.newBest,
      canRestart: this.deadMs >= DEATH.RESTART_DELAY_MS,
      seed: this.sim.seed,
      map: this.mapId,
      recording: this.recording,
      attribution: this.mapId === 'east' ? EAST.attribution : null,
    });
  }

  resize(width: number, height: number): void {
    this.followCamera.resize(width, height);
    this.minimap.layout();
  }

  /** For `?debug`: a snapshot of the rules state. */
  debugState() {
    const { sim } = this;
    const grid = sim.city.grid;
    const at = (cell: number) => ({ x: grid.x(cell), z: grid.z(cell) });
    return {
      seed: sim.seed,
      map: sim.mapId,
      recording: this.recording,
      state: sim.state,
      cause: sim.cause,
      score: sim.score,
      length: sim.snake.length,
      speed: speedFor(sim.snake.length),
      hungerMs: Math.round(sim.hungerMs),
      dir: sim.snake.dir,
      snake: sim.snake.cells.map(at),
      people: sim.people.list.map((person) => ({ id: person.id, state: person.state, ...at(person.cell) })),
    };
  }
}
