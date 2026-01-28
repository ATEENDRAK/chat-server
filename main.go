package main

import (
	"chatstreamapp/internal/api"
	"chatstreamapp/internal/hub"
	"chatstreamapp/internal/logger"
	"chatstreamapp/internal/videoservice"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ Server panicked: %v\n", r)
		}
	}()

	fmt.Println("🚀 Starting ChatStream Server...")

	// Get ports from environment or use defaults
	chatPort := os.Getenv("CHAT_PORT")
	if chatPort == "" {
		chatPort = "8080"
	}
	videoPort := os.Getenv("VIDEO_PORT")
	if videoPort == "" {
		videoPort = "9090"
	}

	// Initialize the Chat WebSocket hub
	chatHub := hub.NewHub()
	go chatHub.Run()
	fmt.Println("✅ Chat WebSocket hub initialized")

	// Initialize the Video Signaling hub
	videoHub := videoservice.NewHub()
	go videoHub.Run()
	fmt.Println("✅ Video Signaling hub initialized")

	// Setup Gin router
	router := gin.Default()
	fmt.Println("✅ Gin router initialized")

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

	// Initialize Chat API routes
	api.SetupRoutes(router, chatHub)

	// Initialize Video Service routes under /video prefix
	videoGroup := router.Group("/video")
	videoservice.SetupRoutes(videoGroup, videoHub)

	// Health check endpoint
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
			"services": gin.H{
				"chat":  "running",
				"video": "running",
			},
		})
	})

	// Print startup info
	fmt.Println("")
	fmt.Println("┌─────────────────────────────────────────────────────┐")
	fmt.Println("│  🎉 ChatStream is running!                          │")
	fmt.Println("│                                                     │")
	fmt.Printf("│  💬 Chat + Video: http://localhost:%-17s│\n", chatPort)
	fmt.Println("│                                                     │")
	fmt.Println("│  Endpoints:                                         │")
	fmt.Println("│    /           - Web UI                             │")
	fmt.Println("│    /api/ws     - Chat WebSocket                     │")
	fmt.Println("│    /video/ws   - Video Signaling WebSocket          │")
	fmt.Println("│    /healthz    - Health Check                       │")
	fmt.Println("│                                                     │")
	fmt.Println("│  📱 Open the URL above in your browser              │")
	fmt.Println("│  ⏹️  Press Ctrl+C to stop the server                 │")
	fmt.Println("└─────────────────────────────────────────────────────┘")
	fmt.Println("")

	logger.Infof("Chat server starting on :%s", chatPort)
	logger.Info("Server ready to accept connections...")

	if err := http.ListenAndServe(":"+chatPort, router); err != nil {
		fmt.Printf("❌ Server failed to start: %v\n", err)
		logger.Errorf("Server failed to start: %v", err)
	}
	fmt.Println("👋 Server stopped")
	logger.Info("Server stopped")
}
