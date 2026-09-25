# ReliefRN website — connection and operation guide

The website works in a clearly labelled directory mode without credentials. With the agent bridge running and signed in, its chat is answered by the ReliefRN project's three live Foundry agents. It does not impersonate an agency, or promise that a human will call until the appropriate service confirms a request.

## Connect the ReliefRN agents

**To run it, see [RUN-LOCALLY.md](RUN-LOCALLY.md).** It is one command, and covers sign-in for the team and for judges.

The ReliefRN project's agents are addressed **by name** through Foundry's Responses API: `Assistance-agent`, `Safety-EscalationAgent` and `WriteUp-agent`, in `https://disaster-ai-agent.services.ai.azure.com/api/projects/ReliefRN`. That is the same API `ready-route-web` and `test-python-site` use. The earlier adapter here targeted classic `asst_…` Threads/Runs agents and could not reach them, so it has been replaced.

The ReliefRN website runs as a Worker, which cannot use `az login` or an interactive sign-in. So `lib/foundry.ts` talks to a small local Python service, `agent-bridge/bridge.py`, which holds the Azure credential and calls the agents with the official `azure-ai-projects` SDK. The bridge orchestrates the three agents:

1. **Safety-EscalationAgent** reviews the message first when it concerns scams, payments, danger, legal, medical or other high-impact issues (keyword screen plus the website's `highImpact` rule). Its `ESCALATE: YES/NO` verdict sets the website's "talk to a person" prompt, and its assessment is passed to the next agent as evidence.
2. **Assistance-agent** answers, using its configured tools (the FEMA MCP server).
3. **WriteUp-agent** drafts the hand-off summary when the person asks for a human.

The reply's links become the website's source list. The agents and MCP tools that actually ran are returned and shown under each reply as **Handled by**. Test a normal assistance question, a multilingual question, an ambiguous eligibility question, an urgent message, and a requested summary. The local emergency rule immediately shows 911 guidance and does not wait for AI. Do not use real personal information for these tests.

Optional server settings: `AGENT_BRIDGE_URL` (default `http://127.0.0.1:8765`) and `AGENT_BRIDGE_TOKEN` (a shared secret, if the bridge runs somewhere other than this machine). Agent names, the project endpoint and credentials are configured in `agent-bridge/.env`; see `agent-bridge/.env.example`.

### Request flow

`POST /api/chat` validates length, rejects obvious identification or financial numbers typed by the user, and answers urgent language locally. It then checks that the bridge is running and signed in. If so, it starts a bridge run and returns its run token. Otherwise it answers in guided mode, and the response's `fallback` field says why. `GET /api/chat?token=…` polls the run and returns its final text, sources and agent trail. `GET /api/config` reports `aiConfigured: true` only when the bridge is reachable **and** signed in, so the interface never labels guided answers as live. Each agent call uses a fresh Foundry conversation, which the bridge deletes afterwards. Deletion does not imply deletion of Azure audit logs or tool-provider records. A failed or timed-out request is never automatically resubmitted.

Conversation text is in tab memory, not a database or browser persistent storage. For later turns, a bounded transcript is passed to the agent as evidence. No identity documents can be uploaded. Avoid configuring tools in Foundry that submit applications, send messages, or make other consequential changes without a separate explicit user confirmation.

## Human handoff, phone and SMS

A user can create a local reference, review and edit a summary, download text, print/save PDF, and call 211 or FEMA. Generating a reference is not opening a FEMA case. Without a callback service the page explicitly says nothing was sent.

To activate callbacks, configure a **support service you control** in `HANDOFF_WEBHOOK_URL` and a secret `HANDOFF_WEBHOOK_TOKEN`. The site sends a request only after explicit user consent. The receiver must accept:

```json
{
  "reference": "RRN-…",
  "summary": "User-reviewed text",
  "phone": "+1…",
  "language": "en",
  "consent": true,
  "consentedAt": "ISO timestamp",
  "source": "ReliefRN"
}
```

The request includes `Authorization: Bearer …` and `Idempotency-Key: RRN-…`. Deduplicate by that key. Return a 2xx JSON response with **both** `{"accepted":true,"caseId":"YOUR-REAL-CASE-ID"}` only after the queue or case system has actually accepted it. Non-2xx, timeouts, invalid JSON, or missing receipt fields are shown as unconfirmed; the user is directed to call. Do not return success if an email, queue, or SMS operation failed. Implement retention, deletion, staff access, abuse controls, and callback scheduling in that support system. No phone numbers or handoff summaries are stored by the ReliefRN website.

Phone and SMS are not provisioned by a website. To route those channels through the agents, connect your existing Azure Communication Services, Twilio, or contact-center number to the same Foundry workflow, then set `SUPPORT_VOICE_NUMBER` and/or `SUPPORT_SMS_NUMBER`. Until supplied, the ReliefRN website offers 211/FEMA calls and the local 211 text-service directory. It never claims a text was sent. Browser microphone input is separate and depends on browser support; speech transcription may be processed by the browser's speech provider.

There is no general public FEMA endpoint configured to accept these summaries as cases. Do not send directly to FEMA without an authorized receiving integration. FEMA application links open the official application site for the user to complete there.

## Data sources and coverage

- **Norfolk initial directory:** two city-designated shelters (Southside STEM Academy and Norview High School), two fire stations, Sentara Norfolk General Hospital, Ghent Veterinary Hospital, and the Norfolk deputy coordinator published in VDEM's Local Emergency Managers Directory. Addresses were geocoded through Esri. Source review: September 23, 2026. The directory is a snapshot; inclusion does not confirm opening or admission.
- **Evacuation polygons:** actual VDEM coastal Virginia zone data used by the official Know Your Zone web map. The Norfolk geometry snapshot identifies the 2020 update used by the current official map. Other coastal Virginia views query the same service. These are planning zones, not live evacuation orders. Other states link to their official agency; no nationwide polygon coverage is claimed.
- **Resource lookup (nationwide):**
  - **USGS National Map structures** provide hospitals, ambulance stations, fire/EMS stations and police, within 25 miles.
  - **FEMA Disaster Recovery Centers** and the **FEMA National Shelter System open-shelter layer** each cover 50 miles. Both only have entries during active disasters, so an empty list is normal elsewhere.
  - **Places the assistant names:** when a live reply names a place with a street address ("Fair Ridge Shelter, 3997 Fair Ridge Drive, Fairfax, VA 22033"), `/api/mentions` geocodes that address and adds the place to the list and map, labelled "Named by your assistant · call to confirm". This keeps the page consistent with the chat.
    - Only street-level geocoder matches within 60 miles are accepted.
    - If every named place is in another city than the map shows (the person asked about Fairfax while the map was on Norfolk), the map moves to that city first.
    - Clearing the chat removes these places.
  - **OpenStreetMap** also provides year-round family and homeless shelters. FEMA's feed only lists disaster shelters that are open right now.
  - **OpenStreetMap** provides veterinary clinics within about 15 miles. The browser fetches these directly: from the local Worker, public Overpass servers hang. Two Overpass mirrors are tried in turn, and both are often busy, so vets can be missing on a bad day.
  - The nearest listings are ranked by straight-line (Haversine) distance: two shelters, two Recovery Centers, two responder stations, one hospital and one veterinary hospital.
  - This is not a complete inventory, live responder tracking, admission confirmation, or a safe travel route. OSM is labelled community data, not government information.
- **Location from the chat:** when a message names a place ("we're in Houston, TX", a ZIP code, "Buncombe County, NC", or a short reply after the assistant asks where they are), `/api/locate` geocodes it with Esri. The map, resources, alerts and the agents' location context then move there, with a visible notice.
  - Only city, county or ZIP-level places are accepted, never a whole state.
  - A bare name that exists in several states is ignored unless one is far more prominent (Asheville resolves to NC; Norfolk alone stays ambiguous).
  - Free text is never geocoded wholesale ("my house" would otherwise become House, Alabama).
- **Local manager:** VDEM public directory snapshot for Virginia, matched by locality and geocoded. Other states currently require the state/211 directory when a verified local listing is not present.
- **Weather alerts:** National Weather Service active alerts by selected point. Empty results never imply no hazard or no local evacuation order. Failed requests are shown as unavailable. Refresh is user initiated.
- **FEMA:** live OpenFEMA DisasterDeclarationsSummaries, FemaRegions and DataSets, plus the supplied data documentation. Recent declarations are context only; they are not used to determine eligibility or deadlines.
- **State links:** Virginia, North Carolina, Florida, California, Texas, New York, with USA.gov's national state emergency agency directory for other states.

Government decisions and eligibility should be grounded in the official source tools configured in Foundry. The unconnected guide is deterministic signposting, clearly labelled as guided information, not a simulated live AI.

## Accessibility, languages and offline operation

The interface is fully translated into ten languages. The picker shows English first, then the languages most spoken in Virginia homes (U.S. Census American Community Survey): Spanish, Chinese (Simplified), Vietnamese, Arabic, Korean, Urdu, Amharic and French. Hindi, which was already supported, comes last. The seven newer translations (`lib/i18n.ts`) were written for this prototype and should be reviewed by native speakers before public use, especially the safety and eligibility text.

- **Right-to-left:** Arabic and Urdu switch the whole layout to right-to-left, with the sidebar on the right. The map, phone numbers and the brand name stay left-to-right.
- **Letter-spacing:** it is turned off for scripts it would break (joined Arabic and Urdu letters) or crowd (Chinese, Korean, Amharic).
- **What the language setting changes:**
  - The live agents are told to reply in the chosen language.
  - Browser speech uses that language's voice.
  - The local emergency rule (immediate 911 guidance, no AI wait) recognises key danger phrases in all ten languages.
  - The rule-based guided answers used when the AI is not connected only match keywords in English, Spanish and Hindi. In the other languages they fall back to a general, translated prompt.
- **Source language:** original agency names, addresses, source titles and weather notices stay in their source language, and a notice says so.
- **Device support:** browser text-to-speech and speech input depend on the device having a voice for that language.

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
