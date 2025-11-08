package client

import (
	"chatstreamapp/internal/logger"
	"chatstreamapp/internal/models"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow connections from any origin in development
		return true
	},
}

// Hub interface for client to communicate with hub
type Hub interface {
	Register(client *Client)
	Unregister(client *Client)
	Broadcast(message *models.Message)
	SendToUser(userID string, message *models.Message)
	JoinRoom(client *Client, roomID string)
	LeaveRoom(client *Client, roomID string)
	GetRooms() map[string]*models.Room
	GetUsers() map[string]*Client
}

// Client represents a WebSocket client
type Client struct {
	Hub      Hub
	Conn     *websocket.Conn
	Send     chan *models.Message
	User     *models.User
	RoomID   string
}

// GetUser returns the user associated with this client
func (c *Client) GetUser() *models.User {
	return c.User
}

// GetRoomID returns the current room ID
func (c *Client) GetRoomID() string {
	return c.RoomID
}

// SetRoomID sets the current room ID
func (c *Client) SetRoomID(roomID string) {
	c.RoomID = roomID
}

// NewClient creates a new client
func NewClient(hub Hub, conn *websocket.Conn, user *models.User) *Client {
	return &Client{
		Hub:  hub,
		Conn: conn,
		Send: make(chan *models.Message, 256),
		User: user,
	}
}

// ServeWS handles websocket requests from the peer
func ServeWS(hub Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("WebSocket upgrade error: %v", err)
		return
	}

	// Get user info from query parameters
	userID := r.URL.Query().Get("user_id")
	username := r.URL.Query().Get("username")
	
	if userID == "" || username == "" {
		conn.Close()
		return
	}

	user := &models.User{
		ID:       userID,
		Username: username,
	}

	client := NewClient(hub, conn, user)
	hub.Register(client)

	// Start goroutines for handling client
	go client.writePump()
	go client.readPump()
}

// readPump pumps messages from the websocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.Hub.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var message models.Message
		err := c.Conn.ReadJSON(&message)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger.Errorf("WebSocket error: %v", err)
			}
			break
		}

		// Set sender information
		message.Sender = c.User.Username
		message.SenderID = c.User.ID
		message.Timestamp = time.Now()

		// Handle different message types
		switch message.Type {
		case models.MessageTypeText:
			if message.Room != "" {
				// Group message
				c.Hub.Broadcast(&message)
			} else if message.Recipient != "" {
				// Private message
				message.Type = models.MessageTypePrivate
				c.Hub.SendToUser(message.Recipient, &message)
				// Also send back to sender for confirmation
				c.Send <- &message
			}
		case "join_room":
			c.Hub.JoinRoom(c, message.Content)
		case "leave_room":
			c.Hub.LeaveRoom(c, message.Content)
		}
	}
}

// writePump pumps messages from the hub to the websocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteJSON(message); err != nil {
				logger.Errorf("WebSocket write error: %v", err)
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// SendMessage sends a message to the client
func (c *Client) SendMessage(message *models.Message) {
	select {
	case c.Send <- message:
	default:
		close(c.Send)
	}
}
