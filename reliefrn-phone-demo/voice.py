"""Browser microphone -> local WebSocket -> Microsoft Voice Live / saved agent.

No telephony, browser credentials, or local audio recordings. Demo calls auto-save reports.
"""
import asyncio
import base64
import json
import logging
import os
import re
import socket
import ssl
import threading
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

Speak naturally in the caller's language. Use two or three short sentences and ask
one question at a time. Lead with the most useful next action. Do not restate what
the caller just said, do not list caveats before answering, and do not pad. Extra
length is for the places it carries weight: safety steps, and phone numbers and
addresses, which you always give in full. This is a phone call, so a long turn
costs the caller real waiting time.

Follow your saved source-verification, privacy, and safety instructions. Use your
configured lookup tools for factual assistance. Do not invent resources or availability.
You are an automated agent, not FEMA or a human. For immediate danger, tell the caller
to call 911 now; you cannot contact emergency services. Never delay this for tools.
Do not collect sensitive identifiers.

DEMO REPORTS AND HUMAN SUPPORT
This demo automatically prepares and saves a local report after every call ends.
Do not ask for report confirmation or require a name before a report can be made.
If useful, ask for a preferred name and callback number; these are optional.
Never invent missing details. Provide verified human-support contacts when needed.
Report generation happens after hang-up. Do not claim it has already been saved,
state a report number, emit [OFFER_CALLBACK], or invoke report or transfer tools.
Nothing is forwarded and no real callback or transfer is arranged. The demo's
automatic report setting is not a record of caller consent. Immediate danger
always takes priority over reports and contact collection.

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
        # silence_duration_ms is dead air on every single turn: nothing is committed
        # and no generation starts until it elapses. 650 read as lag before the model
        # did any work; the SDK's own sample uses 500. prefix_padding_ms is lookback
        # into the buffer already captured, so it costs nothing -- leave it alone.
        # (azure_semantic_vad_multilingual and semantic_detection_v1_multilingual also
        # exist and would cut this further, but neither is confirmed on this resource.)
        "turn_detection": {"type": "server_vad", "threshold": 0.5,
                           "prefix_padding_ms": 300,
                           "silence_duration_ms": int(os.getenv("VOICELIVE_SILENCE_MS", "400"))},
        "input_audio_noise_reduction": {"type": "azure_deep_noise_suppression"},
        "input_audio_echo_cancellation": {"type": "server_echo_cancellation"},
    }


# A spoken request to reach a person. The application watches for this so report
# creation is started by the app, not inferred by the agent from a vague "yes".
HUMAN_REQUEST = re.compile(
    r"(?:(?:talk|speak|connect|transfer|put\s+me\s+through)\s+(?:me\s+|us\s+)?(?:to|with)\s+"
    r"(?:a|an|the|some)?\s*(?:real|actual|live|human)?\s*"
    r"(?:person|human|someone|somebody|agent|representative|rep|operator|"
    r"advisor|case\s*worker|caseworker|supervisor|manager)"
    r"|(?:real|actual|live)\s+(?:person|human|people)"
    r"|human\s+(?:being|support|help|agent)"
    r"|call\s+me\s+back|calls?\s+back|callback"
    r"|(?:file|make|create|prepare|submit|start|open)\s+(?:a|an|my|the)?\s*"
    r"(?:report|claim|case)"
    r"|have\s+(?:someone|somebody|a\s+person)\s+(?:call|contact|reach)"
    r"|need\s+(?:to\s+)?(?:a\s+)?(?:person|human|representative))", re.I)
# Questions, refusals and hedges are answers to something else, not a name.
NOT_A_NAME = re.compile(r"\?|\b(?:no|nope|not|don't|dont|why|what|who|how|when|where|"
                        r"never\s*mind|nevermind|cancel|stop|wait|nothing|rather\s+not)\b", re.I)


