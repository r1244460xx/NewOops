/**
 * Mr. Oops!! - Web Audio API Sound Synthesizer & BGM Engine
 * Pure synthesized sound effects and upbeat retro arcade music with zero external dependencies.
 * All functions are guarded with try/catch to ensure 100% stability across all browser states.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isBgmPlaying = false;
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.tempo = 138;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.setValueAtTime(0.32, this.ctx.currentTime);
      this.bgmGain.connect(this.masterGain);
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  resume() {
    try {
      this.init();
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().then(() => this.prewarm()).catch(() => {});
        } else if (this.ctx.state === 'running') {
          this.prewarm();
        }
      }
    } catch (e) {}
  }

  // Pre-warm audio graph to prevent JIT / Fourier table compilation hitch during gameplay (especially sawtooth)
  prewarm() {
    if (this._prewarmed || !this.ctx || this.ctx.state !== 'running') return;
    try {
      this._prewarmed = true;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.01);
      gain.gain.setValueAtTime(0.00001, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.01);
      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.01);
    } catch (e) {}
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    try {
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.35, this.ctx.currentTime);
      }
    } catch (e) {}
    return this.isMuted;
  }

  // Character movement hop
  playHop() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(540, now + 0.08);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  // Warning alarm tick
  playWarning() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1040, now + 0.04);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  // Rock roll rumble
  playRockRoll() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.linearRampToValueAtTime(60, now + 0.15);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {}
  }

  // Cannon shot
  playCannonShot() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
      oscGain.gain.setValueAtTime(0.4, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.18);

      this.playNoise(0.12, 0.25);
    } catch (e) {}
  }

  // Laser charging buzz
  playLaserCharge() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.25);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {}
  }

  // Laser beam zap
  playLaserBlast() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.22);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.22);
    } catch (e) {}
  }

  // Near miss whistle
  playNearMiss() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, now);
      osc.frequency.exponentialRampToValueAtTime(1300, now + 0.12);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {}
  }

  // Collect star bonus
  playStarCollect() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      [659, 880, 1046, 1318].forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.04);
        gain.gain.setValueAtTime(0.18, now + idx * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.04 + 0.15);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now + idx * 0.04);
        osc.stop(now + idx * 0.04 + 0.15);
      });
    } catch (e) {}
  }

  // Oops hit collision
  playHit() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      this.playNoise(0.25, 0.45);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }

  // Wave clear fanfare
  playWaveClear() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      const now = this.ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.16, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.2);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.2);
      });
    } catch (e) {}
  }

  // Game over jingle
  playGameOver() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const notes = [440, 415.3, 392, 349.23];
      const now = this.ctx.currentTime;
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.16);
        gain.gain.setValueAtTime(0.2, now + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.16 + 0.25);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start(now + i * 0.16);
        osc.stop(now + i * 0.16 + 0.25);
      });
    } catch (e) {}
  }

  // Momentum Push impact sound (successful tackle / knock-away)
  playPush() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      // Punchy sub-bass sweep
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);
      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.22);

      this.playNoise(0.14, 0.35);
    } catch (e) {}
  }

  // Push Blocked recoil thud (insufficient momentum bounce-back)
  playBlocked() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      // Dull thud
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.16);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.16);

      // Short metallic click
      const click = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      click.type = 'square';
      click.frequency.setValueAtTime(820, now);
      click.frequency.exponentialRampToValueAtTime(200, now + 0.05);
      clickGain.gain.setValueAtTime(0.18, now);
      clickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      click.connect(clickGain);
      clickGain.connect(this.sfxGain);
      click.start(now);
      click.stop(now + 0.05);
    } catch (e) {}
  }

  // Head-on Clash (high energy metal impact + shockwave explosion)
  playClash() {
    if (this.isMuted || !this.ctx || this.ctx.state !== 'running') return;
    try {
      const now = this.ctx.currentTime;
      // High metallic ring 1
      const ring1 = this.ctx.createOscillator();
      const rGain1 = this.ctx.createGain();
      ring1.type = 'sine';
      ring1.frequency.setValueAtTime(1240, now);
      ring1.frequency.exponentialRampToValueAtTime(800, now + 0.3);
      rGain1.gain.setValueAtTime(0.3, now);
      rGain1.gain.exponentialRampToValueAtTime(0.005, now + 0.3);
      ring1.connect(rGain1);
      rGain1.connect(this.sfxGain);
      ring1.start(now);
      ring1.stop(now + 0.3);

      // High metallic ring 2 (dissonant harmonic for metallic clang)
      const ring2 = this.ctx.createOscillator();
      const rGain2 = this.ctx.createGain();
      ring2.type = 'square';
      ring2.frequency.setValueAtTime(1780, now);
      ring2.frequency.exponentialRampToValueAtTime(600, now + 0.22);
      rGain2.gain.setValueAtTime(0.18, now);
      rGain2.gain.exponentialRampToValueAtTime(0.005, now + 0.22);
      ring2.connect(rGain2);
      rGain2.connect(this.sfxGain);
      ring2.start(now);
      ring2.stop(now + 0.22);

      // Deep explosion bass
      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = 'sawtooth';
      sub.frequency.setValueAtTime(260, now);
      sub.frequency.exponentialRampToValueAtTime(35, now + 0.35);
      subGain.gain.setValueAtTime(0.4, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      sub.connect(subGain);
      subGain.connect(this.sfxGain);
      sub.start(now);
      sub.stop(now + 0.35);

      this.playNoise(0.22, 0.4);
    } catch (e) {}
  }

  // Utility noise generator
  playNoise(duration, vol = 0.2) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      if (bufferSize <= 0) return;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
      noise.connect(gain);
      gain.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + duration);
    } catch (e) {}
  }

  // --- Retro Chiptune BGM Engine ---

  startBgm() {
    if (this.isBgmPlaying) return;
    this.resume();
    this.isBgmPlaying = true;
    this.bgmStep = 0;
    this.scheduleBgmLoop();
  }

  stopBgm() {
    this.isBgmPlaying = false;
    if (this.bgmTimer) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  scheduleBgmLoop() {
    if (!this.isBgmPlaying) return;
    if (!this.ctx || this.ctx.state !== 'running') {
      // Audio context might still be waiting for resume; poll briefly
      this.bgmTimer = setTimeout(() => this.scheduleBgmLoop(), 200);
      return;
    }

    try {
      const stepDuration = 60 / this.tempo / 4;
      const now = this.ctx.currentTime;

      const bassline = [
        110, 110, 164.8, 110, 146.8, 110, 164.8, 110,
        130.8, 130.8, 174.6, 130.8, 146.8, 130.8, 164.8, 196
      ];

      const melody = [
        440, 0, 523.25, 0, 587.33, 0, 659.25, 587.33,
        523.25, 0, 440, 0, 392, 440, 523.25, 0
      ];

      const currentStep = this.bgmStep % 16;
      const bassNote = bassline[currentStep];
      const melNote = melody[currentStep];

      if (bassNote > 0 && !this.isMuted) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(bassNote, now);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + stepDuration * 0.9);
        osc.connect(gain);
        gain.connect(this.bgmGain);
        osc.start(now);
        osc.stop(now + stepDuration * 0.9);
      }

      if (melNote > 0 && !this.isMuted) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(melNote, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + stepDuration * 0.7);
        osc.connect(gain);
        gain.connect(this.bgmGain);
        osc.start(now);
        osc.stop(now + stepDuration * 0.7);
      }

      if (!this.isMuted) {
        if (currentStep === 4 || currentStep === 12) {
          this.playSnare(now, stepDuration * 0.5);
        } else if (currentStep % 2 === 0) {
          this.playHiHat(now, 0.03);
        }
      }

      this.bgmStep++;
      this.bgmTimer = setTimeout(() => {
        this.scheduleBgmLoop();
      }, stepDuration * 1000);
    } catch (e) {
      this.bgmTimer = setTimeout(() => this.scheduleBgmLoop(), 200);
    }
  }

  playHiHat(time, duration) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(9000, time);
      gain.gain.setValueAtTime(0.03, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      osc.connect(gain);
      gain.connect(this.bgmGain);
      osc.start(time);
      osc.stop(time + duration);
    } catch (e) {}
  }

  playSnare(time, duration) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, time);
      osc.frequency.exponentialRampToValueAtTime(80, time + duration);
      gain.gain.setValueAtTime(0.06, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      osc.connect(gain);
      gain.connect(this.bgmGain);
      osc.start(time);
      osc.stop(time + duration);
    } catch (e) {}
  }
}

window.soundEngine = new SoundEngine();
