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
    allstar: 'ALL-STAR (全明星)',
    versus: '1v1 VERSUS (雙人對戰)'
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

  // Versus Modal elements
  const versusModal = document.getElementById('versus-modal');
  const btnCloseVersusModal = document.getElementById('btn-close-versus-modal');
  const btnOptLocal = document.getElementById('btn-opt-local');
  const btnStartHost = document.getElementById('btn-start-host');
  const btnStartJoin = document.getElementById('btn-start-join');
  const btnCopyUrl = document.getElementById('btn-copy-url');
  const hostShareUrl = document.getElementById('host-share-url');
  const hostRoomCode = document.getElementById('host-room-code');
  const joinHostIp = document.getElementById('join-host-ip');
  const joinRoomCode = document.getElementById('join-room-code');

  function openVersusModal() {
    if (versusModal) {
      versusModal.classList.remove('hidden');
      if (window.networkManager) {
        window.networkManager.fetchLanIp().then(data => {
          if (hostShareUrl) {
            hostShareUrl.value = data.url ? `${data.url}/index.html` : `http://${data.ip}:${data.port}/index.html`;
          }
          if (joinHostIp && !joinHostIp.value) {
            joinHostIp.value = `${data.ip}:${data.port}`;
          }
        });
      }
    }
  }

  if (btnCloseVersusModal) {
    btnCloseVersusModal.addEventListener('click', () => {
      versusModal.classList.add('hidden');
    });
  }

  if (btnCopyUrl) {
    btnCopyUrl.addEventListener('click', () => {
      if (hostShareUrl && hostShareUrl.value) {
        navigator.clipboard.writeText(hostShareUrl.value).then(() => {
          showToast('📋 網址已複製到剪貼簿！可直接傳給對手');
        }).catch(() => {
          hostShareUrl.select();
          document.execCommand('copy');
          showToast('📋 網址已複製！');
        });
      }
    });
  }

  if (btnOptLocal) {
    btnOptLocal.addEventListener('click', () => {
      versusModal.classList.add('hidden');
      startSelectedMode('versus', null);
    });
  }

  if (btnStartHost) {
    btnStartHost.addEventListener('click', () => {
      const room = (hostRoomCode && hostRoomCode.value) ? hostRoomCode.value.trim() : '1234';
      if (window.networkManager) {
        window.networkManager.connect('', 'host', room);
      }
      versusModal.classList.add('hidden');
      startSelectedMode('versus', 'host');
      showToast('🏠 已建立房間！等待對手加入...');
    });
  }

  if (btnStartJoin) {
    btnStartJoin.addEventListener('click', () => {
      const targetHost = (joinHostIp && joinHostIp.value) ? joinHostIp.value.trim() : '';
      const room = (joinRoomCode && joinRoomCode.value) ? joinRoomCode.value.trim() : '1234';
      if (window.networkManager) {
        window.networkManager.connect(targetHost, 'client', room);
      }
      versusModal.classList.add('hidden');
      startSelectedMode('versus', 'client');
      showToast('🔗 正在連線加入對戰...');
    });
  }

  // 2. Start game on mode card click
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = card.dataset.mode;
      if (mode === 'versus') {
        openVersusModal();
      } else {
        startSelectedMode(mode);
      }
    });
  });

  function startSelectedMode(mode, netRole = null) {
    menuOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    if (versusModal) versusModal.classList.add('hidden');
    gameHud.classList.remove('hidden');

    const hudWaveLabel = document.getElementById('hud-wave-label');
    const hudVersusItem = document.getElementById('hud-versus-item');
    const hudScoreItem = document.getElementById('hud-score-item');
    const hudBestItem = document.getElementById('hud-best-item');
    const hudNetItem = document.getElementById('hud-net-item');
    const hudNetBadge = document.getElementById('hud-net-badge');

    if (hudModeName) {
      hudModeName.textContent = mode.toUpperCase();
    }

    if (mode === 'versus') {
      if (hudVersusItem) hudVersusItem.classList.remove('hidden');
      if (hudScoreItem) hudScoreItem.classList.add('hidden');
      if (hudBestItem) hudBestItem.classList.add('hidden');
      if (hudWaveLabel) hudWaveLabel.textContent = 'STAGE';

      if (netRole) {
        if (hudNetItem) hudNetItem.classList.remove('hidden');
        if (hudNetBadge) {
          if (netRole === 'host') {
            hudNetBadge.textContent = '🟢 P1 (房主)';
            hudNetBadge.className = 'hud-net-badge connected';
          } else {
            hudNetBadge.textContent = '🟢 P2 (客機)';
            hudNetBadge.className = 'hud-net-badge connected';
          }
        }
      } else {
        if (hudNetItem) hudNetItem.classList.add('hidden');
      }
    } else {
      if (hudVersusItem) hudVersusItem.classList.add('hidden');
      if (hudNetItem) hudNetItem.classList.add('hidden');
      if (hudScoreItem) hudScoreItem.classList.remove('hidden');
      if (hudBestItem) hudBestItem.classList.remove('hidden');
      if (hudWaveLabel) hudWaveLabel.textContent = 'LEVEL';
    }

    if (toggleDpad && toggleDpad.checked && mode !== 'versus') {
      touchControls.classList.remove('hidden');
    } else {
      touchControls.classList.add('hidden');
    }

    game.renderer.resize();
    game.startGame(mode, netRole);
  }

  // 3. Settings Toggles
  if (toggleBloody) {
    toggleBloody.addEventListener('change', (e) => {
      game.bloodyMode = e.target.checked;
    });
  }

  if (toggleDpad) {
    toggleDpad.addEventListener('change', (e) => {
      if (e.target.checked && game.state === 'PLAYING' && !game.isVersus) {
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
      if (game.state === 'PLAYING' || game.state === 'START_COUNTDOWN') {
        const who = game.netRole === 'client' ? 'p2' : (game.isVersus ? 'p1' : 'player');
        game.pauseGame(who);
      } else if (game.state === 'PAUSED') {
        game.resumeGame();
      }
    });
  }

  if (btnResume) {
    btnResume.addEventListener('click', () => {
      game.resumeGame();
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
    const gameoverTitle = document.getElementById('gameover-title');
    const gameoverBubble = document.getElementById('gameover-bubble');
    const rowWave = document.getElementById('row-wave');
    const rowScore = document.getElementById('row-score');
    const rowBest = document.getElementById('row-best');
    const rowVersusScore = document.getElementById('row-versus-score');
    const resultVersusScore = document.getElementById('result-versus-score');

    if (result.mode === 'versus') {
      if (gameoverBubble) gameoverBubble.textContent = 'VICTORY!!';
      const winnerName = result.winner === 'p1' ? 'P1 藍色 (PLAYER 1)' : 'P2 紅色 (PLAYER 2)';
      const winnerColor = result.winner === 'p1' ? '#007aff' : '#ff3b30';
      if (gameoverTitle) {
        gameoverTitle.innerHTML = `<span style="color:${winnerColor}; font-weight:900;">🏆 ${winnerName} 獲得大勝！</span>`;
      }
      if (resultMode) resultMode.textContent = '1v1 VERSUS (雙人對戰)';
      if (rowVersusScore) rowVersusScore.style.display = 'flex';
      if (resultVersusScore) {
        resultVersusScore.innerHTML = `<strong style="color:#007aff;">P1 [${result.versusScores.p1}]</strong> - <strong style="color:#ff3b30;">[${result.versusScores.p2}] P2</strong> (目標先達 ${result.targetWins} 勝)`;
      }
      if (rowWave) rowWave.style.display = 'none';
      if (rowScore) rowScore.style.display = 'none';
      if (rowBest) rowBest.style.display = 'none';
      if (newRecordBadge) newRecordBadge.classList.add('hidden');
    } else {
      if (gameoverBubble) gameoverBubble.textContent = 'OOPS!!';
      if (gameoverTitle) gameoverTitle.textContent = 'YOU CRASHED!';
      if (resultMode) resultMode.textContent = modeDisplayNames[result.mode] || result.mode;
      if (rowWave) rowWave.style.display = 'flex';
      if (rowScore) rowScore.style.display = 'flex';
      if (rowBest) rowBest.style.display = 'flex';
      if (rowVersusScore) rowVersusScore.style.display = 'none';
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
    }

    gameoverOverlay.classList.remove('hidden');
    updateMenuBestScores();
  };

  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      if (game.isVersus && game.netRole) {
        const myRole = game.netRole === 'host' ? 'p1' : 'p2';
        game.setRematchVote(myRole, true);
      } else {
        gameoverOverlay.classList.add('hidden');
        game.restartGame();
      }
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

  // 7. Keyboard Controls (Arrows for P1 / WASD for P2 in Versus; Both in Single Player)
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
      if (game.isVersus) {
        if (game.netRole === 'client') {
          // LAN Client Mode (P2 on Computer B): Can use EITHER Arrow keys or WASD!
          if (['ArrowUp', 'w', 'W'].includes(e.key)) game.movePlayer(0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key)) game.movePlayer(0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key)) game.movePlayer(-1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key)) game.movePlayer(1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key)) {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else if (game.netRole === 'host') {
          // LAN Host Mode (P1 on Computer A): Controls Blue P1 with Arrows or WASD
          if (['ArrowUp', 'w', 'W'].includes(e.key)) game.movePlayer(0, 0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key)) game.movePlayer(0, 0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key)) game.movePlayer(0, -1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key)) game.movePlayer(0, 1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key)) {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else {
          // Local Couch 1v1 Mode (Shared Keyboard): P1 WASD (left), P2 Arrow keys (right)
          if (e.key === 'w' || e.key === 'W') game.movePlayer(0, 0, -1);
          else if (e.key === 's' || e.key === 'S') game.movePlayer(0, 0, 1);
          else if (e.key === 'a' || e.key === 'A') game.movePlayer(0, -1, 0);
          else if (e.key === 'd' || e.key === 'D') game.movePlayer(0, 1, 0);
          else if (e.key === 'ArrowUp') game.movePlayer(1, 0, -1);
          else if (e.key === 'ArrowDown') game.movePlayer(1, 0, 1);
          else if (e.key === 'ArrowLeft') game.movePlayer(1, -1, 0);
          else if (e.key === 'ArrowRight') game.movePlayer(1, 1, 0);
          else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        }
      } else {
        // Single Player Mode: Both Arrow Keys and WASD control Player 1
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
      }
    } else if (game.state === 'MENU') {
      if (e.key === '1') startSelectedMode('rock');
      else if (e.key === '2') startSelectedMode('cannon');
      else if (e.key === '3') startSelectedMode('laser');
      else if (e.key === '4') startSelectedMode('allstar');
      else if (e.key === '5') openVersusModal();
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
