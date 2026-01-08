package main

import (
	"chatstreamapp/video_service/internal/api"
	"chatstreamapp/video_service/internal/hub"
	"chatstreamapp/video_service/internal/logger"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ Video service panicked: %v\n", r)
		}
	}()

	fmt.Println("🚀 Starting Video Service...")

	// Initialize the signaling hub
	sigHub := hub.NewHub()
	go sigHub.Run()
	fmt.Println("✅ Signaling hub initialized")

	// Setup Gin router
	router := gin.Default()
	fmt.Println("✅ Gin router initialized")

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

	// Serve static files (simple web UI for testing)
	router.Static("/static", "./web/static")
	router.StaticFile("/", "./web/index.html")

	// Initialize API routes
	api.SetupRoutes(router, sigHub)

	// Start server
	fmt.Println("🌐 Video service starting on http://localhost:9090")
	logger.Info("Video service starting on :9090")
	if err := http.ListenAndServe(":9090", router); err != nil {
		fmt.Printf("❌ Video service failed to start: %v\n", err)
		logger.Errorf("Video service failed to start: %v", err)
	}
	fmt.Println("👋 Video service stopped")
}
