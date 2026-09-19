/**
 * Mr. Oops!! - Network Manager (WebRTC P2P DataChannel + WebSocket Signaling)
 * Enables direct ultra-low latency peer-to-peer 1v1 multiplayer between browsers.
 * Strict Quality Policy: If P2P DataChannel cannot be established within 3 seconds,
 * connection is aborted immediately.
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

class NetworkManager {
  constructor() {
    this.ws = null;
    this.role = null; // 'host' | 'client' | null
    this.roomCode = null;
    this.isConnected = false;
    this.isInRoom = false;
    this.opponentConnected = false;

    // Ping & Latency Tracking
    this.pingInterval = null;
    this.httpPingTimer = null;
    this.currentPing = null;
    this.serverPing = null;
    this.p2pPing = null;
    this.lastPingSentTime = 0;
    this.onPing = null;

    // WebRTC P2P State
    this.pc = null;
    this.dc = null;
    this.isP2PActive = false;
    this.p2pTimeoutTimer = null;
    this.p2pPingInterval = null;
    this.pendingCandidates = [];

    // Callbacks
    this.onJoined = null;
    this.onOpponentJoined = null;
    this.onHostReady = null;
    this.onOpponentLeft = null;
    this.onState = null;
    this.onInput = null;
    this.onDisconnect = null;
    this.onError = null;
    this.onPauseRequest = null;
    this.onResumeRequest = null;
    this.onRematchVote = null;
    this.onRematchSync = null;

    // P2P Specific Callbacks
    this.onP2PConnecting = null;
    this.onP2PConnected = null;
    this.onP2PFailed = null;

    // Auto-measure HTTP latency when not in active match
    this.startGlobalPingMonitor();
  }

  startGlobalPingMonitor() {
    if (this.httpPingTimer) return;
    const measure = async () => {
      // Skip if actively connected to match
      if (this.isP2PActive || (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN && this.isInRoom)) {
        return;
      }
      const t0 = performance.now();
      try {
        const res = await fetch('/api/ping?_t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
          const rtt = Math.max(1, Math.round(performance.now() - t0));
          this.currentPing = rtt;
          if (this.onPing) this.onPing(rtt);
        }
      } catch (e) {
        this.currentPing = null;
        if (this.onPing) this.onPing(null);
      }
    };

    setTimeout(measure, 300);
    this.httpPingTimer = setInterval(measure, 2500);
  }

  async fetchLanIp() {
    // If the browser is accessing via a public host (e.g. 64.181.242.49), use current origin directly!
    if (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return {
        ip: location.hostname,
        port: location.port || (location.protocol === 'https:' ? 443 : 80),
        url: location.origin
      };
    }
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

    console.log(`[Network] Connecting to signaling server ${wsUrl} as ${role} for room ${this.roomCode}...`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      if (this.onError) this.onError(err);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log('[Network] WebSocket signaling connected! Joining room...');
      this.sendSignaling({
        action: 'join',
        role: this.role,
        room: this.roomCode
      });

      // WebSocket keepalive ping every 10s
      this.pingInterval = setInterval(() => {
        if (!this.isP2PActive && this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
          const now = performance.now();
          this.lastPingSentTime = now;
          this.sendSignaling({ type: 'ping', t: now });
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
      console.log('[Network] WebSocket signaling disconnected');
      if (!this.isP2PActive) {
        this.cleanup();
        if (this.onDisconnect) this.onDisconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[Network] WebSocket error:', err);
      if (this.onError) this.onError(err);
    };
  }

  // =========================================================================
  // WebRTC P2P DataChannel Implementation
  // =========================================================================

  startP2PTimeoutGuard() {
    this.clearP2PTimeoutGuard();
    this.p2pTimeoutTimer = setTimeout(() => {
      if (!this.isP2PActive) {
        this.handleP2PTimeout('3秒內無法建立 P2P 直連（網路環境受限），為確保遊戲品質已終止對戰');
      }
    }, 3000);
  }

  clearP2PTimeoutGuard() {
    if (this.p2pTimeoutTimer) {
      clearTimeout(this.p2pTimeoutTimer);
      this.p2pTimeoutTimer = null;
    }
  }

  handleP2PTimeout(reason) {
    this.clearP2PTimeoutGuard();
    console.warn('[WebRTC] ❌ P2P Handshake Timeout/Failed:', reason);
    this.cleanupP2P();
    if (this.onP2PFailed) {
      this.onP2PFailed(reason);
    }
  }

  async startP2PAsHost() {
    this.cleanupP2P();
    console.log('[WebRTC] Host starting P2P handshake...');
    if (this.onP2PConnecting) this.onP2PConnecting();
    this.startP2PTimeoutGuard();

    try {
      this.pc = new RTCPeerConnection(RTC_CONFIG);
      this.setupPeerConnectionEvents();

      // Create high-throughput, ordered DataChannel for game packets
      this.dc = this.pc.createDataChannel('mroops_game', {
        ordered: true
      });
      this.setupDataChannel(this.dc);

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      console.log('[WebRTC] Host sending signal_offer via WebSocket...');
      this.sendSignaling({
        type: 'signal_offer',
        sdp: this.pc.localDescription
      });
    } catch (err) {
      console.error('[WebRTC] Host failed to initiate P2P:', err);
      this.handleP2PTimeout('WebRTC 初始化失敗: ' + err.message);
    }
  }

  async handleSignalOffer(msg) {
    this.cleanupP2P();
    console.log('[WebRTC] Client received signal_offer, creating answer...');
    if (this.onP2PConnecting) this.onP2PConnecting();
    this.startP2PTimeoutGuard();

    try {
      this.pc = new RTCPeerConnection(RTC_CONFIG);
      this.setupPeerConnectionEvents();

      this.pc.ondatachannel = (event) => {
        console.log('[WebRTC] Client received DataChannel from Host');
        this.dc = event.channel;
        this.setupDataChannel(this.dc);
      };

      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await this.drainPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      console.log('[WebRTC] Client sending signal_answer via WebSocket...');
      this.sendSignaling({
        type: 'signal_answer',
        sdp: this.pc.localDescription
      });
    } catch (err) {
      console.error('[WebRTC] Client failed to handle offer:', err);
      this.handleP2PTimeout('WebRTC 協商失敗: ' + err.message);
    }
  }

  async handleSignalAnswer(msg) {
    if (!this.pc) return;
    try {
      console.log('[WebRTC] Host received signal_answer, setting remote description...');
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      await this.drainPendingCandidates();
    } catch (err) {
      console.error('[WebRTC] Host failed to set answer remote description:', err);
      this.handleP2PTimeout('WebRTC 應答解析失敗: ' + err.message);
    }
  }

  setupPeerConnectionEvents() {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'signal_candidate',
          candidate: event.candidate
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE Connection State:', this.pc.iceConnectionState);
      if (['failed', 'disconnected', 'closed'].includes(this.pc.iceConnectionState)) {
        if (this.isP2PActive) {
          console.warn('[WebRTC] P2P Peer Disconnected');
          this.isP2PActive = false;
          if (this.onOpponentLeft) this.onOpponentLeft();
        }
      }
    };
  }

  async handleSignalCandidate(msg) {
    if (!msg.candidate) return;
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(msg.candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (err) {
      console.warn('[WebRTC] Error adding ICE candidate:', err);
    }
  }

  async drainPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('[WebRTC] Error adding buffered ICE candidate:', err);
      }
    }
  }

  setupDataChannel(dc) {
    dc.onopen = () => {
      console.log('[WebRTC] ⚡⚡⚡ DataChannel OPEN! P2P direct link established! ⚡⚡⚡');
      this.clearP2PTimeoutGuard();
      this.isP2PActive = true;

      // Start high-precision P2P ping/pong
      this.startP2PPing();

      if (this.onP2PConnected) {
        this.onP2PConnected();
      }
    };

    dc.onclose = () => {
      console.log('[WebRTC] DataChannel closed');
      this.isP2PActive = false;
      if (this.onOpponentLeft) this.onOpponentLeft();
    };

    dc.onerror = (err) => {
      console.warn('[WebRTC] DataChannel error:', err);
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[WebRTC] Error parsing DataChannel packet:', err);
      }
    };
  }

  startP2PPing() {
    if (this.p2pPingInterval) clearInterval(this.p2pPingInterval);
    const pingFn = () => {
      if (this.isP2PActive && this.dc && this.dc.readyState === 'open') {
        const now = performance.now();
        this.lastPingSentTime = now;
        this.send({ type: 'p2p_ping', t: now });
      }
    };
    pingFn();
    this.p2pPingInterval = setInterval(pingFn, 1000);
  }

  // =========================================================================
  // Message Routing
  // =========================================================================

  handleMessage(msg) {
    const type = msg.type;

    // 1. Signaling Messages
    if (type === 'signal_offer') {
      this.handleSignalOffer(msg);
      return;
    }
    if (type === 'signal_answer') {
      this.handleSignalAnswer(msg);
      return;
    }
    if (type === 'signal_candidate') {
      this.handleSignalCandidate(msg);
      return;
    }

    // 2. Room & Connection Events
    if (type === 'joined') {
      this.isInRoom = true;
      this.opponentConnected = Boolean(msg.opponent_present || msg.host_present);
      if (this.onJoined) this.onJoined(msg);
      console.log('[Network] Room joined:', msg);

      // If Host joins and Client is already in room, trigger P2P handshake
      if (this.role === 'host' && msg.opponent_present) {
        this.startP2PAsHost();
      }
    } else if (type === 'opponent_joined') {
      this.opponentConnected = true;
      if (this.onOpponentJoined) this.onOpponentJoined(msg);
      console.log('[Network] Opponent joined room!');

      // Host triggers P2P handshake when Client joins
      if (this.role === 'host') {
        this.startP2PAsHost();
      }
    } else if (type === 'host_ready') {
      this.opponentConnected = true;
      if (this.onHostReady) this.onHostReady(msg);
      console.log('[Network] Host is ready!');
    } else if (type === 'opponent_left') {
      this.opponentConnected = false;
      this.cleanupP2P();
      if (this.onOpponentLeft) this.onOpponentLeft(msg);
      console.log('[Network] Opponent left room');
    }

    // 3. Gameplay Messages (Delivered over WebRTC P2P)
    else if (type === 'state') {
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
    }

    // 4. Latency Measurements
    else if (type === 'p2p_ping') {
      this.send({ type: 'p2p_pong', t: msg.t });
    } else if (type === 'p2p_pong') {
      const now = performance.now();
      const sent = (msg.t !== undefined && msg.t !== null) ? msg.t : this.lastPingSentTime;
      if (sent) {
        const rtt = Math.max(1, Math.round(now - sent));
        this.p2pPing = rtt;
        this.currentPing = rtt;
        if (this.onPing) this.onPing(rtt, true); // true = P2P direct
      }
    } else if (type === 'pong') {
      // WebSocket ping response (before P2P is established)
      if (!this.isP2PActive) {
        const now = performance.now();
        const sent = (msg.t !== undefined && msg.t !== null) ? msg.t : this.lastPingSentTime;
        if (sent) {
          const rtt = Math.max(1, Math.round(now - sent));
          this.serverPing = rtt;
          this.currentPing = rtt;
          if (this.onPing) this.onPing(rtt, false); // false = Server ping
        }
      }
    }
  }

  send(data) {
    // Priority 1: Send over WebRTC P2P DataChannel if active
    if (this.isP2PActive && this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
      return;
    }
    // Priority 2: Send over WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendSignaling(data) {
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

  cleanupP2P() {
    this.clearP2PTimeoutGuard();
    this.isP2PActive = false;
    this.p2pPing = null;
    if (this.p2pPingInterval) {
      clearInterval(this.p2pPingInterval);
      this.p2pPingInterval = null;
    }
    if (this.dc) {
      try { this.dc.close(); } catch (e) {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
    this.pendingCandidates = [];
  }

  disconnect() {
    this.cleanupP2P();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
    }
    this.cleanup();
  }

  cleanup() {
    this.cleanupP2P();
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
