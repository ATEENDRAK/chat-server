import { PrivateVideoCall } from './private_video_call.js';
import { GroupVideoCall } from './group_video_call.js';
import { videoSignaling } from './video_signaling.js';

// Track users who are currently in a call (globally)
const usersInCall = new Set();

class ChatApp {
    constructor() {
        this.ws = null;
        this.currentUser = null;
        this.currentRoom = null;
        this.privateChats = new Map();
        this.privateUnread = new Map();
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadRooms();
        this.loadUsers();
        
        // Auto-refresh rooms and users every 15 seconds
        setInterval(() => {
            if (this.currentUser) {
                this.loadRooms();
                this.loadUsers();
            }
        }, 15000);
    }

    bindEvents() {
        // Login
        document.getElementById('joinBtn').addEventListener('click', () => this.login());
        document.getElementById('usernameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Room management
        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
        document.getElementById('roomNameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createRoom();
        });
        document.getElementById('leaveRoomBtn').addEventListener('click', () => this.leaveRoom());

        // Messaging
        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Private chat
        document.getElementById('sendPrivateBtn').addEventListener('click', () => this.sendPrivateMessage());
        document.getElementById('privateMessageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage();
        });
        document.getElementById('closePrivateChat').addEventListener('click', () => this.closePrivateChat());
    }

    login() {
        const username = document.getElementById('usernameInput').value.trim();
        if (!username) {
            alert('Please enter a username');
            return;
        }

        this.currentUser = {
            id: this.generateId(),
            username: username
        };

        this.connectWebSocket();
        this.showChatInterface();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws?user_id=${this.currentUser.id}&username=${encodeURIComponent(this.currentUser.username)}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to WebSocket');
            this.updateUserInfo();
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
            setTimeout(() => {
                if (this.currentUser) {
                    this.connectWebSocket();
                }
            }, 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    showChatInterface() {
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'flex';
        document.getElementById('userInfo').style.display = 'flex';
        this.loadRooms();
        this.loadUsers();
    }

    updateUserInfo() {
        document.getElementById('currentUser').textContent = this.currentUser.username;
        document.getElementById('currentRoom').textContent = this.currentRoom ? `Room: ${this.currentRoom}` : 'No room';
    }

    async loadRooms() {
        try {
            const response = await fetch('/api/rooms');
            const data = await response.json();
            this.displayRooms(data.rooms);
        } catch (error) {
            console.error('Failed to load rooms:', error);
        }
    }

    displayRooms(rooms) {
        const roomsList = document.getElementById('roomsList');
        roomsList.innerHTML = '';

        rooms.forEach(room => {
            const roomElement = document.createElement('div');
            roomElement.className = 'room-item';
            if (room.id === this.currentRoom) {
                roomElement.classList.add('active');
            }
            
            roomElement.innerHTML = `
                <div>${room.name}</div>
                <small>${room.user_count} users</small>
            `;
            
            roomElement.addEventListener('click', () => this.joinRoom(room.id, room.name));
            roomsList.appendChild(roomElement);
        });
    }

    async createRoom() {
        const roomName = document.getElementById('roomNameInput').value.trim();
        if (!roomName) {
            alert('Please enter a room name');
            return;
        }

        try {
            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: roomName }),
            });

            if (response.ok) {
                document.getElementById('roomNameInput').value = '';
                this.loadRooms();
            } else {
                alert('Failed to create room');
            }
        } catch (error) {
            console.error('Failed to create room:', error);
            alert('Failed to create room');
        }
    }

    joinRoom(roomId, roomName) {
        if (this.currentRoom === roomId) return;

        const message = {
            type: 'join_room',
            content: roomId
        };

        this.ws.send(JSON.stringify(message));
        this.currentRoom = roomId;
        
        // Update UI
        document.getElementById('chatTitle').textContent = `Room: ${roomName}`;
        document.getElementById('messageInputContainer').style.display = 'block';
        document.getElementById('leaveRoomBtn').style.display = 'block';
        document.getElementById('messages').innerHTML = '';
        
        this.updateUserInfo();
        this.loadRooms(); // Refresh to update active room
        
        // Refresh users list after a short delay to show room members
        setTimeout(() => this.loadUsers(), 500);
    }

    leaveRoom() {
        if (!this.currentRoom) return;

        const message = {
            type: 'leave_room',
            content: this.currentRoom
        };

        this.ws.send(JSON.stringify(message));
        this.currentRoom = null;
        
        // Update UI
        document.getElementById('chatTitle').textContent = 'Select a room to start chatting';
        document.getElementById('messageInputContainer').style.display = 'none';
        document.getElementById('leaveRoomBtn').style.display = 'none';
        document.getElementById('messages').innerHTML = '';
        
        this.updateUserInfo();
        this.loadRooms(); // Refresh to update active room
        this.loadUsers(); // Refresh users list to remove room highlighting
    }

    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        
        if (!content || !this.currentRoom) return;

        const message = {
            type: 'text',
            content: content,
            room: this.currentRoom
        };

        this.ws.send(JSON.stringify(message));
        messageInput.value = '';
    }

    handleMessage(message) {
        console.log('[Chat] Received message:', message.type, message);
        switch (message.type) {
            case 'text':
            case 'join':
            case 'leave':
            case 'system':
                this.displayMessage(message);
                break;
            case 'private':
                this.handlePrivateMessage(message);
                break;
        }
    }

    displayMessage(message) {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        
        let messageClass = 'message';
        if (message.type === 'system' || message.type === 'join' || message.type === 'leave') {
            messageClass += ' system';
        } else if (message.sender_id === this.currentUser.id) {
            messageClass += ' own';
        } else {
            messageClass += ' other';
        }
        
        messageElement.className = messageClass;
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        
        if (message.type === 'system' || message.type === 'join' || message.type === 'leave') {
            messageElement.innerHTML = `
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time}</div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-header">${message.sender}</div>
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time}</div>
            `;
        }
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async loadUsers() {
        try {
            const response = await fetch('/api/users');
            const data = await response.json();
            // Store all users with their room info for video call filtering
            this.roomUsers = data.users || [];
            this.displayUsers(data.users);
        } catch (error) {
            console.error('Failed to load users:', error);
        }
    }

    displayUsers(users) {
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';

        if (!Array.isArray(users)) {
            console.error('displayUsers: users is not an array', users);
            return;
        }

        users.forEach((user, idx) => {
            if (!user || typeof user !== 'object' || !user.id) {
                console.warn('displayUsers: skipping user at index', idx, user);
                return;
            }
            if (user.id === this.currentUser.id) return; // Don't show self
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            // Highlight users in the same room
            if (this.currentRoom && user.room === this.currentRoom) {
                userElement.classList.add('same-room');
            }
            userElement.dataset.userid = user.id;
            userElement.dataset.userroom = user.room || '';
            
            // Show room indicator if user is in a room
            const roomIndicator = user.room ? 
                (user.room === this.currentRoom ? ' 🟢' : ' 📍') : '';
            
            // Check if user is in a call
            const inCallBadge = usersInCall.has(user.id) ? '<span class="in-call-badge">In Call</span>' : '';
            
            userElement.innerHTML = `
                <span>${user.username}${roomIndicator}${inCallBadge}</span>
                <span class="user-status"></span>
                <span class="user-unread">0</span>
            `;
            userElement.addEventListener('click', () => this.openPrivateChat(user));
            usersList.appendChild(userElement);
            // Reflect unread, if any
            const count = this.privateUnread.get(user.id) || 0;
            this.updateUnreadBadge(user.id, count);
        });
    }

    openPrivateChat(user) {
        document.getElementById('privateUsername').textContent = user.username;
        document.getElementById('privateChatModal').style.display = 'flex';
        
        // Load private chat history
        const messages = this.privateChats.get(user.id) || [];
        this.displayPrivateMessages(messages);
        
        // Store current private chat user
        this.currentPrivateUser = user;
        // Clear unread for this user
        this.clearUnreadFor(user.id);
    }

    closePrivateChat() {
        document.getElementById('privateChatModal').style.display = 'none';
        this.currentPrivateUser = null;
    }

    sendPrivateMessage() {
        if (!this.currentPrivateUser) {
            console.log('[Chat] No private user selected');
            return;
        }
        
        const messageInput = document.getElementById('privateMessageInput');
        const content = messageInput.value.trim();
        
        if (!content) return;

        const message = {
            type: 'text',
            content: content,
            recipient: this.currentPrivateUser.id
        };

        console.log('[Chat] Sending private message:', message);
        this.ws.send(JSON.stringify(message));
        messageInput.value = '';
    }

    handlePrivateMessage(message) {
        console.log('[Chat] Received private message:', message);
        
        // Store message in private chat history
        const userId = message.sender_id === this.currentUser.id ? message.recipient : message.sender_id;
        if (!this.privateChats.has(userId)) {
            this.privateChats.set(userId, []);
        }
        this.privateChats.get(userId).push(message);

        // If private chat is open for this user, display the message
        if (this.currentPrivateUser && 
            (this.currentPrivateUser.id === message.sender_id || this.currentPrivateUser.id === message.recipient)) {
            console.log('[Chat] Displaying private message in open chat');
            this.displayPrivateMessage(message);
        } else {
            // Increment unread if chat not focused
            console.log('[Chat] Incrementing unread for user:', userId);
            this.incrementUnreadFor(userId);
        }

        // Show notification if chat is not open
        if (!this.currentPrivateUser || this.currentPrivateUser.id !== message.sender_id) {
            this.showNotification(`Private message from ${message.sender}`);
        }
    }

    displayPrivateMessages(messages) {
        const container = document.getElementById('privateMessages');
        container.innerHTML = '';
        
        messages.forEach(message => {
            this.displayPrivateMessage(message);
        });
    }

    displayPrivateMessage(message) {
        const container = document.getElementById('privateMessages');
        const messageElement = document.createElement('div');
        
        // Render system messages differently
        if (message.type === 'system') {
            messageElement.className = 'message system';
        } else {
            let messageClass = 'message private';
            // Some private messages may not have sender_id (depending on server echo),
            // so fall back to sender username comparison.
            const isOwn =
                (message.sender_id && message.sender_id === this.currentUser.id) ||
                (!message.sender_id && message.sender && this.currentUser && message.sender === this.currentUser.username);
            if (isOwn) {
                messageClass += ' own';
            } else {
                messageClass += ' other';
            }
            messageElement.className = messageClass;
        }
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        
        if (message.type === 'system') {
            messageElement.innerHTML = `
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time}</div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-header">${message.sender}</div>
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time}</div>
            `;
        }
        
        container.appendChild(messageElement);
        container.scrollTop = container.scrollHeight;
    }

    addPrivateSystemMessageForCurrentUser(text) {
        if (!this.currentPrivateUser) return;
        const message = {
            id: Math.random().toString(36).slice(2),
            type: 'system',
            content: text,
            sender: 'System',
            timestamp: new Date().toISOString()
        };
        const uid = this.currentPrivateUser.id;
        if (!this.privateChats.has(uid)) {
            this.privateChats.set(uid, []);
        }
        this.privateChats.get(uid).push(message);
        this.displayPrivateMessage(message);
    }

    // Unread helpers
    updateUnreadBadge(userId, count) {
        const item = document.querySelector(`#usersList .user-item[data-userid="${userId}"]`);
        if (!item) return;
        const badge = item.querySelector('.user-unread');
        if (!badge) return;
        if (count > 0) {
            item.classList.add('has-unread');
            badge.textContent = String(count);
        } else {
            item.classList.remove('has-unread');
            badge.textContent = '0';
        }
    }
    incrementUnreadFor(userId) {
        const current = this.privateUnread.get(userId) || 0;
        const next = current + 1;
        this.privateUnread.set(userId, next);
        this.updateUnreadBadge(userId, next);
    }
    clearUnreadFor(userId) {
        this.privateUnread.set(userId, 0);
        this.updateUnreadBadge(userId, 0);
    }

    showNotification(message) {
        // Simple notification - could be enhanced with browser notifications
        console.log('Notification:', message);
    }

    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

// Helper function to get username by ID
function getUsernameById(userId) {
    if (!chatApp || !chatApp.roomUsers) return 'Unknown';
    const user = chatApp.roomUsers.find(u => u.id === userId);
    return user ? user.username : 'Unknown';
}

// Helper function to update video labels
function updateVideoLabels(localLabelId, remoteLabelId, myName, peerName) {
    const localLabel = document.getElementById(localLabelId);
    const remoteLabel = document.getElementById(remoteLabelId);
    if (localLabel) localLabel.textContent = myName || 'You';
    if (remoteLabel) remoteLabel.textContent = peerName || 'Connecting...';
}

// Show user selection modal for group calls
function showUserSelectionModal(availableUsers) {
    return new Promise((resolve) => {
        const modal = document.getElementById('userSelectionModal');
        const checkboxList = document.getElementById('userCheckboxList');
        const selectAllBtn = document.getElementById('selectAllUsersBtn');
        const startCallBtn = document.getElementById('startGroupCallBtn');
        const cancelBtn = document.getElementById('cancelUserSelectionBtn');
        const closeBtn = document.getElementById('closeUserSelection');
        
        if (!modal) {
            // Fallback to old prompt method
            const userList = availableUsers.map((u, idx) => `${idx + 1}. ${u.username}`).join('\n');
            const choice = prompt(`Select users to call (comma-separated numbers, or 'all'):\n${userList}\n\nExample: 1,2,3 or all`);
            if (!choice) {
                resolve([]);
                return;
            }
            if (choice.toLowerCase() === 'all') {
                resolve(availableUsers);
                return;
            }
            const nums = choice.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= availableUsers.length);
            resolve(nums.map(n => availableUsers[n - 1]));
            return;
        }
        
        // Build checkbox list - filter out users who are in a call
        const callableUsers = availableUsers.filter(u => !usersInCall.has(u.id));
        const busyUsers = availableUsers.filter(u => usersInCall.has(u.id));
        
        let checkboxHtml = callableUsers.map((user, idx) => `
            <label style="display: flex; align-items: center; padding: 8px; margin: 4px 0; background: #f8f9fa; border-radius: 5px; cursor: pointer;">
                <input type="checkbox" value="${user.id}" data-username="${user.username}" style="margin-right: 10px; width: 18px; height: 18px;">
                <span>${user.username}</span>
            </label>
        `).join('');
        
        // Show busy users as disabled
        if (busyUsers.length > 0) {
            checkboxHtml += `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; color: #999; font-size: 0.9rem;">
                <strong>In Call (unavailable):</strong><br>
                ${busyUsers.map(u => `<span style="display: inline-block; margin: 2px 5px;">📹 ${u.username}</span>`).join('')}
            </div>`;
        }
        
        checkboxList.innerHTML = checkboxHtml || '<p style="color: #666;">No available users to call.</p>';
        
        modal.style.display = 'flex';
        
        const cleanup = () => {
            modal.style.display = 'none';
            selectAllBtn.onclick = null;
            startCallBtn.onclick = null;
            cancelBtn.onclick = null;
            closeBtn.onclick = null;
        };
        
        // Select all available users (not in call)
        selectAllBtn.onclick = () => {
            if (callableUsers.length === 0) {
                alert('No available users to call. All users are currently in a call.');
                return;
            }
            cleanup();
            resolve(callableUsers);
        };
        
        // Start call with selected users
        startCallBtn.onclick = () => {
            const checkboxes = checkboxList.querySelectorAll('input[type="checkbox"]:checked');
            const selectedUsers = Array.from(checkboxes).map(cb => {
                return callableUsers.find(u => u.id === cb.value);
            }).filter(Boolean);
            
            if (selectedUsers.length === 0) {
                alert('Please select at least one user to call.');
                return;
            }
            
            cleanup();
            resolve(selectedUsers);
        };
        
        // Cancel
        cancelBtn.onclick = () => {
            cleanup();
            resolve([]);
        };
        
        closeBtn.onclick = () => {
            cleanup();
            resolve([]);
        };
    });
}

