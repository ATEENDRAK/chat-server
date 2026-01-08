package hub

import (
	"encoding/json"
	"sync"

	"chatstreamapp/video_service/internal/logger"

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
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"`
	Data []byte `json:"data"`
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan Message),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
		case msg := <-h.Broadcast:
			h.mu.RLock()
			if to, ok := h.clients[msg.To]; ok {
				// Add forwarding log here
				// Use logger.Infof from the logger package
				logger.Infof("Forwarding signaling message: from=%s to=%s type=%s", msg.From, msg.To, msg.Type)
				// Send the full message structure, not just the data
				fullMsg := map[string]interface{}{
					"from": msg.From,
					"to":   msg.To,
					"type": msg.Type,
					"data": json.RawMessage(msg.Data),
				}
				msgBytes, err := json.Marshal(fullMsg)
				if err != nil {
					logger.Errorf("Failed to marshal message: %v", err)
					h.mu.RUnlock()
					continue
				}
				select {
				case to.Send <- msgBytes:
				default:
					// drop if not ready
				}
			}
			h.mu.RUnlock()
		}
	}
}