def caller_name(text):
    """Read a spoken name, rejecting a sentence, a question or a refusal."""
    value = " ".join((text or "").split())
    value = re.sub(r"^(?:my\s+name\s+is|the\s+name\s+is|name'?s|this\s+is|it'?s|"
                   r"i'?m|i\s+am|call\s+me)\s+", "", value, flags=re.I)
    value = value.strip(" .,!\"'")
    if not value or len(value) > 60 or len(value.split()) > 5 or NOT_A_NAME.search(value):
        return None
    return value


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


# Browser-bound frames are queued, never written from the event loop. Deep enough
# to ride out a briefly unresponsive tab, shallow enough that shedding audio beats
# freezing the bridge.
OUTBOUND_FRAMES = 400
# A turn with no response.done by now is stalled, not thinking.
RESPONSE_TIMEOUT = float(os.getenv("VOICELIVE_RESPONSE_TIMEOUT", "25"))
# Tool-approval rounds per turn, mirroring the SMS path's attempt cap.
APPROVAL_ROUNDS = 3
# Consecutive unusable browser frames tolerated before the call is a lost cause.
BAD_FRAME_LIMIT = 25
CALL_LIMIT = 1800


class _SerialSocket:
    """Make flask-sock's writes safe for this bridge.

    simple_websocket writes with ``sock.send()`` and discards the return value, so
    a short write silently truncates a frame and the browser's parser desyncs. It
    also writes from two threads: this bridge, and its own reader thread, which
    emits a keepalive Ping every ping_interval. Complete every write and serialize
    them so no frame can be truncated or interleaved.
    """

    def __init__(self, sock):
        self._sock = sock
        self._lock = threading.Lock()

    def send(self, data):
        view = memoryview(data)
        with self._lock:
            sent = 0
            while sent < len(view):
                sent += self._sock.send(view[sent:])
            return sent

    def __getattr__(self, name):
        return getattr(self._sock, name)


def harden_socket(ws):
    """Complete short writes, and stop Nagle batching 40 ms audio frames."""
    raw = getattr(ws, "sock", None)
    if raw is None or isinstance(raw, _SerialSocket):
        return
    try:
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except OSError:
        pass
    ws.sock = _SerialSocket(raw)


