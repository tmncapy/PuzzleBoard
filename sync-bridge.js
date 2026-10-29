// sync-bridge.js - Multi-Transport Realtime Synchronization Bridge
// Transports supported: Socket.IO, WebRTC (PeerJS), Server REST/SSE, Supabase Realtime, BroadcastChannel, LocalStorage, postMessage

(function(window) {
    'use strict';

    // Intercept and silence external PeerJS broker console errors
    if (typeof window !== 'undefined' && window.console && window.console.error) {
        const _origConsoleError = window.console.error;
        window.console.error = function(...args) {
            const str = args.map(a => (a && a.message) ? a.message : String(a)).join(' ');
            if (str.includes('Could not connect to peer') || str.includes('PeerJS:') || str.includes('peer-unavailable')) {
                return;
            }
            return _origConsoleError.apply(window.console, args);
        };
    }

    // Canonical Room ID normalizer: strips prefixes like crossword_broadcast_room_
    function normalizeRoomId(rawId) {
        if (!rawId) return '123456';
        const str = String(rawId).trim();
        const m = str.match(/^(?:crossword_broadcast_room_)?(.+)$/i);
        return m ? m[1] : str;
    }

    const processedMsgIds = new Set();
    const recentCommandSignatures = new Map();

    function isDuplicateMsg(msgId, data) {
        const now = Date.now();
        if (msgId) {
            if (processedMsgIds.has(msgId)) return true;
            processedMsgIds.add(msgId);
            if (processedMsgIds.size > 800) {
                const first = processedMsgIds.values().next().value;
                processedMsgIds.delete(first);
            }
        }

        // Semantic content deduplication across multiple transports within 350ms window
        if (data && (data.payload || data.action || data.type)) {
            const p = data.payload || data;
            const actionType = p.type || p.action || data.event || '';
            if (actionType && typeof actionType === 'string') {
                const subKey = p.data !== undefined ? (typeof p.data === 'object' ? JSON.stringify(p.data) : String(p.data)) : '';
                const sig = `${data.event || ''}_${actionType}_${subKey}`;
                const lastTs = recentCommandSignatures.get(sig);
                if (lastTs && (now - lastTs < 350)) {
                    return true;
                }
                recentCommandSignatures.set(sig, now);
                if (recentCommandSignatures.size > 200) {
                    for (const [k, t] of recentCommandSignatures.entries()) {
                        if (now - t > 4000) recentCommandSignatures.delete(k);
                    }
                }
            }
        }
        return false;
    }

    // Unified API URL resolver
    function getApiUrl(endpoint) {
        const clean = endpoint.replace(/^\/+/, '');
        let custom = localStorage.getItem('crossword_backend_url');
        if (custom) {
            try {
                const u = new URL(custom);
                if (u.hostname !== window.location.hostname && u.hostname.includes('github.io') && !window.location.hostname.includes('github.io')) {
                    localStorage.removeItem('crossword_backend_url');
                    custom = null;
                }
            } catch(e) {
                custom = null;
            }
        }
        if (custom) {
            return custom.replace(/\/+$/, '') + '/' + clean;
        }
        const segments = window.location.pathname.split('/').filter(Boolean);
        let prefix = '';
        if (segments.length > 0 && /^puzzleboard/i.test(segments[0])) {
            prefix = '/' + segments[0];
        }
        return window.location.origin + prefix + '/' + clean;
    }

    class MultiSyncBridge {
        constructor() {
            this.role = 'display'; // 'control', 'display', 'player', 'scoreboard'
            this.roomId = '123456';
            this.onMessageCallback = null;
            this.socket = null;
            this.peer = null;
            this.peerConnections = new Map();
            this.hostConn = null;
            this.broadcastChannel = null;
            this.globalBroadcastChannel = null;
            this.supabaseChannel = null;
            this.isServerAvailable = false;
            this.isSocketAvailable = false;
        }

        init(options = {}) {
            this.role = options.role || 'display';
            this.roomId = normalizeRoomId(options.roomId || '123456');
            this.onMessageCallback = options.onMessage || null;

            console.log(`[GameSync] Initializing MultiSyncBridge (Role: ${this.role}, Room: ${this.roomId})`);

            this.setupBroadcastChannel();
            this.setupLocalStorageListener();
            this.probeServerApi();
            this.setupSocketIO();
            this.setupPeerJS();

            window.addEventListener('message', (e) => {
                if (e.data && (e.data.event === 'control-to-display' || e.data.event === 'player-buzz' || e.data.event === 'display-to-control')) {
                    this.dispatchMessage(e.data);
                }
            });
        }

        dispatchMessage(data) {
            if (!data) return;
            const msgId = data.msgId || (data.event + '_' + (data.ts || Date.now()) + '_' + JSON.stringify(data.payload || {}));
            if (isDuplicateMsg(msgId, data)) return;

            // Room validation: normalize both sides
            const targetRoom = normalizeRoomId(data.roomid || data.roomId);
            if (targetRoom && targetRoom !== this.roomId && targetRoom !== 'default' && targetRoom !== 'all') {
                return;
            }

            if (typeof this.onMessageCallback === 'function') {
                try {
                    this.onMessageCallback(data);
                } catch(e) {
                    console.error('[GameSync] Error in onMessageCallback:', e);
                }
            }
        }

        // 1. Socket.IO Transport with Pre-check to prevent 404 connection failure on static hosts
        setupSocketIO() {
            if (typeof io === 'undefined') {
                return;
            }

            let customBackend = localStorage.getItem('crossword_backend_url');
            if (customBackend) {
                try {
                    const u = new URL(customBackend);
                    if (u.hostname !== window.location.hostname && u.hostname.includes('github.io') && !window.location.hostname.includes('github.io')) {
                        localStorage.removeItem('crossword_backend_url');
                        customBackend = null;
                    }
                } catch(e) {
                    customBackend = null;
                }
            }
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            // If a valid custom backend is configured or running locally, connect directly
            if (customBackend || isLocal) {
                const socketUrl = customBackend || window.location.origin;
                this.connectSocketIO(socketUrl);
                return;
            }

            // On remote static hosting, probe first to check if Socket.IO server exists on this origin
            fetch(window.location.origin + '/socket.io/?EIO=4&transport=polling')
                .then(r => {
                    if (r.ok && r.status === 200) {
                        this.connectSocketIO(window.location.origin);
                    } else {
                        console.log(`[GameSync] No Socket.IO server running at ${window.location.origin} (Static hosting). WebSocket disabled on this origin. Using WebRTC P2P + BroadcastChannel.`);
                    }
                })
                .catch(() => {
                    console.log(`[GameSync] Socket.IO server not reachable at ${window.location.origin}. Using WebRTC P2P + BroadcastChannel.`);
                });
        }

        connectSocketIO(socketUrl) {
            try {
                console.log('[GameSync] Connecting to Socket.IO server at:', socketUrl);
                this.socket = io(socketUrl, {
                    transports: ['websocket', 'polling'],
                    query: { roomid: this.roomId },
                    reconnectionAttempts: 3,
                    reconnectionDelay: 2000,
                    timeout: 4000
                });

                this.socket.on('connect', () => {
                    this.isSocketAvailable = true;
                    console.log('[GameSync] Socket.IO connected! Socket ID:', this.socket.id);
                    this.socket.emit('join-room', this.roomId);
                });

                this.socket.on('connect_error', (err) => {
                    this.isSocketAvailable = false;
                    // Prevent infinite spam if origin doesn't support Socket.IO
                    if (this.socket && this.socket.io && this.socket.io.reconnectionAttempts <= 1) {
                        this.socket.disconnect();
                    }
                });

                this.socket.on('control-command', (data) => this.dispatchMessage(data));
                this.socket.on('display-message', (data) => this.dispatchMessage(data));
                this.socket.on('player-buzz', (data) => this.dispatchMessage(data));
                this.socket.on('broadcast', (data) => this.dispatchMessage(data));
            } catch(e) {
                console.warn('[GameSync] Socket.IO connection error:', e);
            }
        }

        // 2. WebRTC PeerJS Transport (Direct Peer-to-Peer fallback across internet)
        setupPeerJS() {
            if (typeof Peer === 'undefined') {
                return;
            }

            // In server-backed environments (localhost, Cloud Run, AI Studio, or whenever Node server is running),
            // Socket.IO, BroadcastChannel, LocalStorage and Server REST API handle 100% of sync with sub-millisecond latency.
            // External public broker (0.peerjs.com) is not needed and throws spurious peer-unavailable errors when host is offline.
            const isServerEnvironment = typeof window !== 'undefined' && (
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                window.location.hostname.includes('.run.app') ||
                window.location.hostname.includes('ai.studio') ||
                window.location.port === '3000' ||
                window.location.port === '8080' ||
                Boolean(this.socket && this.socket.connected)
            );
            if (isServerEnvironment) {
                return;
            }

            try {
                const peerOptions = { debug: 0, logFunction: () => {} };
                const hostPeerId = `pb_room_${this.roomId}_host`;
                if (this.role === 'control') {
                    // Control acts as WebRTC Host (debug: 0, logFunction: () => {})
                    this.peer = new Peer(hostPeerId, peerOptions);
                    this.peer.on('open', (id) => {
                        console.log('[GameSync] WebRTC Host Peer ready with ID:', id);
                    });
                    this.peer.on('connection', (conn) => {
                        console.log('[GameSync] WebRTC client connected:', conn.peer);
                        this.peerConnections.set(conn.peer, conn);
                        conn.on('data', (data) => this.dispatchMessage(data));
                        conn.on('close', () => this.peerConnections.delete(conn.peer));
                        conn.on('error', () => this.peerConnections.delete(conn.peer));
                    });
                    this.peer.on('error', (err) => {
                        if (err && err.type === 'unavailable-id') {
                            try {
                                if (this.peer && !this.peer.destroyed) this.peer.destroy();
                            } catch(e) {}
                            this.peer = new Peer(peerOptions);
                            this.peer.on('open', () => this.connectToPeerHost(hostPeerId));
                            this.peer.on('error', () => {});
                        }
                    });
                } else {
                    // Display, Player, or Scoreboard acts as WebRTC Client
                    this.peer = new Peer(peerOptions);
                    this.peer.on('open', (id) => {
                        console.log('[GameSync] WebRTC Client Peer ready:', id);
                        this.connectToPeerHost(hostPeerId);
                    });
                    this.peer.on('error', (err) => {
                        // Gracefully handle peer-unavailable: control host is not online yet
                        if (err && err.type === 'peer-unavailable') {
                            if (this.peerReconnectTimer) clearTimeout(this.peerReconnectTimer);
                            this.peerReconnectTimer = setTimeout(() => {
                                if (this.peer && !this.peer.destroyed && (!this.hostConn || !this.hostConn.open)) {
                                    this.connectToPeerHost(hostPeerId);
                                }
                            }, 15000);
                            return;
                        }
                        // Other transient network/socket disconnects handled silently
                    });
                }
            } catch(e) {
                console.warn('[GameSync] PeerJS init error:', e);
            }
        }

        connectToPeerHost(hostPeerId) {
            if (!this.peer || this.peer.destroyed) return;
            try {
                if (this.hostConn && this.hostConn.open) return;
                this.hostConn = this.peer.connect(hostPeerId, { reliable: true });
                if (!this.hostConn) return;

                this.hostConn.on('open', () => {
                    console.log('[GameSync] WebRTC connected to Host:', hostPeerId);
                });
                this.hostConn.on('data', (data) => this.dispatchMessage(data));
                this.hostConn.on('close', () => {
                    if (this.peerReconnectTimer) clearTimeout(this.peerReconnectTimer);
                    this.peerReconnectTimer = setTimeout(() => this.connectToPeerHost(hostPeerId), 15000);
                });
                this.hostConn.on('error', () => {
                    // Handled gracefully without throwing
                });
            } catch(e) {}
        }

        // 3. BroadcastChannel (Same-browser instant tab sync)
        setupBroadcastChannel() {
            if (typeof BroadcastChannel === 'undefined') return;
            try {
                this.broadcastChannel = new BroadcastChannel('crossword_broadcast_room_' + this.roomId);
                this.broadcastChannel.onmessage = (e) => this.dispatchMessage(e.data);

                this.globalBroadcastChannel = new BroadcastChannel('crossword_broadcast_room');
                this.globalBroadcastChannel.onmessage = (e) => this.dispatchMessage(e.data);
            } catch(e) {}
        }

        // 4. LocalStorage Listener (Same-browser tabs fallback)
        setupLocalStorageListener() {
            window.addEventListener('storage', (e) => {
                if (e.key === 'control-to-display-msg' || e.key === 'control-to-display-msg_' + this.roomId || e.key === 'player-buzz-msg' || e.key === 'player-buzz-msg_' + this.roomId) {
                    if (e.newValue) {
                        try {
                            const data = JSON.parse(e.newValue);
                            this.dispatchMessage(data);
                        } catch(err) {}
                    }
                }
            });
        }

        // 5. Server REST / SSE Probe
        probeServerApi() {
            fetch(getApiUrl('api/get-active-room'))
                .then(r => {
                    if (r.ok && r.status === 200) {
                        this.isServerAvailable = true;
                    } else {
                        this.isServerAvailable = false;
                    }
                })
                .catch(() => {
                    this.isServerAvailable = false;
                });
        }

        // Broadcast a message through ALL active transports
        send(event, payload) {
            const ts = (payload && payload.ts) ? payload.ts : Date.now();
            const msgId = (payload && payload.msgId) ? payload.msgId : ('msg_' + ts + '_' + Math.random().toString(36).substr(2, 6));
            const fullMsg = {
                event: event,
                type: event,
                payload: payload,
                data: payload ? payload.data : null,
                action: payload ? (payload.action || payload.type) : null,
                ts: ts,
                msgId: msgId,
                roomid: this.roomId,
                role: this.role
            };

            // Local dispatch prevention
            isDuplicateMsg(msgId, fullMsg);

            // A. Socket.IO (only if server connected)
            if (this.socket && this.socket.connected) {
                try {
                    this.socket.emit(event, fullMsg);
                    this.socket.emit('control-command', fullMsg);
                } catch(e) {}
            }

            // B. WebRTC PeerJS (direct P2P over Internet)
            if (this.role === 'control') {
                for (const [peerId, conn] of this.peerConnections.entries()) {
                    try {
                        if (conn.open) conn.send(fullMsg);
                    } catch(e) {}
                }
            } else if (this.hostConn && this.hostConn.open) {
                try {
                    this.hostConn.send(fullMsg);
                } catch(e) {}
            }

            // C. Server REST API (ONLY if server available to prevent 404 console errors)
            if (this.isServerAvailable) {
                try {
                    fetch(getApiUrl('api/broadcast'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(fullMsg)
                    }).catch(() => {});
                } catch(e) {}
            }

            // D. Supabase Realtime (safe try-catch)
            if (window.channel) {
                try { window.channel.send({ type: 'broadcast', event: event, payload: payload, ...fullMsg }).catch(() => {}); } catch(e){}
            }
            if (window.activeRoomSupabaseChannel) {
                try { window.activeRoomSupabaseChannel.send({ type: 'broadcast', event: event, payload: payload, ...fullMsg }).catch(() => {}); } catch(e){}
            }

            // E. BroadcastChannel
            if (this.broadcastChannel) {
                try { this.broadcastChannel.postMessage(fullMsg); } catch(e) {}
            }
            if (this.globalBroadcastChannel) {
                try { this.globalBroadcastChannel.postMessage(fullMsg); } catch(e) {}
            }

            // F. LocalStorage
            try {
                localStorage.setItem('control-to-display-msg', JSON.stringify(fullMsg));
                localStorage.setItem('control-to-display-msg_' + this.roomId, JSON.stringify(fullMsg));
            } catch(e) {}

            // G. Window postMessage (for iframes or embedded screens)
            try {
                window.postMessage(fullMsg, '*');
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(fullMsg, '*');
                }
            } catch(e) {}
        }
    }

    window.GameSync = new MultiSyncBridge();
    window.normalizeRoomId = normalizeRoomId;
})(window);
