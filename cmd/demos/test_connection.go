package main

import (
	"fmt"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	fmt.Println("🔍 Testing WebSocket connection...")
	
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/api/ws"}
	q := u.Query()
	q.Set("username", "TestUser")
	q.Set("user_id", "test123")
	u.RawQuery = q.Encode()

	fmt.Printf("📡 Connecting to: %s\n", u.String())

	conn, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		fmt.Printf("❌ Connection failed: %v\n", err)
		if resp != nil {
			fmt.Printf("📄 Response status: %s\n", resp.Status)
		}
		return
	}
	defer conn.Close()

	fmt.Println("✅ Connected successfully!")

	// Listen for messages
	go func() {
		for {
			messageType, message, err := conn.ReadMessage()
			if err != nil {
				fmt.Printf("❌ Read error: %v\n", err)
				return
			}
			fmt.Printf("📨 Received (type %d): %s\n", messageType, string(message))
		}
	}()

	// Send a test message
	time.Sleep(1 * time.Second)
	testMsg := `{"type":"join_room","content":"general"}`
	err = conn.WriteMessage(websocket.TextMessage, []byte(testMsg))
	if err != nil {
		fmt.Printf("❌ Write error: %v\n", err)
		return
	}
	fmt.Printf("📤 Sent: %s\n", testMsg)

	// Wait for responses
	time.Sleep(3 * time.Second)
	
	// Send a chat message
	chatMsg := `{"type":"text","content":"Hello from test client!","room":"general"}`
	err = conn.WriteMessage(websocket.TextMessage, []byte(chatMsg))
	if err != nil {
		fmt.Printf("❌ Write error: %v\n", err)
		return
	}
	fmt.Printf("📤 Sent: %s\n", chatMsg)

	// Wait a bit more
	time.Sleep(2 * time.Second)
	fmt.Println("✅ Test completed!")
}
