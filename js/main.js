/**
 * Mr. Oops!! - Main Controller & Event Bindings
 * Handles menu transitions, touch/keyboard input, click-to-tile movement,
 * virtual D-pad, HUD, and live game parameter config panel.
 */

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);

  const gameHud = document.getElementById('game-hud');
  const hudModeName = document.getElementById('hud-mode-name');
  const menuOverlay = document.getElementById('menu-overlay');
  const pauseOverlay = document.getElementById('pause-overlay');
  const gameoverOverlay = document.getElementById('gameover-overlay');
  const touchControls = document.getElementById('touch-controls');

  const btnSoundToggle = document.getElementById('btn-sound-toggle');
  const btnPauseToggle = document.getElementById('btn-pause-toggle');
  const btnResume = document.getElementById('btn-resume');
  const btnRestartPause = document.getElementById('btn-restart-pause');
  const btnMenuPause = document.getElementById('btn-menu-pause');
  const btnRetry = document.getElementById('btn-retry');
  const btnMenuGameover = document.getElementById('btn-menu-gameover');

  const toggleBloody = document.getElementById('toggle-bloody');
  const toggleDpad = document.getElementById('toggle-dpad');

  const modeDisplayNames = {
    rock: 'ROCK (慢速巨石)',
    cannon: 'CANNON (中速砲彈)',
    laser: 'LASER (快速雷射)',
    allstar: 'ALL-STAR (全明星)'
  };

  // 1. Refresh best scores on main menu cards
  function updateMenuBestScores() {
    ['rock', 'cannon', 'laser', 'allstar'].forEach((m) => {
      const el = document.getElementById(`best-${m}`);
      if (el) {
        el.textContent = `BEST: ${game.getBestScore(m)}`;
      }
    });
  }
  updateMenuBestScores();

  // 2. Start game on mode card click
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = card.dataset.mode;
      startSelectedMode(mode);
    });
  });

  function startSelectedMode(mode) {
    menuOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    gameHud.classList.remove('hidden');

    if (hudModeName) {
      hudModeName.textContent = mode.toUpperCase();
    }

    if (toggleDpad && toggleDpad.checked) {
      touchControls.classList.remove('hidden');
    } else {
      touchControls.classList.add('hidden');
    }

    game.renderer.resize();
    game.startGame(mode);
  }

  // 3. Settings Toggles
  if (toggleBloody) {
    toggleBloody.addEventListener('change', (e) => {
      game.bloodyMode = e.target.checked;
    });
  }

  if (toggleDpad) {
    toggleDpad.addEventListener('change', (e) => {
      if (e.target.checked && game.state === 'PLAYING') {
        touchControls.classList.remove('hidden');
      } else {
        touchControls.classList.add('hidden');
      }
      setTimeout(() => game.renderer.resize(), 50);
    });
  }

  // 4. Sound & Pause Buttons
  if (btnSoundToggle) {
    btnSoundToggle.addEventListener('click', () => {
      const isMuted = game.sound.toggleMute();
      btnSoundToggle.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  if (btnPauseToggle) {
    btnPauseToggle.addEventListener('click', () => {
      if (game.state === 'PLAYING') {
        game.pauseGame();
        pauseOverlay.classList.remove('hidden');
      } else if (game.state === 'PAUSED') {
        game.resumeGame();
        pauseOverlay.classList.add('hidden');
      }
    });
  }

  if (btnResume) {
    btnResume.addEventListener('click', () => {
      game.resumeGame();
      pauseOverlay.classList.add('hidden');
    });
  }

  if (btnRestartPause) {
    btnRestartPause.addEventListener('click', () => {
      pauseOverlay.classList.add('hidden');
      game.restartGame();
    });
  }

  if (btnMenuPause) {
    btnMenuPause.addEventListener('click', () => {
      pauseOverlay.classList.add('hidden');
      gameHud.classList.add('hidden');
      touchControls.classList.add('hidden');
      menuOverlay.classList.remove('hidden');
      updateMenuBestScores();
      game.returnToMenu();
      setTimeout(() => game.renderer.resize(), 50);
    });
  }

  // 5. Game Over Modal Handlers
  window.onGameOverCallback = (result) => {
    const resultMode = document.getElementById('result-mode');
    const resultWave = document.getElementById('result-wave');
    const resultScore = document.getElementById('result-score');
    const resultBest = document.getElementById('result-best');
    const newRecordBadge = document.getElementById('new-record-badge');

    if (resultMode) resultMode.textContent = modeDisplayNames[result.mode] || result.mode;
    if (resultWave) resultWave.textContent = `Level ${result.wave}`;
    if (resultScore) resultScore.textContent = result.score;
    if (resultBest) resultBest.textContent = result.best;

    if (newRecordBadge) {
      if (result.isNewBest) {
        newRecordBadge.classList.remove('hidden');
      } else {
        newRecordBadge.classList.add('hidden');
      }
    }

    gameoverOverlay.classList.remove('hidden');
    updateMenuBestScores();
  };

  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      gameoverOverlay.classList.add('hidden');
      game.restartGame();
    });
  }

  if (btnMenuGameover) {
    btnMenuGameover.addEventListener('click', () => {
      gameoverOverlay.classList.add('hidden');
      gameHud.classList.add('hidden');
      touchControls.classList.add('hidden');
      menuOverlay.classList.remove('hidden');
      updateMenuBestScores();
      game.returnToMenu();
      setTimeout(() => game.renderer.resize(), 50);
    });
  }

  // 6. External Settings Page & Live Update Notification
  setupConfigLink();

  function setupConfigLink() {
    let toastEl = null;
    function showToast(msg) {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'config-toast';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      clearTimeout(toastEl._timer);
      toastEl._timer = setTimeout(() => {
        toastEl.classList.remove('show');
      }, 2000);
    }

    // Listen for live updates from settings.html (via BroadcastChannel or storage event)
    if (window.configManager) {
      window.configManager.onChange(() => {
        showToast('⚡ 遊戲參數已自設定分頁同步更新！');
      });
    }
  }

  // 7. Keyboard Controls (Arrows + WASD + Hotkeys)
  window.addEventListener('keydown', (e) => {
    // If focused on an input element, don't hijack keys
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Escape') {
        document.activeElement.blur();
      }
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }

    // Open settings.html in new tab on backtick (`) or ~
    if (e.key === '`' || e.key === '~') {
      window.open('settings.html', '_blank');
      return;
    }

    if (game.state === 'PLAYING') {
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          game.movePlayer(0, -1);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          game.movePlayer(0, 1);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          game.movePlayer(-1, 0);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          game.movePlayer(1, 0);
          break;
        case 'Escape':
        case 'p':
        case 'P':
          if (btnPauseToggle) btnPauseToggle.click();
          break;
      }
    } else if (game.state === 'MENU') {
      if (e.key === '1') startSelectedMode('rock');
      else if (e.key === '2') startSelectedMode('cannon');
      else if (e.key === '3') startSelectedMode('laser');
      else if (e.key === '4') startSelectedMode('allstar');
      else if (e.key === ' ' || e.key === 'Enter') startSelectedMode('rock');
    } else if (game.state === 'GAME_OVER') {
      if (e.key === ' ' || e.key === 'Enter') {
        if (btnRetry) btnRetry.click();
      } else if (e.key === 'Escape') {
        if (btnMenuGameover) btnMenuGameover.click();
      }
    } else if (game.state === 'PAUSED') {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (btnResume) btnResume.click();
      }
    }
  });

  // 8. Virtual D-Pad Controls
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    const dir = btn.dataset.dir;
    let touchHandled = false;

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchHandled = true;
      if (dir === 'up') game.movePlayer(0, -1);
      else if (dir === 'down') game.movePlayer(0, 1);
      else if (dir === 'left') game.movePlayer(-1, 0);
      else if (dir === 'right') game.movePlayer(1, 0);
    }, { passive: false });

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      if (dir === 'up') game.movePlayer(0, -1);
      else if (dir === 'down') game.movePlayer(0, 1);
      else if (dir === 'left') game.movePlayer(-1, 0);
      else if (dir === 'right') game.movePlayer(1, 0);
    });
  });

  // 9. Direct Canvas Click/Tap on Tiles
  canvas.addEventListener('click', (e) => {
    if (game.state !== 'PLAYING') return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const gridPos = game.renderer.screenToGrid(clickX, clickY);
    if (gridPos) {
      game.moveToTile(gridPos.col, gridPos.row);
    }
  });

  // 10. Mobile Swipe Gestures
  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 22;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (game.state !== 'PLAYING') return;
    if (e.changedTouches.length > 0) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      const dist = Math.hypot(dx, dy);

      if (dist >= SWIPE_THRESHOLD) {
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) game.movePlayer(1, 0);
          else game.movePlayer(-1, 0);
        } else {
          if (dy > 0) game.movePlayer(0, 1);
          else game.movePlayer(0, -1);
        }
      }
    }
  }, { passive: true });
});
