package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"time"

	"github.com/gorilla/websocket"
)

type Message struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Sender    string    `json:"sender"`
	SenderID  string    `json:"sender_id"`
	Recipient string    `json:"recipient,omitempty"`
	Room      string    `json:"room,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

func main() {
	fmt.Println("🚀 ChatStream Demo - Starting chat between Alice and Bob")
	fmt.Println("============================================================")

	// Start Alice
	go startClient("Alice", "user1")
	time.Sleep(1 * time.Second)

	// Start Bob
	go startClient("Bob", "user2")

	// Keep the demo running
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)

	fmt.Println("\n💬 Chat demo is running...")
	fmt.Println("📱 You can also open http://localhost:8080 in your browser to join the chat!")
	fmt.Println("⏹️  Press Ctrl+C to stop the demo")

	<-interrupt
	fmt.Println("\n👋 Demo stopped")
}

func startClient(username, userID string) {
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/api/ws"}
	q := u.Query()
	q.Set("username", username)
	q.Set("user_id", userID)
	u.RawQuery = q.Encode()

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Printf("❌ %s failed to connect: %v", username, err)
		return
	}
	defer c.Close()

	fmt.Printf("✅ %s connected to chat\n", username)

	// Listen for messages
	go func() {
		for {
			var msg Message
			err := c.ReadJSON(&msg)
			if err != nil {
				return
			}
			
			if msg.Type == "text" && msg.Sender != username {
				fmt.Printf("💬 %s received: \"%s\" from %s\n", username, msg.Content, msg.Sender)
			} else if msg.Type == "join" || msg.Type == "leave" {
				fmt.Printf("📢 %s saw: %s\n", username, msg.Content)
			} else if msg.Type == "system" && msg.Content != "Welcome to the chat!" {
				fmt.Printf("ℹ️  %s saw: %s\n", username, msg.Content)
			}
		}
	}()

	// Join general room
	joinMsg := Message{
		Type:    "join_room",
		Content: "general",
	}
	c.WriteJSON(joinMsg)
	time.Sleep(500 * time.Millisecond)

	// Send messages based on user
	if username == "Alice" {
		time.Sleep(2 * time.Second)
		
		messages := []string{
			"Hi everyone! Alice here 👋",
			"How is everyone doing today?",
			"This chat app is pretty cool!",
		}
		
		for i, content := range messages {
			time.Sleep(time.Duration(3+i*2) * time.Second)
			msg := Message{
				Type:    "text",
				Content: content,
				Room:    "general",
			}
			c.WriteJSON(msg)
			fmt.Printf("📤 %s sent: \"%s\"\n", username, content)
		}
		
		// Send a private message to Bob
		time.Sleep(5 * time.Second)
		privateMsg := Message{
			Type:      "text",
			Content:   "Hey Bob, want to chat privately? 😊",
			Recipient: "user2",
		}
		c.WriteJSON(privateMsg)
		fmt.Printf("🔒 %s sent private message to Bob\n", username)
		
	} else if username == "Bob" {
		time.Sleep(4 * time.Second)
		
		messages := []string{
			"Hey Alice! Bob here 🙋‍♂️",
			"I'm doing great, thanks for asking!",
			"Yeah, the real-time features work perfectly!",
		}
		
		for i, content := range messages {
			time.Sleep(time.Duration(2+i*2) * time.Second)
			msg := Message{
				Type:    "text",
				Content: content,
				Room:    "general",
			}
			c.WriteJSON(msg)
			fmt.Printf("📤 %s sent: \"%s\"\n", username, content)
		}
		
		// Reply to Alice's private message
		time.Sleep(3 * time.Second)
		privateReply := Message{
			Type:      "text",
			Content:   "Sure Alice! Private chats work great too! 🎉",
			Recipient: "user1",
		}
		c.WriteJSON(privateReply)
		fmt.Printf("🔒 %s replied privately to Alice\n", username)
	}

	// Keep connection alive
	for {
		time.Sleep(1 * time.Second)
	}
}
