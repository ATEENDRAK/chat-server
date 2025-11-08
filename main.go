package main

import (
	"chatstreamapp/internal/api"
	"chatstreamapp/internal/hub"
	"chatstreamapp/internal/logger"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize the WebSocket hub
	chatHub := hub.NewHub()
	go chatHub.Run()

	// Setup Gin router
	router := gin.Default()
	
	// Add debug output
	logger.Info("Initializing chat server...")
	logger.Info("Setting up routes...")

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

	// Serve static files
	router.Static("/static", "./web/static")
	router.StaticFile("/", "./web/index.html")

	// Initialize API routes
	api.SetupRoutes(router, chatHub)

	// Start server
	logger.Info("Chat server starting on :8080")
	logger.Info("Server ready to accept connections...")
	if err := http.ListenAndServe(":8080", router); err != nil {
		logger.Errorf("Server failed to start: %v", err)
	}
	logger.Info("Server stopped")
}
