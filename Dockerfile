# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o chatstream .

# Final stage
FROM alpine:latest

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/chatstream .

# Copy web assets
COPY --from=builder /app/web ./web

# Expose port (Cloud Run uses PORT env variable)
EXPOSE 8080

# Set default environment variables
ENV CHAT_PORT=8080
ENV GIN_MODE=release

# Run the application
CMD ["./chatstream"]