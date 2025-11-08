class ChatApp {
    constructor() {
        this.ws = null;
        this.currentUser = null;
        this.currentRoom = null;
        this.privateChats = new Map();
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
        }, 30000);
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

        users.forEach(user => {
            if (user.id === this.currentUser.id) return; // Don't show self
            
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            
            userElement.innerHTML = `
                <span>${user.username}</span>
                <span class="user-status"></span>
            `;
            
            userElement.addEventListener('click', () => this.openPrivateChat(user));
            usersList.appendChild(userElement);
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
        
        let messageClass = 'message private';
        if (message.sender_id === this.currentUser.id) {
            messageClass += ' own';
        } else {
            messageClass += ' other';
        }
        
        messageElement.className = messageClass;
        
        const time = new Date(message.timestamp).toLocaleTimeString();
        
        messageElement.innerHTML = `
            <div class="message-header">${message.sender}</div>
            <div class="message-content">${message.content}</div>
            <div class="message-time">${time}</div>
        `;
        
        container.appendChild(messageElement);
        container.scrollTop = container.scrollHeight;
    }

    showNotification(message) {
        // Simple notification - could be enhanced with browser notifications
        console.log('Notification:', message);
    }

    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

// Initialize the chat app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatApp();
});
