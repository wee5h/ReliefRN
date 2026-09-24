# Harbor — connection and operation guide

The website is implemented and works in a clearly labelled directory mode without credentials. It does not impersonate an agency, claim the three Foundry agents are connected, or promise that a human will call until the appropriate service confirms a request.

## Connect the existing three-agent project

This adapter targets Microsoft Foundry **classic connected agents**, using the project Threads/Runs API and `2025-05-15-preview`, which Microsoft's connected-agent documentation specifies. No agent is created or replaced. The website calls the assistance agent; the existing Foundry connections remain responsible for delegation to the safety and write-up agents.

1. Obtain the project endpoint from Foundry's project overview. Format: `https://RESOURCE.services.ai.azure.com/api/projects/PROJECT`.
2. Copy the assistance agent's `asst_…` identifier. Keep the safety and write-up agents connected to it.
3. Configure a dedicated Entra service principal for the project. Give it the minimum Azure AI User / project permissions needed to run these agents and their tools. Follow Microsoft documentation for the permissions of each existing tool.
4. Set `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_ASSISTANT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` as server environment values. Keep the client secret secret; never put it in a browser bundle or paste it into a public page. `.env.example` lists all keys. Hosted values must be set in site environment settings and deployed.
5. Set a separate random `SESSION_SIGNING_SECRET` when practical. The client secret is the fallback signing key.
6. Confirm the assistant's Foundry instructions require the safety agent on every response and the write-up agent only when a user requests a handoff. The website supplies those instructions on each run, preserves the configured connected tools, and returns observed tool names from the run steps. Verify the actual delegation traces with your own agent configuration before public release. Prompt instructions alone are not a guarantee that a connected tool is invoked.
7. Test a normal assistance question, a multilingual question, an ambiguous eligibility question, an urgent message, and a requested summary. The local emergency rule immediately shows 911 guidance and does not wait for AI. Do not use real personal information for these tests.

If your project uses the newer Responses/agent-name APIs or a published agent application endpoint rather than classic `asst_…` agents, the transport must be adapted to your endpoint before connecting. Do not substitute an Azure OpenAI model endpoint for the Foundry project endpoint.

### Request flow

`POST /api/chat` validates length, rejects obvious identification/financial numbers, detects urgent language, and starts an isolated Foundry thread. It returns an expiring, HMAC-signed run receipt, rather than allowing callers to provide arbitrary thread IDs. `GET /api/chat?token=…` polls the run and returns its final text, source citations, and tool-step names. Threads are deleted after a completed or failed run when Azure permits deletion. Deletion does not imply deletion of Azure audit logs or tool-provider records. A failed or timed-out request is never automatically resubmitted.

Conversation text is in tab memory, not a database or browser persistent storage. For subsequent turns a bounded transcript is passed to a new isolated thread. No identity documents can be uploaded. Avoid configuring tools in Foundry that submit applications, send messages, or make other consequential changes without a separate explicit user confirmation.

## Human handoff, phone and SMS

A user can create a local reference, review and edit a summary, download text, print/save PDF, and call 211 or FEMA. Generating a reference is not opening a FEMA case. Without a callback service the page explicitly says nothing was sent.

To activate callbacks, configure a **support service you control** in `HANDOFF_WEBHOOK_URL` and a secret `HANDOFF_WEBHOOK_TOKEN`. The site sends a request only after explicit user consent. The receiver must accept:

```json
{
  "reference": "HBR-…",
  "summary": "User-reviewed text",
  "phone": "+1…",
  "language": "en",
  "consent": true,
  "consentedAt": "ISO timestamp",
  "source": "Harbor"
}
```

The request includes `Authorization: Bearer …` and `Idempotency-Key: HBR-…`. Deduplicate by that key. Return a 2xx JSON response with **both** `{"accepted":true,"caseId":"YOUR-REAL-CASE-ID"}` only after the queue or case system has actually accepted it. Non-2xx, timeouts, invalid JSON, or missing receipt fields are shown as unconfirmed; the user is directed to call. Do not return success if an email, queue, or SMS operation failed. Implement retention, deletion, staff access, abuse controls, and callback scheduling in that support system. No phone numbers or handoff summaries are stored by Harbor.

Phone and SMS are not provisioned by a website. To route those channels through the agents, connect your existing Azure Communication Services, Twilio, or contact-center number to the same Foundry workflow, then set `SUPPORT_VOICE_NUMBER` and/or `SUPPORT_SMS_NUMBER`. Until supplied, Harbor offers 211/FEMA calls and the local 211 text-service directory. It never claims a text was sent. Browser microphone input is separate and depends on browser support; speech transcription may be processed by the browser's speech provider.

