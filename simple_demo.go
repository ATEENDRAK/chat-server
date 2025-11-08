package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Message struct {
	Type      string `json:"type"`
	Content   string `json:"content"`
	Sender    string `json:"sender"`
	SenderID  string `json:"sender_id"`
	Recipient string `json:"recipient,omitempty"`
	Room      string `json:"room,omitempty"`
}

func main() {
	fmt.Println("🚀 ChatStream Demo - Two Person Chat")
	fmt.Println("=====================================")
	
	var wg sync.WaitGroup
	wg.Add(2)

	// Start Alice
	go func() {
		defer wg.Done()
		runClient("Alice", "user1", []string{
			"Hi everyone! 👋",
			"How is everyone today?",
			"This chat app works great!",
		})
	}()

	// Start Bob (with a small delay)
	go func() {
		defer wg.Done()
		time.Sleep(2 * time.Second)
		runClient("Bob", "user2", []string{
			"Hey Alice! 🙋‍♂️",
			"I'm doing well, thanks!",
			"Yes, the real-time messaging is smooth!",
		})
	}()

	// Wait for both clients to finish
	wg.Wait()
	fmt.Println("\n✅ Demo completed successfully!")
	fmt.Println("🌐 You can also visit http://localhost:8080 to try the web interface!")
}

func runClient(username, userID string, messages []string) {
	// Connect to WebSocket
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/api/ws"}
	q := u.Query()
	q.Set("username", username)
	q.Set("user_id", userID)
	u.RawQuery = q.Encode()

	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Printf("❌ %s connection failed: %v", username, err)
		return
	}
	defer conn.Close()

	fmt.Printf("✅ %s connected\n", username)

	// Listen for incoming messages
	go func() {
		for {
			var msg Message
			err := conn.ReadJSON(&msg)
			if err != nil {
				return
			}
			
			// Only show messages from others
			if msg.Sender != username && msg.Type == "text" {
				fmt.Printf("💬 %s received: \"%s\" from %s\n", username, msg.Content, msg.Sender)
			}
		}
	}()

	// Join the general room
	joinMsg := Message{
		Type:    "join_room",
		Content: "general",
	}
	conn.WriteJSON(joinMsg)
	time.Sleep(500 * time.Millisecond)

	// Send messages with delays
	for i, content := range messages {
		time.Sleep(time.Duration(2+i) * time.Second)
		
		msg := Message{
			Type:    "text",
			Content: content,
			Room:    "general",
		}
		
		err := conn.WriteJSON(msg)
		if err != nil {
			log.Printf("❌ %s failed to send message: %v", username, err)
			return
		}
		
		fmt.Printf("📤 %s sent: \"%s\"\n", username, content)
	}

	// Keep connection alive for a bit to receive any remaining messages
	time.Sleep(5 * time.Second)
}
