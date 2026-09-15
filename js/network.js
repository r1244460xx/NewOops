/**
 * Mr. Oops!! - Network Manager (LAN Multiplayer over WebSocket)
 * Handles client-host room matching, input relaying, and state streaming.
 */

class NetworkManager {
  constructor() {
    this.ws = null;
    this.role = null; // 'host' | 'client' | null
    this.roomCode = null;
    this.isConnected = false;
    this.isInRoom = false;
    this.opponentConnected = false;
    this.pingInterval = null;

    // Callbacks
    this.onJoined = null;
    this.onOpponentJoined = null;
    this.onHostReady = null;
    this.onOpponentLeft = null;
    this.onState = null;
    this.onInput = null;
    this.onDisconnect = null;
    this.onError = null;
  }

  async fetchLanIp() {
    try {
      const res = await fetch('/api/lan-ip');
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('[Network] Failed to fetch LAN IP:', e);
    }
    return { ip: location.hostname || '127.0.0.1', port: location.port || 8081, url: location.origin };
  }

  connect(targetHost, role = 'host', roomCode = '1234') {
    this.disconnect();

    this.role = role;
    this.roomCode = (roomCode || '1234').trim();

    let wsUrl = '';
    if (targetHost) {
      // If user typed custom host e.g. "192.168.1.100:8081" or "192.168.1.100"
      let cleanHost = targetHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!cleanHost.includes(':')) {
        cleanHost += ':' + (location.port || 8081);
      }
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      wsUrl = `${proto}${cleanHost}/ws`;
    } else {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      wsUrl = `${proto}${location.host}/ws`;
    }

    console.log(`[Network] Connecting to ${wsUrl} as ${role} for room ${this.roomCode}...`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      if (this.onError) this.onError(err);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log('[Network] WebSocket connected! Joining room...');
      // Join room
      this.send({
        action: 'join',
        role: this.role,
        room: this.roomCode
      });

      // Keepalive ping every 10s
      this.pingInterval = setInterval(() => {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({ type: 'ping' });
        }
      }, 10000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[Network] Error parsing message:', err, event.data);
      }
    };

    this.ws.onclose = () => {
      console.log('[Network] WebSocket disconnected');
      this.cleanup();
      if (this.onDisconnect) this.onDisconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[Network] WebSocket error:', err);
      if (this.onError) this.onError(err);
    };
  }

  handleMessage(msg) {
    const type = msg.type;

    if (type === 'joined') {
      this.isInRoom = true;
      this.opponentConnected = Boolean(msg.opponent_present || msg.host_present);
      if (this.onJoined) this.onJoined(msg);
      console.log('[Network] Room joined:', msg);
    } else if (type === 'opponent_joined') {
      this.opponentConnected = true;
      if (this.onOpponentJoined) this.onOpponentJoined(msg);
      console.log('[Network] Opponent joined room!');
    } else if (type === 'host_ready') {
      this.opponentConnected = true;
      if (this.onHostReady) this.onHostReady(msg);
      console.log('[Network] Host is ready!');
    } else if (type === 'opponent_left') {
      this.opponentConnected = false;
      if (this.onOpponentLeft) this.onOpponentLeft(msg);
      console.log('[Network] Opponent left room');
    } else if (type === 'state') {
      if (this.onState) this.onState(msg);
    } else if (type === 'input') {
      if (this.onInput) this.onInput(msg.payload);
    } else if (type === 'pause_request') {
      if (this.onPauseRequest) this.onPauseRequest(msg);
    } else if (type === 'resume_request') {
      if (this.onResumeRequest) this.onResumeRequest(msg);
    } else if (type === 'rematch_vote') {
      if (this.onRematchVote) this.onRematchVote(msg);
    } else if (type === 'rematch_sync') {
      if (this.onRematchSync) this.onRematchSync(msg);
    } else if (type === 'pong') {
      // Keepalive response
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendInput(dx, dy) {
    if (this.role === 'client') {
      this.send({
        type: 'input',
        payload: { dx, dy }
      });
    }
  }

  sendPause(pausedBy = 'p2') {
    this.send({
      type: 'pause_request',
      pausedBy
    });
  }

  sendResume() {
    this.send({
      type: 'resume_request'
    });
  }

  sendRematchVote(ready = true) {
    this.send({
      type: 'rematch_vote',
      ready
    });
  }

  sendRematchSync(rematchVotes, startingSoon = false) {
    this.send({
      type: 'rematch_sync',
      rematchVotes,
      startingSoon
    });
  }

  sendState(stateSnapshot) {
    if (this.role === 'host') {
      this.send({
        type: 'state',
        ...stateSnapshot
      });
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
    this.cleanup();
  }

  cleanup() {
    this.isConnected = false;
    this.isInRoom = false;
    this.opponentConnected = false;
    this.ws = null;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

window.networkManager = new NetworkManager();
