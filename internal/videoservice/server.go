package videoservice

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Message types for signaling
const (
	OfferMsg  = "offer"
	AnswerMsg = "answer"
	IceMsg    = "ice"
	JoinMsg   = "join"
)

// Client represents a single WebSocket connection for signaling
type Client struct {
	Conn *websocket.Conn
	Send chan []byte
	ID   string
}

// Hub maintains active clients and broadcasts messages
type Hub struct {
	clients    map[string]*Client
	mu         sync.RWMutex
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan Message
}

// Message is a simple signaling message wrapper
type Message struct {
	From string          `json:"from"`
	To   string          `json:"to"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// SignalPayload is the request structure for signaling
type SignalPayload struct {
	From string          `json:"from"`
	To   string          `json:"to"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan Message),
	}
}

func (h *Hub) getClientIDs() []string {
	ids := make([]string, 0, len(h.clients))
	for id := range h.clients {
		ids = append(ids, id)
	}
	return ids
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.clients[client.ID] = client
			fmt.Printf("[video-service] Client registered: %s (total clients: %d)\n", client.ID, len(h.clients))
			h.mu.Unlock()
		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
				fmt.Printf("[video-service] Client unregistered: %s (remaining clients: %d)\n", client.ID, len(h.clients))
			}
			h.mu.Unlock()
		case msg := <-h.Broadcast:
			h.mu.RLock()
			if to, ok := h.clients[msg.To]; ok {
				fmt.Printf("[video-service] Forwarding signaling message: from=%s to=%s type=%s\n", msg.From, msg.To, msg.Type)
				fullMsg := map[string]interface{}{
					"from": msg.From,
					"to":   msg.To,
					"type": msg.Type,
					"data": msg.Data,
				}
				msgBytes, err := json.Marshal(fullMsg)
				if err != nil {
					fmt.Printf("[video-service] ERROR: Failed to marshal message: %v\n", err)
					h.mu.RUnlock()
					continue
				}
				select {
				case to.Send <- msgBytes:
					fmt.Printf("[video-service] Message sent successfully to client: %s\n", msg.To)
				default:
					fmt.Printf("[video-service] ERROR: Client %s send channel full, dropping message\n", msg.To)
				}
			} else {
				fmt.Printf("[video-service] ERROR: Target client not found: %s (available clients: %v)\n", msg.To, h.getClientIDs())
			}
			h.mu.RUnlock()
		}
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// SetupRoutes configures video service routes on the given router group
func SetupRoutes(group *gin.RouterGroup, h *Hub) {
	group.GET("/ws", func(c *gin.Context) {
		id := c.Query("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			fmt.Printf("[video-service] ERROR: websocket upgrade error: %v\n", err)
			return
		}

		client := &Client{Conn: conn, Send: make(chan []byte, 256), ID: id}
		h.Register <- client

		// read loop
		go func() {
			defer func() {
				h.Unregister <- client
				client.Conn.Close()
			}()
			for {
				_, msg, err := client.Conn.ReadMessage()
				if err != nil {
					fmt.Printf("[video-service] ERROR: read error: %v\n", err)
					break
				}
				var payload SignalPayload
				if err := json.Unmarshal(msg, &payload); err != nil {
					fmt.Printf("[video-service] ERROR: invalid payload: %v\n", err)
					continue
				}
				fmt.Printf("[video-service] Received signaling message: from=%s to=%s type=%s\n", payload.From, payload.To, payload.Type)
				h.Broadcast <- Message{From: payload.From, To: payload.To, Type: payload.Type, Data: payload.Data}
			}
		}()

		// write loop
		go func() {
			for data := range client.Send {
				if err := client.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
					fmt.Printf("[video-service] ERROR: write error: %v\n", err)
					break
				}
			}
		}()
	})

	// health check
	group.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "video"})
	})
}

// StartServer starts the video service as a standalone server (for backward compatibility)
func StartServer(port string) error {
	hub := NewHub()
	go hub.Run()

	router := gin.Default()
	
	// CORS middleware
	router.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Setup routes at root level for standalone mode
	group := router.Group("")
	SetupRoutes(group, hub)

	fmt.Printf("🌐 Video service starting on http://localhost:%s\n", port)
	return http.ListenAndServe(":"+port, router)
}
