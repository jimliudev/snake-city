// The snake, the people and the particle bursts, drawn between grid steps (spec §7.3, §7.4).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RECORDING, RENDER } from '../config';
import type { Person } from '../entities/people';
import type { Dir, Grid } from '../grid';
import type { Sim } from '../sim';
import { COLORS, RECORDING_PANTS, RECORDING_SHIRT_PALETTE, SHIRT_PALETTE, SKIN_PALETTE } from './palette';

const SEGMENT = 0.8;
const SEGMENT_HEIGHT = 0.6;
/** Recording mode: a swallowed person travels from head to tail as a bulge in this long (spec §15.3). */
const BULGE_S = 0.35;

/** Facing angle around y for a model whose front is +z. */
const DIR_ANGLE: Record<Dir, number> = { 0: Math.PI, 1: Math.PI / 2, 2: 0, 3: -Math.PI / 2 };

/** Turn `from` towards `to` along the shorter way. */
function dampAngle(from: number, to: number, rate: number, seconds: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * (1 - Math.exp(-rate * seconds));
}

/** 0 → 1 with a springy overshoot past 1 on the way. */
function overshoot(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 + Math.sin(x * Math.PI * 1.5) * (1 - x) * 0.6 - (1 - x) ** 3;
}

function cellPoint(grid: Grid, cell: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(grid.x(cell) + 0.5, 0, grid.z(cell) + 0.5);
}

