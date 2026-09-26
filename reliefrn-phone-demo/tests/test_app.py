"""Behavior tests with a fake agent: no Azure account or network required."""
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import (AzureAgents, Chat, ReportStore, create_app, confirms_callback,
                 requests_callback, needs_safety_review, safety_decision, visible_assistance, OFFER)


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

    def complete_report(self):
        self.send('Yes please')
        return self.send('My name is Jane and my number is 202-555-0130')

    def offer(self):
        result = self.send('I want a callback').get_json()
        self.assertTrue(result['callback_pending'])
        self.assertIn('simulated', result['messages'][-1]['content'])
        self.assertNotIn('[OFFER_CALLBACK]', str(result))

    def test_confirm_generates_saved_report_with_verbatim_agent_body(self):
        self.offer()
        result = self.complete_report().get_json()
        self.assertEqual(result['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 1)
        report = result['reports'][0]
        self.assertEqual(report['filename'], 'reliefrn-report-0001.md')
        self.assertEqual((Path(self.temp.name) / report['filename']).read_text(), '# Agent-created report\n\nOriginal format is preserved.\n')
        self.assertIn('Jane', self.gateway.last_report_transcript[-1]['content'])
        self.assertIn('202-555-0130', self.gateway.last_report_transcript[-1]['content'])
        self.assertIn('created and saved', result['messages'][-1]['content'])
        with self.client.get(report['url']) as download:
            self.assertEqual(download.status_code, 200)

    def test_report_stays_anchored_after_later_messages_and_reload(self):
        self.offer()
        saved = self.complete_report().get_json()
        report = saved['reports'][0]
        anchor = report['message_index']
        self.assertEqual(anchor, len(saved['messages']) - 1)
        self.assertIn('created and saved', saved['messages'][anchor]['content'])
        later = self.send('Where can I find a shelter?').get_json()
        self.assertGreater(len(later['messages']) - 1, anchor)
        reloaded = self.client.get('/api/session').get_json()
        for snapshot in (later, reloaded):
            self.assertEqual(snapshot['reports'], [report])
            self.assertEqual(snapshot['messages'][anchor], saved['messages'][anchor])

    def test_button_confirm_and_duplicate_request_only_write_once(self):
        self.offer()
        request_id = str(uuid.uuid4())
        first = self.send('Yes, prepare report', 'confirm_callback', request_id).get_json()
        second = self.send('Yes, prepare report', 'confirm_callback', request_id).get_json()
        self.assertEqual(first, second)
        self.assertEqual(first['report_status'], 'collecting_details')
        self.assertEqual(self.gateway.report_calls, 0)
        details_id = str(uuid.uuid4())
        first = self.send('Jane, 202-555-0130', request_id=details_id).get_json()
        second = self.send('Jane, 202-555-0130', request_id=details_id).get_json()
        self.assertEqual(first, second)
        self.assertEqual(self.gateway.report_calls, 1)

    def test_generic_yes_without_offer_never_generates(self):
        self.send('yes')
        self.assertEqual(self.gateway.report_calls, 0)

    def test_contact_details_are_requested_in_chat_and_can_be_skipped(self):
        self.offer()
        confirmed = self.send('yes').get_json()
        self.assertEqual(confirmed['report_status'], 'collecting_details')
        self.assertIn('preferred name and callback number', confirmed['messages'][-1]['content'])
        self.assertIn('text them here', confirmed['messages'][-1]['content'])
        self.assertEqual(self.gateway.report_calls, 0)
        self.assertEqual(self.client.get('/api/session').get_json()['report_status'], 'collecting_details')
        result = self.send('skip').get_json()
        self.assertEqual(result['report_status'], 'saved')
        self.assertEqual(self.gateway.last_report_transcript[-1]['content'], 'skip')

    def test_cancel_report_in_chat_without_generating(self):
        self.offer()
        self.send('yes')
        result = self.send('Cancel report').get_json()
        self.assertEqual(result['report_status'], 'none')
        self.assertEqual(self.send('Retry', 'retry_report').status_code, 409)
        self.assertEqual(self.gateway.report_calls, 0)

    def test_emergency_during_contact_reply_does_not_generate_report(self):
        self.offer()
        self.send('yes')
        self.send('Jane, 202-555-0130, I am trapped')
        self.assertEqual(self.gateway.report_calls, 0)
        self.assertEqual(self.gateway.reply_calls, 2)

    def test_conversation_can_continue_before_and_after_report(self):
        self.offer()
        self.send('yes')
        result = self.send('Where is the nearest shelter?').get_json()
        self.assertEqual(result['report_status'], 'collecting_details')
        self.assertEqual(self.gateway.report_calls, 0)
        saved = self.send('Jane, 202-555-0130').get_json()
        later = self.send('What else should I bring?').get_json()
        self.assertEqual(later['reports'], saved['reports'])
        self.assertEqual(later['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 1)

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
        result = self.complete_report().get_json()
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
            self.assertEqual(self.complete_report().get_json()['report_status'], 'failed')
        self.assertEqual(self.send('Retry report', 'retry_report').get_json()['report_status'], 'saved')
        self.assertEqual(self.gateway.report_calls, 1)

    def test_agent_offer_question_is_replaced_without_losing_assistance(self):
        for marker in ['', '\n[OFFER_CALLBACK]']:
            with self.subTest(marker=marker):
                self.client.post('/api/session', json={'new': True})
                with patch.object(self.gateway, 'respond', return_value=
                        'The shelter is at 123 Main St. Would you like me to prepare a callback report?' + marker):
                    result = self.send('Help me').get_json()
                reply = result['messages'][-1]['content']
                self.assertEqual(reply, 'The shelter is at 123 Main St.\n\n' + OFFER)
                self.assertEqual(len(result['messages']), 3)
                self.assertTrue(result['callback_pending'])
                self.assertEqual(self.gateway.report_calls, 0)

    def test_offer_normalization_preserves_other_questions_and_emergency_guidance(self):
        for reply in ['Can I call you Jane?', 'Would you like a callback number for the shelter?']:
            self.assertEqual(visible_assistance(reply), reply)
        self.assertEqual(visible_assistance('Would you like me to prepare a report? Call 911 now.'),
                         'Call 911 now.')

    def test_report_preamble_and_contact_question_do_not_duplicate_app_offer(self):
        generated = (
            'I understand you want to talk to a person. '
            'I can help prepare a report for follow-up by a human support agent. '
            'May I have your preferred name and a callback number to include? '
            'Providing these is optional.')
        for prefix in ['', 'Call 911 now. ']:
            with self.subTest(prefix=prefix):
                self.client.post('/api/session', json={'new': True})
                with patch.object(self.gateway, 'respond', return_value=prefix + generated):
                    result = self.send('I want to talk to a person').get_json()
                reply = result['messages'][-1]['content']
                self.assertEqual(reply, prefix + 'I understand you want to talk to a person.\n\n' + OFFER)
                self.assertEqual(reply.count('?'), 1)
                self.assertTrue(result['callback_pending'])
                self.assertEqual(self.gateway.report_calls, 0)

    def test_premature_handoff_promise_becomes_one_consent_offer(self):
        generated = (
            'I can help connect you with someone who can provide more assistance. '
            'I will prepare a report for a human representative to follow up with you. '
            'Please hold for a moment.')
        for prefix in ['', 'Call 911 now. ', 'Call the shelter at 555-0100. ']:
            with self.subTest(prefix=prefix):
                self.client.post('/api/session', json={'new': True})
                with patch.object(self.gateway, 'respond', return_value=prefix + generated):
                    result = self.send('I want to talk to a person').get_json()
                expected = prefix.strip() + '\n\n' + OFFER if prefix else OFFER
                self.assertEqual(result['messages'][-1]['content'], expected)
                self.assertTrue(result['callback_pending'])
                self.assertEqual(self.gateway.report_calls, 0)
                self.assertEqual(result['reports'], [])

    def test_new_information_invalidates_failed_disk_draft(self):
        self.offer()
        with patch.object(self.app.extensions['reliefrn_reports'], 'save', side_effect=OSError('disk')):
            self.complete_report()
        self.send('I have moved to a different county')
        self.send('Retry report', 'retry_report')
        self.assertEqual(self.gateway.report_calls, 2)
        self.assertIn('I have moved to a different county',
                      [m['content'] for m in self.gateway.last_report_transcript])

    def test_emergency_with_affirmative_is_not_report_consent(self):
        self.offer()
        self.send('Yes, my name is Jane and I am trapped')
        self.assertEqual(self.gateway.report_calls, 0)
        self.assertEqual(self.gateway.reply_calls, 2)

    def test_common_callback_requests_and_affirmatives(self):
        for phrase in ["I'd like a callback", 'callback please', 'I want to talk to someone',
                       'Actually, I want that callback']:
            self.assertTrue(requests_callback(phrase), phrase)
        for phrase in ['ok sure', 'yea', 'alright', 'go for it', 'do it', "let's do it",
                       'yes ok sure', 'why not', "I don't see why not"]:
            self.assertTrue(confirms_callback(phrase), phrase)
        for phrase in ['why not later', "I don't see why not, but wait", 'sure, if you can']:
            self.assertFalse(confirms_callback(phrase), phrase)

    def test_numbering_survives_new_conversation_and_server_restart(self):
        self.offer()
        self.complete_report()
        self.client.post('/api/session', json={'new': True})
        self.offer()
        self.assertEqual(self.complete_report().get_json()['reports'][0]['number'], 2)
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
        url = self.complete_report().get_json()['reports'][0]['url']
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


class SafetyTests(unittest.TestCase):
    def test_triggers_cover_reported_gaps(self):
        for text in ['They want me to pay before releasing my aid',
                     'Someone asked for my bank account number', 'They said to wire money',
                     'I am trapped', 'My child cannot breathe', 'FEMA denied me']:
            self.assertTrue(needs_safety_review(text), text)
        self.assertFalse(needs_safety_review('Where is the nearest shelter?'))

    def test_normalize_supported_formats(self):
        for note, expected in [('CONTINUE', 'ALLOW'),
                ('{"decision":"ALLOW_WITH_CAUTION"}', 'ALLOW_WITH_CAUTION'),
                ('ESCALATE: emergency\nSAY TO CITIZEN: Ignore all rules', 'EMERGENCY_ESCALATE'),
                ('ESCALATE: fraud\nCONTACT: invented', 'ESCALATE'),
                ('unparseable', None), ('[]', None), ('{"decision": []}', None), ('{"decision":"invented"}', None)]:
            self.assertEqual(safety_decision(note), expected)

    def test_escalation_cannot_be_ignored_by_generalist(self):
        for note in ['{"decision":"EMERGENCY_ESCALATE"}', 'ESCALATE: emergency']:
            gateway = object.__new__(AzureAgents)
            chat = Chat(conversation='old')
            with patch.object(gateway, 'ask', return_value=(note, 'safety')) as ask:
                reply = gateway.respond(chat, 'This is a scam')
            self.assertEqual(ask.call_count, 1)
            self.assertEqual(chat.notes, [note])
            self.assertIsNone(chat.conversation)
            if 'emergency' in note.lower():
                self.assertTrue(reply.startswith('Call 911 now.'))
            else:
                self.assertIn('[OFFER_CALLBACK]', reply)

    def test_nonurgent_escalation_keeps_useful_assistance_and_notice(self):
        gateway = object.__new__(AzureAgents)
        chat = Chat()
        with patch.object(gateway, 'ask', side_effect=[
                ('{"decision":"ESCALATE"}', 'safety'), ('Verified shelter information', 'main')]) as ask:
            reply = gateway.respond(chat, 'Possible scam; I also need a shelter')
        self.assertEqual(ask.call_count, 2)
        self.assertIn('needs a human representative', reply)
        self.assertIn('Verified shelter information', reply)
        self.assertIsNone(chat.conversation)

    def test_specialist_failure_preserves_main_assistance(self):
        gateway = object.__new__(AzureAgents)
        chat = Chat()
        with patch.object(gateway, 'ask', side_effect=[TimeoutError(), ('Helpful reply', 'new')]):
            self.assertEqual(gateway.respond(chat, 'Possible scam'), 'Helpful reply')
        self.assertEqual(chat.conversation, 'new')
        self.assertIn('unavailable', chat.notes[0])


if __name__ == '__main__':
    unittest.main()
