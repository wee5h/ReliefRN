"""Browser microphone -> local WebSocket -> Microsoft Voice Live / saved agent.

No telephony, browser credentials, local recordings, or automatic reports.
"""
import asyncio
import base64
import json
import logging
import os
import ssl
import time
from urllib.parse import urlsplit

from flask import jsonify, request
from flask_sock import Sock
import certifi

LANGUAGES = [
    {"code": "en-US", "name": "English", "native": "English"},
    {"code": "es-ES", "name": "Spanish", "native": "Español"},
    {"code": "zh-CN", "name": "Chinese", "native": "中文（普通话）"},
    {"code": "vi-VN", "name": "Vietnamese", "native": "Tiếng Việt"},
    {"code": "ar-SA", "name": "Arabic", "native": "العربية"},
    {"code": "ko-KR", "name": "Korean", "native": "한국어"},
    {"code": "fil-PH", "name": "Tagalog", "native": "Tagalog"},
    # Recognition/LID uses ur-IN; ur-PK is a synthesis locale, not an input locale.
    {"code": "ur-IN", "name": "Urdu", "native": "اردو"},
    {"code": "fr-FR", "name": "French", "native": "Français"},
]
GREETING = ("Hi, I'm ReliefRN, an automated disaster assistance agent. "
            "I speak nine languages. Tell me what you need help with in your preferred language.")
VOICE_CONTEXT = """Application-selected channel: voice. This is a simulated browser phone call.
These channel-specific directions describe the current application's capabilities.
Apply general report and callback instructions only when this interface supports them.

Speak naturally in the caller's language. Prefer brief, direct replies and one
question at a time. Give the most useful next action first, avoid repeating
yourself, and offer more detail when helpful. Before speaking, quietly consider
whether unnecessary wording can be removed. There is no fixed word, sentence,
or speaking-time limit: use as much detail as the situation needs, particularly
for safety, clear explanations, and complete phone numbers or addresses. Do not
announce this check or stop an answer midway just to make it shorter. Treat the
saved voice sentence count as a brevity preference, not a mandatory cutoff.

Follow your saved source-verification, privacy, and safety instructions. Use your
configured lookup tools for factual assistance. Do not invent resources or availability.
You are an automated agent, not FEMA or a human. For immediate danger, tell the caller
to call 911 now; you cannot contact emergency services. Never delay this for tools.
Do not collect sensitive identifiers.

CONSENT AND HUMAN SUPPORT IN THIS VOICE INTERFACE
The voice/web report-consent workflow is proposed, not active in this voice app.
This call has no report-consent controls, report preparation or saving, keypad
consent, callbacks, or transfers. Do not offer a report, ask permission to prepare
one, or emit or speak [OFFER_CALLBACK]. Do not collect a name or callback number
for unavailable follow-up. Do not invoke WriteUp, report, email, or transfer tools.
Never claim that information was saved as a report, forwarded, or sent to FEMA,
or that a callback or human handoff has been arranged.

If the caller requests a person, report, or callback, briefly explain the relevant
limitation and provide verified official human-support contact options. Continue
helping with the original need. Do not pressure the caller or repeat unwanted
offers. Microphone permission, a request for a person, a spoken yes, END, silence,
or hanging up does not authorize preparing or saving a report. Report consent
must be recorded and enforced by the application, never inferred by the agent.
Immediate danger takes priority over consent or contact collection; a simulated
report must never replace real emergency or human-support contact guidance.

The available languages are English, Spanish, Mandarin Chinese, Vietnamese, Arabic,
Korean, Tagalog, Urdu, and French. Continue in the caller's language; clarify if unclear.
Start with exactly this greeting, then wait for the caller: """ + GREETING


class VoiceServiceError(RuntimeError):
    """Preserve service diagnostics for the app's credential-redacted error logger."""
    def __init__(self, details, stage, event_id=None):
        details = details if isinstance(details, dict) else {}
        self.code = details.get("code")
        self.param = details.get("param")
        self.type = details.get("type")
        self.request_id = event_id
        self.body = {"stage": stage, "error": details}
        super().__init__(f"Voice Live {stage}: {details.get('message') or self.code or 'Unspecified service error'}")


def session_settings(language="auto"):
    if language != "auto" and language not in {item["code"] for item in LANGUAGES}:
        raise ValueError("Unsupported language")
    return {
        "modalities": ["text", "audio"],
        "input_audio_format": "pcm16", "output_audio_format": "pcm16",
        "input_audio_sampling_rate": 24000,
        "input_audio_transcription": {
            "model": "azure-speech",
            "language": ",".join(item["code"] for item in LANGUAGES) if language == "auto" else language,
        },
        "voice": {"type": "azure-standard", "name": os.getenv("VOICELIVE_VOICE", "en-US-AvaMultilingualNeural")},
        # Volume VAD supports all configured languages, unlike English-only semantic VAD.
        "turn_detection": {"type": "server_vad", "threshold": 0.5,
                           "prefix_padding_ms": 300, "silence_duration_ms": 650},
        "input_audio_noise_reduction": {"type": "azure_deep_noise_suppression"},
        "input_audio_echo_cancellation": {"type": "server_echo_cancellation"},
    }


def validate_audio(message):
    """Accept bounded audio chunks only, never client-generated agent instructions."""
    if not isinstance(message, dict) or message.get("type") != "audio":
        raise ValueError("Expected an audio chunk")
    audio = message.get("audio")
    if not isinstance(audio, str) or len(audio) > 32768:
        raise ValueError("Invalid audio size")
    raw = base64.b64decode(audio, validate=True)
    if not raw or len(raw) % 2:
        raise ValueError("Expected PCM16 audio")
    return audio


