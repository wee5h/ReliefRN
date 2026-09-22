package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testClient(t *testing.T, handler http.HandlerFunc) *femaClient {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)
	return &femaClient{http: upstream.Client(), endpoint: upstream.URL + "/api/open/v2/DisasterDeclarationsSummaries"}
}

func TestSearchFiltersPaginationAndUnknownValues(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		filter := q.Get("$filter")
		for _, want := range []string{
			"state eq 'IA'", "substringof('O''Brien',designatedArea)",
			"declarationDate ge '2024-02-01T00:00:00Z'",
			"declarationDate lt '2024-03-01T00:00:00Z'",
			"(ihProgramDeclared eq true or iaProgramDeclared eq true)",
		} {
			if !strings.Contains(filter, want) {
				t.Errorf("filter %q does not contain %q", filter, want)
			}
		}
		if q.Get("$top") != "2" || q.Get("$skip") != "5" || !strings.Contains(q.Get("$orderby"), "id asc") {
			t.Errorf("incorrect bounded pagination: %v", q)
		}
		if r.Header.Get("X-API-Key") != "" || r.Header.Get("Authorization") != "" {
			t.Error("credentials must not reach OpenFEMA")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"DisasterDeclarationsSummaries":[
			{"id":"one","disasterNumber":1,"state":"IA","designatedArea":"O'Brien (County)","ihProgramDeclared":true,"iaProgramDeclared":false,"paProgramDeclared":null},
			{"id":"two","disasterNumber":1,"state":"IA"}]}`))
	})
	page, err := c.search(context.Background(), searchArgs{
		State: " ia ", Area: "O'Brien", DeclaredAfter: "2024-02-01", DeclaredBefore: "2024-02-29",
		IndividualAssistanceOnly: true, Limit: 1, Offset: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.RecordsReturned != 1 || !page.HasMore || page.NextOffset != 6 {
		t.Fatalf("unexpected page: %+v", page)
	}
	row := page.Records[0]
	if row.PublicAssistance != nil || row.HazardMitigation != nil || row.IndividualAssistance == nil || *row.IndividualAssistance {
		t.Fatalf("missing/null program flags were confused with false: %+v", row)
	}
	if row.DisasterURL != "https://www.fema.gov/disaster/1" || page.SourceURL == "" || page.RetrievedAt == "" {
		t.Fatal("missing provenance")
	}
}

func TestBadInputDoesNotContactFEMA(t *testing.T) {
	c := testClient(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected external request") })
	for _, a := range []searchArgs{
		{}, {State: "Virginia"}, {State: "ZZ"}, {State: "VA", Limit: 101},
		{State: "VA", Offset: -1}, {State: "VA", DeclarationType: "XX"},
		{State: "VA", DeclaredAfter: "2024-02-30"},
		{State: "VA", DeclaredAfter: "2025-01-01", DeclaredBefore: "2024-01-01"},
		{State: "VA", Area: strings.Repeat("x", 101)}, {State: "VA", Area: "county\nname"},
	} {
		if _, err := c.search(context.Background(), a); err == nil {
			t.Errorf("accepted invalid input: %+v", a)
		}
	}
	if _, err := c.details(context.Background(), detailsArgs{}); err == nil {
		t.Error("accepted missing disaster number")
	}
}

func TestUpstreamFailureIsNotEmptySuccess(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"forbidden", 403, "Access denied"},
		{"malformed", 200, "<html>upstream error</html>"},
		{"wrong shape", 200, `{"message":"error"}`},
		{"null dataset", 200, `{"DisasterDeclarationsSummaries":null}`},
		{"incomplete row", 200, `{"DisasterDeclarationsSummaries":[{"state":"VA"}]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			})
			if _, err := c.search(context.Background(), searchArgs{State: "VA"}); err == nil {
				t.Fatal("upstream failure was treated as success")
			}
		})
	}
}

func TestDetailsLastPage(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("$filter"); got != "disasterNumber eq 4827 and state eq 'NC' and substringof('Buncombe',designatedArea)" {
			t.Errorf("wrong detail filter: %s", got)
		}
		w.Write([]byte(`{"DisasterDeclarationsSummaries":[{"id":"x","state":"NC","disasterNumber":4827}]}`))
	})
	page, err := c.details(context.Background(), detailsArgs{DisasterNumber: 4827, State: "NC", Area: "Buncombe", Limit: 1})
	if err != nil || page.HasMore || page.NextOffset != 0 || len(page.Records) != 1 {
		t.Fatalf("unexpected last page: %+v, %v", page, err)
	}
}

func TestEmptyRecordsRemainJSONArray(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"DisasterDeclarationsSummaries":[]}`))
	})
	page, err := c.search(context.Background(), searchArgs{State: "VA"})
	if err != nil || page.HasMore || page.RecordsReturned != 0 {
		t.Fatalf("unexpected empty result: %+v, %v", page, err)
	}
	data, _ := json.Marshal(page)
	if !strings.Contains(string(data), `"records":[]`) {
		t.Fatal("empty results must serialize as an array")
	}
}

func TestRetryAndCancellation(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(429)
			return
		}
		w.Write([]byte(`{"DisasterDeclarationsSummaries":[]}`))
	})
	if _, err := c.search(context.Background(), searchArgs{State: "VA"}); err != nil || calls.Load() != 2 {
		t.Fatalf("transient failure was not recovered: %v, calls=%d", err, calls.Load())
	}

	c = testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "1")
		w.WriteHeader(503)
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := c.search(ctx, searchArgs{State: "VA"}); err == nil || time.Since(start) > time.Second {
		t.Fatalf("cancellation did not stop retry promptly: %v", err)
	}
}

func TestLongRetryAfterDoesNotRetryEarly(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(429)
	})
	if _, err := c.search(context.Background(), searchArgs{State: "VA"}); err == nil || calls.Load() != 1 {
		t.Fatalf("long Retry-After was ignored: %v, calls=%d", err, calls.Load())
	}
}
