// video_call.js - handles video calling UI and signaling for ChatStream

class VideoCall {
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
        this.connectSignaling(); // Connect as soon as VideoCall is constructed
        this.bindEvents(); // Call directly, not in setTimeout
        this._createControlButtons();
    }

    connectSignaling() {
        if (this.ws) return; // Already connected
        const myId = this.getMyId();
        if (!myId) {
            // Retry after a short delay if user ID is not available yet
            setTimeout(() => this.connectSignaling(), 1000);
            return;
        }
        if (this.startBtn) this.startBtn.disabled = true; // Disable until ready
        const wsUrlWithId = this.wsUrl + `?id=${myId}`;
        console.log('[VideoCall] Connecting to signaling server:', wsUrlWithId);
        this.ws = new WebSocket(wsUrlWithId);
        this.ws.onopen = () => {
            this.isConnected = true;
            console.log('[VideoCall] ✓ WebSocket opened and registered with ID:', myId);
            if (this.endBtn) this.endBtn.style.display = '';
            if (this.startBtn) this.startBtn.disabled = false; // Enable when ready
        };
        this.ws.onclose = (e) => {
            this.isConnected = false;
            console.log('[VideoCall] WebSocket closed', e);
            if (this.endBtn) this.endBtn.style.display = 'none';
            if (this.startBtn) this.startBtn.disabled = true;
            this.ws = null;
        };
        this.ws.onerror = (e) => {
            console.error('[VideoCall] WebSocket error', e);
        };
        this.ws.onmessage = async (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                const myId = this.getMyId();
                console.log('[VideoCall] WS message received - Type:', msg.type, 'From:', msg.from, 'To:', msg.to, 'My ID:', myId);
            
            if (msg.type === 'offer' && msg.data && msg.data.type && msg.data.sdp) {
                console.log('[VideoCall] ✓ Received offer from:', msg.from);
                // Incoming call offer (callee logic)
                if (this.isCaller) {
                    // Ignore offers if this client is the caller
                    console.warn('[VideoCall] Caller received an offer, ignoring.');
                    return;
                }
                
                // Validate that we have the caller's ID
                if (!msg.from) {
                    console.error('[VideoCall] Received offer without from field, rejecting');
                    return;
                }
                
                const accept = window.confirm('Incoming video call. Accept?');
                if (!accept) {
                    // Always reply to the caller in the received offer
                    const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                    try {
                        this.ws.send(JSON.stringify(rejectMsg));
                        console.log('[VideoCall] Sent reject to:', msg.from);
                    } catch (err) {
                        console.error('[VideoCall] Failed to send reject:', err);
                    }
                    this.endCall({ notifyPeer: false, reason: 'rejected' });
                    return;
                }
                
                try {
                    console.log('[VideoCall] Callee accepting call from:', msg.from);
                    this.isCaller = false;
                    this.peerIdInCall = msg.from; // Always use the sender of the offer
                    this.inCall = true;
                    this.onCallStart({ role: 'callee' });
                    
                    // Show video container when accepting call
                    if (this.container) this.container.style.display = '';
                    if (this.endBtn) this.endBtn.style.display = '';
                    
                    // Get local media stream first
                    console.log('[VideoCall] Requesting local media stream...');
                    if (!this.localStream) {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this.localVideo.srcObject = this.localStream;
                        console.log('[VideoCall] ✓ Local media stream obtained');
                    } else {
                        console.log('[VideoCall] Using existing local stream');
                    }
                    
                    // Setup peer connection - MUST be done before setting remote description
                    if (this.pc) {
                        console.log('[VideoCall] Closing existing peer connection');
                        this.pc.close();
                        this.pc = null;
                    }
                    
                    console.log('[VideoCall] Setting up peer connection with peer:', this.peerIdInCall);
                    this._setupPeerConnection(myId, this.peerIdInCall);
                    
                    // Add tracks BEFORE setting remote description (critical for WebRTC)
                    console.log('[VideoCall] Adding local tracks to peer connection');
                    this.localStream.getTracks().forEach(track => {
                        console.log('[VideoCall] Adding track:', track.kind, track.id);
                        this.pc.addTrack(track, this.localStream);
                    });
                    
                    // Set remote description (the offer from caller)
                    console.log('[VideoCall] Setting remote description (offer)');
                    await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                    console.log('[VideoCall] ✓ Remote description set');
                    
                    // Add any pending ICE candidates that arrived before remote description
                    this._addPendingCandidates();
                    
                    // Create and set local description (answer)
                    console.log('[VideoCall] Creating answer...');
                    const answer = await this.pc.createAnswer();
                    console.log('[VideoCall] ✓ Answer created');
                    
                    await this.pc.setLocalDescription(answer);
                    console.log('[VideoCall] ✓ Local description (answer) set');
                    
                    const answerMsg = { 
                        from: myId, 
                        to: this.peerIdInCall, 
                        type: 'answer', 
                        data: { 
                            type: this.pc.localDescription.type, 
                            sdp: this.pc.localDescription.sdp 
                        } 
                    };
                    console.log('[VideoCall] Sending answer - From:', myId, 'To:', this.peerIdInCall);
                    try {
                        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                            throw new Error('WebSocket not connected');
                        }
                        this.ws.send(JSON.stringify(answerMsg));
                        console.log('[VideoCall] ✓ Answer sent successfully to:', this.peerIdInCall);
                    } catch (err) {
                        console.error('[VideoCall] ✗ Failed to send answer:', err);
                        alert('Failed to send call answer. Please try again.');
                        this.endCall({ notifyPeer: false, reason: 'error' });
                    }
                } catch (err) {
                    console.error('[VideoCall] Error accepting call:', err);
                    alert('Failed to accept call: ' + err.message);
                    // Send reject if there was an error
                    const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                    try {
                        this.ws.send(JSON.stringify(rejectMsg));
                    } catch (sendErr) {
                        console.error('[VideoCall] Failed to send reject after error:', sendErr);
                    }
                    this.endCall({ notifyPeer: false, reason: 'error' });
                }
            } else if (msg.type === 'answer' && msg.data && msg.data.type && msg.data.sdp) {
                // Answer should be received by caller only
                // Check if we have a local offer (we sent an offer, so we're expecting an answer)
                const hasLocalOffer = this.pc && this.pc.localDescription && 
                                     (this.pc.localDescription.type === 'offer');
                
                // Also verify the answer is from the peer we're calling
                const isFromExpectedPeer = !this.peerIdInCall || msg.from === this.peerIdInCall;
                
                // Process answer if:
                // 1. We're marked as caller, OR
                // 2. We have a local offer (we sent an offer) AND it's from the expected peer
                if (this.isCaller || (hasLocalOffer && isFromExpectedPeer)) {
                    // If we have a local offer but isCaller is false, update state
                    if (hasLocalOffer && !this.isCaller) {
                        console.log('[VideoCall] Updating state - we sent an offer, so we are the caller');
                        this.isCaller = true;
                        if (!this.inCall) {
                            this.inCall = true;
                        }
                        if (!this.peerIdInCall) {
                            this.peerIdInCall = msg.from;
                        }
                    }
                    
                    console.log('[VideoCall] Received answer from:', msg.from, 'isCaller:', this.isCaller, 'hasLocalOffer:', hasLocalOffer, 'fromExpectedPeer:', isFromExpectedPeer);
                    
                    if (!this.pc) {
                        console.error('[VideoCall] Received answer but no peer connection!');
                        return;
                    }
                    
                    // Verify we have a local offer before processing answer
                    if (!hasLocalOffer) {
                        console.warn('[VideoCall] Received answer but no local offer found. Ignoring.');
                        return;
                    }
                    
                    try {
                        console.log('[VideoCall] Setting remote description (answer) on peer connection');
                        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                        console.log('[VideoCall] ✓ Remote description (answer) set');
                        
                        // Process any queued ICE candidates
                        this._addPendingCandidates();
                        
                        console.log('[VideoCall] ✓ Answer processed, connection should establish');
                    } catch (err) {
                        console.error('[VideoCall] ✗ Error setting remote description:', err);
                        alert('Failed to process answer: ' + err.message);
                    }
                } else {
                    // Callee should not receive answers
                    if (!this.isCaller && !hasLocalOffer) {
                        console.warn('[VideoCall] Callee received an answer, ignoring. (Callee should send answer, not receive it)');
                    } else if (!isFromExpectedPeer) {
                        console.warn('[VideoCall] Received answer from unexpected peer. Expected:', this.peerIdInCall, 'Got:', msg.from);
                    } else {
                        console.warn('[VideoCall] Received answer but not expecting it - isCaller:', this.isCaller, 'hasLocalOffer:', hasLocalOffer, 'fromExpectedPeer:', isFromExpectedPeer);
                    }
                }
            } else if (msg.type === 'ice' && msg.data) {
                // msg.data is the ICE candidate object
                console.log('[VideoCall] Received ICE candidate from:', msg.from, 'My peerIdInCall:', this.peerIdInCall, 'inCall:', this.inCall, 'hasPC:', !!this.pc);
                
                // Process ICE candidates if we have a peer connection
                // Be more lenient - if we have a PC, accept candidates (they might arrive during setup)
                if (this.pc) {
                    // If we're in a call, verify it's from the correct peer
                    // If not in call yet, accept it (might be during call setup)
                    const shouldProcess = !this.inCall || 
                                        !this.peerIdInCall || 
                                        msg.from === this.peerIdInCall;
                    
                    if (shouldProcess) {
                        try {
                            // msg.data might be a string or object, handle both
                            let candidateData = msg.data;
                            if (typeof candidateData === 'string') {
                                candidateData = JSON.parse(candidateData);
                            }
                            const candidate = new RTCIceCandidate(candidateData);
                            console.log('[VideoCall] ✓ Processing ICE candidate from:', msg.from);
                            this._handleRemoteCandidate(candidate);
                        } catch (err) {
                            console.error('[VideoCall] ✗ Error processing ICE candidate:', err, 'Data:', msg.data);
                        }
                    } else {
                        console.log('[VideoCall] Ignoring ICE candidate - wrong peer. Expected:', this.peerIdInCall, 'Got:', msg.from);
                    }
                } else {
                    console.log('[VideoCall] No peer connection yet, queueing ICE candidate for later');
                    // Queue candidate if we don't have PC yet
                    try {
                        let candidateData = msg.data;
                        if (typeof candidateData === 'string') {
                            candidateData = JSON.parse(candidateData);
                        }
                        const candidate = new RTCIceCandidate(candidateData);
                        this.pendingCandidates.push(candidate);
                        console.log('[VideoCall] Queued ICE candidate (total queued:', this.pendingCandidates.length, ')');
                    } catch (err) {
                        console.error('[VideoCall] Error queuing ICE candidate:', err);
                    }
                }
            } else if (msg.candidate) {
                // Fallback for direct candidate format
                console.log('[VideoCall] Received ICE candidate (fallback format)');
                try {
                    const candidate = new RTCIceCandidate(msg);
                    this._handleRemoteCandidate(candidate);
                } catch (err) {
                    console.error('[VideoCall] Error processing ICE candidate (fallback):', err);
                }
            } else if (msg.type === 'reject') {
                // Only show alert if we're actually in a call
                if (this.inCall && msg.from === this.peerIdInCall) {
                    alert('Call was rejected by the other user.');
                } else {
                    console.log('[VideoCall] Received reject, but not in active call');
                }
                this.endCall({ notifyPeer: false, reason: 'rejected_by_peer' });
            } else if (msg.type === 'end_call') {
                // Only show alert if we're actually in a call
                if (this.inCall && msg.from === this.peerIdInCall) {
                    alert('The other user ended the call.');
                } else {
                    console.log('[VideoCall] Received end_call, but not in active call');
                }
                this.endCall({ notifyPeer: false, reason: 'remote' });
            }
            } catch (err) {
                console.error('[VideoCall] Error in WebSocket message handler:', err);
                // Don't let unhandled errors break the WebSocket connection
            }
        };
    }

    async startCall() {
        if (this.container) this.container.style.display = '';
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
        
        console.log('[VideoCall] Starting call - My ID:', myId, 'Peer ID:', peerId);
        console.log('[VideoCall] WebSocket state:', this.ws.readyState, 'Connected:', this.isConnected);
        
        try {
            this.isCaller = true;
            this.peerIdInCall = peerId;
            this.inCall = true;
            this._setupPeerConnection(myId, peerId);
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.localVideo.srcObject = this.localStream;
            this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
            // create offer
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            const offerMsg = { from: myId, to: peerId, type: 'offer', data: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } };
            console.log('[VideoCall] Sending offer - From:', myId, 'To:', peerId, 'Type:', offerMsg.type);
            console.log('[VideoCall] Offer message:', JSON.stringify(offerMsg).substring(0, 200) + '...');
            try {
                this.ws.send(JSON.stringify(offerMsg));
                console.log('[VideoCall] ✓ Offer sent successfully to:', peerId);
                this.onCallStart({ role: 'caller' });
            } catch (err) {
                console.error('[VideoCall] ✗ Failed to send offer:', err);
                alert('Failed to send call offer. Please try again.');
                this.endCall({ notifyPeer: false, reason: 'error' });
            }
        } catch (err) {
            console.error('[VideoCall] Error starting call:', err);
            alert('Failed to start call: ' + err.message);
            this.endCall({ notifyPeer: false, reason: 'error' });
        }
    }

    _setupPeerConnection(myId, peerId) {
        console.log('[VideoCall] Creating new RTCPeerConnection for peer:', peerId);
        this.pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        console.log('[VideoCall] ✓ RTCPeerConnection created');
        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    console.warn('[VideoCall] WebSocket not ready, dropping ICE candidate');
                    return;
                }
                // Serialize the candidate properly
                const candidateData = {
                    candidate: e.candidate.candidate,
                    sdpMLineIndex: e.candidate.sdpMLineIndex,
                    sdpMid: e.candidate.sdpMid
                };
                const iceMsg = { from: myId, to: peerId, type: 'ice', data: candidateData };
                console.log('[VideoCall] Sending ICE candidate to:', peerId);
                try {
                    this.ws.send(JSON.stringify(iceMsg));
                } catch (err) {
                    console.error('[VideoCall] Failed to send ICE candidate:', err);
                }
            } else {
                console.log('[VideoCall] ✓ ICE gathering complete');
            }
        };
        this.pc.ontrack = (e) => {
            console.log('[VideoCall] Received remote track', e);
            console.log('[VideoCall] Track kind:', e.track.kind, 'Streams:', e.streams);
            
            // Handle video and audio tracks
            if (e.streams && e.streams.length > 0) {
                console.log('[VideoCall] Setting remote video stream from streams array');
                this.remoteVideo.srcObject = e.streams[0];
            } else if (e.track) {
                // If no stream, create one from the track
                console.log('[VideoCall] Creating stream from track');
                if (!this.remoteVideo.srcObject) {
                    const stream = new MediaStream();
                    stream.addTrack(e.track);
                    this.remoteVideo.srcObject = stream;
                } else {
                    // Add track to existing stream
                    this.remoteVideo.srcObject.addTrack(e.track);
                }
            }
            
            // Ensure video plays
            this.remoteVideo.play().catch(err => {
                console.error('[VideoCall] Error playing remote video:', err);
            });
        };
        this.pc.onconnectionstatechange = () => {
            const state = this.pc.connectionState;
            console.log('[VideoCall] PeerConnection state changed to:', state);
            
            if (state === 'connected') {
                console.log('[VideoCall] ✓ Connection established!');
            } else if (state === 'connecting') {
                console.log('[VideoCall] Connecting...');
            } else if (state === 'disconnected') {
                console.warn('[VideoCall] ⚠ Connection disconnected');
            } else if (state === 'failed') {
                console.error('[VideoCall] ✗ Connection failed');
                alert('WebRTC connection failed. Please try again.');
            } else if (state === 'closed') {
                console.log('[VideoCall] Connection closed');
            }
        };
        
        this.pc.oniceconnectionstatechange = () => {
            const state = this.pc.iceConnectionState;
            console.log('[VideoCall] ICE connection state:', state);
            
            if (state === 'connected' || state === 'completed') {
                console.log('[VideoCall] ✓ ICE connection established!');
            } else if (state === 'failed') {
                console.error('[VideoCall] ✗ ICE connection failed');
            } else if (state === 'disconnected') {
                console.warn('[VideoCall] ⚠ ICE connection disconnected');
            }
        };
        
        this.pc.onicegatheringstatechange = () => {
            console.log('[VideoCall] ICE gathering state:', this.pc.iceGatheringState);
        };
    }

    _handleRemoteCandidate(candidate) {
        if (!this.pc) {
            console.warn('[VideoCall] PeerConnection not initialized, ignoring ICE candidate');
            return;
        }
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            console.log('[VideoCall] Adding ICE candidate immediately');
            this.pc.addIceCandidate(candidate)
                .then(() => {
                    console.log('[VideoCall] ✓ ICE candidate added successfully');
                })
                .catch(e => {
                    console.error('[VideoCall] ✗ Error adding ICE candidate:', e);
                });
        } else {
            console.log('[VideoCall] Queuing ICE candidate (remote description not set yet)');
            this.pendingCandidates.push(candidate);
        }
    }

    _addPendingCandidates() {
        if (this.pendingCandidates.length > 0) {
            console.log('[VideoCall] Adding', this.pendingCandidates.length, 'queued ICE candidates');
            const promises = this.pendingCandidates.map(candidate => {
                return this.pc.addIceCandidate(candidate)
                    .then(() => {
                        console.log('[VideoCall] ✓ Queued ICE candidate added');
                    })
                    .catch(e => {
                        console.error('[VideoCall] ✗ Error adding queued ICE candidate:', e);
                    });
            });
            Promise.all(promises).then(() => {
                console.log('[VideoCall] ✓ All queued ICE candidates processed');
            });
            this.pendingCandidates = [];
        }
    }

    _createControlButtons() {
        if (!this.container) return;
        
        // Create control buttons container
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'video-call-controls';
        controlsDiv.style.cssText = 'display: flex; gap: 10px; margin-top: 10px; justify-content: center;';
        
        // Mute/Unmute button
        const muteBtn = document.createElement('button');
        muteBtn.id = this.container.id + '_muteBtn';
        muteBtn.innerHTML = '🔇 Mute';
        muteBtn.style.cssText = 'padding: 5px 10px; cursor: pointer;';
        muteBtn.onclick = () => this.toggleMute();
        controlsDiv.appendChild(muteBtn);
        this.muteBtn = muteBtn;
        
        // Speaker button
        const speakerBtn = document.createElement('button');
        speakerBtn.id = this.container.id + '_speakerBtn';
        speakerBtn.innerHTML = '🔊 Speaker';
        speakerBtn.style.cssText = 'padding: 5px 10px; cursor: pointer;';
        speakerBtn.onclick = () => this.toggleSpeaker();
        controlsDiv.appendChild(speakerBtn);
        this.speakerBtn = speakerBtn;
        
        // Move End Call button into the controls row and style it
        if (this.endBtn) {
            this.endBtn.classList.add('end-call-btn');
            controlsDiv.appendChild(this.endBtn);
        }

        this.container.appendChild(controlsDiv);
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
            this.startBtn.addEventListener('click', () => {
                this.startCall();
            });
        }
        if (this.endBtn) {
            this.endBtn.addEventListener('click', () => this.endCall());
        }
    }

    endCall({ notifyPeer = true, reason = 'local' } = {}) {
        // Prevent duplicate end flows (e.g. local hangup + receiving end_call)
        if (!this.inCall && !this.pc) return;
        const wasInCall = this.inCall;
        this.inCall = false;

        // Notify the other party only when we initiated the hangup
        if (notifyPeer && this.ws && this.ws.readyState === WebSocket.OPEN && this.peerIdInCall) {
            const myId = this.getMyId();
            if (myId) {
                const endMsg = { from: myId, to: this.peerIdInCall, type: 'end_call' };
                try {
                    this.ws.send(JSON.stringify(endMsg));
                } catch (err) {
                    console.error('[VideoCall] Failed to send end call message:', err);
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
        if (this.remoteVideo) this.remoteVideo.srcObject = null;
        if (this.container) this.container.style.display = 'none';
        this.isCaller = false;
        this.pendingCandidates = [];
        this.peerIdInCall = null;

        // Only fire callback if we were actually in-call (prevents duplicates)
        if (wasInCall) this.onCallEnd({ reason });
    }
}

export { VideoCall };
