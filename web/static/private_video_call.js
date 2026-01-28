// private_video_call.js - Private video call implementation

import { VideoCallBase, showIncomingCallDialog } from './video_call_base.js';

class PrivateVideoCall extends VideoCallBase {
    // Check if this handler should process the message
    shouldHandleMessage(msg) {
        // PrivateVideoCall handles messages when:
        // 1. We're already in a call with this peer (continue handling)
        // 2. Private chat IS open (we're in private chat view)
        
        // If we're in a call with this peer, always handle
        if (this.inCall && this.peerIdInCall === msg.from) {
            return true;
        }
        
        // For new calls, only handle if private chat is open
        const privateChatModal = document.getElementById('privateChatModal');
        const isPrivateChatOpen = privateChatModal && privateChatModal.style.display !== 'none';
        return isPrivateChatOpen;
    }
    
    async handleMessage(msg, myId) {
        // First check if we should handle this message at all
        if (!this.shouldHandleMessage(msg)) {
            console.log('[PrivateVideoCall] Delegating to GroupVideoCall (private chat is not open)');
            return;
        }
        
        // Skip if we're already in a call with a DIFFERENT peer
        if (this.inCall && msg.from !== this.peerIdInCall && (msg.type === 'offer' || msg.type === 'answer')) {
            console.log('[PrivateVideoCall] Already in call with different peer, ignoring');
            return;
        }
        
        if (msg.type === 'offer' && msg.data && msg.data.type && msg.data.sdp) {
            if (this.isCaller) {
                console.warn('[PrivateVideoCall] Caller received an offer, ignoring.');
                return;
            }
            
            if (!msg.from) {
                console.error('[PrivateVideoCall] Received offer without from field');
                return;
            }
            
            // Get caller's name for the dialog
            const callerName = this._getCallerName ? this._getCallerName(msg.from) : msg.from;
            console.log('[PrivateVideoCall] Showing incoming call dialog for:', callerName);
            
            const accept = await showIncomingCallDialog(callerName);
            console.log('[PrivateVideoCall] User response to call:', accept ? 'ACCEPTED' : 'REJECTED');
            
            if (!accept) {
                const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                try {
                    this.ws.send(JSON.stringify(rejectMsg));
                    console.log('[PrivateVideoCall] Sent reject to:', msg.from);
                } catch (err) {
                    console.error('[PrivateVideoCall] Failed to send reject:', err);
                }
                this.endCall({ notifyPeer: false, reason: 'rejected' });
                return;
            }
            
            try {
                this.isCaller = false;
                this.peerIdInCall = msg.from;
                this.inCall = true;
                this.onCallStart({ role: 'callee' });
                
                if (this.container) this.container.style.display = '';
                if (this.endBtn) this.endBtn.style.display = '';
                
                if (!this.localStream) {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this.localVideo.srcObject = this.localStream;
                }
                
                if (this.pc) {
                    this.pc.close();
                    this.pc = null;
                }
                
                this._setupPeerConnection(myId, this.peerIdInCall);
                this.localStream.getTracks().forEach(track => {
                    this.pc.addTrack(track, this.localStream);
                });
                
                await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                this._addPendingCandidates();
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                const answerMsg = { 
                    from: myId, 
                    to: this.peerIdInCall, 
                    type: 'answer', 
                    data: { 
                        type: this.pc.localDescription.type, 
                        sdp: this.pc.localDescription.sdp 
                    } 
                };
                try {
                    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                        throw new Error('WebSocket not connected');
                    }
                    this.ws.send(JSON.stringify(answerMsg));
                    console.log('[PrivateVideoCall] Answer sent successfully');
                } catch (err) {
                    console.error('[PrivateVideoCall] Failed to send answer:', err);
                    alert('Failed to send call answer. Please try again.');
                    this.endCall({ notifyPeer: false, reason: 'error' });
                }
            } catch (err) {
                console.error('[PrivateVideoCall] Error accepting call:', err);
                alert('Failed to accept call: ' + err.message);
                const rejectMsg = { from: myId, to: msg.from, type: 'reject' };
                try {
                    this.ws.send(JSON.stringify(rejectMsg));
                } catch (sendErr) {
                    console.error('[PrivateVideoCall] Failed to send reject after error:', sendErr);
                }
                this.endCall({ notifyPeer: false, reason: 'error' });
            }
        } else if (msg.type === 'answer' && msg.data && msg.data.type && msg.data.sdp) {
            const hasLocalOffer = this.pc && this.pc.localDescription && 
                                 (this.pc.localDescription.type === 'offer');
            const isFromExpectedPeer = !this.peerIdInCall || msg.from === this.peerIdInCall;
            
            if (this.isCaller || (hasLocalOffer && isFromExpectedPeer)) {
                if (hasLocalOffer && !this.isCaller) {
                    this.isCaller = true;
                    if (!this.inCall) this.inCall = true;
                    if (!this.peerIdInCall) this.peerIdInCall = msg.from;
                }
                
                if (!this.pc || !hasLocalOffer) {
                    console.warn('[PrivateVideoCall] Received answer but no local offer found');
                    return;
                }
                
                try {
                    await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                    this._addPendingCandidates();
                    console.log('[PrivateVideoCall] Answer processed, connection should establish');
                } catch (err) {
                    console.error('[PrivateVideoCall] Error setting remote description:', err);
                    alert('Failed to process answer: ' + err.message);
                }
            }
        } else if (msg.type === 'ice' && msg.data) {
            if (this.pc) {
                const shouldProcess = !this.inCall || !this.peerIdInCall || msg.from === this.peerIdInCall;
                if (shouldProcess) {
                    try {
                        let candidateData = msg.data;
                        if (typeof candidateData === 'string') {
                            candidateData = JSON.parse(candidateData);
                        }
                        const candidate = new RTCIceCandidate(candidateData);
                        this._handleRemoteCandidate(candidate);
                    } catch (err) {
                        console.error('[PrivateVideoCall] Error processing ICE candidate:', err);
                    }
                }
            } else {
                try {
                    let candidateData = msg.data;
                    if (typeof candidateData === 'string') {
                        candidateData = JSON.parse(candidateData);
                    }
                    const candidate = new RTCIceCandidate(candidateData);
                    this.pendingCandidates.push(candidate);
                } catch (err) {
                    console.error('[PrivateVideoCall] Error queuing ICE candidate:', err);
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

export { PrivateVideoCall };