There is no general public FEMA endpoint configured to accept these summaries as cases. Do not send directly to FEMA without an authorized receiving integration. FEMA application links open the official application site for the user to complete there.

## Data sources and coverage

- **Norfolk initial directory:** two city-designated shelters (Southside STEM Academy and Norview High School), two fire stations, Sentara Norfolk General Hospital, Ghent Veterinary Hospital, and the Norfolk deputy coordinator published in VDEM's Local Emergency Managers Directory. Addresses were geocoded through Esri. Source review: September 23, 2026. The directory is a snapshot; inclusion does not confirm opening or admission.
- **Evacuation polygons:** actual VDEM coastal Virginia zone data used by the official Know Your Zone web map. The Norfolk geometry snapshot identifies the 2020 update used by the current official map. Other coastal Virginia views query the same service. These are planning zones, not live evacuation orders. Other states link to their official agency; no nationwide polygon coverage is claimed.
- **Resource lookup:** FEMA National Shelter System open-shelter layer plus OpenStreetMap public facility listings. The nearest available listings are ranked with Haversine straight-line distances (two shelters, two responder stations, one hospital, one veterinary hospital). The search is bounded: approximately 22 miles for OSM facilities, 50 miles for FEMA shelters. It is not a complete inventory, live responder tracking, admission confirmation, or a safe travel route. OSM is labelled community data, not government information.
- **Local manager:** VDEM public directory snapshot for Virginia, matched by locality and geocoded. Other states currently require the state/211 directory when a verified local listing is not present.
- **Weather alerts:** National Weather Service active alerts by selected point. Empty results never imply no hazard or no local evacuation order. Failed requests are shown as unavailable. Refresh is user initiated.
- **FEMA:** live OpenFEMA DisasterDeclarationsSummaries, FemaRegions and DataSets, plus the supplied data documentation. Recent declarations are context only; they are not used to determine eligibility or deadlines.
- **State links:** Virginia, North Carolina, Florida, California, Texas, New York, with USA.gov's national state emergency agency directory for other states.

Government decisions and eligibility should be grounded in the official source tools configured in Foundry. The unconnected guide is deterministic signposting, clearly labelled as guided information, not a simulated live AI.

## Accessibility, languages and offline operation

English, Spanish and Hindi interface dictionaries are included. Original agency names, addresses, source titles and weather notices stay in their source language. The source-language notice is provided. Browser text-to-speech and speech input depend on device support.

The site uses semantic headings, keyboard navigation, focus-managed Radix dialogs, labelled controls, a resource list equivalent to the map, larger text, higher contrast, reduced motion, and guidance for mobility, hearing, vision, speech, cognition, dementia, and medication/equipment needs. Do not claim formal WCAG certification without an audit.

The responsive web layout is designed for current iOS Safari, Android Chrome and desktop browsers. The code has not been tested on physical iPhones/Android devices. Modern JavaScript and APIs are required. Exact oldest-supported OS/browser versions require device testing.

Low-data mode removes the interactive map. The offline guide is an explicitly downloaded text snapshot with contacts, checklists, source links and a timestamp. It can be read without connectivity. The entire site is not an offline PWA; live maps, searches, alerts, AI, and callback requests need connectivity. There are no background location permissions and no automatic emergency notifications. An already open page retains its in-memory list if connectivity drops.

Only language/accessibility preferences and checklist ticks persist in local storage. Selected location and chats do not. Map tiles expose the viewed area and IP to the tile provider; searches/alerts expose the selected location to their providers. Do not use this app to collect health records or identity documents.

## Validation and public rollout

Use `node node_modules/typescript/bin/tsc --noEmit` for type validation and the bundled Sites build workflow for production output. The site is private by default. Before opening to the public, verify Azure connections and safety/write-up traces, supply the staffed support integration, review translations, confirm data-feed coverage in the intended counties, load-test public providers, implement production rate limiting for paid agents, and complete accessibility/device testing.

Reference documentation:
- https://learn.microsoft.com/en-us/azure/ai-services/agents/quickstart
- https://learn.microsoft.com/en-us/azure/ai-services/agents/how-to/connected-agents
- https://www.weather.gov/documentation/services-web-api
- https://www.fema.gov/about/openfema/data-sets
- https://va-know-your-zone-vdemgis.hub.arcgis.com/
