/**
 * Mr. Oops!! - Automated Test Harness & Verification
 * Specifically verifies:
 * 1. Warning duration is shortened by half (~0.5s).
 * 2. Level 1 fires 1 line, Level 2 fires 2 lines, Level 3 fires 3 lines, Level 4+ fires 4 lines (max 4).
 * 3. At least one line MUST target the player's current row or column.
 */

const fs = require('fs');

console.log('--- Running Mr. Oops!! Difficulty Fine-Tuning Verification ---');

// 1. Mock Browser Environment
global.window = global;
global.window.addEventListener = () => {};
global.window.devicePixelRatio = 2;
global.document = {
  getElementById: (id) => ({
    id,
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    textContent: '',
    style: {},
    dataset: { mode: 'rock' },
    checked: true,
    addEventListener: () => {},
    parentElement: {
      clientWidth: 600,
      clientHeight: 600,
      getBoundingClientRect: () => ({ width: 600, height: 600, left: 0, top: 0 })
    },
    getBoundingClientRect: () => ({ width: 600, height: 600, left: 0, top: 0 }),
    click: () => {}
  }),
  querySelectorAll: () => [],
  addEventListener: () => {}
};

global.localStorage = {
  store: {},
  getItem: (k) => global.localStorage.store[k] || null,
  setItem: (k, v) => { global.localStorage.store[k] = v; }
};

// Mock 2D context
const mockCtx = {
  save: () => {},
  restore: () => {},
  clearRect: () => {},
  translate: () => {},
  scale: () => {},
  rotate: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  arc: () => {},
  ellipse: () => {},
  quadraticCurveTo: () => {},
  setTransform: () => {},
  fillText: () => {},
  strokeText: () => {},
  createRadialGradient: () => ({
    addColorStop: () => {}
  })
};

const mockCanvas = {
  width: 600,
  height: 600,
  style: {},
  getContext: () => mockCtx,
  parentElement: {
    clientWidth: 600,
    clientHeight: 600,
    getBoundingClientRect: () => ({ width: 600, height: 600, left: 0, top: 0 })
  },
  getBoundingClientRect: () => ({ width: 600, height: 600, left: 0, top: 0 }),
  addEventListener: () => {}
};

// Mock Web Audio API
class MockAudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}
class MockAudioNode {
  connect() {}
  disconnect() {}
}
class MockGainNode extends MockAudioNode {
  constructor() { super(); this.gain = new MockAudioParam(); }
}
class MockOscillatorNode extends MockAudioNode {
  constructor() { super(); this.frequency = new MockAudioParam(); this.type = 'sine'; }
  start() {}
  stop() {}
}
class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 1.0;
    this.sampleRate = 44100;
    this.destination = new MockAudioNode();
  }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBuffer(channels, length, rate) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    return { connect: () => {}, start: () => {}, stop: () => {}, buffer: null };
  }
  resume() { return Promise.resolve(); }
}

global.AudioContext = MockAudioContext;
global.webkitAudioContext = MockAudioContext;
global.requestAnimationFrame = (cb) => 1;

// 2. Load game scripts
eval(fs.readFileSync('js/audio.js', 'utf8'));
eval(fs.readFileSync('js/renderer.js', 'utf8'));
eval(fs.readFileSync('js/obstacles.js', 'utf8'));
eval(fs.readFileSync('js/game.js', 'utf8'));

console.log('✓ All scripts loaded.');

const game = new Game(mockCanvas);

// --- Test 1: Verify Warning Duration (0.75 of original) ---
console.log('\n[Test 1] Checking warning durations (0.75 of original):');
const rockWarn = game.obstacleManager.getWarningDuration('rock');
const cannonWarn = game.obstacleManager.getWarningDuration('cannon');
const laserWarn = game.obstacleManager.getWarningDuration('laser');

console.log(`  - Rock warning: ${rockWarn.toFixed(3)}s (expected ~0.86s)`);
console.log(`  - Cannon warning: ${cannonWarn.toFixed(3)}s (expected ~0.71s)`);
console.log(`  - Laser warning: ${laserWarn.toFixed(3)}s (expected ~0.75s)`);

if (rockWarn < 0.8 || rockWarn > 0.95 || cannonWarn < 0.65 || cannonWarn > 0.8 || laserWarn < 0.7 || laserWarn > 0.85) {
  throw new Error(`Warning duration does not match 0.75 of original!`);
}
console.log('✓ Requirement 2 Passed: Warning duration is successfully set to 0.75 of original time!');

// --- Test 2 & 3: Verify Levels 1, 2, 3, 4 line counts & Player Targeting ---
console.log('\n[Test 2 & 3] Checking line counts (1, 2, 3, 4) and Player Targeting:');

const levelsToTest = [
  { level: 1, expectedLines: 1 },
  { level: 2, expectedLines: 2 },
  { level: 3, expectedLines: 3 },
  { level: 4, expectedLines: 4 },
  { level: 5, expectedLines: 4 }, // Capped at 4
  { level: 10, expectedLines: 4 } // Capped at 4
];

for (const test of levelsToTest) {
  game.obstacleManager.setWave(test.level);

  // Run 20 trials for each level to ensure probabilistic consistency
  for (let trial = 1; trial <= 20; trial++) {
    // Put player at a random spot
    const playerCol = Math.floor(Math.random() * 6);
    const playerRow = Math.floor(Math.random() * 6);
    const testPlayer = { col: playerCol, row: playerRow };

    // Clear previous warnings
    game.obstacleManager.warnings = [];

    // Trigger pattern generation
    game.obstacleManager.generatePattern(testPlayer);

    const warnings = game.obstacleManager.warnings;
    if (warnings.length !== test.expectedLines) {
      throw new Error(`Level ${test.level} generated ${warnings.length} lines, expected ${test.expectedLines}!`);
    }

    // Verify Requirement 3: At least one line MUST match player's row or col
    const targetsPlayer = warnings.some(w => {
      if (w.direction === 'horizontal') {
        return w.index === playerRow;
      } else {
        return w.index === playerCol;
      }
    });

    if (!targetsPlayer) {
      throw new Error(`Level ${test.level}, trial ${trial}: No line targeted the player at (${playerCol}, ${playerRow})! Warnings: ${JSON.stringify(warnings)}`);
    }
  }

  console.log(`✓ Level ${test.level}: exactly ${test.expectedLines} lines spawned in all 20 trials, 100% targeted player's row or col!`);
}

// --- Test 4: Run full simulation in PLAYING state ---
console.log('\n[Test 4] Simulating actual gameplay with new mechanics:');
game.startGame('allstar');
console.log(`✓ Started All-Star mode, initial Level: ${game.wave}`);

// Run 150 frames
for (let f = 1; f <= 150; f++) {
  if (game.sound.ctx) game.sound.ctx.currentTime += 1/60;
  // Move player safely away
  if (f % 20 === 0) {
    const safeCol = (game.player.col + 1) % 6;
    game.player.col = safeCol;
  }
  game.update(1 / 60);
  game.renderer.render(
    game.state,
    game.player,
    game.obstacleManager.obstacles,
    game.obstacleManager.warnings,
    game.collectibles,
    game.mode
  );
}
console.log(`✓ 150 frames simulated with zero errors!`);
console.log(`  - Active warnings: ${game.obstacleManager.warnings.length}`);
console.log(`  - Active obstacles: ${game.obstacleManager.obstacles.length}`);
console.log(`  - Score: ${game.score}`);

console.log('\n===========================================');
console.log('🎉 ALL DIFFICULTY FINE-TUNING TESTS PASSED!');
console.log('===========================================');
