import { VideoCall } from './video_call.js';

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
        
        // Auto-refresh rooms and users every 30 seconds
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
            userElement.dataset.userid = user.id;
            userElement.innerHTML = `
                <span>${user.username}</span>
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
        if (!this.currentPrivateUser) return;
        
        const messageInput = document.getElementById('privateMessageInput');
        const content = messageInput.value.trim();
        
        if (!content) return;

        const message = {
            type: 'text',
            content: content,
            recipient: this.currentPrivateUser.id
        };

        this.ws.send(JSON.stringify(message));
        messageInput.value = '';
    }

    handlePrivateMessage(message) {
        // Store message in private chat history
        const userId = message.sender_id === this.currentUser.id ? message.recipient : message.sender_id;
        if (!this.privateChats.has(userId)) {
            this.privateChats.set(userId, []);
        }
        this.privateChats.get(userId).push(message);

        // If private chat is open for this user, display the message
        if (this.currentPrivateUser && 
            (this.currentPrivateUser.id === message.sender_id || this.currentPrivateUser.id === message.recipient)) {
            this.displayPrivateMessage(message);
        } else {
            // Increment unread if chat not focused
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

// Initialize the chat app and video call integration when DOM is loaded
let chatApp, groupVideoCall, privateVideoCall;
document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
    // Group video call
    groupVideoCall = new VideoCall({
        localVideoId: 'localVideo',
        remoteVideoId: 'remoteVideo',
        startBtnId: 'videoCallBtn',
        endBtnId: 'endCallBtn',
        wsUrl: 'ws://' + window.location.hostname + ':9090/ws',
        getMyId: () => chatApp && chatApp.currentUser ? chatApp.currentUser.id : '',
        getPeerId: () => {
            // For group chat, pick the first other user in the room (demo purpose)
            const users = document.querySelectorAll('#usersList .user-item');
            for (let u of users) {
                const userId = u.dataset.userid;
                if (userId && userId !== (chatApp && chatApp.currentUser ? chatApp.currentUser.id : '')) {
                    return userId;
                }
            }
            // If no users found, prompt for user ID
            const peerId = prompt('Enter peer user ID for video call:');
            if (!peerId || peerId.trim() === '') {
                return null;
            }
            return peerId.trim();
        },
        containerId: 'videoCallContainer',
        onCallStart: () => {
            chatApp.displayMessage({
                type: 'system',
                content: 'Video call started.',
                timestamp: new Date().toISOString()
            });
        },
        onCallEnd: () => {
            // Post a system message in the main chat when the call ends
            chatApp.displayMessage({
                type: 'system',
                content: 'Video call ended.',
                timestamp: new Date().toISOString()
            });
        }
    });
    // Private video call
    privateVideoCall = new VideoCall({
        localVideoId: 'privateLocalVideo',
        remoteVideoId: 'privateRemoteVideo',
        startBtnId: 'privateVideoCallBtn',
        endBtnId: 'privateEndCallBtn',
        wsUrl: 'ws://' + window.location.hostname + ':9090/ws',
        getMyId: () => chatApp && chatApp.currentUser ? chatApp.currentUser.id : '',
        getPeerId: () => chatApp && chatApp.currentPrivateUser ? chatApp.currentPrivateUser.id : '',
        containerId: 'privateVideoCallContainer',
        onCallStart: () => {
            chatApp.addPrivateSystemMessageForCurrentUser('Call started.');
        },
        onCallEnd: () => {
            // Stay in private chat; add a system message
            chatApp.addPrivateSystemMessageForCurrentUser('Call ended.');
        }
    });
});

