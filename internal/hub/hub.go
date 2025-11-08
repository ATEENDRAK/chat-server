package hub

import (
	"chatstreamapp/internal/client"
	"chatstreamapp/internal/logger"
	"chatstreamapp/internal/models"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Hub maintains the set of active clients and broadcasts messages to the clients
type Hub struct {
	// Registered clients
	clients map[*client.Client]bool

	// User ID to client mapping for private messages
	userClients map[string]*client.Client

	// Rooms
	rooms map[string]*models.Room

	// Inbound messages from the clients
	broadcast chan *models.Message

	// Register requests from the clients
	register chan *client.Client

	// Unregister requests from clients
	unregister chan *client.Client

	// Private message channel
	privateMessage chan *PrivateMessage

	// Room operations
	joinRoom  chan *RoomOperation
	leaveRoom chan *RoomOperation

	// Mutex for thread safety
	mu sync.RWMutex
}

// PrivateMessage represents a private message to a specific user
type PrivateMessage struct {
	UserID  string
	Message *models.Message
}

// RoomOperation represents a room join/leave operation
type RoomOperation struct {
	Client *client.Client
	RoomID string
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		clients:        make(map[*client.Client]bool),
		userClients:    make(map[string]*client.Client),
		rooms:          make(map[string]*models.Room),
		broadcast:      make(chan *models.Message),
		register:       make(chan *client.Client),
		unregister:     make(chan *client.Client),
		privateMessage: make(chan *PrivateMessage),
		joinRoom:       make(chan *RoomOperation),
		leaveRoom:      make(chan *RoomOperation),
	}
}

// Run starts the hub
func (h *Hub) Run() {
	// Create a default general room
	generalRoom := models.NewRoom("general", "General Chat")
	h.rooms["general"] = generalRoom

	for {
		select {
		case c := <-h.register:
			h.registerClient(c)

		case c := <-h.unregister:
			h.unregisterClient(c)

		case message := <-h.broadcast:
			h.broadcastMessage(message)

		case pm := <-h.privateMessage:
			h.sendPrivateMessage(pm)

		case op := <-h.joinRoom:
			h.handleJoinRoom(op)

		case op := <-h.leaveRoom:
			h.handleLeaveRoom(op)
		}
	}
}

// Register adds a client to the hub
func (h *Hub) Register(client *client.Client) {
	h.register <- client
}

// Unregister removes a client from the hub
func (h *Hub) Unregister(client *client.Client) {
	h.unregister <- client
}

// Broadcast sends a message to all clients in the same room
func (h *Hub) Broadcast(message *models.Message) {
	h.broadcast <- message
}

// SendToUser sends a private message to a specific user
func (h *Hub) SendToUser(userID string, message *models.Message) {
	h.privateMessage <- &PrivateMessage{
		UserID:  userID,
		Message: message,
	}
}

// JoinRoom adds a client to a room
func (h *Hub) JoinRoom(client *client.Client, roomID string) {
	h.joinRoom <- &RoomOperation{
		Client: client,
		RoomID: roomID,
	}
}

// LeaveRoom removes a client from a room
func (h *Hub) LeaveRoom(client *client.Client, roomID string) {
	h.leaveRoom <- &RoomOperation{
		Client: client,
		RoomID: roomID,
	}
}

// GetRooms returns all rooms
func (h *Hub) GetRooms() map[string]*models.Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	rooms := make(map[string]*models.Room)
	for id, room := range h.rooms {
		rooms[id] = room
	}
	return rooms
}

// GetUsers returns all connected users
func (h *Hub) GetUsers() map[string]*client.Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	
	users := make(map[string]*client.Client)
	for userID, c := range h.userClients {
		users[userID] = c
	}
	return users
}

// CreateRoom creates a new room
func (h *Hub) CreateRoom(name string) *models.Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	
	roomID := uuid.New().String()
	room := models.NewRoom(roomID, name)
	h.rooms[roomID] = room
	
	return room
}

func (h *Hub) registerClient(client *client.Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[client] = true
	h.userClients[client.GetUser().ID] = client

	user := client.GetUser()
	logger.Infof("User %s (%s) connected", user.Username, user.ID)

	// Send welcome message
	welcomeMessage := &models.Message{
		ID:        uuid.New().String(),
		Type:      models.MessageTypeSystem,
		Content:   "Welcome to the chat!",
		Sender:    "System",
		Timestamp: time.Now(),
	}
	client.SendMessage(welcomeMessage)

	// Send list of available rooms
	roomsMessage := &models.Message{
		ID:        uuid.New().String(),
		Type:      models.MessageTypeSystem,
		Content:   h.getRoomsList(),
		Sender:    "System",
		Timestamp: time.Now(),
	}
	client.SendMessage(roomsMessage)
}

