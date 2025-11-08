package models

import (
	"time"
)

// MessageType represents different types of messages
type MessageType string

const (
	MessageTypeText     MessageType = "text"
	MessageTypeJoin     MessageType = "join"
	MessageTypeLeave    MessageType = "leave"
	MessageTypeSystem   MessageType = "system"
	MessageTypePrivate  MessageType = "private"
)

// Message represents a chat message
type Message struct {
	ID        string      `json:"id"`
	Type      MessageType `json:"type"`
	Content   string      `json:"content"`
	Sender    string      `json:"sender"`
	SenderID  string      `json:"sender_id"`
	Recipient string      `json:"recipient,omitempty"` // For private messages
	Room      string      `json:"room,omitempty"`      // For group messages
	Timestamp time.Time   `json:"timestamp"`
}

// User represents a connected user
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Room     string `json:"room,omitempty"`
}

// Room represents a chat room
type Room struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Users       map[string]*User   `json:"users"`
	Messages    []*Message         `json:"messages"`
	CreatedAt   time.Time          `json:"created_at"`
}

// NewRoom creates a new room
func NewRoom(id, name string) *Room {
	return &Room{
		ID:        id,
		Name:      name,
		Users:     make(map[string]*User),
		Messages:  make([]*Message, 0),
		CreatedAt: time.Now(),
	}
}

// AddUser adds a user to the room
func (r *Room) AddUser(user *User) {
	r.Users[user.ID] = user
}

// RemoveUser removes a user from the room
func (r *Room) RemoveUser(userID string) {
	delete(r.Users, userID)
}

// AddMessage adds a message to the room
func (r *Room) AddMessage(message *Message) {
	r.Messages = append(r.Messages, message)
	
	// Keep only last 100 messages to prevent memory issues
	if len(r.Messages) > 100 {
		r.Messages = r.Messages[1:]
	}
}

