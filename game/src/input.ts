import type { Dir } from './grid';
import type { MapId } from './map/city';

/**
 * Everything the player can ask for. Keys produce these today; touch controls only need to
 * produce the same actions (spec §4.4).
 */
export type Action =
  | { type: 'turn'; dir: Dir }
  | { type: 'confirm' }
  | { type: 'minimap' }
  | { type: 'record' }
  | { type: 'choose'; map: MapId };

const KEY_ACTIONS: Record<string, Action> = {
  ArrowUp: { type: 'turn', dir: 0 },
  KeyW: { type: 'turn', dir: 0 },
  ArrowRight: { type: 'turn', dir: 1 },
  KeyD: { type: 'turn', dir: 1 },
  ArrowDown: { type: 'turn', dir: 2 },
  KeyS: { type: 'turn', dir: 2 },
  ArrowLeft: { type: 'turn', dir: 3 },
  KeyA: { type: 'turn', dir: 3 },
  Space: { type: 'confirm' },
  Enter: { type: 'confirm' },
  NumpadEnter: { type: 'confirm' },
  KeyM: { type: 'minimap' },
  KeyR: { type: 'record' },
  Digit1: { type: 'choose', map: 'random' },
  Numpad1: { type: 'choose', map: 'random' },
  Digit2: { type: 'choose', map: 'east' },
  Numpad2: { type: 'choose', map: 'east' },
};

/** Report key presses as actions. Auto-repeat is ignored. */
export function listenForKeys(onAction: (action: Action) => void): () => void {
  const handler = (event: KeyboardEvent) => {
    const action = KEY_ACTIONS[event.code];
    if (!action || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (event.repeat) return;
    onAction(action);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
