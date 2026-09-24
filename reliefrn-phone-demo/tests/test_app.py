"""Behavior tests with a fake agent: no Azure account or network required."""
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import Chat, ReportStore, create_app, confirms_callback


class FakeAgents:
    test_mode = False

    def __init__(self):
        self.report_calls = 0
        self.reply_calls = 0
        self.fail_write = False
        self.fail_reply = False
        self.last_report_transcript = []

    def respond(self, chat, text):
        self.reply_calls += 1
        if self.fail_reply:
            raise TimeoutError()
        if 'callback' in text.lower():
            return 'I can help with human follow-up.\n[OFFER_CALLBACK]'
        return 'What city and state are you in?'

    def write_report(self, chat):
        self.report_calls += 1
        self.last_report_transcript = list(chat.messages)
        if self.fail_write:
            raise RuntimeError('temporary agent failure')
        return '# Agent-created report\n\nOriginal format is preserved.\n'


class ReliefRNTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.gateway = FakeAgents()
        self.app = create_app(self.gateway, self.temp.name)
        self.app.testing = True
        self.client = self.app.test_client()
        self.client.get('/api/session')

    def send(self, text, action='message', request_id=None, client=None):
        return (client or self.client).post('/api/message', json={
            'text': text, 'action': action, 'request_id': request_id or str(uuid.uuid4())})

    def offer(self):
        result = self.send('I want a callback').get_json()
        self.assertTrue(result['callback_pending'])
        self.assertIn('simulated', result['messages'][-1]['content'])
        self.assertNotIn('[OFFER_CALLBACK]', str(result))

    def test_confirm_generates_saved_report_with_verbatim_agent_body(self):
        self.offer()
        result = self.send('Yes please').get_json()
        self.assertEqual(result['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 1)
        report = result['reports'][0]
        self.assertEqual(report['filename'], 'reliefrn-report-0001.md')
        self.assertEqual((Path(self.temp.name) / report['filename']).read_text(), '# Agent-created report\n\nOriginal format is preserved.\n')
        self.assertEqual(self.gateway.last_report_transcript[-1]['content'], 'Yes please')
        self.assertIn('created and saved', result['messages'][-1]['content'])
        with self.client.get(report['url']) as download:
            self.assertEqual(download.status_code, 200)

    def test_button_confirm_and_duplicate_request_only_write_once(self):
        self.offer()
        request_id = str(uuid.uuid4())
        first = self.send('Yes, prepare report', 'confirm_callback', request_id).get_json()
        second = self.send('Yes, prepare report', 'confirm_callback', request_id).get_json()
        self.assertEqual(first, second)
        self.assertEqual(self.gateway.report_calls, 1)

    def test_generic_yes_without_offer_never_generates(self):
        self.send('yes')
        self.assertEqual(self.gateway.report_calls, 0)

    def test_refusal_and_qualified_consent_never_generate(self):
        for text in ['No thanks', 'yes but not now', 'yes if I can review it first', 'not sure', 'yes what happens next?', 'Do not call me', 'Wait, please prepare the report later']:
            with self.subTest(text=text):
                self.client.post('/api/session', json={'new': True})
                self.offer()
                result = self.send(text).get_json()
                self.assertEqual(result['report_status'], 'none')
        self.assertEqual(self.gateway.report_calls, 0)

    def test_unrelated_reply_expires_pending_offer(self):
        self.offer()
        self.send('What are your hours?')
        self.send('yes')
        self.assertEqual(self.gateway.report_calls, 0)

    def test_refusal_button_does_not_generate(self):
        self.offer()
        result = self.send('Not now', 'decline_callback').get_json()
        self.assertFalse(result['callback_pending'])
        self.assertEqual(self.gateway.report_calls, 0)

    def test_report_failure_retry_and_no_false_success(self):
        self.offer()
        self.gateway.fail_write = True
        result = self.send('yes').get_json()
        self.assertEqual(result['report_status'], 'failed')
        self.assertEqual(result['reports'], [])
        self.assertNotIn('has been created', result['messages'][-1]['content'])
        self.gateway.fail_write = False
        result = self.send('Retry report', 'retry_report').get_json()
        self.assertEqual(result['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 2)

    def test_disk_failure_retry_reuses_report_draft(self):
        self.offer()
        with patch.object(self.app.extensions['reliefrn_reports'], 'save', side_effect=OSError('disk')):
            self.assertEqual(self.send('yes').get_json()['report_status'], 'failed')
        self.assertEqual(self.send('Retry report', 'retry_report').get_json()['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 1)

    def test_numbering_survives_new_conversation_and_server_restart(self):
        self.offer()
        self.send('yes')
        self.client.post('/api/session', json={'new': True})
        self.offer()
        self.assertEqual(self.send('yes').get_json()['reports'][0]['number'], 2)
        store = ReportStore(self.temp.name)
        self.assertEqual(store.save('third report')['number'], 3)
        self.assertEqual(len(list(Path(self.temp.name).glob('*.md'))), 3)

    def test_concurrent_stores_never_overwrite_reports(self):
        errors = []
        def save(index):
            try:
                ReportStore(self.temp.name).save(f'report-{index}')
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=save, args=(i,)) for i in range(8)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(errors, [])
        self.assertEqual({p.read_text() for p in Path(self.temp.name).glob('*.md')}, {f'report-{i}' for i in range(8)})

    def test_report_download_requires_owning_conversation(self):
        self.offer()
        url = self.send('yes').get_json()['reports'][0]['url']
        other = self.app.test_client()
        other.get('/api/session')
        self.assertEqual(other.get(url).status_code, 404)
        self.assertEqual(other.get('/api/reports/../../app.py').status_code, 404)

    def test_failed_assistance_can_retry_without_duplicate_message(self):
        request_id = str(uuid.uuid4())
        self.gateway.fail_reply = True
        self.assertEqual(self.send('Help me', request_id=request_id).status_code, 502)
        self.gateway.fail_reply = False
        result = self.send('Help me', request_id=request_id).get_json()
        self.assertEqual(sum(m['role'] == 'user' for m in result['messages']), 1)

    def test_invalid_and_cross_origin_requests_rejected(self):
        self.assertEqual(self.send(' ', 'message').status_code, 400)
        self.assertEqual(self.send('x' * 4001).status_code, 400)
        self.assertEqual(self.send('yes', 'confirm_callback').status_code, 409)
        result = self.client.post('/api/message', headers={'Origin': 'https://unrelated.example'}, json={'text': 'yes'})
        self.assertEqual(result.status_code, 403)

    def test_consent_phrases(self):
        for phrase in ['yes', 'Yes, please.', 'Sure, go ahead', 'Yes, prepare report', 'Please prepare my report', 'Please call me back', 'Yes, my name is Jane and my number is 202-555-0130']:
            with self.subTest(phrase=phrase): self.assertTrue(confirms_callback(phrase))


if __name__ == '__main__':
    unittest.main()
