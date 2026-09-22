#!/usr/bin/env python3
"""Check a running MCP server, including an actual historical OpenFEMA lookup.

Uses only the Python standard library. Never prints the API key.
"""
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
app = os.environ.get("APP_NAME", "reliefrn-fema-mcp")
key_file = ROOT / ".azure" / f"{app}-mcp-api-key"
url_file = ROOT / ".azure" / f"{app}-mcp-url"
endpoint = sys.argv[1] if len(sys.argv) > 1 else (
    url_file.read_text().strip() if url_file.exists() else "http://localhost:8080/mcp"
)
parts = urllib.parse.urlparse(endpoint)
if parts.scheme not in ("http", "https") or not parts.hostname:
    sys.exit("Supply a valid HTTP(S) MCP URL.")
if parts.scheme != "https" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("Use HTTPS for remote servers.")
key = os.environ.get("MCP_API_KEY") or (key_file.read_text().strip() if key_file.exists() else "")
if not key:
    sys.exit("Set MCP_API_KEY or deploy first to create the local key file.")

# Avoid forwarding the shared key if a mistyped endpoint redirects elsewhere.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect)
protocol = "2025-06-18"
counter = 0

def rpc(method, params, notification=False):
    global counter
    counter += 1
    body = {"jsonrpc": "2.0", "method": method, "params": params}
    if not notification:
        body["id"] = counter
    request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol,
        "X-API-Key": key,
    })
    with opener.open(request, timeout=90) as response:
        raw = response.read()
    if notification:
        return None
    payload = json.loads(raw)
    if "error" in payload:
        raise RuntimeError(f"{method}: {payload['error']}")
    if payload.get("id") != counter or "result" not in payload:
        raise RuntimeError(f"Unexpected JSON-RPC response to {method}")
    if payload["result"].get("isError"):
        raise RuntimeError(f"{method}: {payload['result'].get('content')}")
    return payload["result"]

try:
    info = rpc("initialize", {"protocolVersion": protocol, "capabilities": {},
                              "clientInfo": {"name": "reliefrn-check", "version": "1.0.0"}})
    protocol = info["protocolVersion"]
    rpc("notifications/initialized", {}, notification=True)
    discovered = {tool["name"] for tool in rpc("tools/list", {})["tools"]}
    if discovered != {"search_disasters", "get_disaster_details"}:
        raise RuntimeError(f"Unexpected tools: {discovered}")
    print(f"Connected to {info['serverInfo']['name']}; both tools discovered.")
    result = rpc("tools/call", {"name": "search_disasters", "arguments": {
        "state": "NC", "area": "Buncombe", "declared_after": "2024-09-01",
        "declared_before": "2024-10-31", "individual_assistance_only": True, "limit": 2,
    }})
    data = result.get("structuredContent")
    if not isinstance(data, dict):
        data = json.loads(next(item["text"] for item in result["content"] if item["type"] == "text"))
    if not isinstance(data.get("records"), list) or "source_url" not in data:
        raise RuntimeError("Tool returned an unexpected result shape")
    print(f"Live FEMA query succeeded: {data['records_returned']} area record(s).")
    for row in data["records"]:
        print(f"{row['femaDeclarationString']}: {row['designatedArea']} — {row['declarationTitle']}")
    if data["records"]:
        row = data["records"][0]
        detail = rpc("tools/call", {"name": "get_disaster_details", "arguments": {
            "disaster_number": row["disasterNumber"], "state": row["state"],
            "area": row["designatedArea"], "limit": 1,
        }})
        detail_data = detail.get("structuredContent")
        if not isinstance(detail_data, dict):
            detail_data = json.loads(next(item["text"] for item in detail["content"] if item["type"] == "text"))
        if not detail_data.get("records") or detail_data["records"][0]["id"] != row["id"]:
            raise RuntimeError("Detail lookup did not return the same FEMA area record")
        print("Live get_disaster_details also returned the matching record.")
    if not data["records"]:
        print("The request worked, but the historical example returned no matches; inspect filters and FEMA data.")
    print("This historical test does not establish current eligibility or application availability.")
except (urllib.error.URLError, RuntimeError, ValueError, KeyError, StopIteration) as error:
    sys.exit(f"MCP check failed: {error}")