// Initialize the chat app and video call integration when DOM is loaded
let chatApp, groupVideoCall, privateVideoCall;
document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
    
    // Track the selected peers for group calls (can be multiple)
    let selectedGroupPeers = [];
    
    // Group video call
    groupVideoCall = new GroupVideoCall({
        localVideoId: 'localVideo',
        remoteVideoId: 'remoteVideo',
        startBtnId: 'videoCallBtn',
        endBtnId: 'endCallBtn',
        wsUrl: (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/video/ws',
        getMyId: () => chatApp && chatApp.currentUser ? chatApp.currentUser.id : '',
        // getPeerId now returns an array of peer IDs for multi-party calls
        getPeerIds: async () => {
            // For group chat, pick users who are in the SAME ROOM
            if (!chatApp || !chatApp.currentRoom) {
                alert('Please join a room first before starting a video call.');
                return [];
            }
            
            // Get users in the current room from the cached user data
            const roomUsers = chatApp.roomUsers || [];
            const myId = chatApp.currentUser ? chatApp.currentUser.id : '';
            
            // Filter users in the same room (excluding self)
            const availableUsers = roomUsers.filter(u => 
                u.id !== myId && u.room === chatApp.currentRoom
            );
            
            if (availableUsers.length === 0) {
                alert('No other users in this room for video call. Please wait for someone to join the room.');
                return [];
            }
            
            if (availableUsers.length === 1) {
                // Only one user, call them directly
                selectedGroupPeers = [availableUsers[0]];
                console.log('[GroupVideoCall] Auto-selected single peer:', availableUsers[0].username);
                return [availableUsers[0].id];
            }
            
            // Multiple users - show selection modal
            const selectedUsers = await showUserSelectionModal(availableUsers);
            
            if (selectedUsers.length === 0) {
                return [];
            }
            
            selectedGroupPeers = selectedUsers;
            console.log('[GroupVideoCall] Selected peers:', selectedUsers.map(u => u.username).join(', '));
            return selectedUsers.map(u => u.id);
        },
        // Keep getPeerId for backward compatibility (returns first peer)
        getPeerId: () => {
            if (selectedGroupPeers.length > 0) {
                return selectedGroupPeers[0].id;
            }
            return null;
        },
        containerId: 'videoCallContainer',
        // Function to get other users in the room (for mesh network expansion)
        getRoomUsers: () => {
            if (!chatApp || !chatApp.currentRoom) return [];
            const roomUsers = chatApp.roomUsers || [];
            const myId = chatApp.currentUser ? chatApp.currentUser.id : '';
            return roomUsers.filter(u => u.id !== myId && u.room === chatApp.currentRoom);
        },
        onCallStart: (info) => {
            // Update local video label with user's name
            const myName = chatApp.currentUser ? chatApp.currentUser.username : 'You';
            const localLabel = document.getElementById('localVideoLabel');
            if (localLabel) localLabel.textContent = myName;
            
            let peerNames = '';
            let participantCount = 1;
            
            if (info && info.role === 'caller' && selectedGroupPeers.length > 0) {
                peerNames = selectedGroupPeers.map(p => p.username).join(', ');
                participantCount = selectedGroupPeers.length;
                // Update remote video label for single peer
                if (selectedGroupPeers.length === 1) {
                    updateVideoLabels('localVideoLabel', 'remoteVideoLabel', myName, peerNames);
                }
            } else if (info && info.role === 'callee' && groupVideoCall.peerIdInCall) {
                peerNames = getUsernameById(groupVideoCall.peerIdInCall);
                updateVideoLabels('localVideoLabel', 'remoteVideoLabel', myName, peerNames);
            }
            
            chatApp.displayMessage({
                type: 'system',
                content: `Video call started${peerNames ? ` with ${peerNames}` : ''}.`,
                timestamp: new Date().toISOString()
            });
        },
        onCallEnd: () => {
            // Reset labels
            updateVideoLabels('localVideoLabel', 'remoteVideoLabel', 'You', 'Connecting...');
            selectedGroupPeers = [];
            
            chatApp.displayMessage({
                type: 'system',
                content: 'Video call ended.',
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Set the caller name lookup function for GroupVideoCall
    groupVideoCall._getCallerName = getUsernameById;
    
    // Private video call
    privateVideoCall = new PrivateVideoCall({
        localVideoId: 'privateLocalVideo',
        remoteVideoId: 'privateRemoteVideo',
        startBtnId: 'privateVideoCallBtn',
        endBtnId: 'privateEndCallBtn',
        wsUrl: (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/video/ws',
        getMyId: () => chatApp && chatApp.currentUser ? chatApp.currentUser.id : '',
        getPeerId: () => chatApp && chatApp.currentPrivateUser ? chatApp.currentPrivateUser.id : '',
        containerId: 'privateVideoCallContainer',
        onCallStart: (info) => {
            // Update video labels for private call
            const myName = chatApp.currentUser ? chatApp.currentUser.username : 'You';
            let peerName = 'Connecting...';
            
            if (chatApp.currentPrivateUser) {
                peerName = chatApp.currentPrivateUser.username;
            } else if (info && info.role === 'callee' && privateVideoCall.peerIdInCall) {
                peerName = getUsernameById(privateVideoCall.peerIdInCall);
            }
            
            updateVideoLabels('privateLocalVideoLabel', 'privateRemoteVideoLabel', myName, peerName);
            
            chatApp.addPrivateSystemMessageForCurrentUser(`Call started with ${peerName}.`);
        },
        onCallEnd: () => {
            // Reset labels
            updateVideoLabels('privateLocalVideoLabel', 'privateRemoteVideoLabel', 'You', 'Connecting...');
            
            chatApp.addPrivateSystemMessageForCurrentUser('Call ended.');
        }
    });
    
    // Set the caller name lookup function for PrivateVideoCall
    privateVideoCall._getCallerName = getUsernameById;
    
    // ==================== In-Call Status Tracking ====================
    
    // Listen for call status messages via video signaling
    videoSignaling.addHandler('InCallTracker', (msg) => {
        if (msg.type === 'call_status') {
            if (msg.subtype === 'in_call') {
                usersInCall.add(msg.userId);
                chatApp.loadUsers(); // Refresh user list
            } else if (msg.subtype === 'call_ended') {
                usersInCall.delete(msg.userId);
                chatApp.loadUsers(); // Refresh user list
            }
        }
    });
    
    // Broadcast in-call status when call starts/ends
    const originalOnCallStart = groupVideoCall.onCallStart;
    groupVideoCall.onCallStart = (info) => {
        // Mark self as in call
        if (chatApp?.currentUser?.id) {
            usersInCall.add(chatApp.currentUser.id);
            // Broadcast to others
            videoSignaling.send({
                type: 'call_status',
                subtype: 'in_call',
                userId: chatApp.currentUser.id
            });
        }
        
        // Call original handler
        originalOnCallStart(info);
    };
    
    const originalOnCallEnd = groupVideoCall.onCallEnd;
    groupVideoCall.onCallEnd = (info) => {
        // Mark self as not in call
        if (chatApp?.currentUser?.id) {
            usersInCall.delete(chatApp.currentUser.id);
            // Broadcast to others
            videoSignaling.send({
                type: 'call_status',
                subtype: 'call_ended',
                userId: chatApp.currentUser.id
            });
            chatApp.loadUsers(); // Refresh user list
        }
        
        // Call original handler
        originalOnCallEnd(info);
    };
});

