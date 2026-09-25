# ReliefRN phone demo

A local phone-style messaging website connected to your saved Assistance-agent, Safety-EscalationAgent, and WriteUp-agent. SMS style is selected by the server on every assistance request; the participant sees only the conversation.

On your Mac, unzip this folder, open Terminal in it, and run:

```bash
bash start.command
```

The launcher installs the pinned dependencies into the Python selected by `python` and starts the app without a virtual environment. Python 3.10 or newer is required. Complete the Microsoft sign-in using an account with access to your ReliefRN Foundry project. When the terminal says it is connected, open http://localhost:8000. Keep the terminal open while presenting. Node.js is not needed to run the app.

The project endpoint, tenant ID, and all three agent names are already configured in app.py. These identify your project; they do not replace Microsoft authentication. The app checks that all three agents can be read before starting. It does not edit the saved agents in Foundry.

If browser sign-in is unavailable, run `bash start.command --auth device` and follow the terminal instructions. If Azure CLI is already installed and signed in to the correct tenant, use `bash start.command --auth cli`. For environment or managed identity authentication, use `--auth default`.

For an existing Python environment, including Windows, install and launch directly:

```bash
python -m pip install -r requirements.txt
python app.py
```

Ask for assistance normally. When the agent offers human follow-up, the app presents a consent question explaining that callbacks and forwarding are simulated. The participant can reply “Yes please” or tap “Yes, prepare report.” That immediately invokes the saved WriteUp-agent with the conversation and any safety assessments. Its saved report instructions remain in effect, and its report body is saved unchanged. END is no longer required.

The app passes SMS channel context and a small runtime update to Assistance-agent. This update explains the new consent trigger and asks the agent to emit a hidden `[OFFER_CALLBACK]` marker when it is ready to offer follow-up. The server removes that marker and displays its explicit consent question. It also recognizes common natural-language callback offers. Clear text confirmations only apply while that consent question is pending; unrelated “yes” messages do not generate a report. Ambiguous replies continue the conversation. The confirmation button is the unambiguous option for a presentation.

Reports are saved as `reliefrn-report-0001.md`, `reliefrn-report-0002.md`, and so on in the process's current working directory. The launcher changes into the app folder, so reports appear beside app.py. Existing reports are preserved and numbering continues after restarting. Use the compose icon at the top right for another participant. The chat shows a saved-report message only after generation and disk writing both succeed, and offers a download of the same file. The browser does not have to download anything for the local file to exist.

If WriteUp fails, the chat offers “Retry report.” A disk-save retry reuses the already-generated report instead of calling the agent again, unless new conversation messages have made that draft stale. Duplicate HTTP retries do not generate another report. One report is created per conversation; start a new conversation for another demo. Restarting the server clears in-memory conversations but preserves reports. Refreshing the browser keeps the current conversation while the server is running. Messages are not stored in browser localStorage.

The app never sends a real SMS, email, FEMA submission, or callback. The saved agents can still perform their configured information lookups. If an MCP tool requests approval, the presenter sees the same approval question in the terminal as in the original demo. Only auto-approve known read-only lookups: `RELIEFRN_READ_ONLY_TOOLS` accepts comma-separated exact `server_label:tool_name` values as displayed by that terminal prompt. Other requested tools still require presenter approval. Local custom function tools are not implemented and should be removed from these saved demo agents if Foundry reports one.

Use fictional participant information for a demonstration. In live mode, messages and reports are processed by the configured Azure agents and may be retained by that service. Local reports contain the agent's output and stay on your computer until you remove them. The server binds to 127.0.0.1 by default. The app is intended as a local demo, not a public emergency response service.

To view the interface without Azure, run `bash start.command --preview`. This is explicitly labeled as an offline preview and uses scripted responses and a clearly marked test report. The app never silently switches to scripted replies when a real agent fails. Real agent mode is the default.

The backend was verified with 24 behavior tests covering consent, refusals, idempotency, report failures and retries, authorization of downloads, concurrent numbering, and numbering across restarts. Run them with `python -m unittest discover -s tests -v`. The three Azure client constructors and actual SDK request serialization were checked using an in-memory HTTP transport. Live authenticated responses could not be tested without your Microsoft sign-in. The screen and callback controls were browser-tested against an explicitly scripted preview. Optional WebMCP registration is feature-detected; this test browser did not expose that capability.

The development-only package.json and preview.config.mjs provide a separate scripted browser-layout preview in environments that support only Node. They do not connect to Azure or test actual report writing. The Python app is the intended launcher and uses the real backend in both live and `--preview` modes.

The Microsoft SDK documentation for this connection method is https://learn.microsoft.com/en-us/python/api/azure-ai-projects/azure.ai.projects.aiprojectclient?view=azure-python. The agent-specific `get_openai_client(agent_name=...)` path is used with `allow_preview=True`, preserving your terminal demo's connection pattern.

See [FINDINGS-REVIEW.md](FINDINGS-REVIEW.md) for the independent bug review, local fixes, and remaining saved-agent prompt corrections.
