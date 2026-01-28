// video_call_base.js - Base class for video calling functionality

import { videoSignaling, showIncomingCallDialog } from './video_signaling.js';

// Export for subclasses
export { showIncomingCallDialog };

class VideoCallBase {
    constructor({ localVideoId, remoteVideoId, startBtnId, endBtnId, wsUrl, getMyId, getPeerId, getPeerIds, containerId, onCallStart, onCallEnd }) {
        this.localVideo = document.getElementById(localVideoId);
        this.remoteVideo = document.getElementById(remoteVideoId);
        this.startBtn = document.getElementById(startBtnId);
        this.endBtn = document.getElementById(endBtnId);
        this.container = containerId ? document.getElementById(containerId) : null;
        this.wsUrl = wsUrl;
        this.getMyId = getMyId;
        this.getPeerId = getPeerId;
        this.getPeerIds = getPeerIds; // For multi-party calls
        this.onCallStart = onCallStart || (() => {});
        this.onCallEnd = onCallEnd || (() => {});
        
        // Single peer connection (for 1:1 calls)
        this.pc = null;
        
        // Multi-party support: map of peerId -> { pc, remoteVideo, remoteLabel }
        this.peerConnections = new Map();
        
        this.ws = null;
        this.localStream = null;
        this.pendingCandidates = [];
        this.isCaller = false;
        this.isConnected = false;
        this.isMuted = false;
        this.isSpeakerOn = true;
        this.peerIdInCall = null;
        this.peersInCall = []; // Array of peer IDs for multi-party
        this.inCall = false;
        this.connectSignaling();
        this.bindEvents();
        this._createControlButtons();
    }

    connectSignaling() {
        const myId = this.getMyId();
        if (!myId) {
            setTimeout(() => this.connectSignaling(), 1000);
            return;
        }
        
        if (this.startBtn) this.startBtn.disabled = true;
        
        // Use the shared signaling manager
        const handlerId = this.constructor.name;
        
        // Register our message handler
        videoSignaling.addHandler(handlerId, async (msg) => {
            try {
                const myId = this.getMyId();
                console.log(`[${this.constructor.name}] Message received - Type:`, msg.type, 'From:', msg.from, 'To:', msg.to);
                await this.handleMessage(msg, myId);
            } catch (err) {
                console.error(`[${this.constructor.name}] Error in message handler:`, err);
            }
        });
        
        // Connect to the shared signaling server
        videoSignaling.connect(this.wsUrl, myId)
            .then(() => {
                this.isConnected = true;
                console.log(`[${this.constructor.name}] Connected via shared signaling with ID:`, myId);
                if (this.endBtn) this.endBtn.style.display = '';
                if (this.startBtn) this.startBtn.disabled = false;
            })
            .catch((err) => {
                console.error(`[${this.constructor.name}] Failed to connect:`, err);
                if (this.startBtn) this.startBtn.disabled = true;
            });
        
        // Store reference for sending messages
        this.ws = {
            get readyState() { return videoSignaling.ready ? WebSocket.OPEN : WebSocket.CLOSED; },
            send: (data) => videoSignaling.send(JSON.parse(data))
        };
    }

    async handleMessage(msg, myId) {
        // To be implemented by subclasses
        throw new Error('handleMessage must be implemented by subclass');
    }

