// Score, hunger bar and the start / game-over panels (spec §8). Plain DOM over the canvas.

import type { MapId } from './map/city';
import type { DeathCause } from './sim';

const MAP_NAMES: Record<MapId, string> = { random: '隨機城市', east: '台北東區' };

const CAUSE_TEXT: Record<DeathCause, string> = {
  wall: '撞到建築物了',
  self: '咬到自己了',
  starve: '餓死了',
};

export interface HudState {
  screen: 'ready' | 'playing' | 'dead';
  score: number;
  best: number;
  length: number;
  speed: number;
  hungerLeft: number;
  starving: boolean;
  cause: DeathCause | null;
  newBest: boolean;
  canRestart: boolean;
  seed: number;
  map: MapId;
  /** Recording mode hides the key hint and the seed; the map credit stays (spec §15.5). */
  recording: boolean;
  /** Credit line for real map data, or null. */
  attribution: string | null;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.append(node);
  return node;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly score: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly hunger: HTMLElement;
  private readonly hungerFill: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly seed: HTMLElement;
  private readonly attribution: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toastBox: HTMLElement;
  private toastTimer = 0;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = element('div', 'hud', parent);
    const corner = element('div', 'hud-score', this.root);
    this.score = element('div', 'hud-score-main', corner);
    this.stats = element('div', 'hud-score-sub', corner);
    this.hunger = element('div', 'hud-hunger', this.root);
    element('span', 'hud-hunger-label', this.hunger).textContent = '飢餓';
    const track = element('div', 'hud-hunger-track', this.hunger);
    this.hungerFill = element('div', 'hud-hunger-fill', track);
    this.panel = element('div', 'hud-panel', this.root);
    this.hint = element('div', 'hud-hint', this.root);
    this.hint.textContent = '方向鍵 / WASD 移動 · M 地圖 · R 錄影模式';
    this.toastBox = element('div', 'hud-toast', this.root);
    this.toastBox.hidden = true;
    const corner2 = element('div', 'hud-corner', this.root);
    this.attribution = element('div', 'hud-attribution', corner2);
    this.seed = element('div', 'hud-seed', corner2);
  }

  /** A short message in the middle of the screen that fades by itself. */
  toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastBox.hidden = true), 1200);
  }

  update(state: HudState): void {
    this.hungerFill.style.transform = `scaleX(${state.starving ? 1 : state.hungerLeft})`;
    this.hunger.classList.toggle('starving', state.starving);
    this.hunger.classList.toggle('low', !state.starving && state.hungerLeft < 0.3);

    // The rest only changes on events; skip the DOM work when nothing moved.
    const key = JSON.stringify({ ...state, hungerLeft: 0, speed: state.speed.toFixed(1) });
    if (key === this.last) return;
    this.last = key;

    this.score.textContent = `吃掉 ${state.score} 人`;
    this.stats.textContent = `最高 ${state.best} · 長度 ${state.length} · 速度 ${state.speed.toFixed(1)} 格/秒`;
    this.seed.textContent = `${MAP_NAMES[state.map]} · seed ${state.seed}`;
    this.hint.hidden = state.recording;
    this.seed.hidden = state.recording;
    this.attribution.hidden = state.attribution === null;
    this.attribution.textContent = state.attribution ?? '';
    this.hunger.hidden = state.screen === 'ready';

    if (state.screen === 'ready') {
      this.panel.hidden = false;
      this.panel.innerHTML = `
        <h1>Snake City</h1>
        <p>在城市街道上獵食路人。越吃越長、越長越快。</p>
        <p>撞到建築物、咬到自己，或太久沒吃而餓死，遊戲就結束。</p>
        <p class="hud-cta">${MAP_NAMES[state.map]} · 按方向鍵開始</p>`;
    } else if (state.screen === 'dead' && state.cause) {
      this.panel.hidden = false;
      this.panel.innerHTML = `
        <h1>${CAUSE_TEXT[state.cause]}</h1>
        <p>${MAP_NAMES[state.map]}</p>
        <p class="hud-big">吃掉 ${state.score} 人</p>
        ${state.newBest ? '<p class="hud-best">新紀錄！</p>' : `<p>最高 ${state.best}</p>`}
        <p class="hud-cta"${state.canRestart ? '' : ' style="visibility:hidden"'}>按 Space / Enter 再來一局</p>`;
    } else {
      this.panel.hidden = true;
    }
  }
}
