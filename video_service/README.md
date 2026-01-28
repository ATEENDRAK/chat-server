Video Service microservice (signaling) for peer-to-peer WebRTC calls.

- HTTP + WebSocket signaling using Gin + Gorilla WebSocket
- Simple web UI in /web for testing
- Run with `go run ./...` from the video_service folder

Design notes:
- This is intentionally packaged under video_service so it can be split out into a separate repo later
- Signaling only: browsers exchange SDP and ICE through the WS hub
