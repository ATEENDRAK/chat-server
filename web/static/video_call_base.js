// video_call_base.js - Base class for video calling functionality

class VideoCallBase {
    constructor({ localVideoId, remoteVideoId, startBtnId, endBtnId, wsUrl, getMyId, getPeerId, containerId, onCallStart, onCallEnd }) {
        this.localVideo = document.getElementById(localVideoId);
        this.remoteVideo = document.getElementById(remoteVideoId);
        this.startBtn = document.getElementById(startBtnId);
        this.endBtn = document.getElementById(endBtnId);
        this.container = containerId ? document.getElementById(containerId) : null;
        this.wsUrl = wsUrl;
        this.getMyId = getMyId;
        this.getPeerId = getPeerId;
        this.onCallStart = onCallStart || (() => {});
        this.onCallEnd = onCallEnd || (() => {});
        this.pc = null;
        this.ws = null;
        this.localStream = null;
        this.pendingCandidates = [];
        this.isCaller = false;
        this.isConnected = false;
        this.isMuted = false;
        this.isSpeakerOn = true;
        this.peerIdInCall = null;
        this.inCall = false;
        this.connectSignaling();
        this.bindEvents();
        this._createControlButtons();
    }

    connectSignaling() {
        if (this.ws) return;
        const myId = this.getMyId();
        if (!myId) {
            setTimeout(() => this.connectSignaling(), 1000);
            return;
        }
        if (this.startBtn) this.startBtn.disabled = true;
        const wsUrlWithId = this.wsUrl + `?id=${myId}`;
        console.log(`[${this.constructor.name}] Connecting to signaling server:`, wsUrlWithId);
        this.ws = new WebSocket(wsUrlWithId);
        this.ws.onopen = () => {
            this.isConnected = true;
            console.log(`[${this.constructor.name}] WebSocket opened and registered with ID:`, myId);
            if (this.endBtn) this.endBtn.style.display = '';
            if (this.startBtn) this.startBtn.disabled = false;
        };
        this.ws.onclose = (e) => {
            this.isConnected = false;
            console.log(`[${this.constructor.name}] WebSocket closed`, e);
            if (this.endBtn) this.endBtn.style.display = 'none';
            if (this.startBtn) this.startBtn.disabled = true;
            this.ws = null;
        };
        this.ws.onerror = (e) => {
            console.error(`[${this.constructor.name}] WebSocket error`, e);
        };
        this.ws.onmessage = async (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                const myId = this.getMyId();
                console.log(`[${this.constructor.name}] WS message received - Type:`, msg.type, 'From:', msg.from, 'To:', msg.to);
                await this.handleMessage(msg, myId);
            } catch (err) {
                console.error(`[${this.constructor.name}] Error in WebSocket message handler:`, err);
            }
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
        const peerId = this.getPeerId();
        if (!myId || !peerId) {
            alert('Missing user IDs for video call. Please ensure you have selected a user to call.');
            return;
        }
        if (!this.ws || this.ws.readyState !== 1) {
            alert('Signaling connection not ready. Please wait and try again.');
            return;
        }
        if (this.pc || this.inCall) {
            alert('A call is already in progress. Please end the current call first.');
            return;
        }
        
        console.log(`[${this.constructor.name}] Starting call - My ID:`, myId, 'Peer ID:', peerId);
        
        try {
            this.isCaller = true;
            this.peerIdInCall = peerId;
            this.inCall = true;
            this._setupPeerConnection(myId, peerId);
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (this.localVideo) {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = '';
                console.log(`[${this.constructor.name}] Local video stream set`);
            } else {
                console.error(`[${this.constructor.name}] Local video element not found!`);
            }
            // Add all tracks (both video and audio)
            const tracks = this.localStream.getTracks();
            console.log(`[${this.constructor.name}] Adding ${tracks.length} tracks to peer connection`);
            tracks.forEach(t => {
                console.log(`[${this.constructor.name}] Adding track:`, t.kind, t.id, 'enabled:', t.enabled, 'muted:', t.muted);
                this.pc.addTrack(t, this.localStream);
            });
            
            // Ensure remote video is visible
            if (this.remoteVideo) {
                this.remoteVideo.style.display = '';
            }
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            const offerMsg = { from: myId, to: peerId, type: 'offer', data: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } };
            console.log(`[${this.constructor.name}] Sending offer - From:`, myId, 'To:', peerId);
            try {
                this.ws.send(JSON.stringify(offerMsg));
                console.log(`[${this.constructor.name}] Offer sent successfully to:`, peerId);
                this.onCallStart({ role: 'caller' });
            } catch (err) {
                console.error(`[${this.constructor.name}] Failed to send offer:`, err);
                alert('Failed to send call offer. Please try again.');
                this.endCall({ notifyPeer: false, reason: 'error' });
            }
        } catch (err) {
            console.error(`[${this.constructor.name}] Error starting call:`, err);
            alert('Failed to start call: ' + err.message);
            this.endCall({ notifyPeer: false, reason: 'error' });
        }
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
                console.log(`[${this.constructor.name}] Connection established!`);
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
        if (!this.inCall && !this.pc) return;
        const wasInCall = this.inCall;
        this.inCall = false;

        if (notifyPeer && this.ws && this.ws.readyState === WebSocket.OPEN && this.peerIdInCall) {
            const myId = this.getMyId();
            if (myId) {
                const endMsg = { from: myId, to: this.peerIdInCall, type: 'end_call' };
                try {
                    this.ws.send(JSON.stringify(endMsg));
                } catch (err) {
                    console.error(`[${this.constructor.name}] Failed to send end call message:`, err);
                }
            }
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }

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

        if (wasInCall) this.onCallEnd({ reason });
    }
}

export { VideoCallBase };


