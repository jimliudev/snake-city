// Short synthesized sounds; no sound files.

export type Sound = 'start' | 'eat' | 'scream' | 'shrink' | 'hit' | 'crash';

interface Note {
  frequency: number;
  /** Slide to this frequency over the note. */
  to?: number;
  ms: number;
  wave?: OscillatorType;
  volume?: number;
}

const NOTES: Record<Sound, Note[]> = {
  start: [
    { frequency: 523, ms: 70 },
    { frequency: 784, ms: 110 },
  ],
  // "Pop": a quick upward blip.
  eat: [{ frequency: 380, to: 1100, ms: 70, wave: 'sine', volume: 0.12 }],
  // A tiny cartoon yelp.
  scream: [{ frequency: 1250, to: 620, ms: 170, wave: 'sawtooth', volume: 0.035 }],
  shrink: [{ frequency: 220, to: 160, ms: 90, wave: 'triangle', volume: 0.08 }],
  // A parked scooter knocked flying: a tinny clatter.
  crash: [
    { frequency: 520, to: 180, ms: 60, wave: 'square', volume: 0.05 },
    { frequency: 300, to: 120, ms: 90, wave: 'sawtooth', volume: 0.04 },
  ],
  hit: [
    { frequency: 140, ms: 90 },
    { frequency: 90, ms: 140 },
  ],
};

export class Audio {
  private context: AudioContext | null = null;

  /** Browsers only allow audio after a user gesture; call this from a key handler. */
  unlock(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  play(sound: Sound): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    let start = context.currentTime;
    for (const note of NOTES[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave ?? 'square';
      const end = start + note.ms / 1000;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      if (note.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
      gain.gain.setValueAtTime(note.volume ?? 0.06, start);
      gain.gain.exponentialRampToValueAtTime(0.001, end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end);
      start = end;
    }
  }
}
