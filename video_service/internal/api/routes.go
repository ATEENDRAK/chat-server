package api

import (
	"chatstreamapp/video_service/internal/hub"
	"chatstreamapp/video_service/internal/logger"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// signaling request structure
type SignalPayload struct {
	From string          `json:"from"`
	To   string          `json:"to"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func SetupRoutes(r *gin.Engine, h *hub.Hub) {
	r.GET("/ws", func(c *gin.Context) {
		id := c.Query("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			logger.Errorf("websocket upgrade error: %v", err)
			return
		}

		client := &hub.Client{Conn: conn, Send: make(chan []byte, 256), ID: id}
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
					logger.Errorf("read error: %v", err)
					break
				}
				var payload SignalPayload
				if err := json.Unmarshal(msg, &payload); err != nil {
					logger.Errorf("invalid payload: %v", err)
					continue
				}
				// forward to target
				logger.Infof("Received signaling message: from=%s to=%s type=%s", payload.From, payload.To, payload.Type)
				h.Broadcast <- hub.Message{From: payload.From, To: payload.To, Type: payload.Type, Data: payload.Data}
			}
		}()

		// write loop
		go func() {
			for data := range client.Send {
				if err := client.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
					logger.Errorf("write error: %v", err)
					break
				}
			}
		}()
	})

	// health
	r.GET("/healthz", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok"}) })
}