async def live_call(ws, gateway, project_endpoint, agent, language, session=None):
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
        log = logging.getLogger("reliefrn")
        harden_socket(ws)
        outbound = asyncio.Queue(maxsize=OUTBOUND_FRAMES)
        turn = {"pending": None, "rounds": 0, "hangup": False}
        session = session if session is not None else {}
        transcript = session.setdefault("transcript", [])
        session.setdefault("name", None)
        stage = {"value": "idle"}

        def emit(payload):
            """Queue a browser-bound frame. Never blocks, so the loop never stalls."""
            try:
                outbound.put_nowait(payload)
            except asyncio.QueueFull:
                # A wedged tab should cost audio, not the entire call.
                if payload.get("type") == "audio":
                    return
                try:
                    outbound.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                outbound.put_nowait(payload)

        async def writer():
            """The only writer to the browser socket, and never on the loop thread.

            ws.send is a blocking syscall on a Werkzeug socket that carries no
            timeout. Called inline it froze this coroutine, the Azure event loop,
            the mic-forwarding task and the SDK heartbeat all at once.
            """
            while True:
                payload = await outbound.get()
                try:
                    await asyncio.to_thread(ws.send, json.dumps(payload))
                except Exception:
                    turn["hangup"] = True
                    return

        def note_request(text):
            """Capture an optional name; reports no longer depend on recognizing it.

            Only the name is captured during the call. The report itself is written
            at hangup, so the writeup gets the whole conversation as evidence.
            """
            if stage["value"] == "awaiting_name":
                name = caller_name(text)
                if name:
                    session["name"] = name
                    stage["value"] = "named"
                    log.info("Voice caller gave a name after asking for a person")
                return
            if stage["value"] == "idle" and HUMAN_REQUEST.search(text):
                stage["value"] = "awaiting_name"
                log.info("Voice caller asked for a person; waiting for a name")

        async def watchdog():
            """Surface a turn that never finishes instead of showing 'Listening'."""
            while True:
                await asyncio.sleep(1)
                started = turn["pending"]
                if started and time.monotonic() - started > RESPONSE_TIMEOUT:
                    turn["pending"] = None
                    raise VoiceServiceError(
                        {"message": f"No response completed within {RESPONSE_TIMEOUT:.0f}s"},
                        "response generation")

        async def upstream():
            ready = False
            async for event in conn:
                kind = event.type
                if kind in {"session.created", "session.updated", "response.created"}:
                    log.info("Voice Live event=%s", kind)
                if kind == "response.created":
                    turn["pending"] = time.monotonic()
                if kind == "session.updated" and not ready:
                    ready = True
                    await conn.send({"type": "conversation.item.create", "event_id": "voice_context", "item": {
                        "type": "message", "role": "system",
                        "content": [{"type": "input_text", "text": VOICE_CONTEXT}]}})
                    await conn.send({"type": "response.create", "event_id": "voice_greeting"})
                    turn["pending"] = time.monotonic()
                    emit({"type": "ready"})
                elif kind == "response.audio.delta":
                    # SDK decodes the wire's base64 into PCM bytes. Browser JSON
                    # transport needs base64 again, not bytes or their string repr.
                    emit({"type": "audio", "audio": base64.b64encode(event.delta).decode("ascii")})
                elif kind in {"response.audio_transcript.done", "conversation.item.input_audio_transcription.completed"}:
                    role = "user" if kind.startswith("conversation") else "assistant"
                    text = event.transcript.replace("[OFFER_CALLBACK]", "")
                    transcript.append({"role": role, "content": text})
                    if role == "user":
                        note_request(text)
                    emit({"type": "transcript", "role": role, "text": text})
                elif kind == "input_audio_buffer.speech_started":
                    turn["rounds"] = 0
                    emit({"type": "interrupt"})
                elif kind == "response.done":
                    turn["pending"] = None
                    response = event.as_dict().get("response", {})
                    if response.get("status") == "failed":
                        details = response.get("status_details") or {}
                        raise VoiceServiceError(details.get("error", details), "response generation",
                                                response.get("id"))
                    # Use the SMS application's explicit read-only allowlist. Deny other tools.
                    decided = False
                    for item in response.get("output", []):
                        if item.get("type") != "mcp_approval_request":
                            continue
                        key = f"{item.get('server_label', '')}:{item.get('name', '')}"
                        approved = key in gateway.approved_tools
                        if not approved:
                            log.warning("Voice Live denied tool %s; add it to "
                                        "RELIEFRN_READ_ONLY_TOOLS to allow the lookup", key)
                        await conn.send({"type": "conversation.item.create", "item": {
                            "type": "mcp_approval_response", "approval_request_id": item["id"],
                            "approve": approved}})
                        decided = True
                    # Continue the turn exactly once per batch. response.create cancels
                    # the generation already in flight by default, so one per approval
                    # made the requests cancel each other and clipped the reply.
                    if decided:
                        turn["rounds"] += 1
                        if turn["rounds"] > APPROVAL_ROUNDS:
                            # A denied tool gets re-requested, and an unbounded
                            # deny/retry ping-pong is pure silence on the call.
                            log.warning("Voice Live hit %d approval rounds; answering without tools",
                                        APPROVAL_ROUNDS)
                            turn["rounds"] = 0
                            await conn.send({"type": "conversation.item.create", "item": {
                                "type": "message", "role": "system",
                                "content": [{"type": "input_text", "text":
                                             "Tool lookups are unavailable for this turn. Answer now "
                                             "from what you already know, briefly say what you could "
                                             "not verify, and do not call any tool."}]}})
                        await conn.send({"type": "response.create"})
                        turn["pending"] = time.monotonic()
                    else:
                        turn["rounds"] = 0
                    emit({"type": "response_done"})
                elif kind == "error":
                    # The shared logger redacts credentials; the browser receives a generic error.
                    details = event.error.as_dict()
                    if not ready or details.get("type") == "server_error":
                        raise VoiceServiceError(details, "conversation" if ready else "session configuration",
                                                getattr(event, "event_id", None))
                    # Most Voice Live errors are recoverable and the session stays open.
                    # Raising on every one was ending whole calls over a transient.
                    log.warning("Voice Live recoverable error: %s",
                                details.get("message") or details.get("code"))
                elif kind in {"response.mcp_call.failed", "mcp_list_tools.failed",
                              "conversation.item.input_audio_transcription.failed"}:
                    # Silently ignored before: a failed lookup or failed recognition
                    # looks identical to the agent ignoring the caller.
                    log.warning("Voice Live %s: %s", kind, event.as_dict())
            # The SDK's iterator returns rather than raises when Azure drops the
            # socket, so this used to end the call with no message and no log line.
            if not turn["hangup"]:
                raise VoiceServiceError({"message": "Voice Live closed the connection"}, "conversation")

        async def downstream():
            deadline = time.monotonic() + CALL_LIMIT
            unusable = 0
            while True:
                if time.monotonic() > deadline:
                    # Expiring used to drop the call with no explanation at all.
                    turn["hangup"] = True
                    emit({"type": "error", "message": "This demo call reached its 30-minute "
                                                      "limit. You can call again."})
                    await asyncio.sleep(.25)  # let the writer flush before teardown
                    return
                raw = await asyncio.to_thread(ws.receive, timeout=0.25)
                if raw is None:
                    if not ws.connected:
                        turn["hangup"] = True
                        return
                    continue
                try:
                    if not isinstance(raw, str) or len(raw) > 34000:
                        raise ValueError("Invalid message")
                    message = json.loads(raw)
                    if isinstance(message, dict) and message.get("type") == "end":
                        turn["hangup"] = True
                        return
                    audio = validate_audio(message)
                except ValueError:
                    # One unusable frame must not end a live call. A flood still does.
                    unusable += 1
                    if unusable > BAD_FRAME_LIMIT:
                        raise
                    continue
                unusable = 0
                await conn.send({"type": "input_audio_buffer.append", "audio": audio})

        tasks = [asyncio.create_task(job()) for job in (upstream, downstream, writer, watchdog)]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


