import * as THREE from 'three';
import { RENDER } from './config';
import { Game } from './game';

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) >>> 0 : null;
const debug = params.has('debug');
// Only 台北東區 is offered; `?map=random` still opens the generated city, for testing.
const map = params.get('map') === 'random' ? 'random' : 'east';
const recording = params.has('record');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const game = new Game(seed, map, document.getElementById('overlay')!, debug, recording);
if (debug) Object.assign(window, { __snake: () => game.debugState(), __snakeGame: game });

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  game.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let lastTime: number | null = null;
function frame(time: number): void {
  const deltaMs = Math.min(RENDER.MAX_DELTA_MS, lastTime === null ? 0 : time - lastTime);
  lastTime = time;
  game.update(deltaMs);
  renderer.render(game.scene, game.followCamera.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