func (h *Hub) unregisterClient(client *client.Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client]; ok {
		user := client.GetUser()
		roomID := client.GetRoomID()

		// Remove from room if in one
		if roomID != "" {
			if room, exists := h.rooms[roomID]; exists {
				room.RemoveUser(user.ID)
				
				// Notify room about user leaving
				leaveMessage := &models.Message{
					ID:        uuid.New().String(),
					Type:      models.MessageTypeLeave,
					Content:   user.Username + " left the room",
					Sender:    "System",
					Room:      roomID,
					Timestamp: time.Now(),
				}
				h.broadcastToRoom(roomID, leaveMessage)
			}
		}

		delete(h.clients, client)
		delete(h.userClients, user.ID)
		
		logger.Infof("User %s (%s) disconnected", user.Username, user.ID)
	}
}

func (h *Hub) broadcastMessage(message *models.Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if message.Room != "" {
		// Add message to room history
		if room, exists := h.rooms[message.Room]; exists {
			room.AddMessage(message)
		}
		
		// Broadcast to room
		h.broadcastToRoom(message.Room, message)
	}
}

func (h *Hub) broadcastToRoom(roomID string, message *models.Message) {
	room, exists := h.rooms[roomID]
	if !exists {
		return
	}

	for userID := range room.Users {
		if client, exists := h.userClients[userID]; exists {
			client.SendMessage(message)
		}
	}
}

func (h *Hub) sendPrivateMessage(pm *PrivateMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if client, exists := h.userClients[pm.UserID]; exists {
		client.SendMessage(pm.Message)
	}
}

func (h *Hub) handleJoinRoom(op *RoomOperation) {
	h.mu.Lock()
	defer h.mu.Unlock()

	user := op.Client.GetUser()
	
	// Leave current room if in one
	currentRoom := op.Client.GetRoomID()
	if currentRoom != "" {
		if room, exists := h.rooms[currentRoom]; exists {
			room.RemoveUser(user.ID)
			
			leaveMessage := &models.Message{
				ID:        uuid.New().String(),
				Type:      models.MessageTypeLeave,
				Content:   user.Username + " left the room",
				Sender:    "System",
				Room:      currentRoom,
				Timestamp: time.Now(),
			}
			h.broadcastToRoom(currentRoom, leaveMessage)
		}
	}

	// Join new room
	room, exists := h.rooms[op.RoomID]
	if !exists {
		// Create room if it doesn't exist
		room = models.NewRoom(op.RoomID, op.RoomID)
		h.rooms[op.RoomID] = room
	}

	room.AddUser(user)
	user.Room = op.RoomID
	op.Client.SetRoomID(op.RoomID)

	// Send join message to room
	joinMessage := &models.Message{
		ID:        uuid.New().String(),
		Type:      models.MessageTypeJoin,
		Content:   user.Username + " joined the room",
		Sender:    "System",
		Room:      op.RoomID,
		Timestamp: time.Now(),
	}
	h.broadcastToRoom(op.RoomID, joinMessage)

	// Send room history to the joining user
	for _, msg := range room.Messages {
		op.Client.SendMessage(msg)
	}

	logger.Infof("User %s joined room %s", user.Username, op.RoomID)
}

func (h *Hub) handleLeaveRoom(op *RoomOperation) {
	h.mu.Lock()
	defer h.mu.Unlock()

	user := op.Client.GetUser()
	
	if room, exists := h.rooms[op.RoomID]; exists {
		room.RemoveUser(user.ID)
		user.Room = ""
		op.Client.SetRoomID("")

		leaveMessage := &models.Message{
			ID:        uuid.New().String(),
			Type:      models.MessageTypeLeave,
			Content:   user.Username + " left the room",
			Sender:    "System",
			Room:      op.RoomID,
			Timestamp: time.Now(),
		}
		h.broadcastToRoom(op.RoomID, leaveMessage)
	}

	logger.Infof("User %s left room %s", user.Username, op.RoomID)
}

func (h *Hub) getRoomsList() string {
	rooms := "Available rooms: "
	for _, room := range h.rooms {
		rooms += room.Name + " (" + room.ID + "), "
	}
	return rooms
}
