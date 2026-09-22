package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const testKey = "test-only-not-a-deployment-secret-1234567890"

func TestHTTPAuthenticationAndHealth(t *testing.T) {
	handler := newHTTPHandler(testKey, newFEMAClient())
	for _, tc := range []struct {
		path, method, key, origin string
		want                      int
	}{
		{"/healthz", "GET", "", "", 200},
		{"/mcp", "POST", "", "", 401},
		{"/mcp", "POST", "wrong", "", 401},
		{"/mcp", "POST", testKey, "https://untrusted.example", 403},
		{"/mcp", "GET", testKey, "", 405},
	} {
		r := httptest.NewRequest(tc.method, tc.path, nil)
		r.Header.Set("X-API-Key", tc.key)
		r.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%s %s: got %d, want %d: %s", tc.method, tc.path, w.Code, tc.want, w.Body.String())
		}
	}
}

// Exercise real HTTP + SDK serialization using the protocol versions commonly
// used by remote MCP clients. The upstream alone is a deterministic fixture.
func TestMCPLifecycleAndTools(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-API-Key") != "" {
			t.Error("MCP key was forwarded to FEMA")
		}
		w.Write([]byte(`{"DisasterDeclarationsSummaries":[{"id":"fixture","disasterNumber":4827,"state":"NC","designatedArea":"Buncombe (County)","ihProgramDeclared":true,"iaProgramDeclared":false}]}`))
	})
	server := httptest.NewServer(newHTTPHandler(testKey, c))
	defer server.Close()
	for _, protocol := range []string{"2025-03-26", "2025-06-18", "2025-11-25"} {
		t.Run(protocol, func(t *testing.T) {
			post := func(method string, params any, notification bool) map[string]any {
				t.Helper()
				message := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
				if !notification {
					message["id"] = 1
				}
				body, _ := json.Marshal(message)
				r, _ := http.NewRequest(http.MethodPost, server.URL+"/mcp", strings.NewReader(string(body)))
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Accept", "application/json, text/event-stream")
				r.Header.Set("MCP-Protocol-Version", protocol)
				r.Header.Set("X-API-Key", testKey)
				resp, err := server.Client().Do(r)
				if err != nil {
					t.Fatal(err)
				}
				defer resp.Body.Close()
				data, _ := io.ReadAll(resp.Body)
				if resp.Header.Get("Mcp-Session-Id") != "" {
					t.Fatal("stateless server must not require replica-local sessions")
				}
				if notification && resp.StatusCode == 202 {
					return nil
				}
				if resp.StatusCode != 200 {
					t.Fatalf("%s: HTTP %d: %s", method, resp.StatusCode, data)
				}
				var result map[string]any
				if err := json.Unmarshal(data, &result); err != nil {
					t.Fatalf("invalid MCP JSON: %s", data)
				}
				if result["error"] != nil {
					t.Fatalf("MCP error: %s", data)
				}
				return result["result"].(map[string]any)
			}
			post("initialize", map[string]any{
				"protocolVersion": protocol, "capabilities": map[string]any{},
				"clientInfo": map[string]string{"name": "test", "version": "1"},
			}, false)
			post("notifications/initialized", map[string]any{}, true)
			listed := post("tools/list", map[string]any{}, false)
			tools := listed["tools"].([]any)
			if len(tools) != 2 {
				t.Fatalf("expected two tools: %+v", tools)
			}
			for _, tool := range tools {
				encoded, _ := json.Marshal(tool.(map[string]any)["inputSchema"])
				if strings.Contains(string(encoded), `"anyOf"`) || strings.Contains(string(encoded), `"allOf"`) {
					t.Fatal("Foundry input schemas must not contain anyOf/allOf")
				}
			}
			for name, args := range map[string]any{
				"search_disasters":     map[string]any{"state": "NC", "area": "Buncombe"},
				"get_disaster_details": map[string]any{"disaster_number": 4827},
			} {
				result := post("tools/call", map[string]any{"name": name, "arguments": args}, false)
				if result["isError"] == true || result["structuredContent"] == nil || result["content"] == nil {
					t.Fatalf("tool failed or omitted JSON/text results: %+v", result)
				}
			}
			before := calls.Load()
			bad := post("tools/call", map[string]any{"name": "search_disasters", "arguments": map[string]any{}}, false)
			if bad["isError"] != true || before != calls.Load() {
				t.Fatal("missing required state must be rejected before a FEMA request")
			}
		})
	}
}

func TestToolUpstreamErrorUsesIsError(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) })
	server := httptest.NewServer(newHTTPHandler(testKey, c))
	defer server.Close()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_disasters","arguments":{"state":"VA"}}}`
	r, _ := http.NewRequest("POST", server.URL+"/mcp", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	r.Header.Set("MCP-Protocol-Version", "2025-06-18")
	r.Header.Set("X-API-Key", testKey)
	resp, err := server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var payload struct {
		Result struct {
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil || !payload.Result.IsError {
		t.Fatal(fmt.Sprintf("upstream failure did not become an MCP tool error: %+v, %v", payload, err))
	}
}
