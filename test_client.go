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
	if len(os.Args) < 3 {
		fmt.Println("Usage: go run test_client.go <username> <user_id>")
		return
	}

	username := os.Args[1]
	userID := os.Args[2]

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)

	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/api/ws"}
	q := u.Query()
	q.Set("username", username)
	q.Set("user_id", userID)
	u.RawQuery = q.Encode()

	fmt.Printf("Connecting to %s as %s\n", u.String(), username)

	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer c.Close()

	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			var msg Message
			err := c.ReadJSON(&msg)
			if err != nil {
				log.Println("read:", err)
				return
			}
			fmt.Printf("[%s] %s: %s\n", msg.Type, msg.Sender, msg.Content)
		}
	}()

	// Join general room
	joinMsg := Message{
		Type:    "join_room",
		Content: "general",
	}
	c.WriteJSON(joinMsg)

	// Send a test message after 2 seconds
	time.Sleep(2 * time.Second)
	testMsg := Message{
		Type:    "text",
		Content: fmt.Sprintf("Hello from %s!", username),
		Room:    "general",
	}
	c.WriteJSON(testMsg)

	for {
		select {
		case <-done:
			return
		case <-interrupt:
			log.Println("interrupt")
			err := c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			if err != nil {
				log.Println("write close:", err)
				return
			}
			select {
			case <-done:
			case <-time.After(time.Second):
			}
			return
		}
	}
}

