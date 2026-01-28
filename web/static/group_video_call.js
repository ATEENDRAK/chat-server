// group_video_call.js - Group video call implementation

import { VideoCallBase, showIncomingCallDialog } from './video_call_base.js';

class GroupVideoCall extends VideoCallBase {
    // Helper method to ensure all video containers are visible
    _ensureVideoContainersVisible() {
        console.log('[GroupVideoCall] Ensuring video containers are visible');
        
        // Show message input container
        const messageInputContainer = document.getElementById('messageInputContainer');
        if (messageInputContainer) {
            messageInputContainer.style.display = 'block';
        }
        
        // Show video call container
        if (this.container) {
            this.container.style.display = 'block';
            this.container.style.visibility = 'visible';
        }
        
        // Show video grid
        const videoGrid = document.getElementById('videoGrid');
        if (videoGrid) {
            videoGrid.style.display = 'flex';
        }
        
        // Ensure local video is visible
        if (this.localVideo) {
            this.localVideo.style.display = 'block';
            if (this.localVideo.parentElement) {
                this.localVideo.parentElement.style.display = 'block';
            }
        }
        
        // Ensure remote video is visible
        if (this.remoteVideo) {
            this.remoteVideo.style.display = 'block';
            if (this.remoteVideo.parentElement) {
                this.remoteVideo.parentElement.style.display = 'block';
            }
        }
        
        // Show end call button
        if (this.endBtn) {
            this.endBtn.style.display = 'block';
        }
    }
    
    // Check if this handler should process the message
    shouldHandleMessage(msg) {
        // GroupVideoCall handles messages when:
        // 1. We're already in a call (handle messages from any participant)
        // 2. Private chat is NOT open (we're in room view)
        
        // If we're in a call, handle messages from known participants or new offers
        if (this.inCall) {
            // Always handle if from known peer
            if (this.peerIdInCall === msg.from || this.peersInCall.includes(msg.from)) {
                return true;
            }
            // Also handle if we have a connection to this peer
            if (this.peerConnections.has(msg.from)) {
                return true;
            }
            // For new offers while in call - this is another participant joining
            if (msg.type === 'offer') {
                return true;
            }
        }
        
        // For new calls, only handle if private chat is not open
        const privateChatModal = document.getElementById('privateChatModal');
        const isPrivateChatOpen = privateChatModal && privateChatModal.style.display !== 'none';
        return !isPrivateChatOpen;
    }
    
