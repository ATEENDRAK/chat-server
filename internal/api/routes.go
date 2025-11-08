package api

import (
	"chatstreamapp/internal/client"
	"chatstreamapp/internal/models"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Hub interface for API handlers
type Hub interface {
	Register(client *client.Client)
	Unregister(client *client.Client)
	Broadcast(message *models.Message)
	SendToUser(userID string, message *models.Message)
	JoinRoom(client *client.Client, roomID string)
	LeaveRoom(client *client.Client, roomID string)
	GetRooms() map[string]*models.Room
	GetUsers() map[string]*client.Client
	CreateRoom(name string) *models.Room
}

// SetupRoutes configures all API routes
func SetupRoutes(router *gin.Engine, hub Hub) {
	api := router.Group("/api")
	{
		// WebSocket endpoint
		api.GET("/ws", func(c *gin.Context) {
			client.ServeWS(hub, c.Writer, c.Request)
		})

		// REST endpoints
		api.GET("/rooms", getRooms(hub))
		api.POST("/rooms", createRoom(hub))
		api.GET("/rooms/:id/messages", getRoomMessages(hub))
		api.GET("/users", getUsers(hub))
		api.POST("/messages", sendMessage(hub))
	}
}

// getRooms returns all available rooms
func getRooms(hub Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		rooms := hub.GetRooms()
		
		// Convert to response format
		response := make([]gin.H, 0, len(rooms))
		for _, room := range rooms {
			response = append(response, gin.H{
				"id":         room.ID,
				"name":       room.Name,
				"user_count": len(room.Users),
				"created_at": room.CreatedAt,
			})
		}
		
		c.JSON(http.StatusOK, gin.H{
			"rooms": response,
		})
	}
}

// createRoom creates a new chat room
func createRoom(hub Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name string `json:"name" binding:"required"`
		}
		
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Room name is required",
			})
			return
		}
		
		room := hub.CreateRoom(req.Name)
		
		c.JSON(http.StatusCreated, gin.H{
			"room": gin.H{
				"id":         room.ID,
				"name":       room.Name,
				"user_count": 0,
				"created_at": room.CreatedAt,
			},
		})
	}
}

// getRoomMessages returns messages for a specific room
func getRoomMessages(hub Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("id")
		
		rooms := hub.GetRooms()
		room, exists := rooms[roomID]
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Room not found",
			})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"messages": room.Messages,
		})
	}
}

// getUsers returns all connected users
func getUsers(hub Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		users := hub.GetUsers()
		
		// Convert to response format
		response := make([]gin.H, 0, len(users))
		for _, client := range users {
			user := client.GetUser()
			response = append(response, gin.H{
				"id":       user.ID,
				"username": user.Username,
				"room":     user.Room,
			})
		}
		
		c.JSON(http.StatusOK, gin.H{
			"users": response,
		})
	}
}

// sendMessage sends a message via REST API (alternative to WebSocket)
func sendMessage(hub Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Type      string `json:"type" binding:"required"`
			Content   string `json:"content" binding:"required"`
			Sender    string `json:"sender" binding:"required"`
			SenderID  string `json:"sender_id" binding:"required"`
			Room      string `json:"room,omitempty"`
			Recipient string `json:"recipient,omitempty"`
		}
		
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid message format",
			})
			return
		}
		
		message := &models.Message{
			ID:        uuid.New().String(),
			Type:      models.MessageType(req.Type),
			Content:   req.Content,
			Sender:    req.Sender,
			SenderID:  req.SenderID,
			Room:      req.Room,
			Recipient: req.Recipient,
			Timestamp: time.Now(),
		}
		
		if req.Room != "" {
			// Group message
			hub.Broadcast(message)
		} else if req.Recipient != "" {
			// Private message
			message.Type = models.MessageTypePrivate
			hub.SendToUser(req.Recipient, message)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Either room or recipient must be specified",
			})
			return
		}
		
		c.JSON(http.StatusOK, gin.H{
			"message": "Message sent successfully",
			"id":      message.ID,
		})
	}
}
