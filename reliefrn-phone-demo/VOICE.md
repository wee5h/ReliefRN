# Simulated phone call

The **Call** link in the SMS screen opens `/call` on the same Python server. It rings briefly, requests microphone permission, and connects to Microsoft Voice Live using the existing Python Azure Identity credential and saved Assistance-agent. No Azure CLI, phone number, carrier, or separate frontend build is involved.

Controls include microphone mute, speaker output on/off, captions, a call timer, hang-up, and a language selector. Speaker toggles browser playback; it does not switch a physical handset's audio route. Hang-up immediately releases microphone tracks, stops playback, and closes the socket. The server then writes the report locally. Recognition starts only after permission and the Voice Live session are ready.

## Languages

The server hardcodes nine recognition candidates in `voice.py`:

| Language | Azure locale |
| --- | --- |
| English | `en-US` |
| Spanish | `es-ES` |
| Chinese (Mandarin) | `zh-CN` |
| Vietnamese | `vi-VN` |
| Arabic | `ar-SA` |
| Korean | `ko-KR` |
| Tagalog (Azure Filipino locale) | `fil-PH` |
| Urdu | `ur-IN` |
| French | `fr-FR` |

Automatic mode sends the comma-separated list in `session.input_audio_transcription.language`, using `azure-speech`. Selecting a language sends only that locale. This is the code equivalent of configuring input languages in Foundry. English is the first automatic candidate. Output uses `en-US-AvaMultilingualNeural`; speech quality and resource availability require live validation. The greeting says **nine**, matching the supplied list.

## Integration

Dependencies are in the existing `requirements.txt`. The resource and project default to the existing `PROJECT_ENDPOINT`; the agent defaults to `ASSISTANT_AGENT`. Optional environment overrides are `VOICELIVE_ENDPOINT`, `VOICELIVE_PROJECT`, `VOICELIVE_AGENT`, and `VOICELIVE_VOICE`. No deployed agent instructions are changed.

The browser streams mono PCM16 at 24 kHz through a same-origin WebSocket. The Python Voice Live SDK authenticates on the server and connects directly to the saved agent, preserving its configured tools. Browser messages can contain audio or hang-up only, not arbitrary agent events. Microphone audio is processed by Azure in live mode; this app does not write local recordings or transcripts.

Voice uses the saved agent's safety instructions/tools. It does **not** run the SMS application's separate shadow safety check. MCP approval requests use the SMS backend's explicit `RELIEFRN_READ_ONLY_TOOLS` allowlist; other requests are denied. Voice cannot transfer a live call or place a real callback. For this demo, every call automatically generates a local report on hang-up, even without a recognized name, a request for a person, or a transcript. The presenter has enabled this demo behavior; it is not recorded as caller consent. The UI discloses it before calling. WriteUp-agent summarizes the available transcript; missing details must not be invented. If generation fails, the app saves a clearly labeled incomplete report without raw conversation or contact details. Disk failures are surfaced rather than falsely claiming success.

Reports are written by the running Python process to its configured report directory (the working directory by default, or `--report-dir`). The terminal logs the saved file path. There is no browser download, report link, or additional report UI. Closing the tab or losing the connection still triggers the local save. Each call is processed once. No real forwarding or callback occurs. SMS retains its existing consent and report UI.

The existing `--preview` mode provides a clearly labeled, browser-spoken scripted greeting and microphone permission testing. It does not transcribe speech, answer questions, or contact Azure. Live failures never silently switch to preview. Use localhost or HTTPS for microphone access.

## References

- [Microsoft Voice Live language configuration](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-language-support)
- [Voice Live with existing Foundry agents](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-agents-quickstart)
- [Voice Live session and audio configuration](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-how-to)

Offline tests cover language configuration, audio validation, page integration, and connection cleanup. Live Microsoft authentication, regional availability, tool behavior, and recognition quality in each language must be checked with an authorized session.
