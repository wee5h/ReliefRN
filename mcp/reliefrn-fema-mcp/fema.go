package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const femaEndpoint = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"

const selectedFields = "id,disasterNumber,femaDeclarationString,state,declarationType,declarationTitle,incidentType,declarationDate,incidentBeginDate,incidentEndDate,disasterCloseoutDate,designatedArea,fipsStateCode,fipsCountyCode,tribalRequest,ihProgramDeclared,iaProgramDeclared,paProgramDeclared,hmProgramDeclared,lastIAFilingDate,lastRefresh"

// Pointers preserve null/missing values as unknown instead of silently false.
type declaration struct {
	ID                    string  `json:"id"`
	DisasterNumber        int     `json:"disasterNumber"`
	DeclarationString     string  `json:"femaDeclarationString"`
	State                 string  `json:"state"`
	DeclarationType       string  `json:"declarationType"`
	Title                 string  `json:"declarationTitle"`
	IncidentType          string  `json:"incidentType"`
	DeclarationDate       string  `json:"declarationDate"`
	IncidentBeginDate     *string `json:"incidentBeginDate"`
	IncidentEndDate       *string `json:"incidentEndDate"`
	DisasterCloseoutDate  *string `json:"disasterCloseoutDate"`
	DesignatedArea        string  `json:"designatedArea"`
	FIPSStateCode         string  `json:"fipsStateCode"`
	FIPSCountyCode        string  `json:"fipsCountyCode"`
	TribalRequest         *bool   `json:"tribalRequest"`
	IndividualsHouseholds *bool   `json:"ihProgramDeclared"`
	IndividualAssistance  *bool   `json:"iaProgramDeclared"`
	PublicAssistance      *bool   `json:"paProgramDeclared"`
	HazardMitigation      *bool   `json:"hmProgramDeclared"`
	LastIAFilingDate      *string `json:"lastIAFilingDate"`
	LastRefresh           *string `json:"lastRefresh"`
	DisasterURL           string  `json:"disaster_url"`
}

type resultPage struct {
	Source               string        `json:"source"`
	SourceURL            string        `json:"source_url"`
	RetrievedAt          string        `json:"retrieved_at"`
	Records              []declaration `json:"records"`
	RecordsReturned      int           `json:"records_returned"`
	HasMore              bool          `json:"has_more"`
	NextOffset           int           `json:"next_offset,omitempty"`
	ApplicationPortalURL string        `json:"application_portal_url"`
	Interpretation       string        `json:"interpretation"`
}

type femaClient struct {
	http     *http.Client
	endpoint string // fixed in production; injectable only by Go tests
}

