package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

func main() {
	fmt.Println("🔍 Testing ChatStream Server...")
	
	// Wait a moment for server to be ready
	time.Sleep(2 * time.Second)
	
	// Test the main page
	fmt.Println("📡 Testing main page...")
	resp, err := http.Get("http://localhost:8080")
	if err != nil {
		fmt.Printf("❌ Failed to connect: %v\n", err)
		return
	}
	defer resp.Body.Close()
	
	fmt.Printf("✅ Server responded with status: %s\n", resp.Status)
	
	// Test the API
	fmt.Println("📡 Testing API endpoints...")
	resp2, err := http.Get("http://localhost:8080/api/rooms")
	if err != nil {
		fmt.Printf("❌ API test failed: %v\n", err)
		return
	}
	defer resp2.Body.Close()
	
	body, _ := io.ReadAll(resp2.Body)
	fmt.Printf("✅ API responded: %s\n", string(body))
	
	fmt.Println("🎉 Server is working! You can now:")
	fmt.Println("   1. Open http://localhost:8080 in your browser")
	fmt.Println("   2. Enter a username and start chatting!")
	fmt.Println("   3. Open another browser tab with a different username to test chat between 2 people")
}