    async startCall() {
        // Show video container and ensure parent containers are visible
        if (this.container) {
            this.container.style.display = '';
            // For group calls, also show the message input container
            if (this.container.id === 'videoCallContainer') {
                const messageInputContainer = document.getElementById('messageInputContainer');
                if (messageInputContainer) {
                    messageInputContainer.style.display = 'block';
                }
            }
        }
        
        const myId = this.getMyId();
        
        // Check for multi-party call support
        let peerIds = [];
        if (this.getPeerIds) {
            peerIds = await this.getPeerIds();
            if (!peerIds || peerIds.length === 0) {
                console.log(`[${this.constructor.name}] No peers selected for call`);
                return;
            }
        } else if (this.getPeerId) {
            const peerId = this.getPeerId();
            if (peerId) {
                peerIds = [peerId];
            }
        }
        
        if (!myId || peerIds.length === 0) {
            alert('Missing user IDs for video call. Please ensure you have selected a user to call.');
            return;
        }
        if (!this.ws || this.ws.readyState !== 1) {
            alert('Signaling connection not ready. Please wait and try again.');
            return;
        }
        if (this.inCall) {
            alert('A call is already in progress. Please end the current call first.');
            return;
        }
        
        console.log(`[${this.constructor.name}] Starting call - My ID:`, myId, 'Peer IDs:', peerIds);
        
        try {
            this.isCaller = true;
            this.peersInCall = peerIds;
            this.peerIdInCall = peerIds[0]; // Primary peer for backward compatibility
            this.inCall = true;
            
            // Get local media stream first
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (this.localVideo) {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = '';
                console.log(`[${this.constructor.name}] Local video stream set`);
            }
            
            // For single peer, use the default remote video element
            if (peerIds.length === 1) {
                const peerId = peerIds[0];
                this._setupPeerConnection(myId, peerId);
                
                // Add tracks to peer connection
                this.localStream.getTracks().forEach(t => {
                    this.pc.addTrack(t, this.localStream);
                });
                
                if (this.remoteVideo) {
                    this.remoteVideo.style.display = '';
                }
                
                // Create and send offer
                const offer = await this.pc.createOffer();
                await this.pc.setLocalDescription(offer);
                const offerMsg = { from: myId, to: peerId, type: 'offer', data: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } };
                
                console.log(`[${this.constructor.name}] Sending offer to:`, peerId);
                this.ws.send(JSON.stringify(offerMsg));
            } else {
                // Multi-party call: create peer connections for each peer
                console.log(`[${this.constructor.name}] Starting multi-party call with ${peerIds.length} peers`);
                
                for (let i = 0; i < peerIds.length; i++) {
                    const peerId = peerIds[i];
                    await this._setupMultiPartyConnection(myId, peerId, i);
                }
            }
            
            this.onCallStart({ role: 'caller', peerCount: peerIds.length });
            
        } catch (err) {
            console.error(`[${this.constructor.name}] Error starting call:`, err);
            alert('Failed to start call: ' + err.message);
            this.endCall({ notifyPeer: false, reason: 'error' });
        }
    }
    
    async _setupMultiPartyConnection(myId, peerId, index) {
        console.log(`[${this.constructor.name}] Setting up connection ${index + 1} for peer:`, peerId);
        
        // Create a new peer connection for this peer
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        
        // Create or get remote video element for this peer
        let remoteVideo, remoteLabel;
        if (index === 0 && this.remoteVideo) {
            // Use the default remote video for the first peer
            remoteVideo = this.remoteVideo;
            remoteLabel = document.getElementById('remoteVideoLabel');
        } else {
            // Create new video element for additional peers
            const videoGrid = document.getElementById('videoGrid');
            if (videoGrid) {
                const wrapper = document.createElement('div');
                wrapper.className = 'video-wrapper';
                wrapper.id = `remoteVideoWrapper_${peerId}`;
                
                remoteLabel = document.createElement('div');
                remoteLabel.className = 'video-label';
                remoteLabel.textContent = 'Connecting...';
                
                remoteVideo = document.createElement('video');
                remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.style.cssText = 'width: 180px; border: 1px solid #ccc; background: #000;';
                
                wrapper.appendChild(remoteLabel);
                wrapper.appendChild(remoteVideo);
                videoGrid.appendChild(wrapper);
            }
        }
        
        // Store the connection info
        this.peerConnections.set(peerId, { pc, remoteVideo, remoteLabel });
        
        // Set up ICE candidate handling
        pc.onicecandidate = (e) => {
            if (e.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                const candidateData = {
                    candidate: e.candidate.candidate,
                    sdpMLineIndex: e.candidate.sdpMLineIndex,
                    sdpMid: e.candidate.sdpMid
                };
                const iceMsg = { from: myId, to: peerId, type: 'ice', data: candidateData };
                this.ws.send(JSON.stringify(iceMsg));
            }
        };
        
        // Set up track handling
        pc.ontrack = (e) => {
            console.log(`[${this.constructor.name}] Received track from peer:`, peerId, 'streams:', e.streams?.length);
            if (remoteVideo && e.streams && e.streams.length > 0) {
                remoteVideo.srcObject = e.streams[0];
                remoteVideo.muted = false;
                // Force play the video
                remoteVideo.play().catch(err => {
                    console.log(`[${this.constructor.name}] Video play error (will retry):`, err.name);
                    setTimeout(() => {
                        remoteVideo.play().catch(() => {});
                    }, 500);
                });
                if (remoteLabel && this._getCallerName) {
                    remoteLabel.textContent = this._getCallerName(peerId);
                }
            }
        };
        
        // When connection is established, send participant info
        pc.onconnectionstatechange = () => {
            console.log(`[${this.constructor.name}] Connection state for ${peerId}:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                // Send list of other participants to this peer
                this._sendParticipantInfo(peerId, myId);
            }
        };
        
        // Add local tracks
        this.localStream.getTracks().forEach(t => {
            pc.addTrack(t, this.localStream);
        });
        
        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        const offerMsg = { 
            from: myId, 
            to: peerId, 
            type: 'offer', 
            data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } 
        };
        
        console.log(`[${this.constructor.name}] Sending offer to peer ${index + 1}:`, peerId);
        this.ws.send(JSON.stringify(offerMsg));
    }
    
    // Send participant info to a peer so they can connect to other participants
    _sendParticipantInfo(toPeerId, myId) {
        // Collect ALL participants - even if not fully connected yet
        const participants = new Set([myId]);
        
        // Add ALL peers from multi-party connections (regardless of state)
        this.peerConnections.forEach((info, peerId) => {
            participants.add(peerId);
        });
        
        // Add primary peer if exists
        if (this.peerIdInCall) {
            participants.add(this.peerIdInCall);
        }
        
        // Add ALL peers that were initially called (most important for caller)
        this.peersInCall.forEach(peerId => {
            participants.add(peerId);
        });
        
        // Remove the target peer from the list (they don't need to know about themselves)
        participants.delete(toPeerId);
        
        const participantArray = Array.from(participants);
        
        if (participantArray.length > 0) {
            console.log(`[${this.constructor.name}] Sending participant info to ${toPeerId}:`, participantArray);
            const infoMsg = {
                from: myId,
                to: toPeerId,
                type: 'participant_info',
                data: { participants: participantArray }
            };
            try {
                this.ws.send(JSON.stringify(infoMsg));
            } catch (err) {
                console.error(`[${this.constructor.name}] Failed to send participant info:`, err);
            }
        }
    }
    
    // Send participant info to ALL peers (for mesh network updates)
    // Debounced to prevent excessive broadcasts
    _broadcastParticipantInfo(myId) {
        // Debounce - only broadcast once per second
        if (this._lastBroadcast && Date.now() - this._lastBroadcast < 1000) {
            console.log(`[${this.constructor.name}] Skipping broadcast - too soon (debounced)`);
            return;
        }
        this._lastBroadcast = Date.now();
        
        const sentTo = new Set();
        
        // Send to all peers in peerConnections
        this.peerConnections.forEach((info, peerId) => {
            if (!sentTo.has(peerId)) {
                this._sendParticipantInfo(peerId, myId);
                sentTo.add(peerId);
            }
        });
        
        // Send to primary peer if exists
        if (this.peerIdInCall && !sentTo.has(this.peerIdInCall)) {
            this._sendParticipantInfo(this.peerIdInCall, myId);
            sentTo.add(this.peerIdInCall);
        }
        
        // CRITICAL: Also send to ALL peers in peersInCall array
        // This ensures newly joined peers get info even if their connection isn't in peerConnections yet
        this.peersInCall.forEach(peerId => {
            if (!sentTo.has(peerId) && peerId !== myId) {
                this._sendParticipantInfo(peerId, myId);
                sentTo.add(peerId);
            }
        });
        
        console.log(`[${this.constructor.name}] Broadcast participant info to ${sentTo.size} peers:`, Array.from(sentTo));
    }

    _setupPeerConnection(myId, peerId) {
        console.log(`[${this.constructor.name}] Creating new RTCPeerConnection for peer:`, peerId);
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    return;
                }
                const candidateData = {
                    candidate: e.candidate.candidate,
                    sdpMLineIndex: e.candidate.sdpMLineIndex,
                    sdpMid: e.candidate.sdpMid
                };
                const iceMsg = { from: myId, to: peerId, type: 'ice', data: candidateData };
                try {
                    this.ws.send(JSON.stringify(iceMsg));
                } catch (err) {
                    console.error(`[${this.constructor.name}] Failed to send ICE candidate:`, err);
                }
            }
        };
        this.pc.ontrack = (e) => {
            console.log(`[${this.constructor.name}] Received remote track`, e);
            console.log(`[${this.constructor.name}] Track kind:`, e.track.kind, 'Streams:', e.streams?.length || 0);
            console.log(`[${this.constructor.name}] Track enabled:`, e.track.enabled, 'muted:', e.track.muted);
            
            if (!this.remoteVideo) {
                console.error(`[${this.constructor.name}] Remote video element not found!`);
                return;
            }
            
            // Handle video and audio tracks
            if (e.streams && e.streams.length > 0) {
                console.log(`[${this.constructor.name}] Setting remote video stream from streams array`);
                this.remoteVideo.srcObject = e.streams[0];
                // Ensure audio is enabled for remote video
                this.remoteVideo.muted = false;
            } else if (e.track) {
                console.log(`[${this.constructor.name}] Creating stream from track:`, e.track.kind);
                if (!this.remoteVideo.srcObject) {
                    const stream = new MediaStream();
                    stream.addTrack(e.track);
                    this.remoteVideo.srcObject = stream;
                    console.log(`[${this.constructor.name}] Created new stream and set on remote video`);
                } else {
                    // Check if track already exists
                    const existingTracks = this.remoteVideo.srcObject.getTracks();
                    const trackExists = existingTracks.some(t => t.id === e.track.id);
                    if (!trackExists) {
                        this.remoteVideo.srcObject.addTrack(e.track);
                        console.log(`[${this.constructor.name}] Added track to existing stream`);
                    } else {
                        console.log(`[${this.constructor.name}] Track already exists, skipping`);
                    }
                }
                // Ensure audio is enabled for remote video
                this.remoteVideo.muted = false;
            }
            
            // Ensure video element is visible
            if (this.remoteVideo.style.display === 'none') {
                this.remoteVideo.style.display = '';
            }
            
            // Update the remote video label with peer's name
            const remoteLabel = document.getElementById('remoteVideoLabel');
            if (remoteLabel && this._getCallerName && this.peerIdInCall) {
                const peerName = this._getCallerName(this.peerIdInCall);
                if (peerName && peerName !== 'Unknown') {
                    remoteLabel.textContent = peerName;
                }
            }
            
            // Log all tracks in the remote stream
            if (this.remoteVideo.srcObject) {
                const allTracks = this.remoteVideo.srcObject.getTracks();
                console.log(`[${this.constructor.name}] Remote stream now has ${allTracks.length} tracks:`, 
                    allTracks.map(t => `${t.kind} (enabled: ${t.enabled})`).join(', '));
            }
            
            // Fix video play error - wait for video to be ready
            this._playRemoteVideo();
        };
        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            console.log(`[${this.constructor.name}] PeerConnection state:`, state);
            if (state === 'connected') {
                console.log(`[${this.constructor.name}] Connection established with ${peerId}!`);
                // Always send participant info when connection is established
                // This helps build the mesh network
                setTimeout(() => {
                    this._broadcastParticipantInfo(myId);
                }, 500);
            } else if (state === 'failed') {
                console.error(`[${this.constructor.name}] Connection failed`);
            }
        };
        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                console.log(`[${this.constructor.name}] ICE connection established!`);
            }
        };
    }

    _playRemoteVideo() {
        if (!this.remoteVideo) return;
        // Wait for video to be ready before playing
        const playVideo = () => {
            if (this.remoteVideo.readyState >= 2) { // HAVE_CURRENT_DATA or higher
                this.remoteVideo.play().catch(err => {
                    if (err.name !== 'AbortError') {
                        console.error(`[${this.constructor.name}] Error playing remote video:`, err);
                    }
                });
            } else {
                // Wait for loadeddata event
                this.remoteVideo.addEventListener('loadeddata', () => {
                    this.remoteVideo.play().catch(err => {
                        if (err.name !== 'AbortError') {
                            console.error(`[${this.constructor.name}] Error playing remote video:`, err);
                        }
                    });
                }, { once: true });
            }
        };
        playVideo();
    }

    _handleRemoteCandidate(candidate) {
        if (!this.pc) return;
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            this.pc.addIceCandidate(candidate).catch(e => {
                console.error(`[${this.constructor.name}] Error adding ICE candidate:`, e);
            });
        } else {
            this.pendingCandidates.push(candidate);
        }
    }

    _addPendingCandidates() {
        if (this.pendingCandidates.length > 0) {
            this.pendingCandidates.forEach(candidate => {
                this.pc.addIceCandidate(candidate).catch(e => {
                    console.error(`[${this.constructor.name}] Error adding queued ICE candidate:`, e);
                });
            });
            this.pendingCandidates = [];
        }
    }

    _createControlButtons() {
        if (!this.container) return;
        
        // Check if controls already exist
        let controlsDiv = this.container.querySelector('.video-call-controls');
        if (!controlsDiv) {
            controlsDiv = document.createElement('div');
            controlsDiv.className = 'video-call-controls';
            controlsDiv.style.cssText = 'display: flex; gap: 10px; margin-top: 10px; justify-content: center;';
            
            const muteBtn = document.createElement('button');
            muteBtn.innerHTML = '🔇 Mute';
            muteBtn.style.cssText = 'padding: 5px 10px; cursor: pointer;';
            muteBtn.onclick = () => this.toggleMute();
            controlsDiv.appendChild(muteBtn);
            this.muteBtn = muteBtn;
            
            const speakerBtn = document.createElement('button');
            speakerBtn.innerHTML = '🔊 Speaker';
            speakerBtn.style.cssText = 'padding: 5px 10px; cursor: pointer;';
            speakerBtn.onclick = () => this.toggleSpeaker();
            controlsDiv.appendChild(speakerBtn);
            this.speakerBtn = speakerBtn;
            
            if (this.endBtn) {
                this.endBtn.classList.add('end-call-btn');
                // Remove end button from its original location if it exists there
                if (this.endBtn.parentNode && this.endBtn.parentNode !== controlsDiv) {
                    this.endBtn.parentNode.removeChild(this.endBtn);
                }
                controlsDiv.appendChild(this.endBtn);
            }
            this.container.appendChild(controlsDiv);
        }
    }
    
    toggleMute() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });
        if (this.muteBtn) {
            this.muteBtn.innerHTML = this.isMuted ? '🔇 Unmute' : '🔇 Mute';
        }
    }
    
    toggleSpeaker() {
        this.isSpeakerOn = !this.isSpeakerOn;
        if (this.remoteVideo) {
            this.remoteVideo.muted = !this.isSpeakerOn;
        }
        if (this.speakerBtn) {
            this.speakerBtn.innerHTML = this.isSpeakerOn ? '🔊 Speaker' : '🔇 Speaker Off';
        }
    }

    bindEvents() {
        if (this.startBtn) {
            this.startBtn.addEventListener('click', () => this.startCall());
        }
        if (this.endBtn) {
            this.endBtn.addEventListener('click', () => this.endCall());
        }
    }

    endCall({ notifyPeer = true, reason = 'local' } = {}) {
        if (!this.inCall && !this.pc && this.peerConnections.size === 0) return;
        const wasInCall = this.inCall;
        this.inCall = false;

        const myId = this.getMyId();
        
        // Notify all peers in multi-party call
        if (notifyPeer && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const peersToNotify = this.peersInCall.length > 0 ? this.peersInCall : (this.peerIdInCall ? [this.peerIdInCall] : []);
            peersToNotify.forEach(peerId => {
                if (myId) {
                    const endMsg = { from: myId, to: peerId, type: 'end_call' };
                    try {
                        this.ws.send(JSON.stringify(endMsg));
                    } catch (err) {
                        console.error(`[${this.constructor.name}] Failed to send end call message to ${peerId}:`, err);
                    }
                }
            });
        }

        // Close single peer connection
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        
        // Close all multi-party peer connections
        this.peerConnections.forEach((peerInfo, peerId) => {
            if (peerInfo.pc) {
                peerInfo.pc.close();
            }
            // Remove dynamically created video elements (but not the default one)
            if (peerInfo.remoteVideo && peerInfo.remoteVideo !== this.remoteVideo) {
                const wrapper = peerInfo.remoteVideo.parentElement;
                if (wrapper && wrapper.id && wrapper.id.startsWith('remoteVideoWrapper_')) {
                    wrapper.remove();
                }
            }
        });
        this.peerConnections.clear();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.localVideo) this.localVideo.srcObject = null;
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = null;
            this.remoteVideo.load(); // Reset video element
        }
        if (this.container) this.container.style.display = 'none';
        this.isCaller = false;
        this.pendingCandidates = [];
        this.peerIdInCall = null;
        this.peersInCall = [];

        if (wasInCall) this.onCallEnd({ reason });
    }
}

export { VideoCallBase };