func newFEMAClient() *femaClient {
	return &femaClient{
		http: &http.Client{
			Timeout: 10 * time.Second,
			// Never follow redirects to a different host or dataset.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		endpoint: femaEndpoint,
	}
}

func (c *femaClient) search(ctx context.Context, a searchArgs) (*resultPage, error) {
	state, err := validateState(a.State, true)
	if err != nil {
		return nil, err
	}
	filters := []string{"state eq " + literal(state)}
	if err := addArea(&filters, a.Area); err != nil {
		return nil, err
	}
	incident := strings.TrimSpace(a.IncidentType)
	if incident != "" {
		if err := validateText(incident); err != nil {
			return nil, fmt.Errorf("incident_type: %w", err)
		}
		filters = append(filters, "incidentType eq "+literal(incident))
	}
	if kind := strings.ToUpper(strings.TrimSpace(a.DeclarationType)); kind != "" {
		if kind != "DR" && kind != "EM" && kind != "FM" {
			return nil, errors.New("declaration_type must be DR, EM, or FM")
		}
		filters = append(filters, "declarationType eq "+literal(kind))
	}
	after, err := dateBound(a.DeclaredAfter)
	if err != nil {
		return nil, fmt.Errorf("declared_after: %w", err)
	}
	before, err := dateBound(a.DeclaredBefore)
	if err != nil {
		return nil, fmt.Errorf("declared_before: %w", err)
	}
	if !after.IsZero() && !before.IsZero() && after.After(before) {
		return nil, errors.New("declared_after must not be later than declared_before")
	}
	if !after.IsZero() {
		filters = append(filters, "declarationDate ge "+literal(after.Format(time.RFC3339)))
	}
	if !before.IsZero() {
		// An exclusive next-day bound includes the entire requested last day.
		filters = append(filters, "declarationDate lt "+literal(before.AddDate(0, 0, 1).Format(time.RFC3339)))
	}
	if a.IndividualAssistanceOnly {
		// Many modern declarations have IH=true and IA=false. Testing only IA
		// would incorrectly hide records relevant to individual households.
		filters = append(filters, "(ihProgramDeclared eq true or iaProgramDeclared eq true)")
	}
	return c.query(ctx, filters, a.Limit, a.Offset)
}

func (c *femaClient) details(ctx context.Context, a detailsArgs) (*resultPage, error) {
	if a.DisasterNumber < 1 || a.DisasterNumber > 99999 {
		return nil, errors.New("disaster_number must be between 1 and 99999")
	}
	filters := []string{"disasterNumber eq " + strconv.Itoa(a.DisasterNumber)}
	state, err := validateState(a.State, false)
	if err != nil {
		return nil, err
	}
	if state != "" {
		filters = append(filters, "state eq "+literal(state))
	}
	if err := addArea(&filters, a.Area); err != nil {
		return nil, err
	}
	return c.query(ctx, filters, a.Limit, a.Offset)
}

func (c *femaClient) query(ctx context.Context, filters []string, limit, offset int) (*resultPage, error) {
	if limit == 0 {
		limit = 20
	}
	if limit < 1 || limit > 100 || offset < 0 || offset > 100000 {
		return nil, errors.New("limit must be 1..100 (or 0 for default); offset must be 0..100000")
	}
	u, err := url.Parse(c.endpoint)
	if err != nil {
		return nil, errors.New("invalid server-side FEMA endpoint configuration")
	}
	q := url.Values{
		"$filter":  {strings.Join(filters, " and ")},
		"$select":  {selectedFields},
		"$orderby": {"declarationDate desc,disasterNumber desc,id asc"},
		"$top":     {strconv.Itoa(limit + 1)}, // look ahead to detect another page
		"$skip":    {strconv.Itoa(offset)},
		"$format":  {"json"},
	}
	u.RawQuery = q.Encode()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	body, err := c.fetch(ctx, u.String())
	if err != nil {
		return nil, err
	}
	var payload struct {
		Records *[]declaration `json:"DisasterDeclarationsSummaries"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Records == nil {
		return nil, errors.New("OpenFEMA returned an unexpected response; availability of assistance is unknown")
	}
	rows := *payload.Records
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	for i := range rows {
		if rows[i].DisasterNumber < 1 || rows[i].State == "" || rows[i].ID == "" {
			return nil, errors.New("OpenFEMA returned an incomplete record; availability of assistance is unknown")
		}
		rows[i].DisasterURL = fmt.Sprintf("https://www.fema.gov/disaster/%d", rows[i].DisasterNumber)
	}
	page := &resultPage{
		Source:               "FEMA OpenFEMA — Disaster Declarations Summaries v2",
		SourceURL:            u.String(),
		RetrievedAt:          time.Now().UTC().Format(time.RFC3339),
		Records:              rows,
		RecordsReturned:      len(rows),
		HasMore:              more,
		ApplicationPortalURL: "https://www.disasterassistance.gov/",
		Interpretation:       "Each row is a designated area. Confirm the exact area and dates. IH/IA flags describe declared programs, not personal eligibility or an open application period. PA/HM flags are not promises of direct household payments. Null means unknown. lastIAFilingDate is the date recorded in this dataset; verify current deadlines on the official disaster page. No matches does not establish that no assistance exists; area and incident-type filters are case-sensitive. Data can change between pages.",
	}
	if more {
		page.NextOffset = offset + limit
	}
	return page, nil
}

func (c *femaClient) fetch(ctx context.Context, requestURL string) ([]byte, error) {
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return nil, errors.New("could not construct the OpenFEMA request")
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "ReliefRN-FEMA-MCP/"+version)
		// No inbound headers, API keys, or citizen identifiers are forwarded.
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, errors.New("OpenFEMA could not be reached; retry later. This does not mean no assistance exists")
		}
		if resp.StatusCode == http.StatusOK {
			const maxResponse = 2 << 20
			body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
			resp.Body.Close()
			if readErr != nil || len(body) > maxResponse {
				return nil, errors.New("OpenFEMA response was interrupted or too large; try a smaller page")
			}
			return body, nil
		}
		resp.Body.Close()
		retryable := resp.StatusCode == 429 || resp.StatusCode == 500 || resp.StatusCode == 502 || resp.StatusCode == 503 || resp.StatusCode == 504
		if !retryable || attempt == 2 {
			return nil, fmt.Errorf("OpenFEMA returned HTTP %d; data is unavailable, not evidence of no assistance", resp.StatusCode)
		}
		delay := time.Duration(attempt+1) * 250 * time.Millisecond
		if value := resp.Header.Get("Retry-After"); value != "" {
			if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
				if seconds > 3 {
					return nil, errors.New("OpenFEMA asked clients to wait; retry later. Availability of assistance is unknown")
				}
				delay = time.Duration(seconds) * time.Second
			} else if when, err := http.ParseTime(value); err == nil {
				delay = max(time.Until(when), 0)
			}
		}
		if delay > 3*time.Second {
			return nil, errors.New("OpenFEMA asked clients to wait; retry later. Availability of assistance is unknown")
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, errors.New("OpenFEMA request timed out or was cancelled")
		case <-timer.C:
		}
	}
	return nil, errors.New("OpenFEMA request failed")
}

func literal(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func validateState(s string, required bool) (string, error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" && !required {
		return s, nil
	}
	const states = " AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI FM MH PW "
	if len(s) != 2 || !strings.Contains(states, " "+s+" ") {
		return "", errors.New("state must be a two-letter US state or territory code, such as VA or NC")
	}
	return s, nil
}

func addArea(filters *[]string, area string) error {
	area = strings.TrimSpace(area)
	if area == "" {
		return nil
	}
	if err := validateText(area); err != nil {
		return fmt.Errorf("area: %w", err)
	}
	*filters = append(*filters, "substringof("+literal(area)+",designatedArea)")
	return nil
}

func validateText(s string) error {
	if len(s) > 100 {
		return errors.New("must be at most 100 bytes")
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return errors.New("must not contain control characters")
		}
	}
	return nil
}

func dateBound(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Year() < 1953 || t.Year() > 9998 {
		return time.Time{}, errors.New("must be a valid YYYY-MM-DD date from 1953 through 9998")
	}
	return t, nil
}