const box = (w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

/** A small "!" billboard for people who have seen the snake. */
function alertSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(32, 32, 28, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#e63946';
  context.font = 'bold 48px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('!', 32, 35);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.setScalar(0.5);
  sprite.renderOrder = 10;
  return sprite;
}

/** The "+1" that floats up when someone is eaten in recording mode. */
function plusOneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.font = '900 104px system-ui, -apple-system, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 18;
  context.strokeStyle = '#1c1b33';
  context.strokeText('+1', 128, 68);
  context.fillStyle = '#fff200';
  context.fillText('+1', 128, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Popup {
  sprite: THREE.Sprite;
  age: number;
}

interface PersonModel {
  root: THREE.Group;
  /** Hip pivots; the legs hang from them. */
  hips: [THREE.Object3D, THREE.Object3D];
  alert: THREE.Sprite;
  angle: number;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
}

export class Actors {
  readonly object = new THREE.Group();
  /** Ground position of the head as drawn this frame; the camera follows it. */
  readonly headPosition = new THREE.Vector3();

  private readonly segments: THREE.InstancedMesh;
  private readonly head = new THREE.Group();
  private readonly tongue: THREE.Mesh;
  private headAngle = 0;
  private readonly people = new Map<number, PersonModel>();
  private readonly personMaterials: {
    shirts: THREE.MeshLambertMaterial[];
    skins: THREE.MeshLambertMaterial[];
    pants: THREE.MeshLambertMaterial;
    hair: THREE.MeshLambertMaterial;
  };
  private readonly particles: THREE.InstancedMesh;
  private readonly particleState: Particle[] = [];
  private time = 0;
  private dead = false;
  private recording = false;
  private readonly recordingMaterials: { shirts: THREE.MeshLambertMaterial[]; pants: THREE.MeshLambertMaterial };
  /** Seconds since each recent meal, for the recording-mode bounce, bulge and tail pop. */
  private meals: number[] = [];
  private readonly plusOne: THREE.SpriteMaterial;
  private popups: Popup[] = [];

  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor() {
    // Body segments: rounded boxes with alternating stripes.
    const segmentGeometry = new RoundedBoxGeometry(SEGMENT, SEGMENT_HEIGHT, SEGMENT, 2, 0.16);
    this.segments = new THREE.InstancedMesh(segmentGeometry, new THREE.MeshLambertMaterial(), RENDER.MAX_SEGMENTS);
    this.segments.castShadow = true;
    this.segments.frustumCulled = false;
    const stripe = new THREE.Color(COLORS.snakeStripe);
    const plain = new THREE.Color(COLORS.snake);
    for (let index = 0; index < RENDER.MAX_SEGMENTS; index++) {
      this.segments.setColorAt(index, index % 3 === 1 ? stripe : plain);
    }
    this.segments.count = 0;

    // Head: a bigger rounded box with eyes and a flicking tongue, front facing +z.
    const skin = new THREE.MeshLambertMaterial({ color: COLORS.snake });
    const white = new THREE.MeshLambertMaterial({ color: COLORS.eyeWhite });
    const black = new THREE.MeshLambertMaterial({ color: COLORS.pupil });
    const headMesh = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.7, 1, 2, 0.2), skin);
    headMesh.position.y = 0.38;
    headMesh.castShadow = true;
    this.head.add(headMesh);
    for (const side of [-1, 1]) {
      this.head.add(box(0.26, 0.26, 0.12, white, side * 0.24, 0.62, 0.36));
      this.head.add(box(0.12, 0.14, 0.06, black, side * 0.24, 0.62, 0.43));
    }
    this.tongue = box(0.08, 0.04, 0.35, new THREE.MeshLambertMaterial({ color: COLORS.tongue }), 0, 0.22, 0.6);
    this.head.add(this.tongue);

    this.personMaterials = {
      shirts: SHIRT_PALETTE.map((color) => new THREE.MeshLambertMaterial({ color })),
      skins: SKIN_PALETTE.map((color) => new THREE.MeshLambertMaterial({ color })),
      pants: new THREE.MeshLambertMaterial({ color: COLORS.pants }),
      hair: new THREE.MeshLambertMaterial({ color: COLORS.hair }),
    };
    this.recordingMaterials = {
      shirts: RECORDING_SHIRT_PALETTE.map((color) => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 })),
      pants: new THREE.MeshLambertMaterial({ color: RECORDING_PANTS }),
    };
    this.plusOne = new THREE.SpriteMaterial({ map: plusOneTexture(), depthTest: false, transparent: true });

    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), RENDER.PARTICLES);
    this.particles.frustumCulled = false;
    this.particles.count = 0;
    this.particles.setColorAt(0, this.color.set('#ffffff'));

    this.object.add(this.segments, this.head, this.particles);
  }

  /** Forget everything from the previous game. */
  reset(sim: Sim): void {
    for (const model of this.people.values()) this.object.remove(model.root);
    this.people.clear();
    this.particleState.length = 0;
    this.particles.count = 0;
    this.meals = [];
    for (const popup of this.popups) {
      this.object.remove(popup.sprite);
      popup.sprite.material.dispose();
    }
    this.popups = [];
    this.dead = false;
    this.headAngle = DIR_ANGLE[sim.snake.dir];
    this.update(sim, 0);
  }

  /** Recording mode (spec §15): bigger people in neon, and extra feedback when eating. */
  setRecording(on: boolean): void {
    if (on === this.recording) return;
    this.recording = on;
    // Rebuilt with the other look on the next update.
    for (const model of this.people.values()) this.object.remove(model.root);
    this.people.clear();
  }

  /** Recording mode: bounce the head, float a "+1" and swell the body down to the new tail. */
  eat(): void {
    if (!this.recording) return;
    this.meals.push(0);
    const sprite = new THREE.Sprite(this.plusOne.clone());
    sprite.renderOrder = 11;
    sprite.position.copy(this.headPosition);
    this.object.add(sprite);
    this.popups.push({ sprite, age: 0 });
  }

  update(sim: Sim, deltaMs: number): void {
    const seconds = deltaMs / 1000;
    this.time += seconds;
    this.dead = sim.state === 'dead';
    this.updateSnake(sim, seconds);
    this.updatePeople(sim, seconds);
    this.updateParticles(seconds);
    this.updatePopups(seconds);
  }

  private updatePopups(seconds: number): void {
    const life = RECORDING.PLUS_MS / 1000;
    this.popups = this.popups.filter((popup) => {
      popup.age += seconds;
      if (popup.age >= life) {
        this.object.remove(popup.sprite);
        popup.sprite.material.dispose();
        return false;
      }
      const t = popup.age / life;
      // Pop in big, then drift up while shrinking a little.
      const size = 1.6 * Math.min(1, t * 6) * (1.15 - 0.25 * t);
      popup.sprite.scale.set(size, size / 2, 1);
      popup.sprite.position.y = 1.8 + t * 1.6;
      popup.sprite.material.opacity = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      return true;
    });
  }

  private updateSnake(sim: Sim, seconds: number): void {
    const grid = sim.city.grid;
    const { cells, previous } = sim.snake;
    const alpha = sim.snakeAlpha;
    const count = cells.length;

    // Recording mode: each recent meal is a bulge running down the body, then a pop at the tail.
    const pop = RECORDING.POP_MS / 1000;
    for (let i = 0; i < this.meals.length; i++) this.meals[i] += seconds;
    this.meals = this.meals.filter((age) => age < BULGE_S + pop && !this.dead);

    // Segment 0 is the head; the instanced body starts at 1.
    this.segments.count = count - 1;
    for (let index = 0; index < count; index++) {
      cellPoint(grid, previous[index] ?? cells[index], this.from);
      cellPoint(grid, cells[index], this.to);
      this.from.lerp(this.to, alpha);
      if (index === 0) {
        this.headPosition.copy(this.from);
        continue;
      }
      // Taper over the last few segments, and a gentle ripple along the body.
      const fromTail = count - 1 - index;
      let taper = fromTail < 3 ? 0.7 + fromTail * 0.1 : 1;
      for (const age of this.meals) {
        const at = Math.min(1, age / BULGE_S) * (count - 1);
        taper *= 1 + 0.45 * Math.exp(-(((index - at) / 1.3) ** 2));
        // The new tail segment: grows in from nothing with an overshoot once the bulge arrives.
        if (fromTail === 0) taper *= age < BULGE_S ? 0.2 : 0.2 + 0.8 * overshoot((age - BULGE_S) / pop);
      }
      const ripple = this.dead ? 0 : Math.sin(this.time * 9 - index * 0.7) * 0.04;
      this.scale.set(taper, taper, taper);
      this.from.y = (SEGMENT_HEIGHT / 2) * taper + ripple + 0.02;
      this.matrix.compose(this.from, this.quaternion.identity(), this.scale);
      this.segments.setMatrixAt(index - 1, this.matrix);
    }
    this.segments.instanceMatrix.needsUpdate = true;

    // Face the way the head is moving.
    const moving = previous[0] !== undefined && previous[0] !== cells[0];
    const facing = moving ? grid.dirTo(previous[0], cells[0]) : sim.snake.dir;
    this.headAngle = dampAngle(this.headAngle, DIR_ANGLE[facing], 18, seconds);
    this.head.position.copy(this.headPosition);
    this.head.rotation.set(0, this.headAngle, 0);
    // Recording mode: a hop and a squash-and-stretch right after eating.
    const hop = this.meals.length > 0 ? Math.min(1, this.meals[this.meals.length - 1] / pop) : 1;
    const bounce = Math.sin(Math.PI * hop);
    this.head.position.y = bounce * 0.7;
    this.head.scale.set(1 + bounce * 0.3, 1 + bounce * 0.15, 1 + bounce * 0.3);
    if (this.dead) {
      this.head.rotation.z = Math.sin(this.time * 30) * 0.08;
      this.tongue.visible = false;
    } else {
      this.tongue.visible = Math.sin(this.time * 7) > 0.3;
    }
  }

  private updatePeople(sim: Sim, seconds: number): void {
    const grid = sim.city.grid;
    const alpha = sim.peopleAlpha;
    const alive = new Set<number>();
    for (const person of sim.people.list) {
      alive.add(person.id);
      let model = this.people.get(person.id);
      if (!model) {
        model = this.makePerson(person);
        this.people.set(person.id, model);
        this.object.add(model.root);
      }
      cellPoint(grid, person.previous, this.from);
      cellPoint(grid, person.cell, this.to);
      this.from.lerp(this.to, alpha);

      const walking = person.previous !== person.cell && alpha < 1;
      const alarmed = person.state === 'fleeing' || person.state === 'trapped';
      const swing = walking ? Math.sin(this.time * (alarmed ? 22 : 12)) * 0.6 : 0;
      model.hips[0].rotation.x = swing;
      model.hips[1].rotation.x = -swing;

      model.root.position.copy(this.from);
      if (walking && alarmed) model.root.position.y = Math.abs(Math.sin(this.time * 22)) * 0.08;
      if (person.state === 'trapped') model.root.position.x += Math.sin(this.time * 60) * 0.05;

      model.angle = dampAngle(model.angle, DIR_ANGLE[person.dir], 14, seconds);
      model.root.rotation.y = model.angle;
      model.alert.visible = alarmed;
      model.alert.position.y = 1.35 + Math.sin(this.time * 10) * 0.05;
    }
    for (const [id, model] of this.people) {
      if (alive.has(id)) continue;
      this.object.remove(model.root);
      this.people.delete(id);
    }
  }

  /** A blocky person, about 1.1 cells tall (2.5× in recording mode), front facing +z. */
  private makePerson(person: Person): PersonModel {
    const { skins } = this.personMaterials;
    const { shirts, pants } = this.recording ? this.recordingMaterials : this.personMaterials;
    // The camera looks down on the hair, so in recording mode it is a cap in the shirt colour.
    const hair = this.recording ? shirts[person.color] : this.personMaterials.hair;
    const root = new THREE.Group();
    const skin = skins[person.id % skins.length];
    const hips: [THREE.Object3D, THREE.Object3D] = [new THREE.Group(), new THREE.Group()];
    hips.forEach((hip, index) => {
      hip.position.set(index === 0 ? -0.08 : 0.08, 0.36, 0);
      hip.add(box(0.12, 0.36, 0.14, pants, 0, -0.18, 0));
      root.add(hip);
    });
    root.add(box(0.34, 0.36, 0.22, shirts[person.color], 0, 0.54, 0));
    root.add(box(0.26, 0.26, 0.26, skin, 0, 0.86, 0));
    root.add(box(0.28, 0.08, 0.28, hair, 0, 1.02, -0.01));
    const alert = alertSprite();
    alert.visible = false;
    root.add(alert);
    if (this.recording) {
      root.scale.setScalar(RECORDING.PERSON_SCALE);
      // The "!" grows less than the person, so it does not cover the street.
      alert.scale.multiplyScalar(1.4 / RECORDING.PERSON_SCALE);
    }
    return { root, hips, alert, angle: DIR_ANGLE[person.dir] };
  }

  /** Confetti when someone is eaten. */
  burst(grid: Grid, cell: number, colors: THREE.ColorRepresentation[], count: number, power: number): void {
    const origin = cellPoint(grid, cell, new THREE.Vector3());
    origin.y = 0.6;
    for (let i = 0; i < count; i++) {
      if (this.particleState.length >= RENDER.PARTICLES) this.particleState.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = (1 + Math.random() * 2) * power;
      this.particleState.push({
        position: origin.clone(),
        velocity: new THREE.Vector3(Math.cos(angle) * speed, (2 + Math.random() * 3) * power, Math.sin(angle) * speed),
        age: 0,
        life: 0.6 + Math.random() * 0.4,
        size: 0.1 + Math.random() * 0.1,
        color: new THREE.Color(colors[i % colors.length]),
      });
    }
  }

  private updateParticles(seconds: number): void {
    let write = 0;
    for (const particle of this.particleState) {
      particle.age += seconds;
      if (particle.age >= particle.life) continue;
      particle.velocity.y -= 12 * seconds;
      particle.position.addScaledVector(particle.velocity, seconds);
      if (particle.position.y < 0.05) {
        particle.position.y = 0.05;
        particle.velocity.multiplyScalar(0.5);
      }
      this.particleState[write] = particle;
      const s = particle.size * (1 - particle.age / particle.life);
      this.matrix.compose(particle.position, this.quaternion.identity(), this.scale.set(s, s, s));
      this.particles.setMatrixAt(write, this.matrix);
      this.particles.setColorAt(write, particle.color);
      write++;
    }
    this.particleState.length = write;
    this.particles.count = write;
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }
}
