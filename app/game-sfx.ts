/**
 * Shared game audio controls and short synthesized cues (UI, turn-signal relay,
 * passenger chimes, fare register). Every AudioContext in the game registers here
 * so one mute switch silences the engine, metro and cues together.
 */

const STORAGE_KEY = "capy-cab:muted";
const contexts = new Set<AudioContext>();
const listeners = new Set<(muted: boolean) => void>();

function readMuted() {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

let muted = readMuted();

export const audioSettings = {
  get muted() { return muted; },
  register(context: AudioContext) {
    contexts.add(context);
    if (muted) void context.suspend().catch(() => {});
  },
  unregister(context: AudioContext) { contexts.delete(context); },
  /** Resumes contexts on a user gesture unless the player muted the game. */
  resume(context: AudioContext | null) {
    if (context && !muted && context.state === "suspended") void context.resume().catch(() => {});
  },
  setMuted(value: boolean) {
    muted = value;
    try { localStorage.setItem(STORAGE_KEY, value ? "1" : "0"); } catch { /* storage may be blocked */ }
    for (const context of contexts) {
      if (context.state === "closed") { contexts.delete(context); continue; }
      void (value ? context.suspend() : context.resume()).catch(() => {});
    }
    listeners.forEach((listener) => listener(value));
  },
  subscribe(listener: (muted: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

type Tone = { frequency: number; at: number; duration: number; gain: number; type?: OscillatorType; glide?: number };

export class GameSfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  start() {
    const Context = typeof window === "undefined" ? undefined : window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    if (!this.context) {
      try {
        const context = new Context();
        this.context = context;
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -10; limiter.ratio.value = 4; limiter.attack.value = .003; limiter.release.value = .15;
        limiter.connect(context.destination);
        this.master = context.createGain(); this.master.gain.value = .9; this.master.connect(limiter);
        const noise = context.createBuffer(1, Math.round(context.sampleRate * .25), context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = noise;
        audioSettings.register(context);
      } catch { this.context = null; return; }
    }
    audioSettings.resume(this.context);
  }

  private ready() {
    const context = this.context;
    return context && this.master && context.state === "running" ? context : null;
  }

  /** Soft mallet tone: fundamental plus a quiet octave, quick attack, exponential decay. */
  private tones(tones: Tone[]) {
    const context = this.ready();
    if (!context) return;
    const base = context.currentTime + .005;
    for (const tone of tones) {
      const at = base + tone.at;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(tone.gain, at + .008);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + tone.duration);
      envelope.connect(this.master!);
      for (const [ratio, level] of [[1, 1], [2, .28], [3.01, .08]] as const) {
        const oscillator = context.createOscillator(), partial = context.createGain();
        oscillator.type = tone.type ?? "sine";
        oscillator.frequency.setValueAtTime(tone.frequency * ratio, at);
        if (tone.glide) oscillator.frequency.exponentialRampToValueAtTime(tone.frequency * ratio * tone.glide, at + tone.duration);
        partial.gain.value = level;
        oscillator.connect(partial); partial.connect(envelope);
        oscillator.start(at); oscillator.stop(at + tone.duration + .02);
        oscillator.onended = () => { oscillator.disconnect(); partial.disconnect(); };
      }
      setTimeout(() => envelope.disconnect(), (tone.at + tone.duration + .2) * 1000);
    }
  }

  private click(at: number, frequency: number, gain: number, length = .012) {
    const context = this.ready();
    if (!context || !this.noise) return;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), envelope = context.createGain();
    source.buffer = this.noise;
    filter.type = "bandpass"; filter.frequency.value = frequency; filter.Q.value = 2.2;
    const start = context.currentTime + at;
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + length);
    source.connect(filter); filter.connect(envelope); envelope.connect(this.master!);
    source.start(start, Math.random() * .2, length + .01);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  ui() { this.start(); this.click(0, 2600, .22, .018); this.tones([{ frequency: 1320, at: 0, duration: .06, gain: .035 }]); }

  /** Turn-signal relay: a firm tick when the lamp lights, a lighter tock when it drops. */
  relay(on: boolean) { this.click(0, on ? 3200 : 2100, on ? .32 : .2, on ? .014 : .01); }

  pickup() {
    this.tones([
      { frequency: 659.25, at: 0, duration: .32, gain: .11 },
      { frequency: 987.77, at: .11, duration: .45, gain: .1 },
    ]);
  }

  dropoff() {
    this.tones([
      { frequency: 783.99, at: 0, duration: .28, gain: .1 },
      { frequency: 987.77, at: .09, duration: .28, gain: .1 },
      { frequency: 1318.51, at: .18, duration: .6, gain: .11 },
    ]);
    // Register drawer: two bright metallic hits after the chime.
    this.click(.42, 5200, .35, .05);
    this.click(.5, 6800, .28, .09);
    this.tones([{ frequency: 2637, at: .5, duration: .5, gain: .03, type: "triangle" }]);
  }

  notice() { this.tones([{ frequency: 880, at: 0, duration: .18, gain: .05 }]); }

  dispose() {
    if (this.context) { audioSettings.unregister(this.context); void this.context.close().catch(() => {}); }
    this.context = null; this.master = null; this.noise = null;
  }
}
