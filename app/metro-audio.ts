import type { Coordinates } from './game-core';
import { MetroSystem } from './metro-system';

/** Gesture-activated rail ambience and distinct door/arrival cues. */
export class MetroAudio {
  private context: AudioContext | null = null;
  private motors: { oscillator: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; rolling: AudioBufferSourceNode; rollingGain: GainNode }[] = [];
  private phases = ['', ''];
  private liftPhases = Array<string>(6).fill('');
  private master: GainNode | null = null;
  private ticketPasses=0;

  start() {
    if (this.context) { if (this.context.state === 'suspended') void this.context.resume().catch(() => {}); return; }
    try {
      const context = new AudioContext(); this.context = context;
      this.master = context.createGain(); this.master.gain.value = .26; this.master.connect(context.destination);
      const noise = context.createBuffer(1, context.sampleRate * 6, context.sampleRate), samples = noise.getChannelData(0);
      let smooth = 0;
      for (let i = 0; i < samples.length; i++) { smooth = smooth * .985 + (Math.random() * 2 - 1) * .015; samples[i] = smooth * 3; }
      for (let i = 0; i < 2; i++) {
        const oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain();
        oscillator.type = 'triangle'; oscillator.frequency.value = 38;
        filter.type = 'lowpass'; filter.frequency.value = 220; gain.gain.value = 0;
        oscillator.connect(filter); filter.connect(gain); gain.connect(this.master); oscillator.start();
        const rolling = context.createBufferSource(), rollingGain = context.createGain();
        rolling.buffer = noise; rolling.loop = true; rollingGain.gain.value = 0;
        rolling.connect(rollingGain); rollingGain.connect(this.master); rolling.start();
        this.motors.push({ oscillator, filter, gain, rolling, rollingGain });
      }
      void context.resume().catch(() => {});
    } catch { /* Transport gameplay also works without an audio device. */ }
  }

  private cue(arrival: boolean, volume: number) {
    const context = this.context;
    if (!context || !this.master || volume < .008 || context.state !== 'running') return;
    const notes = arrival ? [587.33, 880, 659.25] : [880, 880];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator(), envelope = context.createGain();
      const at = context.currentTime + index * .21;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(volume * .6, at + .015); envelope.gain.exponentialRampToValueAtTime(.0001, at + .2);
      oscillator.connect(envelope); envelope.connect(this.master!); oscillator.start(at); oscillator.stop(at + .22);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    });
  }

  update(system: MetroSystem, rider: Coordinates, height: number) {
    const context = this.context;
    if (!context) return;
    if(system.ticketPasses!==this.ticketPasses){this.cue(true,.13);this.ticketPasses=system.ticketPasses;}
    system.trains.forEach((train, index) => {
      const motor = this.motors[index]; if (!motor) return;
      const aboard = system.carrier?.kind === 'train' && system.carrier.id === train.id;
      const distance = Math.hypot(rider.x - train.x, rider.z - train.z, height - 21.6);
      const volume = aboard ? .28 : Math.max(0, 1 - distance / 85) ** 2 * .18;
      const speed = Math.abs(train.speed), moving = train.phase === 'running';
      motor.oscillator.frequency.setTargetAtTime(38 + speed * 3.4, context.currentTime, .2);
      motor.filter.frequency.setTargetAtTime(180 + speed * 9, context.currentTime, .2);
      motor.gain.gain.setTargetAtTime(moving ? volume * Math.min(1, speed / 6) : volume * .035, context.currentTime, .15);
      motor.rollingGain.gain.setTargetAtTime(moving ? volume * Math.min(.9, speed / 12) : 0, context.currentTime, .18);
      motor.rolling.playbackRate.setTargetAtTime(.72 + speed * .025, context.currentTime, .22);
      if (train.phase !== this.phases[index]) {
        if (train.phase === 'opening') this.cue(true, volume);
        if (train.phase === 'closing') this.cue(false, volume);
        this.phases[index] = train.phase;
      }
    });
    system.lifts.forEach(lift => {
      if (lift.phase !== this.liftPhases[lift.id] && lift.phase === 'opening') this.cue(true, Math.max(0, 1 - Math.hypot(rider.x - lift.x, rider.z - lift.z, height - lift.height) / 15) * .2);
      this.liftPhases[lift.id] = lift.phase;
    });
  }

  silence() {
    if (!this.context) return;
    for (const motor of this.motors) { motor.gain.gain.setTargetAtTime(0, this.context.currentTime, .08); motor.rollingGain.gain.setTargetAtTime(0, this.context.currentTime, .08); }
  }

  dispose() {
    this.motors.forEach(motor => { motor.oscillator.stop(); motor.rolling.stop(); motor.oscillator.disconnect(); motor.rolling.disconnect(); motor.filter.disconnect(); motor.gain.disconnect(); motor.rollingGain.disconnect(); });
    this.master?.disconnect(); void this.context?.close().catch(() => {}); this.context = null;
  }
}
