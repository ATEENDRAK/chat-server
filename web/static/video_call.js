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
        this.ws = new WebSocket(this.wsUrl + `?id=${myId}`);
        this.ws.onopen = () => {
            this.isConnected = true;
            console.log('[VideoCall] WebSocket opened');
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
            const msg = JSON.parse(evt.data);
            console.log('[VideoCall] WS message received:', msg);
            const myId = this.getMyId();
            if (msg.type === 'offer' && msg.data && msg.data.type && msg.data.sdp) {
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
                    this.isCaller = false;
                    this.peerIdInCall = msg.from; // Always use the sender of the offer
                    this.inCall = true;
                    this.onCallStart({ role: 'callee' });
                    
                    // Show video container when accepting call
                    if (this.container) this.container.style.display = '';
                    if (this.endBtn) this.endBtn.style.display = '';
                    
                    // Get local media stream first
                    if (!this.localStream) {
                        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this.localVideo.srcObject = this.localStream;
                    }
                    
                    // Setup peer connection
                    if (!this.pc) {
                        this._setupPeerConnection(myId, this.peerIdInCall);
                        // Add tracks BEFORE setting remote description
                        this.localStream.getTracks().forEach(track => {
                            this.pc.addTrack(track, this.localStream);
                        });
                    }
                    
                    await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                    this._addPendingCandidates();
                    const answer = await this.pc.createAnswer();
                    await this.pc.setLocalDescription(answer);
                    const answerMsg = { from: myId, to: this.peerIdInCall, type: 'answer', data: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } };
                    console.log('[VideoCall] Sending answer:', answerMsg);
                    try {
                        this.ws.send(JSON.stringify(answerMsg));
                        console.log('[VideoCall] Sent answer');
                    } catch (err) {
                        console.error('[VideoCall] Failed to send answer:', err);
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
                if (!this.isCaller) {
                    console.warn('[VideoCall] Callee received an answer, ignoring.');
                    return;
                }
                console.log('[VideoCall] Received answer');
                await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                this._addPendingCandidates();
            } else if (msg.type === 'ice' && msg.data) {
                // msg.data is the ICE candidate object
                this._handleRemoteCandidate(new RTCIceCandidate(msg.data));
            } else if (msg.candidate) {
                // Fallback for direct candidate format
                this._handleRemoteCandidate(new RTCIceCandidate(msg));
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
            console.log('[VideoCall] Sending offer:', offerMsg);
            try {
                this.ws.send(JSON.stringify(offerMsg));
                console.log('[VideoCall] Sent offer to:', peerId);
                this.onCallStart({ role: 'caller' });
            } catch (err) {
                console.error('[VideoCall] Failed to send offer:', err);
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
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    console.warn('[VideoCall] WebSocket not ready, dropping ICE candidate');
                    return;
                }
                const iceMsg = { from: myId, to: peerId, type: 'ice', data: e.candidate };
                console.log('[VideoCall] Sending ICE candidate:', iceMsg);
                try {
                    this.ws.send(JSON.stringify(iceMsg));
                } catch (err) {
                    console.error('[VideoCall] Failed to send ICE candidate:', err);
                }
            } else {
                console.log('[VideoCall] ICE gathering complete');
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
            console.log('[VideoCall] PeerConnection state:', this.pc.connectionState);
            if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
                console.warn('[VideoCall] Connection state changed to:', this.pc.connectionState);
            }
        };
    }

    _handleRemoteCandidate(candidate) {
        if (!this.pc) {
            console.warn('[VideoCall] PeerConnection not initialized, ignoring ICE candidate');
            return;
        }
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            this.pc.addIceCandidate(candidate).catch(e => console.error('[VideoCall] addIceCandidate error:', e));
        } else {
            console.log('[VideoCall] Queuing ICE candidate until remote description is set');
            this.pendingCandidates.push(candidate);
        }
    }

    _addPendingCandidates() {
        if (this.pendingCandidates.length > 0) {
            console.log('[VideoCall] Adding queued ICE candidates:', this.pendingCandidates);
            this.pendingCandidates.forEach(candidate => {
                this.pc.addIceCandidate(candidate).catch(e => console.error('[VideoCall] addIceCandidate error:', e));
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
