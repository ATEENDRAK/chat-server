# ChatStream - Real-time Chat Application

A scalable real-time chat application built with Go, WebSockets, and a modern web interface. Supports both group chatting and person-to-person messaging.

## Features

- **Real-time messaging** using WebSockets
- **Group chat rooms** with multiple users
- **Private messaging** between users
- **Room management** (create, join, leave rooms)
- **User presence** tracking
- **Message history** (in-memory storage)
- **Modern web interface** with responsive design
- **RESTful API** for chat operations
- **Concurrent connection handling** using Go goroutines

## Architecture

### Backend (Go)
- **WebSocket Hub**: Manages client connections and message routing
- **Room-based System**: Supports multiple chat rooms
- **Client Manager**: Handles user sessions and presence
- **REST API**: Endpoints for room management and message history
- **Concurrent Design**: Efficient handling of multiple connections

### Frontend
- **Vanilla JavaScript**: No framework dependencies
- **WebSocket Client**: Real-time communication
- **Modern UI**: Clean and responsive design
- **Private Chat Modal**: Dedicated interface for direct messages

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chatstreamapp
   ```

2. **Install dependencies**
   ```bash
   go mod tidy
   ```

3. **Run the application**
   ```bash
   go run main.go
   ```

4. **Open your browser**
   Navigate to `http://localhost:8080`

## API Endpoints

### WebSocket
- `GET /api/ws?user_id={id}&username={name}` - WebSocket connection

### REST API
- `GET /api/rooms` - Get all rooms
- `POST /api/rooms` - Create a new room
- `GET /api/rooms/{id}/messages` - Get room message history
- `GET /api/users` - Get online users
- `POST /api/messages` - Send message via REST

## WebSocket Message Types

### Client to Server
```json
{
  "type": "text",
  "content": "Hello, world!",
  "room": "room-id"
}
```

```json
{
  "type": "text",
  "content": "Private message",
  "recipient": "user-id"
}
```

```json
{
  "type": "join_room",
  "content": "room-id"
}
```

### Server to Client
```json
{
  "id": "message-id",
  "type": "text",
  "content": "Hello, world!",
  "sender": "username",
  "sender_id": "user-id",
  "room": "room-id",
  "timestamp": "2023-01-01T12:00:00Z"
}
```

## Project Structure

```
chatstreamapp/
├── main.go                 # Application entry point
├── go.mod                  # Go module definition
├── internal/
│   ├── api/
│   │   └── routes.go      # REST API routes
│   ├── client/
│   │   ├── client.go      # Client interface
│   │   └── websocket_client.go # WebSocket client implementation
│   ├── hub/
│   │   └── hub.go         # WebSocket hub for connection management
│   └── models/
│       └── message.go     # Data models
└── web/
    ├── index.html         # Main HTML page
    └── static/
        ├── app.js         # Frontend JavaScript
        └── styles.css     # CSS styles
```

## Scaling Considerations

The current implementation is designed for horizontal scaling:

1. **Stateless Design**: All state is managed in memory per instance
2. **Database Integration**: Can be extended with persistent storage
3. **Load Balancing**: WebSocket sticky sessions required
4. **Message Queue**: Can integrate Redis/RabbitMQ for distributed messaging
5. **Microservices**: Components can be separated into different services

## Future Enhancements

- [ ] Database persistence (PostgreSQL/MongoDB)
- [ ] Redis for distributed caching
- [ ] User authentication and authorization
- [ ] File sharing and media messages
- [ ] Push notifications
- [ ] Message encryption
- [ ] Admin panel for room management
- [ ] Rate limiting and spam protection
- [ ] Docker containerization
- [ ] Kubernetes deployment

## Development

### Running in Development
```bash
# Install air for hot reloading (optional)
go install github.com/cosmtrek/air@latest

# Run with hot reload
air

# Or run normally
go run main.go
```

### Building for Production
```bash
# Build binary
go build -o chatstreamapp main.go

# Run binary
./chatstreamapp
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

