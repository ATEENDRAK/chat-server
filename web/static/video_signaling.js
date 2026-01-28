// video_signaling.js - Shared WebSocket connection for video signaling

class VideoSignalingManager {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.userId = null;
        this.wsUrl = null;
        this.messageHandlers = new Map(); // Map of handler ID to callback
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        this.connectPromise = null; // Track pending connection
        this.pendingUserId = null; // Track which user ID we're connecting for
    }

    // Initialize the shared connection
    connect(wsUrl, userId) {
        // If already connected with same user ID, return immediately
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.userId === userId) {
            console.log('[VideoSignaling] Already connected with same user ID:', userId);
            return Promise.resolve();
        }
        
        // If a connection is in progress for the same user, return the pending promise
        if (this.connectPromise && this.pendingUserId === userId) {
            console.log('[VideoSignaling] Connection already in progress for user:', userId);
            return this.connectPromise;
        }
        
        // If WebSocket exists and is connecting for the same user, wait for it
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.pendingUserId === userId) {
            console.log('[VideoSignaling] WebSocket is connecting for user:', userId);
            return this.connectPromise || Promise.resolve();
        }

        // Close existing connection if user ID changed
        if (this.ws && this.userId && this.userId !== userId) {
            console.log('[VideoSignaling] User ID changed from', this.userId, 'to', userId, ', reconnecting...');
            this.ws.close();
            this.ws = null;
            this.connectPromise = null;
        }

        this.wsUrl = wsUrl;
        this.pendingUserId = userId; // Set BEFORE creating promise

        this.connectPromise = new Promise((resolve, reject) => {
            if (!userId) {
                this.connectPromise = null;
                this.pendingUserId = null;
                reject(new Error('User ID is required'));
                return;
            }

            const wsUrlWithId = `${wsUrl}?id=${userId}`;
            console.log('[VideoSignaling] Creating new connection to:', wsUrlWithId);
            
            this.ws = new WebSocket(wsUrlWithId);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.userId = userId; // Set userId only after successful connection
                this.reconnectAttempts = 0;
                console.log('[VideoSignaling] ✓ Connected with ID:', userId);
                resolve();
            };

            this.ws.onclose = (e) => {
                this.isConnected = false;
                this.connectPromise = null;
                console.log('[VideoSignaling] Connection closed', e.code, e.reason);
                
                // Auto-reconnect if not intentional close
                if (e.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`[VideoSignaling] Reconnecting... attempt ${this.reconnectAttempts}`);
                    setTimeout(() => {
                        if (this.userId) {
                            this.connect(this.wsUrl, this.userId);
                        }
                    }, this.reconnectDelay);
                }
            };

            this.ws.onerror = (e) => {
                console.error('[VideoSignaling] WebSocket error', e);
                this.connectPromise = null;
                reject(e);
            };

            this.ws.onmessage = (evt) => {
                try {
                    const msg = JSON.parse(evt.data);
                    console.log('[VideoSignaling] Message received:', msg.type, 'from:', msg.from);
                    
                    // Dispatch to all registered handlers
                    this.messageHandlers.forEach((handler, id) => {
                        try {
                            handler(msg);
                        } catch (err) {
                            console.error(`[VideoSignaling] Handler ${id} error:`, err);
                        }
                    });
                } catch (err) {
                    console.error('[VideoSignaling] Error parsing message:', err);
                }
            };
        });
        
        return this.connectPromise;
    }

    // Register a message handler
    addHandler(id, callback) {
        this.messageHandlers.set(id, callback);
        console.log(`[VideoSignaling] Handler registered: ${id}`);
    }

    // Remove a message handler
    removeHandler(id) {
        this.messageHandlers.delete(id);
        console.log(`[VideoSignaling] Handler removed: ${id}`);
    }

    // Send a message
    send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('[VideoSignaling] Cannot send - not connected');
            return false;
        }
        try {
            this.ws.send(JSON.stringify(message));
            return true;
        } catch (err) {
            console.error('[VideoSignaling] Send error:', err);
            return false;
        }
    }

    // Check if connected
    get ready() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // Disconnect
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'User disconnected');
            this.ws = null;
        }
        this.isConnected = false;
        this.userId = null;
    }
}

// Incoming call dialog helper
function showIncomingCallDialog(callerName) {
    return new Promise((resolve) => {
        const modal = document.getElementById('incomingCallModal');
        const message = document.getElementById('incomingCallMessage');
        const acceptBtn = document.getElementById('acceptCallBtn');
        const rejectBtn = document.getElementById('rejectCallBtn');
        
        if (!modal || !acceptBtn || !rejectBtn) {
            // Fallback to confirm if modal elements not found
            console.warn('[VideoSignaling] Incoming call modal not found, using confirm()');
            resolve(window.confirm(`Incoming video call from ${callerName}. Accept?`));
            return;
        }
        
        message.textContent = `${callerName} is calling you...`;
        modal.style.display = 'flex';
        
        // Play a sound or vibrate if possible
        try {
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }
        } catch (e) {}
        
        const cleanup = () => {
            modal.style.display = 'none';
            acceptBtn.onclick = null;
            rejectBtn.onclick = null;
        };
        
        acceptBtn.onclick = () => {
            cleanup();
            resolve(true);
        };
        
        rejectBtn.onclick = () => {
            cleanup();
            resolve(false);
        };
    });
}

// Export singleton instance
const videoSignaling = new VideoSignalingManager();
export { videoSignaling, VideoSignalingManager, showIncomingCallDialog };