def save_callback_report(session, make_report, agent=None, report_error=None):
    """Write the callback report once the call is over.

    Runs on the call's own worker thread after audio stops, so a slow WriteUp
    run cannot stall the bridge, and the writeup sees the entire conversation rather
    than only the turns that happened to precede the caller giving their name.
    """
    if session is None:
        return None
    if session.get("report_attempted"):
        return session.get("report")
    name, transcript = session.get("name"), session.get("transcript") or []
    if not make_report:
        return None
    session["report_attempted"] = True
    log = logging.getLogger("reliefrn")
    try:
        saved = make_report(list(transcript), name)
        session["report"] = saved
        log.info("Voice callback report saved on hangup: %s", (saved or {}).get("filename"))
        return saved
    except Exception as error:
        if report_error:
            report_error(error, "Voice callback report", agent=agent)
        else:
            log.error("Voice callback report failed: %s", error)
        return None


def register_voice(app, gateway, project_endpoint, agent, report_error=None, make_report=None):
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
        session = {"transcript": [], "name": None}
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
                asyncio.run(live_call(ws, gateway, project_endpoint, agent, language, session))
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
            # Audio is stopped. Keep the socket for the result while the browser
            # downloads; a disconnected browser does not prevent the local save.
            saved = save_callback_report(session, make_report, agent, report_error)
            try:
                ws.send(json.dumps({"type": "report", "report": saved}))
            except Exception:
                pass
            finally:
                ws.close()
