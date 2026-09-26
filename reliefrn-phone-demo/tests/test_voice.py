"""Voice configuration and bridge contracts; no Azure requests."""
import asyncio
import base64
import json
import ssl
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

from app import create_app
from preview_agent import PreviewAgents
from voice import (LANGUAGES, GREETING, live_call, session_settings, validate_audio, voice_ssl_context,
                   VoiceServiceError, _SerialSocket, HUMAN_REQUEST, caller_name, save_callback_report)


class VoiceTests(unittest.TestCase):
    def test_service_error_preserves_actual_azure_reason(self):
        from azure.ai.voicelive.models import ServerEventError
        event = ServerEventError({"type": "error", "event_id": "server_error_1", "error": {
            "type": "invalid_request_error", "code": "invalid_value",
            "message": "Unsupported language configuration", "param": "input_audio_transcription.language",
            "event_id": "voice_session_update"}})

        class Connection:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def send(self, message): pass
            def __aiter__(self): return self.events()
            async def events(self): yield event

        class Socket:
            connected = True
            def receive(self, timeout):
                import time
                time.sleep(.01)
                return None

        with patch('azure.ai.voicelive.aio.connect', return_value=Connection()):
            with self.assertRaises(VoiceServiceError) as caught:
                asyncio.run(live_call(Socket(), SimpleNamespace(credential=object()),
                    'https://resource.services.ai.azure.com/api/projects/ReliefRN', 'Assistance-agent', 'auto'))
        self.assertIn('Unsupported language configuration', str(caught.exception))
        self.assertEqual(caught.exception.param, 'input_audio_transcription.language')
        self.assertEqual(caught.exception.body['error']['event_id'], 'voice_session_update')
        self.assertEqual(caught.exception.request_id, 'server_error_1')

    def test_real_sdk_passes_certificate_context_to_websocket_transport(self):
        import aiohttp
        from azure.core.credentials import AccessToken
        from azure.ai.voicelive.aio import ConnectionError as VoiceConnectionError
        gateway = SimpleNamespace(credential=SimpleNamespace(
            get_token=lambda *args: AccessToken('offline-test-token', 9999999999)))
        # Exercise the actual SDK option mapping, stopping only at the network boundary.
        with patch('aiohttp.ClientSession.ws_connect', new_callable=AsyncMock,
                   side_effect=aiohttp.ClientConnectionError('test network boundary')) as websocket:
            with self.assertRaises(VoiceConnectionError):
                asyncio.run(live_call(None, gateway,
                    'https://resource.services.ai.azure.com/api/projects/ReliefRN',
                    'Assistance-agent', 'auto'))
        context = websocket.call_args.kwargs['ssl']
        self.assertIsInstance(context, ssl.SSLContext)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertGreater(context.cert_store_stats()['x509_ca'], 0)

    def test_tls_has_trusted_roots_and_requires_valid_host_certificate(self):
        context = voice_ssl_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertGreater(context.cert_store_stats()['x509_ca'], 0)

    def test_exact_language_list_and_single_language_selection(self):
        self.assertEqual([item['code'] for item in LANGUAGES],
                         ['en-US', 'es-ES', 'zh-CN', 'vi-VN', 'ar-SA', 'ko-KR', 'fil-PH', 'ur-IN', 'fr-FR'])
        settings = session_settings()
        self.assertEqual(settings['input_audio_transcription']['language'].split(','),
                         [item['code'] for item in LANGUAGES])
        self.assertEqual(session_settings('ur-IN')['input_audio_transcription']['language'], 'ur-IN')
        # Do not reuse the Urdu speech-output locale for recognition.
        with self.assertRaises(ValueError):
            session_settings('ur-PK')
        with self.assertRaises(ValueError):
            session_settings('invented')
        self.assertIn('nine languages', GREETING)

    def test_browser_cannot_supply_agent_instructions_or_bad_audio(self):
        for message in [[], {'type': 'session.update'}, {'type': 'audio', 'audio': '!!!'},
                        {'type': 'audio', 'audio': 'A' * 33000},
                        {'type': 'audio', 'audio': base64.b64encode(b'x').decode()}]:
            with self.subTest(message=str(message)[:60]), self.assertRaises(ValueError):
                validate_audio(message)
        audio = base64.b64encode(b'\0\0' * 960).decode()
        self.assertEqual(validate_audio({'type': 'audio', 'audio': audio}), audio)

    def test_call_routes_reuse_app_and_expose_no_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            client = create_app(PreviewAgents(), directory).test_client()
            with client.get('/call') as response:
                self.assertEqual(response.status_code, 200)
            config = client.get('/api/voice/config').get_json()
            self.assertEqual(set(config), {'languages', 'greeting', 'preview'})
            self.assertTrue(config['preview'])
            self.assertEqual(len(config['languages']), 9)
            with client.get('/') as response:
                self.assertIn(b'/call', response.data)
            self.assertEqual(client.get('/api/session').status_code, 200)

    def test_live_bridge_greets_once_and_closes_on_hangup(self):
        from azure.ai.voicelive.models import ServerEventResponseAudioDelta
        pcm = b'\x00\x00\xff\x7f\x00\x80\x11\x22'
        audio_event = ServerEventResponseAudioDelta({
            'type': 'response.audio.delta', 'response_id': 'response-test',
            'item_id': 'item-test', 'output_index': 0, 'content_index': 0,
            'delta': base64.b64encode(pcm).decode('ascii')})
        self.assertEqual(audio_event.delta, pcm)
        class Socket:
            connected = True
            def __init__(self): self.sent = []
            def send(self, value): self.sent.append(json.loads(value))
            def receive(self, timeout):
                if any(event['type'] == 'audio' for event in self.sent):
                    return '{"type":"end"}'
                import time
                time.sleep(.01)
                return None

        class Connection:
            def __init__(self): self.sent = []; self.closed = False
            async def __aenter__(self): return self
            async def __aexit__(self, *args): self.closed = True
            async def send(self, event): self.sent.append(event)
            def __aiter__(self): return self.events()
            async def events(self):
                yield SimpleNamespace(type='session.updated')
                yield SimpleNamespace(type='session.updated')
                yield SimpleNamespace(type='input_audio_buffer.speech_started')
                yield audio_event
                await asyncio.sleep(10)

        ws, conn = Socket(), Connection()
        gateway = SimpleNamespace(credential=object(), approved_tools=set())
        with patch('azure.ai.voicelive.aio.connect', return_value=conn) as connect:
            asyncio.run(live_call(ws, gateway, 'https://resource.services.ai.azure.com/api/projects/ReliefRN',
                                  'Assistance-agent', 'auto'))
        self.assertEqual(connect.call_args.kwargs['agent_name'], 'Assistance-agent')
        self.assertEqual(connect.call_args.kwargs['project_name'], 'ReliefRN')
        self.assertIs(connect.call_args.kwargs['credential'], gateway.credential)
        context = connect.call_args.kwargs['connection_options']['vendor_options']['ssl']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(sum(event['type'] == 'response.create' for event in conn.sent), 1)
        audio = next(event['audio'] for event in ws.sent if event['type'] == 'audio')
        self.assertIsInstance(audio, str)
        self.assertEqual(base64.b64decode(audio, validate=True), pcm)
        self.assertIn({'type': 'interrupt'}, ws.sent)
        self.assertTrue(conn.closed)

    def test_only_a_real_name_after_a_real_request_starts_a_report(self):
        for asked in ['can I talk to a person', 'I want to speak with a representative',
                      'is there a real person', 'can someone call me back', 'I need a human',
                      'please file a report for me', 'transfer me to an operator']:
            self.assertTrue(HUMAN_REQUEST.search(asked), asked)
        for ordinary in ['what shelters are open', 'my house flooded', 'is the road to Tampa closed',
                         'can you tell me about FEMA aid']:
            self.assertFalse(HUMAN_REQUEST.search(ordinary), ordinary)
        self.assertEqual(caller_name('my name is James Okonkwo'), 'James Okonkwo')
        self.assertEqual(caller_name("it's Priya"), 'Priya')
        for refusal in ['why do you need my name', 'no thanks', 'I would rather not',
                        'what shelters are open near me tonight please']:
            self.assertIsNone(caller_name(refusal), refusal)

    def test_hangup_writes_the_report_from_the_whole_call_when_a_name_was_given(self):
        made = []
        session = {'transcript': [], 'name': None}

        def make_report(messages, name):
            made.append((list(messages), name))
            return {'number': 7, 'filename': 'reliefrn-report-0007.md',
                    'url': '/api/reports/reliefrn-report-0007.md'}

        def said(text):
            return SimpleNamespace(type='conversation.item.input_audio_transcription.completed',
                                   transcript=text)

        class Socket:
            connected = True
            def __init__(self): self.sent = []
            def send(self, value): self.sent.append(json.loads(value))
            def receive(self, timeout):
                if len(session['transcript']) >= 3:
                    return '{"type":"end"}'
                time.sleep(.005)
                return None

        class Connection:
            def __init__(self): self.sent = []; self.closed = False
            async def __aenter__(self): return self
            async def __aexit__(self, *args): self.closed = True
            async def send(self, event): self.sent.append(event)
            def __aiter__(self): return self.events()
            async def events(self):
                yield SimpleNamespace(type='session.updated')
                yield said('can I talk to a real person please')
                yield said('Maria Lopez')
                yield said('my street is still flooded')
                await asyncio.sleep(10)

        ws, conn = Socket(), Connection()
        gateway = SimpleNamespace(credential=object(), approved_tools=set())
        with patch('azure.ai.voicelive.aio.connect', return_value=conn):
            asyncio.run(live_call(ws, gateway, 'https://resource.services.ai.azure.com/api/projects/ReliefRN',
                                  'Assistance-agent', 'auto', session))
        self.assertEqual(made, [], 'nothing is written while the caller is still on the line')
        self.assertEqual(session['name'], 'Maria Lopez')

        self.assertEqual(save_callback_report(session, make_report, 'Assistance-agent')['number'], 7)
        messages, name = made[0]
        self.assertEqual(name, 'Maria Lopez')
        # The writeup gets the turns after the name too, not just the ones before it.
        self.assertEqual([item['content'] for item in messages],
                         ['can I talk to a real person please', 'Maria Lopez',
                          'my street is still flooded'])

    def test_demo_hangup_writes_once_without_name_or_transcript(self):
        made = []
        def make_report(*args):
            made.append(args)
            return {'filename': 'demo.md'}
        for session in [{'transcript': [{'role': 'user', 'content': 'what shelters are open'}]}, {}]:
            first = save_callback_report(session, make_report)
            self.assertEqual(save_callback_report(session, make_report), first)
        self.assertEqual(len(made), 2)
        self.assertEqual(made[0][1], None)
        self.assertEqual(made[1], ([], None))
        self.assertIsNone(save_callback_report(None, make_report))

    def test_hangup_saves_locally_without_browser_report_messages(self):
        class Socket:
            connected = True
            def __init__(self): self.sent = []
            def send(self, data): self.sent.append(json.loads(data))
            def receive(self, timeout): return '{"type":"end"}'
            def close(self): self.connected = False

        for fail in [False, True, 'refused']:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                gateway = PreviewAgents()
                app = create_app(gateway, directory)
                client = app.test_client()
                client.get('/api/voice/config')
                ws = Socket()
                original = gateway.write_report
                effect = (lambda *args, **kwargs: 'REPORT_NOT_AUTHORIZED') if fail == 'refused' else RuntimeError('unavailable') if fail else original
                with patch.object(gateway, 'write_report', side_effect=effect):
                    with app.test_request_context('/api/voice/stream', headers={
                            'Origin': 'http://localhost'}):
                        app.view_functions['stream'].__wrapped__(ws)
                self.assertFalse(any(event['type'] == 'report' for event in ws.sent))
                self.assertFalse(ws.connected)
                files = list(Path(directory).glob('reliefrn-report-*.md'))
                self.assertEqual(len(files), 1)
                body = files[0].read_text()
                self.assertIn('consent was not recorded', body)
                self.assertEqual('Incomplete demo call report' in body, bool(fail))
                self.assertEqual(client.get('/api/reports/' + files[0].name).status_code, 404)
                self.assertEqual(client.get('/api/session').get_json()['reports'], [])

    def test_serial_socket_completes_short_writes(self):
        class Stingy:
            """A socket that writes 7 bytes at a time, as send(2) is allowed to."""
            def __init__(self): self.out = bytearray()
            def send(self, view):
                chunk = bytes(view[:7])
                self.out += chunk
                return len(chunk)

        raw, frame = Stingy(), bytes(range(256)) * 12
        self.assertEqual(_SerialSocket(raw).send(frame), len(frame))
        self.assertEqual(bytes(raw.out), frame,
                         'a truncated frame desynchronises the browser parser and wedges the call')

    def test_approvals_batch_into_one_response_and_a_bad_frame_keeps_the_call(self):
        done = SimpleNamespace(type='response.done', as_dict=lambda: {'response': {
            'status': 'completed', 'id': 'response-1', 'output': [
                {'type': 'mcp_approval_request', 'id': 'approval-1',
                 'server_label': 'weather', 'name': 'NWSWeatherAlertsAPI'},
                {'type': 'mcp_approval_request', 'id': 'approval-2',
                 'server_label': 'fema', 'name': 'OpenFEMADisasterAssistanceAPI'}]}})

        class Socket:
            connected = True
            def __init__(self):
                self.sent = []
                self.outgoing = ['{"type":"audio","audio":"!!! not base64 !!!"}',
                                 json.dumps({'type': 'audio',
                                             'audio': base64.b64encode(b'\0\0' * 960).decode()}),
                                 '{"type":"end"}']
            def send(self, value): self.sent.append(json.loads(value))
            def receive(self, timeout):
                if not self.outgoing:
                    return None
                if self.outgoing[0] == '{"type":"end"}' and not any(
                        event['type'] == 'response_done' for event in self.sent):
                    return None  # hold the hangup until the approval round is answered
                return self.outgoing.pop(0)

        class Connection:
            def __init__(self): self.sent = []; self.closed = False
            async def __aenter__(self): return self
            async def __aexit__(self, *args): self.closed = True
            async def send(self, event): self.sent.append(event)
            def __aiter__(self): return self.events()
            async def events(self):
                yield SimpleNamespace(type='session.updated')
                yield done
                await asyncio.sleep(10)

        ws, conn = Socket(), Connection()
        gateway = SimpleNamespace(credential=object(), approved_tools={'weather:NWSWeatherAlertsAPI'})
        with patch('azure.ai.voicelive.aio.connect', return_value=conn):
            asyncio.run(live_call(ws, gateway, 'https://resource.services.ai.azure.com/api/projects/ReliefRN',
                                  'Assistance-agent', 'auto'))
        approvals = [event for event in conn.sent
                     if event.get('item', {}).get('type') == 'mcp_approval_response']
        self.assertEqual([item['item']['approve'] for item in approvals], [True, False],
                         'the allowlist decides each tool independently')
        # response.create cancels the generation already in flight by default, so one
        # per approval made the requests cancel each other and clipped the reply.
        self.assertEqual(sum(event['type'] == 'response.create' for event in conn.sent), 2,
                         'greeting plus exactly one continuation for the whole batch')
        self.assertEqual(sum(event['type'] == 'input_audio_buffer.append' for event in conn.sent), 1,
                         'the unusable frame is skipped and the good frame still reaches Azure')


if __name__ == '__main__':
    unittest.main()
