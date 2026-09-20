/**
 * Mr. Oops!! - Main Controller & Event Bindings
 * Handles menu transitions, touch/keyboard input, click-to-tile movement,
 * virtual D-pad, HUD, and live game parameter config panel.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Prewarm sound engine on first user interaction in main menu
  const prewarmUserAudio = () => {
    if (window.soundEngine) {
      window.soundEngine.resume();
    }
  };
  window.addEventListener('pointerdown', prewarmUserAudio, { once: true, passive: true });
  window.addEventListener('keydown', prewarmUserAudio, { once: true, passive: true });

  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);
  window.game = game;

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
  const hostRoomCode = document.getElementById('host-room-code');
  const joinRoomCode = document.getElementById('join-room-code');

  let currentLobbyMode = 'versus';
  const selectHostPlayerCount = document.getElementById('select-host-player-count');

  function updateLobbyTexts(playerCount) {
    const count = parseInt(playerCount, 10) || 2;
    currentLobbyMode = (count === 2) ? 'versus' : (count === 3 ? 'versus3p' : 'versus4p');

    const modalTitle = document.getElementById('versus-modal-title');
    const modalSubtitle = document.getElementById('versus-modal-subtitle');
    const badgeLocal = document.getElementById('badge-opt-local');
    const titleLocal = document.getElementById('title-opt-local');
    const descLocal = document.getElementById('desc-opt-local');
    const badgeHost = document.getElementById('badge-opt-host');
    const titleHost = document.getElementById('title-opt-host');
    const descHost = document.getElementById('desc-opt-host');
    const badgeJoin = document.getElementById('badge-opt-join');
    const titleJoin = document.getElementById('title-opt-join');
    const descJoin = document.getElementById('desc-opt-join');

    if (count === 2) {
      if (modalTitle) modalTitle.textContent = '雙人對抗模式 (1v1 VERSUS)';
      if (modalSubtitle) modalSubtitle.textContent = '選擇本機同屏對戰，或透過區網 / 線上進行超低延遲直連 PK';
      if (badgeLocal) badgeLocal.textContent = '本機';
      if (titleLocal) titleLocal.textContent = '單機同屏雙人 (Local 1v1)';
      if (descLocal) descLocal.textContent = '兩人使用同一台鍵盤（P1: WASD / P2: 方向鍵）即刻開打！';
      if (badgeHost) badgeHost.textContent = '線上 / 區網 • 房主 (P1 藍)';
      if (titleHost) titleHost.textContent = '建立 2 人房間 (開房並開始)';
      if (descHost) descHost.textContent = '設定房號並開房，等待 1 位好友 (P2 紅) 輸入相同房號加入即可開打！';
      if (badgeJoin) badgeJoin.textContent = '線上 / 區網 • 訪客 (P2 紅)';
      if (titleJoin) titleJoin.textContent = '加入 2 人房間 (Join Game)';
      if (descJoin) descJoin.textContent = '輸入好友的房號，直接超低延遲直連加入！';
    } else if (count === 3) {
      if (modalTitle) modalTitle.textContent = '3 人大亂鬥 PK 連線大廳';
      if (modalSubtitle) modalSubtitle.textContent = '正中心開局！選擇本機 3 人混戰，或建立 / 加入連線房間 (線上需 3 人到齊才開始)';
      if (badgeLocal) badgeLocal.textContent = '本機單機';
      if (titleLocal) titleLocal.textContent = '本機 3 人同機對戰 (支援 AI 補位)';
      if (descLocal) descLocal.textContent = 'P1 (WASD)、P2 (方向鍵)、P3 (IJKL/數字鍵)。無人操作時由 AI 電腦人補位！';
      if (badgeHost) badgeHost.textContent = '線上 / 區網 • 房主 (P1 藍)';
      if (titleHost) titleHost.textContent = '建立 3 人房間 (開房並開始)';
      if (descHost) descHost.textContent = '設定房號並開房，等待 2 位好友 (P2~P3) 全部加入即可開打！';
      if (badgeJoin) badgeJoin.textContent = '線上 / 區網 • 加入者 (P2~P3)';
      if (titleJoin) titleJoin.textContent = '加入 3 人房間 (自動分發玩家位)';
      if (descJoin) descJoin.textContent = '輸入相同房號直連加入，系統自動分配 P2/P3 位，使用自己鍵盤即可操控！';
    } else {
      if (modalTitle) modalTitle.textContent = '4 人大亂鬥 PK 連線大廳';
      if (modalSubtitle) modalSubtitle.textContent = '正中心開局！選擇本機 4 人混戰，或建立 / 加入連線房間 (線上需 4 人到齊才開始)';
      if (badgeLocal) badgeLocal.textContent = '本機單機';
      if (titleLocal) titleLocal.textContent = '本機 4 人同機對戰 (支援 AI 補位)';
      if (descLocal) descLocal.textContent = 'P1 (WASD)、P2 (方向鍵)、P3 (IJKL/數字鍵)、P4 (TFGH)。無人操作時由 AI 電腦人補位！';
      if (badgeHost) badgeHost.textContent = '線上 / 區網 • 房主 (P1 藍)';
      if (titleHost) titleHost.textContent = '建立 4 人房間 (開房並開始)';
      if (descHost) descHost.textContent = '設定房號並開房，等待 3 位好友 (P2~P4) 全部加入即可開打！';
      if (badgeJoin) badgeJoin.textContent = '線上 / 區網 • 加入者 (P2~P4)';
      if (titleJoin) titleJoin.textContent = '加入 4 人房間 (自動分發玩家位)';
      if (descJoin) descJoin.textContent = '輸入相同房號直連加入，系統自動分配 P2/P3/P4 位，使用自己鍵盤即可操控！';
    }
  }

  function openVersusModal(mode = 'versus') {
    let initialCount = 2;
    if (mode === 'versus') initialCount = 2;
    else if (mode === 'versus3p') initialCount = 3;
    else if (mode === 'versus4p') initialCount = 4;
    else if (selectHostPlayerCount && selectHostPlayerCount.value) {
      initialCount = parseInt(selectHostPlayerCount.value, 10) || 2;
    }

    if (selectHostPlayerCount) {
      selectHostPlayerCount.value = String(initialCount);
    }
    updateLobbyTexts(initialCount);

    if (versusModal) {
      versusModal.classList.remove('hidden');
    }
  }

  if (selectHostPlayerCount) {
    selectHostPlayerCount.addEventListener('change', (e) => {
      updateLobbyTexts(e.target.value);
    });
  }

  if (btnCloseVersusModal) {
    btnCloseVersusModal.addEventListener('click', () => {
      versusModal.classList.add('hidden');
    });
  }

  if (btnOptLocal) {
    btnOptLocal.addEventListener('click', () => {
      versusModal.classList.add('hidden');
      startSelectedMode(currentLobbyMode, null);
    });
  }

  if (btnStartHost) {
    btnStartHost.addEventListener('click', () => {
      const room = (hostRoomCode && hostRoomCode.value) ? hostRoomCode.value.trim() : '1234';
      if (selectHostPlayerCount) {
        const count = parseInt(selectHostPlayerCount.value, 10) || 2;
        currentLobbyMode = (count === 2) ? 'versus' : (count === 3 ? 'versus3p' : 'versus4p');
      }
      if (window.networkManager) {
        window.networkManager.connect('', 'host', room, currentLobbyMode);
      }
      versusModal.classList.add('hidden');
      startSelectedMode(currentLobbyMode, 'host');
      const need = (currentLobbyMode === 'versus4p') ? '3 位' : (currentLobbyMode === 'versus3p' ? '2 位' : '1 位');
      showToast(`🏠 房間已建立！等待 ${need} 好友加入...`);
    });
  }

  if (btnStartJoin) {
    btnStartJoin.addEventListener('click', () => {
      const room = (joinRoomCode && joinRoomCode.value) ? joinRoomCode.value.trim() : '1234';
      if (window.networkManager) {
        window.networkManager.connect('', 'client', room, currentLobbyMode);
      }
      versusModal.classList.add('hidden');
      startSelectedMode(currentLobbyMode, 'client');
      showToast('🔗 正在連線加入房間...');
    });
  }

  // 2. Start game on mode card click
  document.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const mode = card.dataset.mode;
      if (mode === 'versus' || mode === 'versus4p') {
        openVersusModal(mode);
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
    const hudVersus4pItem = document.getElementById('hud-versus4p-item');
    const hudScoreItem = document.getElementById('hud-score-item');
    const hudLivesItem = document.getElementById('hud-lives-item');
    const hudBestItem = document.getElementById('hud-best-item');
    const hudNetItem = document.getElementById('hud-net-item');
    const hudNetBadge = document.getElementById('hud-net-badge');

    if (hudModeName) {
      if (mode === 'versus4p') {
        hudModeName.textContent = '4P BATTLE ROYALE';
      } else if (mode === 'versus3p') {
        hudModeName.textContent = '3P BATTLE ROYALE';
      } else {
        hudModeName.textContent = mode.toUpperCase();
      }
    }

    if (mode === 'versus4p' || mode === 'versus3p') {
      if (hudVersus4pItem) hudVersus4pItem.classList.remove('hidden');
      const hudVersus4pLabel = document.getElementById('hud-versus4p-label');
      if (hudVersus4pLabel) {
        hudVersus4pLabel.textContent = (mode === 'versus3p') ? '3P SURVIVAL' : '4P SURVIVAL';
      }
      if (hudVersusItem) hudVersusItem.classList.add('hidden');
      if (hudScoreItem) hudScoreItem.classList.add('hidden');
      if (hudLivesItem) hudLivesItem.classList.add('hidden');
      if (hudBestItem) hudBestItem.classList.add('hidden');
      if (hudNetItem) hudNetItem.classList.remove('hidden');
      if (hudWaveLabel) hudWaveLabel.textContent = 'STAGE';
    } else if (mode === 'versus') {
      if (hudVersus4pItem) hudVersus4pItem.classList.add('hidden');
      if (hudVersusItem) hudVersusItem.classList.remove('hidden');
      if (hudScoreItem) hudScoreItem.classList.add('hidden');
      if (hudLivesItem) hudLivesItem.classList.add('hidden');
      if (hudBestItem) hudBestItem.classList.add('hidden');
      if (hudWaveLabel) hudWaveLabel.textContent = 'STAGE';
      if (hudNetItem) hudNetItem.classList.remove('hidden');
    } else {
      if (hudVersus4pItem) hudVersus4pItem.classList.add('hidden');
      if (hudVersusItem) hudVersusItem.classList.add('hidden');
      if (hudNetItem) hudNetItem.classList.remove('hidden');
      if (hudScoreItem) hudScoreItem.classList.remove('hidden');
      if (hudLivesItem) hudLivesItem.classList.remove('hidden');
      if (hudBestItem) hudBestItem.classList.remove('hidden');
      if (hudWaveLabel) hudWaveLabel.textContent = 'LEVEL';
    }

    if (game && typeof game.updateNetHudBadge === 'function') {
      game.updateNetHudBadge();
    }

    if (toggleDpad && toggleDpad.checked && mode !== 'versus' && mode !== 'versus4p' && mode !== 'versus3p') {
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
    const rowVersus4pScore = document.getElementById('row-versus4p-score');
    const resultVersus4pScore = document.getElementById('result-versus4p-score');

    if (result.mode === 'versus4p' || result.mode === 'versus3p') {
      const is3p = (result.mode === 'versus3p');
      if (gameoverBubble) gameoverBubble.textContent = 'CHAMPION!!';
      const names = ['P1 (藍色)', 'P2 (紅色)', 'P3 (綠色)', 'P4 (黃色)'];
      const colors = ['#007aff', '#ff3b30', '#30d158', '#ff9f0a'];
      const winIdx = (result.winner !== null && result.winner !== undefined) ? result.winner : 0;
      const winnerName = names[winIdx] || `P${winIdx + 1}`;
      const winnerColor = colors[winIdx] || '#ffd700';

      if (gameoverTitle) {
        gameoverTitle.innerHTML = `<span style="color:${winnerColor}; font-weight:900;">👑 ${winnerName} 獲得總冠軍！</span>`;
      }
      if (resultMode) resultMode.textContent = is3p ? '3-PLAYER BATTLE ROYALE (3人PK大亂鬥)' : '4-PLAYER BATTLE ROYALE (4人PK大亂鬥)';
      if (rowVersus4pScore) rowVersus4pScore.style.display = 'flex';
      if (resultVersus4pScore) {
        const scores = result.versus4pScores || [0, 0, 0, 0];
        let scorePills = `
          <span style="color:#007aff;">P1: ${scores[0]}</span>
          <span style="color:#ff3b30;">P2: ${scores[1]}</span>
          <span style="color:#30d158;">P3: ${scores[2]}</span>
        `;
        if (!is3p) {
          scorePills += `<span style="color:#ff9f0a;">P4: ${scores[3]}</span>`;
        }
        resultVersus4pScore.innerHTML = `
          <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; font-size:14px; font-weight:900;">
            ${scorePills}
          </div>
          <div style="font-size:12px; color:#8e8e93; margin-top:4px;">(先達 ${result.targetWins} 勝者贏得整場對決)</div>
        `;
      }
      if (rowVersusScore) rowVersusScore.style.display = 'none';
      if (rowWave) rowWave.style.display = 'none';
      if (rowScore) rowScore.style.display = 'none';
      if (rowBest) rowBest.style.display = 'none';
      if (newRecordBadge) newRecordBadge.classList.add('hidden');
    } else if (result.mode === 'versus') {
      if (rowVersus4pScore) rowVersus4pScore.style.display = 'none';
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
      if (rowVersus4pScore) rowVersus4pScore.style.display = 'none';
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
      if (game.isVersus4p && game.netRole) {
        if (game.netRole === 'host') {
          gameoverOverlay.classList.add('hidden');
          game.restartGame();
        } else {
          showToast('等待房主重新開始對決...');
        }
      } else if (game.isVersus && game.netRole) {
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

    const isControlKey = [
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ',
      'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'
    ].includes(e.key) || [
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
      'KeyW', 'KeyS', 'KeyA', 'KeyD'
    ].includes(e.code);

    if (isControlKey) {
      e.preventDefault();
    }

    // Open settings.html in new tab on backtick (`) or ~
    if (e.key === '`' || e.key === '~') {
      window.open('settings.html', '_blank');
      return;
    }

    if (game.state === 'PLAYING') {
      if (game.isVersus4p) {
        if (game.netRole === 'client') {
          // Client (P2, P3, or P4) on own device: can use WASD or Arrow keys!
          if (['ArrowUp', 'w', 'W'].includes(e.key) || e.code === 'KeyW') game.movePlayer(0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key) || e.code === 'KeyS') game.movePlayer(0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key) || e.code === 'KeyA') game.movePlayer(-1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key) || e.code === 'KeyD') game.movePlayer(1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key) || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else if (game.netRole === 'host') {
          // Host (P1) on own device: can use WASD or Arrow keys!
          if (['ArrowUp', 'w', 'W'].includes(e.key) || e.code === 'KeyW') game.movePlayer(0, 0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key) || e.code === 'KeyS') game.movePlayer(0, 0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key) || e.code === 'KeyA') game.movePlayer(0, -1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key) || e.code === 'KeyD') game.movePlayer(0, 1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key) || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else {
          // Local Couch 4P (Shared Keyboard):
          // P1: WASD
          if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') game.movePlayer(0, 0, -1);
          else if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') game.movePlayer(0, 0, 1);
          else if (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') game.movePlayer(0, -1, 0);
          else if (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') game.movePlayer(0, 1, 0);

          // P2: Arrows
          else if (e.key === 'ArrowUp') game.movePlayer(1, 0, -1);
          else if (e.key === 'ArrowDown') game.movePlayer(1, 0, 1);
          else if (e.key === 'ArrowLeft') game.movePlayer(1, -1, 0);
          else if (e.key === 'ArrowRight') game.movePlayer(1, 1, 0);

          // P3: IJKL or Numpad 8/5/4/6
          else if (e.key === 'i' || e.key === 'I' || e.code === 'KeyI' || e.code === 'Numpad8') game.movePlayer(2, 0, -1);
          else if (e.key === 'k' || e.key === 'K' || e.code === 'KeyK' || e.code === 'Numpad5' || e.code === 'Numpad2') game.movePlayer(2, 0, 1);
          else if (e.key === 'j' || e.key === 'J' || e.code === 'KeyJ' || e.code === 'Numpad4') game.movePlayer(2, -1, 0);
          else if (e.key === 'l' || e.key === 'L' || e.code === 'KeyL' || e.code === 'Numpad6') game.movePlayer(2, 1, 0);

          // P4: TFGH
          else if (e.key === 't' || e.key === 'T' || e.code === 'KeyT') game.movePlayer(3, 0, -1);
          else if (e.key === 'g' || e.key === 'G' || e.code === 'KeyG') game.movePlayer(3, 0, 1);
          else if (e.key === 'f' || e.key === 'F' || e.code === 'KeyF') game.movePlayer(3, -1, 0);
          else if (e.key === 'h' || e.key === 'H' || e.code === 'KeyH') game.movePlayer(3, 1, 0);

          else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        }
      } else if (game.isVersus) {
        if (game.netRole === 'client') {
          // LAN Client Mode (P2 on Computer B): Can use EITHER Arrow keys or WASD!
          if (['ArrowUp', 'w', 'W'].includes(e.key) || e.code === 'KeyW') game.movePlayer(0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key) || e.code === 'KeyS') game.movePlayer(0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key) || e.code === 'KeyA') game.movePlayer(-1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key) || e.code === 'KeyD') game.movePlayer(1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key) || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else if (game.netRole === 'host') {
          // LAN Host Mode (P1 on Computer A): Controls Blue P1 with Arrows or WASD
          if (['ArrowUp', 'w', 'W'].includes(e.key) || e.code === 'KeyW') game.movePlayer(0, 0, -1);
          else if (['ArrowDown', 's', 'S'].includes(e.key) || e.code === 'KeyS') game.movePlayer(0, 0, 1);
          else if (['ArrowLeft', 'a', 'A'].includes(e.key) || e.code === 'KeyA') game.movePlayer(0, -1, 0);
          else if (['ArrowRight', 'd', 'D'].includes(e.key) || e.code === 'KeyD') game.movePlayer(0, 1, 0);
          else if (['Escape', 'p', 'P'].includes(e.key) || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        } else {
          // Local Couch 1v1 Mode (Shared Keyboard): P1 WASD (left), P2 Arrow keys (right)
          if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') game.movePlayer(0, 0, -1);
          else if (e.key === 's' || e.key === 'S' || e.code === 'KeyS') game.movePlayer(0, 0, 1);
          else if (e.key === 'a' || e.key === 'A' || e.code === 'KeyA') game.movePlayer(0, -1, 0);
          else if (e.key === 'd' || e.key === 'D' || e.code === 'KeyD') game.movePlayer(0, 1, 0);
          else if (e.key === 'ArrowUp') game.movePlayer(1, 0, -1);
          else if (e.key === 'ArrowDown') game.movePlayer(1, 0, 1);
          else if (e.key === 'ArrowLeft') game.movePlayer(1, -1, 0);
          else if (e.key === 'ArrowRight') game.movePlayer(1, 1, 0);
          else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P' || e.code === 'KeyP') {
            if (btnPauseToggle) btnPauseToggle.click();
          }
        }
      } else {
        // Single Player Mode: Both Arrow Keys and WASD control Player 1 (robustly checks e.key and e.code)
        const isUp = ['ArrowUp', 'w', 'W'].includes(e.key) || e.code === 'KeyW';
        const isDown = ['ArrowDown', 's', 'S'].includes(e.key) || e.code === 'KeyS';
        const isLeft = ['ArrowLeft', 'a', 'A'].includes(e.key) || e.code === 'KeyA';
        const isRight = ['ArrowRight', 'd', 'D'].includes(e.key) || e.code === 'KeyD';
        const isPause = ['Escape', 'p', 'P'].includes(e.key) || e.code === 'KeyP';

        if (isUp) {
          game.movePlayer(0, -1);
        } else if (isDown) {
          game.movePlayer(0, 1);
        } else if (isLeft) {
          game.movePlayer(-1, 0);
        } else if (isRight) {
          game.movePlayer(1, 0);
        } else if (isPause) {
          if (btnPauseToggle) btnPauseToggle.click();
        }
      }
    } else if (game.state === 'MENU') {
      if (e.key === '1') startSelectedMode('rock');
      else if (e.key === '2') startSelectedMode('cannon');
      else if (e.key === '3') startSelectedMode('laser');
      else if (e.key === '4' || e.key === '5' || e.key === '6') openVersusModal('versus');
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

  // 11. Real-time Ping Monitor Hook
  if (window.networkManager) {
    const prevOnPing = window.networkManager.onPing;
    window.networkManager.onPing = (ping, isP2P) => {
      if (typeof prevOnPing === 'function') {
        prevOnPing(ping, isP2P);
      }
      const isValidNum = typeof ping === 'number' && !isNaN(ping);
      // Update Menu Ping Badge (only with server ping)
      if (!isP2P) {
        const menuPingVal = document.getElementById('menu-ping-val');
        const menuPingBadge = document.getElementById('menu-ping-badge');
        if (menuPingVal) {
          menuPingVal.textContent = isValidNum ? ping : '--';
        }
        if (menuPingBadge) {
          const colorClass = !isValidNum ? 'waiting' : (ping > 130 ? 'bad' : (ping > 60 ? 'warn' : 'connected'));
          menuPingBadge.className = `menu-ping-badge ${colorClass}`;
        }
      }

      // Update Game HUD Ping Badge
      if (window.game && typeof window.game.updateNetHudBadge === 'function') {
        if (window.game.mode === 'versus') {
          if (isP2P) {
            window.game.updateNetHudBadge(isValidNum ? ping : null);
          }
        } else {
          window.game.updateNetHudBadge();
        }
      }
    };
  }
});
