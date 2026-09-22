// ReliefRN's MCP server exposes a small, read-only slice of OpenFEMA.
package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const version = "1.0.0"

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	key := os.Getenv("MCP_API_KEY")
	if len(key) < 32 || strings.ContainsAny(key, "\r\n\t ") {
		return errors.New("MCP_API_KEY must contain at least 32 characters and no whitespace")
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("PORT must be an integer between 1 and 65535")
	}

	client := newFEMAClient()
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           newHTTPHandler(key, client),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       35 * time.Second,
		WriteTimeout:      40 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errs := make(chan error, 1)
	go func() { errs <- server.ListenAndServe() }()
	slog.Info("MCP server listening", "port", port, "version", version)
	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func newHTTPHandler(key string, client *femaClient) http.Handler {
	agentTools := newMCPServer(client)
	// Stateless requests work across replicas and restarts; no sticky sessions.
	// JSON responses are a supported form of the Streamable HTTP transport.
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return agentTools
	}, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	want := sha256.Sum256([]byte(key))
	protected := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		// This endpoint is for server-to-server calls. Browser origins are not
		// trusted; a citizen-facing frontend should call its own backend.
		if r.Header.Get("Origin") != "" {
			http.Error(w, "browser origins are not supported", http.StatusForbidden)
			return
		}
		got := sha256.Sum256([]byte(r.Header.Get("X-API-Key")))
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			http.Error(w, "missing or invalid X-API-Key", http.StatusUnauthorized)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
		mcpHandler.ServeHTTP(w, r)
	})
	mux := http.NewServeMux()
	mux.Handle("/mcp", protected)
	mux.Handle("/mcp/", protected)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok"}`)
	})
	return mux
}
