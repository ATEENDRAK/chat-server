// group_video_call.js - Group video call implementation

import { VideoCallBase } from './video_call_base.js';

class GroupVideoCall extends VideoCallBase {
    async handleMessage(msg, myId) {
        if (msg.type === 'offer' && msg.data && msg.data.type && msg.data.sdp) {
            if (this.isCaller) {
                console.warn('[GroupVideoCall] Caller received an offer, ignoring.');
                return;
            }
            
            if (!msg.from) {
                console.error('[GroupVideoCall] Received offer without from field');
                return;
            }
            
            const accept = window.confirm('Incoming video call. Accept?');
            if (!accept) {
                const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                try {
                    this.ws.send(JSON.stringify(rejectMsg));
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
                this.inCall = true;
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
                    this.container.style.display = '';
                    
                    // Ensure video elements are visible
                    if (this.localVideo) {
                        this.localVideo.style.display = '';
                    }
                    if (this.remoteVideo) {
                        this.remoteVideo.style.display = '';
                    }
                } else {
                    console.error('[GroupVideoCall] Video container not found!');
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
            const hasLocalOffer = this.pc && this.pc.localDescription && 
                                 (this.pc.localDescription.type === 'offer');
            const isFromExpectedPeer = !this.peerIdInCall || msg.from === this.peerIdInCall;
            
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
                    
                    this._addPendingCandidates();
                    
                    console.log('[GroupVideoCall] Answer processed, connection should establish');
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
            console.log('[GroupVideoCall] Received ICE candidate from:', msg.from, 'My peerIdInCall:', this.peerIdInCall, 'inCall:', this.inCall, 'hasPC:', !!this.pc);
            
            if (this.pc) {
                const shouldProcess = !this.inCall || !this.peerIdInCall || msg.from === this.peerIdInCall;
                
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
            if (this.inCall && msg.from === this.peerIdInCall) {
                alert('Call was rejected by the other user.');
            }
            this.endCall({ notifyPeer: false, reason: 'rejected_by_peer' });
        } else if (msg.type === 'end_call') {
            if (this.inCall && msg.from === this.peerIdInCall) {
                alert('The other user ended the call.');
            }
            this.endCall({ notifyPeer: false, reason: 'remote' });
        }
    }
}

export { GroupVideoCall };