def voice_ssl_context():
    """Keep system/custom trust and add bundled roots for macOS Python installs."""
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=certifi.where())
    return context


async def live_call(ws, gateway, project_endpoint, agent, language):
    from azure.ai.voicelive.aio import connect

    parsed = urlsplit(project_endpoint)
    endpoint = os.getenv("VOICELIVE_ENDPOINT", f"https://{parsed.netloc}")
    project = os.getenv("VOICELIVE_PROJECT", parsed.path.rstrip("/").split("/")[-1])
    # The SDK supports the existing synchronous Azure Identity credential.
    async with connect(endpoint=endpoint, credential=gateway.credential,
                       agent_name=os.getenv("VOICELIVE_AGENT", agent), project_name=project,
                       api_version="2026-04-10",
                       connection_options={"vendor_options": {"ssl": voice_ssl_context()}}) as conn:
        await conn.send({"type": "session.update", "event_id": "voice_session_update",
                         "session": session_settings(language)})

        async def upstream():
            ready = False
            async for event in conn:
                kind = event.type
                if kind in {"session.created", "session.updated", "response.created"}:
                    logging.getLogger("reliefrn").info("Voice Live event=%s", kind)
                if kind == "session.updated" and not ready:
                    ready = True
                    await conn.send({"type": "conversation.item.create", "event_id": "voice_context", "item": {
                        "type": "message", "role": "system",
                        "content": [{"type": "input_text", "text": VOICE_CONTEXT}]}})
                    await conn.send({"type": "response.create", "event_id": "voice_greeting"})
                    ws.send(json.dumps({"type": "ready"}))
                elif kind == "response.audio.delta":
                    # SDK decodes the wire's base64 into PCM bytes. Browser JSON
                    # transport needs base64 again, not bytes or their string repr.
                    audio = base64.b64encode(event.delta).decode("ascii")
                    ws.send(json.dumps({"type": "audio", "audio": audio}))
                elif kind in {"response.audio_transcript.done", "conversation.item.input_audio_transcription.completed"}:
                    ws.send(json.dumps({"type": "transcript", "role": "user" if kind.startswith("conversation") else "assistant",
                                        "text": event.transcript.replace("[OFFER_CALLBACK]", "")}))
                elif kind == "input_audio_buffer.speech_started":
                    ws.send(json.dumps({"type": "interrupt"}))
                elif kind == "response.done":
                    response = event.as_dict().get("response", {})
                    if response.get("status") == "failed":
                        details = response.get("status_details") or {}
                        raise VoiceServiceError(details.get("error", details), "response generation",
                                                response.get("id"))
                    # Use the SMS application's explicit read-only allowlist. Deny other tools.
                    for item in response.get("output", []):
                        if item.get("type") == "mcp_approval_request":
                            key = f"{item.get('server_label', '')}:{item.get('name', '')}"
                            approved = key in gateway.approved_tools
                            await conn.send({"type": "conversation.item.create", "item": {
                                "type": "mcp_approval_response", "approval_request_id": item["id"], "approve": approved}})
                            await conn.send({"type": "response.create"})
                    ws.send(json.dumps({"type": "response_done"}))
                elif kind == "error":
                    # The shared logger redacts credentials; the browser receives a generic error.
                    raise VoiceServiceError(event.error.as_dict(),
                                            "conversation" if ready else "session configuration",
                                            getattr(event, "event_id", None))

        async def downstream():
            deadline = time.monotonic() + 1800
            while time.monotonic() < deadline:
                raw = await asyncio.to_thread(ws.receive, timeout=0.25)
                if raw is None:
                    if not ws.connected:
                        return
                    continue
                if not isinstance(raw, str) or len(raw) > 34000:
                    raise ValueError("Invalid message")
                message = json.loads(raw)
                if isinstance(message, dict) and message.get("type") == "end":
                    return
                await conn.send({"type": "input_audio_buffer.append", "audio": validate_audio(message)})

        tasks = [asyncio.create_task(upstream()), asyncio.create_task(downstream())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


def register_voice(app, gateway, project_endpoint, agent, report_error=None):
    app.config.setdefault("SOCK_SERVER_OPTIONS", {"ping_interval": 20, "max_message_size": 34000})
    sock = Sock(app)

    @app.get("/call")
    def call_page():
        return app.send_static_file("call.html")

    @app.get("/api/voice/config")
    def voice_config():
        return jsonify(languages=LANGUAGES, greeting=GREETING, preview=gateway.test_mode)

    @sock.route("/api/voice/stream")
    def stream(ws):
        # Browser WebSockets bypass the normal JSON POST checks.
        if request.headers.get("Origin", "").rstrip("/") != request.host_url.rstrip("/"):
            ws.close(reason="Same-origin calls only")
            return
        language = request.args.get("language", "auto")
        try:
            session_settings(language)
            if gateway.test_mode:
                ws.send(json.dumps({"type": "preview", "text": GREETING}))
                # Preview never transmits microphone data to Azure.
                while ws.connected:
                    raw = ws.receive(timeout=1)
                    if raw and json.loads(raw).get("type") == "end":
                        break
            else:
                asyncio.run(live_call(ws, gateway, project_endpoint, agent, language))
        except Exception as error:
            if report_error:
                report_error(error, "Voice Live connection", agent=agent)
            else:
                logging.getLogger("reliefrn").error("Voice call ended: %s", type(error).__name__)
            try:
                ws.send(json.dumps({"type": "error", "message":
                    "The voice connection is unavailable. Check Voice Live access for this Foundry resource, or use Messages."}))
            except Exception:
                pass
        finally:
            ws.close()
