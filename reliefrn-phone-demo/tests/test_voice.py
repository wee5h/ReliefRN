"""Voice configuration and bridge contracts; no Azure requests."""
import asyncio
import base64
import json
import ssl
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

from app import create_app
from preview_agent import PreviewAgents
from voice import LANGUAGES, GREETING, live_call, session_settings, validate_audio, voice_ssl_context, VoiceServiceError


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


if __name__ == '__main__':
    unittest.main()
