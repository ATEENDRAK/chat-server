package main

import (
	"chatstreamapp/internal/api"
	"chatstreamapp/internal/hub"
	"chatstreamapp/internal/logger"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ Server panicked: %v\n", r)
		}
	}()
	
	fmt.Println("🚀 Starting ChatStream Server...")
	
	// Initialize the WebSocket hub
	chatHub := hub.NewHub()
	go chatHub.Run()
	fmt.Println("✅ WebSocket hub initialized")

	// Setup Gin router
	router := gin.Default()
	fmt.Println("✅ Gin router initialized")
	
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
	fmt.Println("🌐 Server starting on http://localhost:8080")
	fmt.Println("🎯 Ready for connections!")
	fmt.Println("📱 Open http://localhost:8080 in your browser to start chatting")
	fmt.Println("⏹️  Press Ctrl+C to stop the server")
	
	logger.Info("Chat server starting on :8080")
	logger.Info("Server ready to accept connections...")
	if err := http.ListenAndServe(":8080", router); err != nil {
		fmt.Printf("❌ Server failed to start: %v\n", err)
		logger.Errorf("Server failed to start: %v", err)
	}
	fmt.Println("👋 Server stopped")
	logger.Info("Server stopped")
}
