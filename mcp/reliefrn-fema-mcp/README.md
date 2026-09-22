**ReliefRN FEMA MCP — Go server for Foundry and Azure Container Apps**

This project connects a Foundry agent to the public [OpenFEMA API](https://www.fema.gov/about/openfema/api). It uses the [official Go MCP SDK](https://github.com/modelcontextprotocol/go-sdk), pinned in `go.mod`, and exposes two read-only tools over Streamable HTTP. No model runs inside this server, and no FEMA API key is needed for these public requests. Your existing GPT-5 mini agent supplies the reasoning; this program supplies the data.

The implemented dataset is **Disaster Declarations Summaries v2**. OpenFEMA has many datasets; this starter deliberately provides useful disaster lookups rather than unrestricted access to every dataset. FEMA describes these records as declared disasters, recovery programs, and designated geographic areas. They include historical information and can contain errors. [FEMA dataset metadata](https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=name%20eq%20%27DisasterDeclarationsSummaries%27) and the [data dictionary](https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2) describe that scope.

`search_disasters` takes a required two-letter `state` plus optional `area`, `incident_type`, `declaration_type`, `declared_after`, `declared_before`, `individual_assistance_only`, `limit`, and `offset`. It returns newest declarations first. `get_disaster_details` takes `disaster_number` and optional `state`, `area`, `limit`, and `offset`. It returns the designated-area rows for that declaration.

Every response includes `source_url`, `retrieved_at`, official `disaster_url` links, the recorded assistance flags, and paging information. The default page size is 20 and maximum is 100. A one-record lookahead makes `has_more` accurate for the response received. When it is true, repeat the same query using `next_offset`. FEMA records may change between requests; this is not a frozen snapshot.

**Deploy to Azure**

Install a current [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) and Docker with Buildx, and start the Docker daemon. Run the commands in Bash on macOS, Linux, or WSL. The Go compiler runs inside the Docker build; installing Go locally is optional. Python 3 is used only by the smoke-test script.

Extract the ZIP and open a terminal inside `reliefrn-fema-mcp`. Sign in and select the subscription you want to use. Replace both placeholders below. The region must be one your subscription's policy permits for Container Apps and Container Registry; your Foundry project does not have to be in that same region for this public HTTPS connection.

```bash
az login
az account set --subscription "YOUR_SUBSCRIPTION_ID"
bash scripts/deploy-azure.sh "YOUR_ALLOWED_REGION"
```

The script creates a dedicated resource group, a Basic Azure Container Registry, a Container Apps environment, a managed identity with registry-scoped `AcrPull`, and the Container App. It builds a `linux/amd64` image locally, pushes it, stores a generated key as a Container Apps secret, and configures HTTPS ingress to port 8080. Registry administrator credentials are not enabled. Image-pull authentication follows Microsoft's [managed identity guidance](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull). Building locally means this path does not depend on ACR Tasks.

By default the app is named `reliefrn-fema-mcp`, and the dedicated resource group is `rg-reliefrn-fema-mcp`. You can set `APP_NAME` and `RESOURCE_GROUP` before the deployment command to choose different names; keep using those same values when redeploying. `AZURE_LOCATION`, `ENVIRONMENT_NAME`, and `REGISTRY_NAME` can also be set. The default registry name is generated deterministically from your subscription, group, and app name.

The app uses 0.25 CPU, 0.5 GiB memory, and zero to one replica. Zero replicas reduces idle compute use, but the first request can take longer. For a live demo, keep one replica warm by deploying with `MIN_REPLICAS=1 bash scripts/deploy-azure.sh "YOUR_ALLOWED_REGION"`. The registry and running resources can incur Azure charges. This environment disables persistent log collection to keep the starter small.

The deployment script needs permission to create those resources, register their providers, and assign `AcrPull`. Your earlier region-policy error can still apply to these resources. Use an allowed region; an MCP server does not remove subscription restrictions.

After deployment, the terminal shows an MCP URL ending in `/mcp`. With the default app name, it is also saved in `.azure/reliefrn-fema-mcp-mcp-url`. The shared key is saved in `.azure/reliefrn-fema-mcp-mcp-api-key`. This directory is excluded from Git and Docker builds. The key protects your MCP server; it is not a FEMA or Azure model credential.

Check the running server with the supplied script. With the default app name it finds the saved URL and key automatically; if you used `APP_NAME`, set that same environment variable here.

```bash
python3 scripts/smoke-test.py
```

This performs MCP initialization, discovers both tools, and makes a real historical FEMA lookup for Buncombe County, North Carolina, in September–October 2024. If a record is returned, it also checks `get_disaster_details` against that record. It prints returned records without printing the key. Success checks the deployed MCP server and FEMA connectivity; it does not check Foundry's connection yet and does not establish current assistance availability.

**Connect the MCP tool in Foundry**

Open your Foundry project and your GPT-5 mini agent. In its tools area, choose **Add tool**, then **MCP / Model Context Protocol**, and add a custom or remote server. Portal wording can vary. Use `fema` as the server label/name, and paste the deployed HTTPS URL including `/mcp` as the server URL. Do not use the root URL or `/healthz`.

Choose **Key-based authentication** (sometimes shown as API key/custom headers). Set the credential/header name to **`X-API-Key`**, and the value to the raw key from the following file. Do not prepend `Bearer`, and do not use `MCP_API_KEY` as the header name; that is the container's environment variable. Keep the key out of the agent's instructions.

```bash
cat .azure/reliefrn-fema-mcp-mcp-api-key
```

Foundry stores these credentials in a project connection and sends them as HTTP headers when invoking the server, as described in Microsoft's [MCP authentication guide](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/mcp-authentication). Choose the two tools `search_disasters` and `get_disaster_details` if the portal asks which tools to expose. If your UI only accepts an existing connection, create a custom-key MCP project connection with that URL and header, then select it on the agent.

Save the connection and agent. Leave the portal's initial approval setting in place and approve a read-only call if prompted in the playground. For automatic lookup behavior, an approval setting that permits these two read-only tools avoids stopping the conversation for every request. This server has no write or application-submission tools.

Paste the contents of `foundry-instructions.txt` into the agent's instructions, merging them with any project-specific behavior you already wrote. Test the agent with: “Use the FEMA tools to find disaster declarations for Buncombe County, NC, declared between September 1 and October 31, 2024. Explain the recorded household assistance designation and cite the FEMA disaster page. Do not treat this historical lookup as current eligibility.” Inspect the tool trace to confirm an actual `search_disasters` call occurred.

If Foundry says you cannot create the connection, you need permissions to create project connections in addition to using the agent. Microsoft's current guide calls these roles **Foundry User** for using agents and **Foundry Project Manager** for creating MCP authentication connections; older UI may display Azure AI role names. Your Azure resource Owner role alone does not necessarily supply all Foundry data-plane permissions. See the [Foundry MCP prerequisites](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/model-context-protocol#prerequisites).

**Run locally instead**

The server requires a key of at least 32 non-whitespace characters. Generate a local key and run the container. The bind below makes it reachable only from your own computer.

```bash
export MCP_API_KEY="$(openssl rand -hex 32)"
docker build -t reliefrn-fema-mcp .
docker run --rm -p 127.0.0.1:8080:8080 -e MCP_API_KEY reliefrn-fema-mcp
```

Run the smoke test from another terminal with the same key set as `MCP_API_KEY`: `python3 scripts/smoke-test.py http://localhost:8080/mcp`. If you prefer Go directly, use Go 1.25 or later, set the same environment variable, and run `go run -buildvcs=false .`. Both paths expose the same protocol. Foundry itself needs the Azure HTTPS endpoint; it cannot reach your laptop's localhost directly.

`GET /healthz` returns process health without authentication. It intentionally does not call FEMA, so a temporary FEMA outage will not continually restart the container. `POST /mcp` implements Streamable HTTP with JSON responses. A browser GET to `/mcp` returns 401 without the key or 405 with it; that does not show that the server is broken. There is no legacy `/sse` endpoint or stdio mode.

**Understand and extend the code**

`main.go` owns HTTP serving, API-key checking, request limits, and shutdown. `tools.go` declares the model-visible tool names, descriptions, and argument types. `fema.go` validates arguments, constructs bounded OpenFEMA requests, handles pagination and transient failures, and attaches source information. To add another dataset, create a narrowly scoped handler in `fema.go` and register its tool in `tools.go`; keep URLs and field selections controlled by the server.

The agent chooses a tool and arguments. Foundry calls this server. The server translates those arguments into an ordinary FEMA HTTP GET and returns JSON. Foundry then supplies that result to GPT-5 mini, which writes the answer. No model keys are stored here, and this MCP server does not maintain conversation history or a database.

FEMA area matching is case-sensitive in the tested API: `Buncombe` matches `Buncombe (County)`; `buncombe` does not. A plain `Buncombe County` also will not match the parenthesized label. Use a correctly capitalized base name, then verify the full returned `designatedArea`. Partial names may match several areas. Independent cities, counties with the same name, and tribal areas must be distinguished from returned records. Avoid guessing FIPS codes.

`individual_assistance_only` checks **either** `ihProgramDeclared` or `iaProgramDeclared`. Neither flag establishes that a particular person qualifies. Each record covers one area; dates and flags must be read at that scope. The optional `lastIAFilingDate` is returned as recorded, with instructions to verify current guidance. Empty results are inconclusive, and upstream failures become MCP errors rather than empty successes.

This is a declaration lookup foundation. It does not fetch every government program, live shelter capacity, application forms, personalized document requirements, or verified current eligibility rules. It does not submit applications or transfer chats to humans. The supplied agent instructions provide a referral to official channels when the prototype cannot resolve a case. Review Foundry conversation retention separately before using real citizen conversations.

**Redeploy and troubleshoot**

After editing Go code, rerun the deployment command with the same subscription, region, and resource names. It builds a fresh image tag and updates the app while retaining the saved MCP key. The Docker build runs the included tests. If you deliberately rotate the key, set a new `MCP_API_KEY`, rerun deployment, and update the credential in Foundry as well.

For `RequestDisallowedByAzure`, select a region allowed by your subscription or ask the subscription administrator to make the required region available. For `MissingSubscriptionRegistration`, the script registers `Microsoft.App`, `Microsoft.ContainerRegistry`, and `Microsoft.ManagedIdentity`; if that action is denied, a subscription administrator must register them. No extra Cognitive Services account is created by this project.

For an image-pull authorization failure on a first deployment, check that the managed identity has `AcrPull` on the registry and allow the assignment to propagate before rerunning the script. The script creates its own registry in RBAC mode. If you override `REGISTRY_NAME` with an existing ABAC-mode registry, its repository access roles need a different configuration; use the generated registry for this starter.

For 401 in Foundry, check the exact `X-API-Key` header, raw key value, and project connection. For a schema or tools-discovery problem, run `scripts/smoke-test.py` directly against the endpoint. For a first-call timeout, warm `/healthz` and retry, or set `MIN_REPLICAS=1`. For a FEMA 403/429/5xx inside a tool result, the MCP server may be healthy while the upstream API is rejecting or delaying requests; do not reinterpret the failure as no aid.

To inspect current console output using the default resource names:

```bash
az containerapp logs show --name reliefrn-fema-mcp --resource-group rg-reliefrn-fema-mcp --follow
```

When finished, delete the dedicated `rg-reliefrn-fema-mcp` resource group in the Azure portal after verifying it contains only this project's resources. This removes the app, environment, registry, and identity. Remove the MCP tool connection from your Foundry agent as well. Nothing in the deployment script deletes resources automatically.

**Validation**

The unit/integration tests cover HTTP authentication, MCP initialization and both tools across three protocol versions, required arguments, query escaping, date boundaries, bounded pagination, null program flags, retries, cancellation, and upstream errors. Run `go test ./...`; with a C compiler available, run `go test -race ./...` to check concurrent use. The separate smoke test contacts the live FEMA API, so it requires network access.

The project was compiled and checked locally, including a live FEMA call through the MCP endpoint. Docker and an authenticated Azure subscription were not available in the authoring environment, so the Docker image build and Azure deployment were not executed there. Run the supplied deployment and smoke test to validate your subscription's policies, quotas, image pulls, and network path.

FEMA is the source of the public declaration data. This project is an independent hackathon prototype and does not imply FEMA endorsement. See [OpenFEMA terms and citation guidance](https://www.fema.gov/about/openfema/terms-conditions).
