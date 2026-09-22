package main

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Plain fields keep the input schemas simple for Foundry: no anyOf/allOf.
type searchArgs struct {
	State                    string `json:"state" jsonschema:"Two-letter state or territory code, such as NC or VA. Required."`
	Area                     string `json:"area,omitempty" jsonschema:"Case-sensitive substring of FEMA designatedArea, such as Buncombe or Fairfax (City). Use the base county name without adding County. Inspect returned areas for an exact geographic match."`
	IncidentType             string `json:"incident_type,omitempty" jsonschema:"Exact FEMA incident type, such as Hurricane, Tropical Storm, Fire, Flood, or Severe Storm. Leave empty if unsure; an event commonly called a hurricane may be classified as Tropical Storm."`
	DeclarationType          string `json:"declaration_type,omitempty" jsonschema:"Optional declaration category: DR (major disaster), EM (emergency), or FM (fire management)."`
	DeclaredAfter            string `json:"declared_after,omitempty" jsonschema:"Inclusive declaration date lower bound in YYYY-MM-DD. This is the declaration date, not the incident start date."`
	DeclaredBefore           string `json:"declared_before,omitempty" jsonschema:"Inclusive declaration date upper bound in YYYY-MM-DD."`
	IndividualAssistanceOnly bool   `json:"individual_assistance_only,omitempty" jsonschema:"If true, return areas with ihProgramDeclared OR iaProgramDeclared. Does not mean applications are currently open or the person qualifies."`
	Limit                    int    `json:"limit,omitempty" jsonschema:"Records per page, 1 to 100; omitted or 0 defaults to 20. Each record is a designated area, not a unique disaster."`
	Offset                   int    `json:"offset,omitempty" jsonschema:"Pagination offset, 0 to 100000. Start at 0; follow next_offset when has_more is true."`
}

type detailsArgs struct {
	DisasterNumber int    `json:"disaster_number" jsonschema:"Numeric FEMA disaster number obtained from search_disasters, for example 4827."`
	State          string `json:"state,omitempty" jsonschema:"Optional two-letter state or territory code."`
	Area           string `json:"area,omitempty" jsonschema:"Optional case-sensitive designated-area substring, such as Buncombe or Fairfax (City)."`
	Limit          int    `json:"limit,omitempty" jsonschema:"Records per page, 1 to 100; omitted or 0 defaults to 20."`
	Offset         int    `json:"offset,omitempty" jsonschema:"Start at 0; follow next_offset when has_more is true. Maximum 100000."`
}

func newMCPServer(client *femaClient) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "reliefrn-fema", Version: version}, &mcp.ServerOptions{
		Instructions: "Read-only OpenFEMA declaration lookup. Results are area-level historical administrative records, not eligibility decisions, emergency alerts, or proof that applications are open. Cite returned FEMA links and retrieval time. Never request SSNs, bank details, full addresses, or identity documents. No matches and API errors do not mean no assistance exists.",
	})
	annotations := &mcp.ToolAnnotations{ReadOnlyHint: true, IdempotentHint: true}
	// Out=any omits an inferred output schema while the SDK supplies both
	// structured JSON and a JSON text fallback for clients such as Foundry.
	mcp.AddTool(s, &mcp.Tool{
		Name:        "search_disasters",
		Description: "Search official OpenFEMA disaster declaration records by state, designated area, dates, and assistance flags. Newest declarations first. Rows represent designated areas and may repeat a disaster number. Area and incident-type matching are case-sensitive. Never infer current eligibility or application availability from these records.",
		Annotations: annotations,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, args searchArgs) (*mcp.CallToolResult, any, error) {
		page, err := client.search(ctx, args)
		return nil, page, err
	})
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_disaster_details",
		Description: "Retrieve a page of designated-area records for one FEMA disaster number, including program flags, dates, and an official disaster page link. Filter by area or paginate to find the person's location; never treat one area's flags as applying to the whole state.",
		Annotations: annotations,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, args detailsArgs) (*mcp.CallToolResult, any, error) {
		page, err := client.details(ctx, args)
		return nil, page, err
	})
	return s
}
