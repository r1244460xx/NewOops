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
    this.mode = 'versus'; // 'versus' | 'versus4p'
    this.playerIndex = 0; // 0 for host/P1, 1 for P2, 2 for P3, 3 for P4
    this.clientId = null;
    this.peerClients = {}; // clientId -> { pc, dc, playerIndex, isConnected, pendingCandidates: [] }
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

  get isMultiClient() {
    return this.mode === 'versus4p' || this.mode === 'versus3p';
  }

  get connectedClientCount() {
    if (this.mode === 'versus') {
      return (this.opponentConnected || this.isP2PActive) ? 1 : 0;
    }
    let count = 0;
    if (this.peerClients) {
      for (const cid in this.peerClients) {
        if (this.peerClients[cid] && this.peerClients[cid].isConnected) count++;
      }
    }
    return count;
  }

  isPlayerConnected(playerIndex) {
    if (playerIndex === 0) return true; // Host
    if (this.mode === 'versus') {
      return playerIndex === 1 && (this.opponentConnected || this.isP2PActive);
    }
    if (this.peerClients) {
      for (const cid in this.peerClients) {
        const client = this.peerClients[cid];
        if (client && client.playerIndex === playerIndex && client.isConnected) {
          return true;
        }
      }
    }
    return false;
  }

  connect(targetHost, role = 'host', roomCode = '1234', mode = 'versus') {
    this.disconnect();

    this.role = role;
    this.roomCode = (roomCode || '1234').trim();
    this.mode = mode || 'versus';

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

    console.log(`[Network] Connecting to signaling server ${wsUrl} as ${role} (mode: ${this.mode}) for room ${this.roomCode}...`);

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
        room: this.roomCode,
        mode: this.mode
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
        // CRITICAL OPTIMIZATION: If this client has an active P2P DataChannel,
        // drop any delayed 'state' packets arriving via WebSocket to eliminate jitter & rollback!
        if (this.role === 'client' && this.isP2PActive && this.dc && this.dc.readyState === 'open' && msg.type === 'state') {
          return;
        }
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
        this.handleP2PTimeout('5秒內無法建立 P2P 直連（網路環境受限），為確保遊戲品質已終止對戰');
      }
    }, 5000);
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

  // Multi-peer WebRTC Star Topology for 4P Mode
  async startP2PForClient(clientId, playerIndex) {
    if (!clientId) return;
    console.log(`[WebRTC] Host starting P2P handshake for client ${clientId} (P${playerIndex + 1})...`);
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer = {
        clientId,
        playerIndex,
        pc,
        dc: null,
        isConnected: false,
        pendingCandidates: []
      };
      this.peerClients[clientId] = peer;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignaling({
            type: 'signal_candidate',
            targetClientId: clientId,
            candidate: event.candidate
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] Peer ${clientId} ICE state:`, pc.iceConnectionState);
        if (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState)) {
          console.warn(`[WebRTC] Peer ${clientId} disconnected`);
          if (peer.isConnected) {
            peer.isConnected = false;
            delete this.peerClients[clientId];
            if (this.onOpponentLeft) this.onOpponentLeft({ clientId, playerIndex });
          }
        }
      };

      const dc = pc.createDataChannel(`mroops_p${playerIndex + 1}`, { ordered: true });
      peer.dc = dc;

      dc.onopen = () => {
        console.log(`[WebRTC] ⚡ DataChannel OPEN for ${clientId} (P${playerIndex + 1})!`);
        peer.isConnected = true;
        this.isP2PActive = true;
        this.startMultiPeerPing();
        if (this.onP2PConnected) this.onP2PConnected({ clientId, playerIndex });
      };

      dc.onclose = () => {
        console.log(`[WebRTC] DataChannel closed for ${clientId}`);
        peer.isConnected = false;
        delete this.peerClients[clientId];
        if (this.onOpponentLeft) this.onOpponentLeft({ clientId, playerIndex });
      };

      dc.onerror = (err) => {
        console.warn(`[WebRTC] DataChannel error for ${clientId}:`, err);
      };

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'p2p_ping') {
            // Echo p2p_pong directly back on this peer's DataChannel
            try { dc.send(JSON.stringify({ type: 'p2p_pong', t: msg.t })); } catch (e) {}
            return;
          }
          if (msg.type === 'p2p_pong') {
            const now = performance.now();
            const sent = (msg.t !== undefined && msg.t !== null) ? msg.t : (peer.lastPingSent || now);
            const rtt = Math.max(1, Math.round(now - sent));
            peer.ping = rtt;
            let maxPing = rtt;
            for (const k in this.peerClients) {
              if (this.peerClients[k].ping) maxPing = Math.max(maxPing, this.peerClients[k].ping);
            }
            this.p2pPing = maxPing;
            this.currentPing = maxPing;
            if (this.onPing) this.onPing(maxPing, true);
            return;
          }
          if (msg.type === 'input') {
            msg.playerIndex = playerIndex;
          }
          this.handleMessage(msg);
        } catch (err) {
          console.error('[WebRTC] Error parsing DataChannel packet from client:', err);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log(`[WebRTC] Host sending signal_offer to ${clientId}...`);
      this.sendSignaling({
        type: 'signal_offer',
        targetClientId: clientId,
        sdp: pc.localDescription
      });
    } catch (err) {
      console.error(`[WebRTC] Host failed to initiate P2P for ${clientId}:`, err);
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
        targetClientId: 'host',
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
          targetClientId: 'host',
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
        if (msg.type === 'p2p_ping') {
          try { dc.send(JSON.stringify({ type: 'p2p_pong', t: msg.t })); } catch (e) {}
          return;
        }
        this.handleMessage(msg);
      } catch (err) {
        console.error('[WebRTC] Error parsing DataChannel packet:', err);
      }
    };
  }

  startMultiPeerPing() {
    if (this.p2pPingInterval) return;
    const pingFn = () => {
      if (this.role === 'host' && this.isMultiClient && this.peerClients) {
        const now = performance.now();
        for (const cid in this.peerClients) {
          const peer = this.peerClients[cid];
          if (peer && peer.dc && peer.dc.readyState === 'open') {
            peer.lastPingSent = now;
            try { peer.dc.send(JSON.stringify({ type: 'p2p_ping', t: now })); } catch (e) {}
          }
        }
      }
    };
    pingFn();
    this.p2pPingInterval = setInterval(pingFn, 1000);
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
      const fromId = msg.fromClientId;
      if (fromId && this.peerClients && this.peerClients[fromId]) {
        const peer = this.peerClients[fromId];
        peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(() => {
          while (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
            const cand = peer.pendingCandidates.shift();
            peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.warn);
          }
        }).catch(err => console.error('[WebRTC] Error setting answer for peer:', err));
      } else {
        this.handleSignalAnswer(msg);
      }
      return;
    }
    if (type === 'signal_candidate') {
      const fromId = msg.fromClientId;
      if (fromId && this.peerClients && this.peerClients[fromId]) {
        const peer = this.peerClients[fromId];
        if (peer.pc && peer.pc.remoteDescription) {
          peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(console.warn);
        } else if (peer.pendingCandidates) {
          peer.pendingCandidates.push(msg.candidate);
        }
      } else {
        this.handleSignalCandidate(msg);
      }
      return;
    }

    // 2. Room & Connection Events
    if (type === 'joined') {
      this.isInRoom = true;
      this.mode = msg.mode || this.mode;
      if (this.role === 'client') {
        this.playerIndex = msg.playerIndex !== undefined ? msg.playerIndex : 1;
        this.clientId = msg.clientId;
      } else if (this.role === 'host') {
        this.playerIndex = 0;
        this.clientId = 'host';
      }
      this.opponentConnected = Boolean(msg.opponent_present || msg.host_present);
      if (this.onJoined) this.onJoined(msg);
      console.log('[Network] Room joined:', msg);

      // If Host joins and Client(s) already in room
      if (this.role === 'host') {
        if (this.isMultiClient) {
          if (Array.isArray(msg.clients)) {
            msg.clients.forEach((cid, idx) => {
              this.startP2PForClient(cid, idx + 1);
            });
          }
        } else if (msg.opponent_present) {
          this.startP2PAsHost();
        }
      }
    } else if (type === 'opponent_joined') {
      this.opponentConnected = true;
      if (this.role === 'host') {
        if (this.isMultiClient) {
          this.startP2PForClient(msg.clientId, msg.playerIndex);
        } else {
          this.startP2PAsHost();
        }
      }
      if (this.onOpponentJoined) this.onOpponentJoined(msg);
      console.log('[Network] Opponent joined room!', msg);
    } else if (type === 'host_ready') {
      this.opponentConnected = true;
      if (this.onHostReady) this.onHostReady(msg);
      console.log('[Network] Host is ready!');
    } else if (type === 'opponent_left') {
      if (this.isMultiClient && this.role === 'host') {
        const cid = msg.clientId;
        if (cid && this.peerClients && this.peerClients[cid]) {
          try { this.peerClients[cid].pc.close(); } catch(e) {}
          delete this.peerClients[cid];
        }
        if (this.onOpponentLeft) this.onOpponentLeft(msg);
      } else {
        this.opponentConnected = false;
        this.cleanupP2P();
        if (this.onOpponentLeft) this.onOpponentLeft(msg);
      }
      console.log('[Network] Opponent left room', msg);
    }

    // 3. Gameplay Messages (Delivered over WebRTC P2P)
    else if (type === 'state') {
      if (this.onState) this.onState(msg);
    } else if (type === 'input') {
      const pIdx = (msg.playerIndex !== undefined) ? msg.playerIndex : (msg.payload && msg.payload.playerIndex !== undefined ? msg.payload.playerIndex : 1);
      if (this.onInput) this.onInput(msg.payload, pIdx);
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
    const jsonStr = (typeof data === 'string') ? data : JSON.stringify(data);

    // Multi-peer mode on Host: broadcast to all connected peer DataChannels
    if (this.role === 'host' && this.isMultiClient && this.peerClients && Object.keys(this.peerClients).length > 0) {
      let sentCount = 0;
      let totalPeers = 0;
      for (const cid in this.peerClients) {
        totalPeers++;
        const peer = this.peerClients[cid];
        if (peer && peer.dc && peer.dc.readyState === 'open') {
          try {
            peer.dc.send(jsonStr);
            sentCount++;
          } catch (e) {}
        }
      }
      // If all active peers received it over P2P DataChannels, do NOT fall back to WebSocket!
      if (sentCount > 0 && sentCount === totalPeers) {
        return;
      }
    }

    // 1v1 P2P mode (Host or Client)
    if (this.isP2PActive && this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(jsonStr);
        return;
      } catch (e) {}
    }

    // Priority 2: Fallback to WebSocket only if P2P is not available
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(jsonStr);
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
        playerIndex: this.playerIndex,
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
    if (this.role !== 'host') return;

    const data = {
      type: 'state',
      ...stateSnapshot
    };
    const str = JSON.stringify(data);

    // Multi-client mode (3P / 4P)
    if (this.isMultiClient) {
      let missingP2P = false;
      let peerCount = 0;

      if (this.peerClients && Object.keys(this.peerClients).length > 0) {
        for (const cid in this.peerClients) {
          peerCount++;
          const peer = this.peerClients[cid];
          if (peer && peer.dc && peer.dc.readyState === 'open') {
            try {
              peer.dc.send(str);
            } catch (e) {
              missingP2P = true;
            }
          } else {
            missingP2P = true;
          }
        }
      } else {
        missingP2P = true;
      }

      // ONLY broadcast over WebSocket if at least one client does not have an open P2P DataChannel!
      if (missingP2P && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(str);
      }
      return;
    }

    // 1v1 Mode: If P2P active, send via DataChannel and return immediately!
    if (this.isP2PActive && this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(str);
        return;
      } catch (e) {}
    }

    // 1v1 Mode: Fallback to WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(str);
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
    if (this.peerClients) {
      for (const cid in this.peerClients) {
        const peer = this.peerClients[cid];
        if (peer.dc) { try { peer.dc.close(); } catch(e) {} }
        if (peer.pc) { try { peer.pc.close(); } catch(e) {} }
      }
      this.peerClients = {};
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