    async handleMessage(msg, myId) {
        console.log('[GroupVideoCall] handleMessage called - type:', msg.type, 'from:', msg.from, 'inCall:', this.inCall);
        
        // First check if we should handle this message at all
        if (!this.shouldHandleMessage(msg)) {
            console.log('[GroupVideoCall] Delegating to PrivateVideoCall (private chat is open)');
            return;
        }
        
        if (msg.type === 'offer' && msg.data && msg.data.type && msg.data.sdp) {
            if (!msg.from) {
                console.error('[GroupVideoCall] Received offer without from field');
                return;
            }
            
            // Check if we already have a WORKING connection to this peer
            const existingConn = this.peerConnections.get(msg.from);
            if (existingConn && existingConn.pc) {
                const state = existingConn.pc.connectionState;
                if (state === 'connected') {
                    console.log('[GroupVideoCall] Already have CONNECTED peer, ignoring offer from:', msg.from);
                    return;
                }
                // If not connected, we'll handle this in _handleAdditionalParticipant
                console.log('[GroupVideoCall] Have existing connection but state is:', state, '- will handle offer');
            }
            
            // If we're already in a call, this is another participant joining the mesh
            const isAdditionalParticipant = this.inCall && msg.from !== this.peerIdInCall;
            
            if (isAdditionalParticipant) {
                console.log('[GroupVideoCall] Additional participant joining call:', msg.from);
                // Auto-accept additional participants in an ongoing call
                await this._handleAdditionalParticipant(msg, myId);
                return;
            }
            
            // For initial call, we're the callee
            if (this.isCaller && !isAdditionalParticipant) {
                console.warn('[GroupVideoCall] Caller received an offer from unknown peer, treating as new participant');
            }
            
            // Get caller's name for the dialog
            const callerName = this._getCallerName ? this._getCallerName(msg.from) : msg.from;
            console.log('[GroupVideoCall] Showing incoming call dialog for:', callerName);
            
            const accept = await showIncomingCallDialog(callerName);
            console.log('[GroupVideoCall] User response to call:', accept ? 'ACCEPTED' : 'REJECTED');
            
            if (!accept) {
                const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                try {
                    this.ws.send(JSON.stringify(rejectMsg));
                    console.log('[GroupVideoCall] Sent reject to:', msg.from);
                } catch (err) {
                    console.error('[GroupVideoCall] Failed to send reject:', err);
                }
                this.endCall({ notifyPeer: false, reason: 'rejected' });
                return;
            }
            
            try {
                console.log('[GroupVideoCall] Callee accepting call from:', msg.from);
                this.isCaller = false;
                this.peerIdInCall = msg.from;
                this.peersInCall = [msg.from];
                this.inCall = true;
                
                // Update the remote video label immediately with caller's name
                const remoteLabel = document.getElementById('remoteVideoLabel');
                if (remoteLabel && callerName) {
                    remoteLabel.textContent = callerName;
                }
                
                this.onCallStart({ role: 'callee' });
                
                // Show video container and ensure parent containers are visible
                console.log('[GroupVideoCall] Showing video container and UI elements');
                
                // CRITICAL: Ensure we're in the main chat view, not private chat
                const privateChatModal = document.getElementById('privateChatModal');
                if (privateChatModal && privateChatModal.style.display !== 'none') {
                    console.log('[GroupVideoCall] Private chat is open, closing it for group call');
                    privateChatModal.style.display = 'none';
                }
                
                // Ensure main chat area is visible
                const chatContainer = document.getElementById('chatContainer');
                if (chatContainer) {
                    chatContainer.style.display = 'flex';
                }
                
                // Show the message input container (parent of video container)
                const messageInputContainer = document.getElementById('messageInputContainer');
                if (messageInputContainer) {
                    console.log('[GroupVideoCall] Showing message input container');
                    messageInputContainer.style.display = 'block';
                } else {
                    console.warn('[GroupVideoCall] Message input container not found');
                }
                
                // Show the group video container
                if (this.container) {
                    console.log('[GroupVideoCall] Container found:', this.container.id);
                    this.container.style.display = 'block';
                    this.container.style.visibility = 'visible';
                    
                    // Also show the video grid
                    const videoGrid = document.getElementById('videoGrid');
                    if (videoGrid) {
                        videoGrid.style.display = 'flex';
                        console.log('[GroupVideoCall] Video grid shown');
                    }
                    
                    // Ensure video elements are visible
                    if (this.localVideo) {
                        this.localVideo.style.display = '';
                    }
                    if (this.remoteVideo) {
                        this.remoteVideo.style.display = '';
                    }
                } else {
                    console.error('[GroupVideoCall] Video container not found!');
                    // Try to find and show it anyway
                    const container = document.getElementById('videoCallContainer');
                    if (container) {
                        container.style.display = 'block';
                        console.log('[GroupVideoCall] Found and showed videoCallContainer directly');
                    }
                }
                
                if (this.endBtn) {
                    console.log('[GroupVideoCall] Showing end call button');
                    this.endBtn.style.display = '';
                    // Ensure end button is visible in controls
                    const controlsDiv = this.container?.querySelector('.video-call-controls');
                    if (controlsDiv) {
                        if (!controlsDiv.contains(this.endBtn)) {
                            console.log('[GroupVideoCall] Moving end button to controls div');
                            controlsDiv.appendChild(this.endBtn);
                        }
                    } else {
                        console.warn('[GroupVideoCall] Controls div not found, end button should still be visible');
                    }
                } else {
                    console.warn('[GroupVideoCall] End button not found!');
                }
                
                console.log('[GroupVideoCall] Requesting local media stream...');
                if (!this.localStream) {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    if (this.localVideo) {
                        this.localVideo.srcObject = this.localStream;
                        console.log('[GroupVideoCall] Local media stream set on video element');
                    } else {
                        console.error('[GroupVideoCall] Local video element not found!');
                    }
                    console.log('[GroupVideoCall] Local media stream obtained');
                } else {
                    console.log('[GroupVideoCall] Using existing local stream');
                }
                
                if (this.pc) {
                    console.log('[GroupVideoCall] Closing existing peer connection');
                    this.pc.close();
                    this.pc = null;
                }
                
                console.log('[GroupVideoCall] Setting up peer connection with peer:', this.peerIdInCall);
                this._setupPeerConnection(myId, this.peerIdInCall);
                
                console.log('[GroupVideoCall] Adding local tracks to peer connection');
                const tracks = this.localStream.getTracks();
                tracks.forEach(track => {
                    console.log('[GroupVideoCall] Adding track:', track.kind, track.id, 'enabled:', track.enabled, 'muted:', track.muted);
                    this.pc.addTrack(track, this.localStream);
                });
                console.log('[GroupVideoCall] Added', tracks.length, 'tracks (video + audio)');
                
                // Ensure remote video is visible
                if (this.remoteVideo) {
                    this.remoteVideo.style.display = '';
                }
                
                console.log('[GroupVideoCall] Setting remote description (offer)');
                await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                console.log('[GroupVideoCall] Remote description set');
                
                this._addPendingCandidates();
                
                console.log('[GroupVideoCall] Creating answer...');
                const answer = await this.pc.createAnswer();
                console.log('[GroupVideoCall] Answer created');
                
                await this.pc.setLocalDescription(answer);
                console.log('[GroupVideoCall] Local description (answer) set');
                
                const answerMsg = { 
                    from: myId, 
                    to: this.peerIdInCall, 
                    type: 'answer', 
                    data: { 
                        type: this.pc.localDescription.type, 
                        sdp: this.pc.localDescription.sdp 
                    } 
                };
                console.log('[GroupVideoCall] Sending answer - From:', myId, 'To:', this.peerIdInCall);
                try {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                        throw new Error('WebSocket not connected');
                    }
                    this.ws.send(JSON.stringify(answerMsg));
                    console.log('[GroupVideoCall] Answer sent successfully to:', this.peerIdInCall);
                } catch (err) {
                    console.error('[GroupVideoCall] Failed to send answer:', err);
                    alert('Failed to send call answer. Please try again.');
                    this.endCall({ notifyPeer: false, reason: 'error' });
                }
            } catch (err) {
                console.error('[GroupVideoCall] Error accepting call:', err);
                alert('Failed to accept call: ' + err.message);
                const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                try {
                    this.ws.send(JSON.stringify(rejectMsg));
                } catch (sendErr) {
                    console.error('[GroupVideoCall] Failed to send reject after error:', sendErr);
                }
                this.endCall({ notifyPeer: false, reason: 'error' });
            }
        } else if (msg.type === 'answer' && msg.data && msg.data.type && msg.data.sdp) {
            // Check for multi-party peer connection first
            const multiPartyPc = this.peerConnections.get(msg.from);
            if (multiPartyPc && multiPartyPc.pc) {
                console.log('[GroupVideoCall] Processing answer for multi-party peer:', msg.from);
                try {
                    await multiPartyPc.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                    console.log('[GroupVideoCall] Multi-party answer processed for:', msg.from);
                    
                    // Update label with peer name
                    if (multiPartyPc.remoteLabel && this._getCallerName) {
                        multiPartyPc.remoteLabel.textContent = this._getCallerName(msg.from);
                    }
                    
                    // Add this peer to our list if not already there
                    if (!this.peersInCall.includes(msg.from)) {
                        this.peersInCall.push(msg.from);
                    }
                    
                    // CRITICAL: Broadcast to ALL peers so everyone knows about everyone
                    console.log('[GroupVideoCall] Broadcasting participant info after multi-party answer');
                    this._broadcastParticipantInfo(myId);
                } catch (err) {
                    console.error('[GroupVideoCall] Error setting multi-party remote description:', err);
                }
                return;
            }
            
            // Single/Primary peer connection handling
            const hasLocalOffer = this.pc && this.pc.localDescription && 
                                 (this.pc.localDescription.type === 'offer');
            const isFromExpectedPeer = !this.peerIdInCall || msg.from === this.peerIdInCall || this.peersInCall.includes(msg.from);
            
            if (this.isCaller || (hasLocalOffer && isFromExpectedPeer)) {
                if (hasLocalOffer && !this.isCaller) {
                    console.log('[GroupVideoCall] Updating state - we sent an offer, so we are the caller');
                    this.isCaller = true;
                    if (!this.inCall) this.inCall = true;
                    if (!this.peerIdInCall) this.peerIdInCall = msg.from;
                }
                
                console.log('[GroupVideoCall] Received answer from:', msg.from, 'isCaller:', this.isCaller, 'hasLocalOffer:', hasLocalOffer);
                
                if (!this.pc) {
                    console.error('[GroupVideoCall] Received answer but no peer connection!');
                    return;
                }
                
                if (!hasLocalOffer) {
                    console.warn('[GroupVideoCall] Received answer but no local offer found. Ignoring.');
                    return;
                }
                
                try {
                    console.log('[GroupVideoCall] Setting remote description (answer) on peer connection');
                    await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                    console.log('[GroupVideoCall] Remote description (answer) set');
                    
                    // Update the primary remote video label
                    const remoteLabel = document.getElementById('remoteVideoLabel');
                    if (remoteLabel && this._getCallerName) {
                        const peerName = this._getCallerName(msg.from);
                        if (peerName && peerName !== 'Unknown') {
                            remoteLabel.textContent = peerName;
                        }
                    }
                    
                    // Add this peer to our list if not already there
                    if (!this.peersInCall.includes(msg.from)) {
                        this.peersInCall.push(msg.from);
                    }
                    
                    this._addPendingCandidates();
                    
                    console.log('[GroupVideoCall] Answer processed, connection should establish');
                    console.log('[GroupVideoCall] Current peersInCall:', this.peersInCall);
                    
                    // CRITICAL: Always broadcast to all peers after receiving an answer
                    // This tells the new joinee about all existing participants
                    // And tells existing participants about the new joinee
                    console.log('[GroupVideoCall] Broadcasting participant info to all peers');
                    this._broadcastParticipantInfo(myId);
                } catch (err) {
                    console.error('[GroupVideoCall] Error setting remote description:', err);
                    alert('Failed to process answer: ' + err.message);
                }
            } else {
                if (!this.isCaller && !hasLocalOffer) {
                    console.warn('[GroupVideoCall] Callee received an answer, ignoring.');
                } else if (!isFromExpectedPeer) {
                    console.warn('[GroupVideoCall] Received answer from unexpected peer. Expected:', this.peerIdInCall, 'Got:', msg.from);
                }
            }
        } else if (msg.type === 'ice' && msg.data) {
            console.log('[GroupVideoCall] Received ICE candidate from:', msg.from);
            
            // Check for multi-party peer connection first
            const multiPartyPc = this.peerConnections.get(msg.from);
            if (multiPartyPc && multiPartyPc.pc) {
                try {
                    let candidateData = msg.data;
                    if (typeof candidateData === 'string') {
                        candidateData = JSON.parse(candidateData);
                    }
                    const candidate = new RTCIceCandidate(candidateData);
                    
                    if (multiPartyPc.pc.remoteDescription) {
                        await multiPartyPc.pc.addIceCandidate(candidate);
                        console.log('[GroupVideoCall] Added ICE candidate for multi-party peer:', msg.from);
                    }
                } catch (err) {
                    console.error('[GroupVideoCall] Error adding multi-party ICE candidate:', err);
                }
                return;
            }
            
            // Single peer connection handling
            if (this.pc) {
                const shouldProcess = !this.inCall || !this.peerIdInCall || msg.from === this.peerIdInCall || this.peersInCall.includes(msg.from);
                
                if (shouldProcess) {
                    try {
                        let candidateData = msg.data;
                        if (typeof candidateData === 'string') {
                            candidateData = JSON.parse(candidateData);
                        }
                        const candidate = new RTCIceCandidate(candidateData);
                        console.log('[GroupVideoCall] Processing ICE candidate from:', msg.from);
                        this._handleRemoteCandidate(candidate);
                    } catch (err) {
                        console.error('[GroupVideoCall] Error processing ICE candidate:', err);
                    }
                } else {
                    console.log('[GroupVideoCall] Ignoring ICE candidate - wrong peer. Expected:', this.peerIdInCall, 'Got:', msg.from);
                }
            } else {
                console.log('[GroupVideoCall] No peer connection yet, queueing ICE candidate for later');
                try {
                    let candidateData = msg.data;
                    if (typeof candidateData === 'string') {
                        candidateData = JSON.parse(candidateData);
                    }
                    const candidate = new RTCIceCandidate(candidateData);
                    this.pendingCandidates.push(candidate);
                    console.log('[GroupVideoCall] Queued ICE candidate (total queued:', this.pendingCandidates.length, ')');
                } catch (err) {
                    console.error('[GroupVideoCall] Error queuing ICE candidate:', err);
                }
            }
        } else if (msg.type === 'reject') {
            // Check if it's from a multi-party peer
            if (this.peerConnections.has(msg.from)) {
                console.log('[GroupVideoCall] Participant rejected:', msg.from);
                const peerInfo = this.peerConnections.get(msg.from);
                if (peerInfo.pc) peerInfo.pc.close();
                if (peerInfo.remoteVideo && peerInfo.remoteVideo !== this.remoteVideo) {
                    const wrapper = peerInfo.remoteVideo.parentElement;
                    if (wrapper) wrapper.remove();
                }
                this.peerConnections.delete(msg.from);
                return;
            }
            
            if (this.inCall && msg.from === this.peerIdInCall) {
                alert('Call was rejected by the other user.');
            }
            this.endCall({ notifyPeer: false, reason: 'rejected_by_peer' });
        } else if (msg.type === 'end_call') {
            // Check if it's from a multi-party peer
            if (this.peerConnections.has(msg.from)) {
                console.log('[GroupVideoCall] Participant left call:', msg.from);
                const peerInfo = this.peerConnections.get(msg.from);
                if (peerInfo.pc) peerInfo.pc.close();
                if (peerInfo.remoteVideo && peerInfo.remoteVideo !== this.remoteVideo) {
                    const wrapper = peerInfo.remoteVideo.parentElement;
                    if (wrapper) wrapper.remove();
                }
                this.peerConnections.delete(msg.from);
                return;
            }
            
            if (this.inCall && msg.from === this.peerIdInCall) {
                alert('The other user ended the call.');
            }
            this.endCall({ notifyPeer: false, reason: 'remote' });
        } else if (msg.type === 'participant_info') {
            // Received info about other participants in the call
            console.log('[GroupVideoCall] ========== PARTICIPANT INFO RECEIVED ==========');
            console.log('[GroupVideoCall] From:', msg.from);
            console.log('[GroupVideoCall] Participants:', msg.data?.participants);
            console.log('[GroupVideoCall] My current peersInCall:', this.peersInCall);
            console.log('[GroupVideoCall] My peerConnections:', Array.from(this.peerConnections.keys()));
            
            if (msg.data && msg.data.participants && Array.isArray(msg.data.participants)) {
                const myId = this.getMyId();
                
                // Update our list of peers in call
                for (const participantId of msg.data.participants) {
                    if (participantId !== myId && !this.peersInCall.includes(participantId)) {
                        console.log('[GroupVideoCall] Adding to peersInCall:', participantId);
                        this.peersInCall.push(participantId);
                    }
                }
                
                // Connect to other participants we don't already have connections with
                // IMPORTANT: Use deterministic connection initiation to avoid "glare"
                // Only the peer with the LOWER ID initiates the connection
                const toConnect = [];
                for (const participantId of msg.data.participants) {
                    // Skip self and the primary peer (already connected via main flow)
                    if (participantId !== myId && participantId !== this.peerIdInCall) {
                        // Check if we need to connect
                        const existingConn = this.peerConnections.get(participantId);
                        const existingState = existingConn?.pc?.connectionState;
                        const needsConnection = !existingConn || 
                            !existingState ||
                            (existingState !== 'connected' && existingState !== 'connecting');
                        
                        // DETERMINISTIC: Only initiate if my ID is "lower" than theirs
                        // This prevents both peers from sending offers to each other
                        const shouldInitiate = myId < participantId;
                        
                        console.log('[GroupVideoCall] Participant', participantId, 
                            '- existing state:', existingState, 
                            '- needs connection:', needsConnection,
                            '- should initiate (myId < peerId):', shouldInitiate);
                        
                        if (needsConnection && shouldInitiate) {
                            toConnect.push(participantId);
                        } else if (needsConnection && !shouldInitiate) {
                            console.log('[GroupVideoCall] Waiting for', participantId, 'to initiate connection to me');
                        }
                    }
                }
                
                console.log('[GroupVideoCall] Will connect to:', toConnect);
                
                // Connect to each participant with staggered delays
                toConnect.forEach((participantId, index) => {
                    const delay = index * 300 + 100; // Stagger connections more
                    console.log('[GroupVideoCall] Scheduling connection to', participantId, 'in', delay, 'ms');
                    setTimeout(() => {
                        if (this.inCall) {
                            // Double-check we still need to connect
                            const existingConn = this.peerConnections.get(participantId);
                            const existingState = existingConn?.pc?.connectionState;
                            if (!existingConn || (existingState !== 'connected' && existingState !== 'connecting')) {
                                console.log('[GroupVideoCall] NOW connecting to:', participantId);
                                this._connectToParticipant(participantId, myId);
                            } else {
                                console.log('[GroupVideoCall] Skipping connection to', participantId, '- already', existingState);
                            }
                        }
                    }, delay);
                });
            }
            console.log('[GroupVideoCall] ========== END PARTICIPANT INFO ==========');
        }
    }
    
    // Handle an additional participant joining the call (receiving an offer from them)
    async _handleAdditionalParticipant(msg, myId) {
        console.log('[GroupVideoCall] ===== _handleAdditionalParticipant START =====');
        console.log('[GroupVideoCall] Received offer from:', msg.from);
        console.log('[GroupVideoCall] My ID:', myId);
        console.log('[GroupVideoCall] My localStream:', this.localStream ? 'exists' : 'MISSING');
        
        // Check if we already have a WORKING connection to this participant
        const existingConnection = this.peerConnections.get(msg.from);
        if (existingConnection && existingConnection.pc) {
            const existingState = existingConnection.pc.connectionState;
            console.log('[GroupVideoCall] Existing connection to', msg.from, 'state:', existingState);
            
            // If already connected, ignore the new offer
            if (existingState === 'connected') {
                console.log('[GroupVideoCall] Already connected to', msg.from, '- ignoring duplicate offer');
                return;
            }
            
            // GLARE HANDLING: If we're in the middle of connecting (have-local-offer state),
            // use deterministic tie-breaking: peer with lower ID accepts the offer, higher ID ignores
            if (existingState === 'connecting' || existingState === 'new') {
                const iAmPolite = myId < msg.from;
                console.log('[GroupVideoCall] Glare detected! My ID:', myId, 'Their ID:', msg.from, 'I am polite:', iAmPolite);
                
                if (!iAmPolite) {
                    // I have the higher ID, so I ignore their offer and wait for them to answer mine
                    console.log('[GroupVideoCall] I am impolite (higher ID) - ignoring their offer, waiting for my offer to be answered');
                    return;
                }
                
                // I have the lower ID, so I accept their offer and close my outgoing connection
                console.log('[GroupVideoCall] I am polite (lower ID) - accepting their offer, closing my outgoing connection');
            }
            
            // Close the old connection
            console.log('[GroupVideoCall] Closing existing connection to accept new offer');
            existingConnection.pc.close();
            const oldWrapper = document.getElementById(`remoteVideoWrapper_${msg.from}`);
            if (oldWrapper) oldWrapper.remove();
            this.peerConnections.delete(msg.from);
        }
        
        // Ensure we have a local stream
        if (!this.localStream) {
            console.error('[GroupVideoCall] No local stream! Cannot handle additional participant.');
            return;
        }
        
        try {
            // Create a new peer connection for this participant
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            console.log('[GroupVideoCall] Created RTCPeerConnection for:', msg.from);
            
            // Ensure all video containers are visible
            this._ensureVideoContainersVisible();
            
            // Create video element for this participant
            const videoGrid = document.getElementById('videoGrid');
            let remoteVideo, remoteLabel;
            
            console.log('[GroupVideoCall] videoGrid:', videoGrid ? 'found' : 'NOT FOUND');
            
            // Check if wrapper already exists (avoid duplicates)
            let existingWrapper = document.getElementById(`remoteVideoWrapper_${msg.from}`);
            if (existingWrapper) {
                console.log('[GroupVideoCall] Video wrapper already exists for:', msg.from);
                remoteVideo = existingWrapper.querySelector('video');
                remoteLabel = existingWrapper.querySelector('.video-label');
            } else if (videoGrid) {
                console.log('[GroupVideoCall] Creating new video wrapper for:', msg.from);
                const wrapper = document.createElement('div');
                wrapper.className = 'video-wrapper';
                wrapper.id = `remoteVideoWrapper_${msg.from}`;
                
                remoteLabel = document.createElement('div');
                remoteLabel.className = 'video-label';
                const peerName = this._getCallerName ? this._getCallerName(msg.from) : 'Connecting...';
                remoteLabel.textContent = peerName;
                console.log('[GroupVideoCall] Peer name:', peerName);
                
                remoteVideo = document.createElement('video');
                remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.style.cssText = 'width: 180px; border: 1px solid #ccc; background: #000;';
                
                wrapper.appendChild(remoteLabel);
                wrapper.appendChild(remoteVideo);
                videoGrid.appendChild(wrapper);
                console.log('[GroupVideoCall] Video wrapper added');
            } else {
                console.error('[GroupVideoCall] videoGrid not found!');
            }
            
            // Store the connection
            this.peerConnections.set(msg.from, { pc, remoteVideo, remoteLabel });
            
            // Set up ICE candidate handling
            pc.onicecandidate = (e) => {
                if (e.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const iceMsg = { 
                        from: myId, 
                        to: msg.from, 
                        type: 'ice', 
                        data: {
                            candidate: e.candidate.candidate,
                            sdpMLineIndex: e.candidate.sdpMLineIndex,
                            sdpMid: e.candidate.sdpMid
                        }
                    };
                    this.ws.send(JSON.stringify(iceMsg));
                }
            };
            
            // Set up track handling
            pc.ontrack = (e) => {
                console.log('[GroupVideoCall] ★★★ Received track from additional participant:', msg.from, 'streams:', e.streams?.length, 'track kind:', e.track?.kind);
                if (remoteVideo && e.streams && e.streams.length > 0) {
                    console.log('[GroupVideoCall] Setting video srcObject for:', msg.from);
                    
                    // Only set srcObject if it's different (avoid AbortError from resetting same stream)
                    if (remoteVideo.srcObject !== e.streams[0]) {
                        remoteVideo.srcObject = e.streams[0];
                    }
                    remoteVideo.muted = false;
                    
                    // Make sure video element is visible
                    remoteVideo.style.display = 'block';
                    if (remoteVideo.parentElement) {
                        remoteVideo.parentElement.style.display = 'block';
                    }
                    
                    // Wait for video to have enough data before playing
                    const tryPlay = () => {
                        if (remoteVideo.readyState >= 2) { // HAVE_CURRENT_DATA or better
                            remoteVideo.play().then(() => {
                                console.log('[GroupVideoCall] ✓ Video playing for:', msg.from);
                            }).catch(err => {
                                // AbortError is normal when stream changes, ignore it
                                if (err.name !== 'AbortError') {
                                    console.warn('[GroupVideoCall] Video play error for', msg.from, ':', err.name);
                                }
                            });
                        } else {
                            // Wait for loadeddata event
                            remoteVideo.onloadeddata = () => {
                                remoteVideo.play().catch(err => {
                                    if (err.name !== 'AbortError') {
                                        console.warn('[GroupVideoCall] Video play error for', msg.from, ':', err.name);
                                    }
                                });
                            };
                        }
                    };
                    tryPlay();
                    
                    // Update label with peer name
                    if (remoteLabel && this._getCallerName) {
                        const peerName = this._getCallerName(msg.from);
                        if (peerName && peerName !== 'Unknown') {
                            remoteLabel.textContent = peerName;
                        }
                    }
                } else {
                    console.error('[GroupVideoCall] ✗ Missing remoteVideo or streams for:', msg.from);
                }
            };
            
            // Monitor connection state
            pc.onconnectionstatechange = () => {
                console.log(`[GroupVideoCall] Connection state for ${msg.from}:`, pc.connectionState);
                if (pc.connectionState === 'connected') {
                    // When connected, broadcast participant info so others can connect too
                    console.log(`[GroupVideoCall] Connected to ${msg.from}, broadcasting participant info`);
                    setTimeout(() => {
                        this._broadcastParticipantInfo(myId);
                    }, 300);
                    
                    // Check if we have video after a delay - if not, try to renegotiate
                    setTimeout(() => {
                        if (remoteVideo && !remoteVideo.srcObject) {
                            console.warn(`[GroupVideoCall] No video stream for ${msg.from} after connection - may need renegotiation`);
                        }
                    }, 2000);
                } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                    console.error(`[GroupVideoCall] Connection to ${msg.from} ${pc.connectionState} - attempting reconnect`);
                    
                    // Clean up the failed connection
                    const wrapper = document.getElementById(`remoteVideoWrapper_${msg.from}`);
                    if (wrapper) wrapper.remove();
                    this.peerConnections.delete(msg.from);
                    
                    // Try to reconnect after a short delay (only if we're still in the call)
                    if (this.inCall && this.peersInCall.includes(msg.from)) {
                        setTimeout(() => {
                            console.log(`[GroupVideoCall] Attempting to reconnect to ${msg.from}`);
                            this._connectToParticipant(msg.from, myId);
                        }, 1000);
                    }
                }
            };
            
            pc.oniceconnectionstatechange = () => {
                console.log(`[GroupVideoCall] ICE state for ${msg.from}:`, pc.iceConnectionState);
                
                // Handle ICE disconnection - try ICE restart
                if (pc.iceConnectionState === 'disconnected') {
                    console.warn(`[GroupVideoCall] ICE disconnected for ${msg.from} - will wait for reconnection`);
                } else if (pc.iceConnectionState === 'failed') {
                    console.error(`[GroupVideoCall] ICE failed for ${msg.from}`);
                }
            };
            
            // Add local tracks - CRITICAL: must add tracks BEFORE setting remote description
            if (this.localStream) {
                const tracks = this.localStream.getTracks();
                console.log(`[GroupVideoCall] Adding ${tracks.length} local tracks to connection for ${msg.from}`);
                tracks.forEach(t => {
                    pc.addTrack(t, this.localStream);
                });
            } else {
                console.error('[GroupVideoCall] No local stream available for additional participant!');
            }
            
            // Set remote description (the offer)
            await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            
            // Create and send answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            const answerMsg = {
                from: myId,
                to: msg.from,
                type: 'answer',
                data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
            };
            
            console.log('[GroupVideoCall] Sending answer to:', msg.from);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(answerMsg));
                console.log('[GroupVideoCall] ✓ Answer sent to additional participant:', msg.from);
            } else {
                console.error('[GroupVideoCall] ✗ WebSocket not ready!');
            }
            
            // Add this peer to our list
            if (!this.peersInCall.includes(msg.from)) {
                this.peersInCall.push(msg.from);
            }
            
            console.log('[GroupVideoCall] ===== _handleAdditionalParticipant END =====');
            
        } catch (err) {
            console.error('[GroupVideoCall] Error handling additional participant:', err);
        }
    }
    
    // Connect to a participant (as the caller)
    async _connectToParticipant(participantId, myId) {
        console.log('[GroupVideoCall] ===== _connectToParticipant START =====');
        console.log('[GroupVideoCall] Connecting to:', participantId, 'from:', myId);
        
        // DETERMINISTIC: Only initiate if my ID is "lower" than theirs
        // This prevents both peers from sending offers to each other (glare condition)
        if (myId > participantId) {
            console.log('[GroupVideoCall] Skipping - my ID is higher, waiting for', participantId, 'to initiate');
            console.log('[GroupVideoCall] ===== _connectToParticipant END (skipped) =====');
            return;
        }
        
        // Check if we already have a WORKING connection to this participant
        const existingConnection = this.peerConnections.get(participantId);
        if (existingConnection && existingConnection.pc) {
            const state = existingConnection.pc.connectionState;
            if (state === 'connected' || state === 'connecting') {
                console.log('[GroupVideoCall] Already have active connection to participant:', participantId, 'state:', state);
                console.log('[GroupVideoCall] ===== _connectToParticipant END (existing) =====');
                return;
            }
            // Clean up failed/closed connection
            console.log('[GroupVideoCall] Cleaning up old connection to', participantId, 'state:', state);
            existingConnection.pc.close();
            const oldWrapper = document.getElementById(`remoteVideoWrapper_${participantId}`);
            if (oldWrapper) oldWrapper.remove();
            this.peerConnections.delete(participantId);
        }
        
        // Ensure we have a local stream
        if (!this.localStream) {
            console.error('[GroupVideoCall] No local stream! Cannot connect to participant.');
            console.log('[GroupVideoCall] ===== _connectToParticipant END (no stream) =====');
            return;
        }
        
        try {
            // Create a new peer connection
            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            console.log('[GroupVideoCall] Created new RTCPeerConnection for:', participantId);
            
            // Ensure all video containers are visible
            this._ensureVideoContainersVisible();
            
            // Create video element
            const videoGrid = document.getElementById('videoGrid');
            let remoteVideo, remoteLabel;
            
            console.log('[GroupVideoCall] videoGrid element:', videoGrid ? 'found' : 'NOT FOUND');
            
            // Check if wrapper already exists (avoid duplicates)
            let existingWrapper = document.getElementById(`remoteVideoWrapper_${participantId}`);
            if (existingWrapper) {
                console.log('[GroupVideoCall] Video wrapper already exists for:', participantId);
                remoteVideo = existingWrapper.querySelector('video');
                remoteLabel = existingWrapper.querySelector('.video-label');
            } else if (videoGrid) {
                console.log('[GroupVideoCall] Creating new video wrapper for:', participantId);
                const wrapper = document.createElement('div');
                wrapper.className = 'video-wrapper';
                wrapper.id = `remoteVideoWrapper_${participantId}`;
                
                remoteLabel = document.createElement('div');
                remoteLabel.className = 'video-label';
                const peerName = this._getCallerName ? this._getCallerName(participantId) : 'Connecting...';
                remoteLabel.textContent = peerName;
                console.log('[GroupVideoCall] Peer name for', participantId, ':', peerName);
                
                remoteVideo = document.createElement('video');
                remoteVideo.autoplay = true;
                remoteVideo.playsInline = true;
                remoteVideo.style.cssText = 'width: 180px; border: 1px solid #ccc; background: #000;';
                
                wrapper.appendChild(remoteLabel);
                wrapper.appendChild(remoteVideo);
                videoGrid.appendChild(wrapper);
                console.log('[GroupVideoCall] Video wrapper added to grid');
            } else {
                console.error('[GroupVideoCall] videoGrid not found! Cannot create video element.');
            }
            
            // Store the connection
            this.peerConnections.set(participantId, { pc, remoteVideo, remoteLabel });
            
            // Set up ICE candidate handling
            pc.onicecandidate = (e) => {
                if (e.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const iceMsg = { 
                        from: myId, 
                        to: participantId, 
                        type: 'ice', 
                        data: {
                            candidate: e.candidate.candidate,
                            sdpMLineIndex: e.candidate.sdpMLineIndex,
                            sdpMid: e.candidate.sdpMid
                        }
                    };
                    this.ws.send(JSON.stringify(iceMsg));
                }
            };
            
            // Set up track handling
            pc.ontrack = (e) => {
                console.log('[GroupVideoCall] ★★★ Received track from participant:', participantId, 'streams:', e.streams?.length, 'track kind:', e.track?.kind);
                if (remoteVideo && e.streams && e.streams.length > 0) {
                    console.log('[GroupVideoCall] Setting video srcObject for:', participantId);
                    
                    // Only set srcObject if it's different (avoid AbortError from resetting same stream)
                    if (remoteVideo.srcObject !== e.streams[0]) {
                        remoteVideo.srcObject = e.streams[0];
                    }
                    remoteVideo.muted = false;
                    
                    // Make sure video element is visible
                    remoteVideo.style.display = 'block';
                    if (remoteVideo.parentElement) {
                        remoteVideo.parentElement.style.display = 'block';
                    }
                    
                    // Wait for video to have enough data before playing
                    const tryPlay = () => {
                        if (remoteVideo.readyState >= 2) { // HAVE_CURRENT_DATA or better
                            remoteVideo.play().then(() => {
                                console.log('[GroupVideoCall] ✓ Video playing for:', participantId);
                            }).catch(err => {
                                // AbortError is normal when stream changes, ignore it
                                if (err.name !== 'AbortError') {
                                    console.warn('[GroupVideoCall] Video play error for', participantId, ':', err.name);
                                }
                            });
                        } else {
                            // Wait for loadeddata event
                            remoteVideo.onloadeddata = () => {
                                remoteVideo.play().catch(err => {
                                    if (err.name !== 'AbortError') {
                                        console.warn('[GroupVideoCall] Video play error for', participantId, ':', err.name);
                                    }
                                });
                            };
                        }
                    };
                    tryPlay();
                    
                    // Update label with peer name
                    if (remoteLabel && this._getCallerName) {
                        const peerName = this._getCallerName(participantId);
                        if (peerName && peerName !== 'Unknown') {
                            remoteLabel.textContent = peerName;
                        }
                    }
                } else {
                    console.error('[GroupVideoCall] ✗ Missing remoteVideo or streams for:', participantId);
                }
            };
            
            // Monitor connection state
            pc.onconnectionstatechange = () => {
                console.log(`[GroupVideoCall] Connection state for ${participantId}:`, pc.connectionState);
                if (pc.connectionState === 'connected') {
                    // When connected, broadcast participant info so others can connect too
                    console.log(`[GroupVideoCall] Connected to ${participantId}, broadcasting participant info`);
                    setTimeout(() => {
                        this._broadcastParticipantInfo(myId);
                    }, 300);
                    
                    // Check if we have video after a delay
                    setTimeout(() => {
                        if (remoteVideo && !remoteVideo.srcObject) {
                            console.warn(`[GroupVideoCall] No video stream for ${participantId} after connection - may need renegotiation`);
                        }
                    }, 2000);
                } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                    console.error(`[GroupVideoCall] Connection to ${participantId} ${pc.connectionState} - attempting reconnect`);
                    
                    // Clean up the failed connection
                    const wrapper = document.getElementById(`remoteVideoWrapper_${participantId}`);
                    if (wrapper) wrapper.remove();
                    this.peerConnections.delete(participantId);
                    
                    // Try to reconnect after a short delay (only if we're still in the call)
                    if (this.inCall && this.peersInCall.includes(participantId)) {
                        setTimeout(() => {
                            console.log(`[GroupVideoCall] Attempting to reconnect to ${participantId}`);
                            this._connectToParticipant(participantId, myId);
                        }, 1000);
                    }
                }
            };
            
            pc.oniceconnectionstatechange = () => {
                console.log(`[GroupVideoCall] ICE state for ${participantId}:`, pc.iceConnectionState);
                
                // Also handle ICE disconnection
                if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                    console.warn(`[GroupVideoCall] ICE ${pc.iceConnectionState} for ${participantId}`);
                }
            };
            
            // Add local tracks - CRITICAL: must have tracks to send
            if (this.localStream) {
                const tracks = this.localStream.getTracks();
                console.log(`[GroupVideoCall] Adding ${tracks.length} local tracks to connection for ${participantId}`);
                tracks.forEach(t => {
                    pc.addTrack(t, this.localStream);
                });
            } else {
                console.error('[GroupVideoCall] No local stream available for participant connection!');
            }
            
            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            const offerMsg = {
                from: myId,
                to: participantId,
                type: 'offer',
                data: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
            };
            
            console.log('[GroupVideoCall] Sending offer to participant:', participantId);
            console.log('[GroupVideoCall] WebSocket state:', this.ws?.readyState);
            
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(offerMsg));
                console.log('[GroupVideoCall] ✓ Offer sent successfully to:', participantId);
            } else {
                console.error('[GroupVideoCall] ✗ WebSocket not ready, cannot send offer');
            }
            
            console.log('[GroupVideoCall] ===== _connectToParticipant END =====');
            
        } catch (err) {
            console.error('[GroupVideoCall] Error connecting to participant:', err);
        }
    }
    
    // Join an existing call (after getting approval)
    async joinExistingCall(participantIds) {
        console.log('[GroupVideoCall] Joining existing call with participants:', participantIds);
        
        const myId = this.getMyId();
        if (!myId) {
            console.error('[GroupVideoCall] Cannot join call - no user ID');
            return;
        }
        
        // Show video container
        if (this.container) {
            this.container.style.display = '';
        }
        
        // Show message input container for group calls
        const messageInputContainer = document.getElementById('messageInputContainer');
        if (messageInputContainer) {
            messageInputContainer.style.display = 'block';
        }
        
        try {
            // Get local media stream
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (this.localVideo) {
                this.localVideo.srcObject = this.localStream;
                this.localVideo.style.display = '';
            }
            
            this.inCall = true;
            this.isCaller = true; // We're initiating connections to existing participants
            this.peersInCall = participantIds;
            
            // Connect to each existing participant
            for (let i = 0; i < participantIds.length; i++) {
                const participantId = participantIds[i];
                await this._connectToParticipant(participantId, myId);
            }
            
            // Show end call button
            if (this.endBtn) {
                this.endBtn.style.display = '';
            }
            
            this.onCallStart({ role: 'joiner', peerCount: participantIds.length });
            
        } catch (err) {
            console.error('[GroupVideoCall] Error joining existing call:', err);
            alert('Failed to join call: ' + err.message);
            this.endCall({ notifyPeer: false, reason: 'error' });
        }
    }
}

export { GroupVideoCall };

