# Running Harbor with the live ReliefRN agents

Harbor's chat is answered by the team's three Microsoft Foundry agents in the
**ReliefRN** project:

| Agent | When it runs |
|---|---|
| **Safety-EscalationAgent** | First, on any message about scams, danger, money requests, legal or medical issues, or anything high-impact. It decides whether a human should take over. |
| **Assistance-agent** | Every message. Looks up FEMA declarations through the team's FEMA MCP server and answers in the person's language. |
| **WriteUp-agent** | When the person presses **Talk to a person**. It drafts the hand-off summary they review before anything is shared. |

Under every live reply, Harbor shows a **Handled by** line naming the agents
(and MCP tools) that actually ran, so you can see the system working rather
than take it on trust.

---

## For judges: run it

You need **Python 3.10+** and **Node.js 22.13+** (https://nodejs.org, LTS).
Everything else installs into this folder.

1. Put the three values the ReliefRN team sent you into `agent-bridge/.env`
   (copy `agent-bridge/.env.example` to start):

   ```
   AZURE_TENANT_ID=...
   AZURE_CLIENT_ID=...
   AZURE_CLIENT_SECRET=...
   ```

2. Start everything:

   - **Windows:** double-click `start-demo.cmd`
   - **macOS / Linux:** `./start-demo.sh`

   The first run installs dependencies (about a minute). Harbor then opens at
   **http://localhost:5173**. Press **Ctrl+C** in that window to stop.

3. Things to try:
   - *"What FEMA help can I get after a flood in Asheville, NC?"*: the
     Assistance agent calls the FEMA MCP tool.
   - *"Someone texted me to pay a $50 fee to release my FEMA grant."*: the
     Safety agent reviews it first and flags it for a person.
   - Press **Talk to a person**: the WriteUp agent drafts the hand-off summary.
   - Switch the language to **Español** and ask again.

If the header says **Guided information** instead of **Connected assistant**,
the agents are not reachable. Harbor still works, answering from built-in
rules, and the reason is shown in the agent bridge window.

To check the connection without the website:

- **Windows:** `powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Check`
- **macOS / Linux:** `./start-demo.sh --check`

This signs in and sends one test message to each agent.

---

## For the team: sign-in

The agent bridge (`agent-bridge/bridge.py`) holds the Azure credential, because
Harbor runs as a Worker and cannot use `az login` itself. It signs in with the
first of these that works:

1. **A service principal** in `agent-bridge/.env` (what judges use).
2. **`az login --tenant 9e857255-df57-4c47-a0c0-0546460380cb`** if you have the
   Azure CLI.
3. **A browser sign-in window**, opened once at startup, for your own account.

Your account (or the service principal) needs the **Azure AI User** role on
the Foundry resource. Newer portals call this **Foundry User**.

### Creating credentials for judges

Judges do not have accounts in the ReliefRN tenant, so give them a service
principal. Whoever owns the `disaster-ai-agent` Foundry resource does this once.

**In the Azure portal**

1. **Microsoft Entra ID → App registrations → New registration.** Name it
   `reliefrn-judges`, keep the defaults, and register. Copy the
   **Application (client) ID** and **Directory (tenant) ID**.
2. In that app: **Certificates & secrets → New client secret.** Pick an expiry
   that ends soon after judging (for example 30 days). Copy the **Value** now;
   it is shown only once.
3. Open the Foundry resource **disaster-ai-agent → Access control (IAM) → Add
   role assignment.** Choose **Azure AI User** (or **Foundry User**). Under
   Members, select `reliefrn-judges`. Save.
4. Wait about 5 minutes for the role to propagate. Then put the three values in
   your own `agent-bridge/.env` and run the `-Check` / `--check` command above.
   All three agents should PASS.
5. Send judges the three values **privately** (email or a password manager),
   never in the repository. `.env` is already git-ignored.

**Or with the Azure CLI**

```bash
az ad sp create-for-rbac --name reliefrn-judges --years 1 \
  --role "Azure AI User" \
  --scopes /subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RESOURCE_GROUP>/providers/Microsoft.CognitiveServices/accounts/disaster-ai-agent
```

It prints `appId` (client ID), `password` (secret) and `tenant`.

**After judging**, delete the client secret, or the whole `reliefrn-judges`
app registration. Anyone holding the secret can run your agents and spend
against your subscription until you do.

### Before a judged session

- The Assistance agent's FEMA tools come from the `reliefrn-fema-mcp` Container
  App. If it scales to zero, the first question can be slow or time out. Deploy
  it with `MIN_REPLICAS=1` for the demo (see `mcp/reliefrn-fema-mcp/README.md`).
- Run the `--check` command once. If an agent fails, the error names it.

---

## How it fits together

```
Browser ──► Harbor (Worker, localhost:5173)
              │  /api/chat: urgent or sensitive text is answered locally, at once
              ▼
            agent bridge (Python, 127.0.0.1:8765, holds the Azure sign-in)
              │  Safety-EscalationAgent → Assistance-agent (→ FEMA MCP)
              │  WriteUp-agent for hand-off summaries
              ▼
            Microsoft Foundry · project ReliefRN
```

- **Nothing is stored.** Each run uses a fresh Foundry conversation, which the
  bridge deletes afterwards. Harbor keeps chats in tab memory only.
- **The bridge accepts local calls only.** It listens on 127.0.0.1, and refuses
  browser-originated requests and foreign Host headers. So a website you visit
  cannot use it to spend your Azure quota.
- **Tool approvals.** The agents ask before calling MCP tools, and the bridge
  approves them automatically (`MCP_APPROVE_TOOLS=*`), as ready-route-web does.
  Once you know the exact read-only tools your agents use, restrict it, for
  example `MCP_APPROVE_TOOLS=search_disasters,get_disaster_details`.
- **Mock mode.** `start-demo -Mock` / `--mock` runs the full interface with
  fake, clearly labelled replies. Use it for UI work without spending tokens.
  Never use it for judging.

## Troubleshooting

| You see | Do this |
|---|---|
| Header says **Guided information** | Read the agent bridge window. Usually sign-in failed: check the three `.env` values, or that the role assignment has propagated. |
| `AADSTS7000215` / invalid client secret | You pasted the secret's **ID** instead of its **Value**. Create a new secret. |
| `AuthorizationFailed` / 403 from Foundry | The service principal or account lacks **Azure AI User** on `disaster-ai-agent`. |
| `…did not finish` in the bridge window | Open **Traces** in the Foundry portal for that agent. A failing MCP tool is the usual cause. |
| Replies take 30+ seconds | The MCP container was asleep. See *Before a judged session*. |
| `Python 3.10 or newer is required` / `Node.js 22.13` | Install from python.org / nodejs.org, then run the launcher again. |
