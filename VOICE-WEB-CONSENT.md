# Voice and web report consent — proposed workflow

This is a plan, not implemented behavior. Use the same application-owned consent model as the SMS demo: help first, offer an optional report, record an explicit decision, then generate and save. Consent covers preparing and saving the brief only; it does not authorize real forwarding, a callback, or call recording. The current terminal demo must stop treating `END` alone as authorization.

## Shared rules

- Strip `[OFFER_CALLBACK]` before display or speech. It opens one application-owned offer; it never establishes consent. Use the participant's language.
- Suggested offer: “I can save a brief summary of this conversation for human follow-up. Forwarding and callbacks are simulated in this demo. Would you like me to prepare it?” Contact details are optional; never invent them.
- Track `none → offered → confirmed → creating → saved`, with `declined`, `failed`, and `withdrawn` outcomes. Store the disclosure version, decision, time, and input method with the session. Only the server may authorize WriteUp-agent.
- Consent applies to the current offer. Refusal, silence, disconnect, topic changes, ambiguous replies, or an unrelated “yes” must not generate a report. Explain an unclear offer once if needed; do not repeatedly pressure someone who declines. A later explicit request may open a new offer.
- Prioritize immediate danger over consent and contact collection. Keep ordinary help available after refusal or specialist failure. A simulated report must never replace real emergency or human-support contact guidance.
- Save once per confirmed offer, including HTTP/telephony retries. Announce success only after generation and saving succeed. On failure, offer retry; reuse an unsaved draft only if the conversation is unchanged. Reject `REPORT_NOT_AUTHORIZED` as an error.
- Honor withdrawal before saving, including while generation runs. If already saved, explain its status and provide a separate deletion action; do not claim deletion until it succeeds. This consent is separate from any recording/transcription or service-data notices the app needs.

## Voice

Speak the offer after a natural pause, with no competing question. Accept a clear spoken affirmation to that offer or offer “Press 1 to prepare it, or 2 to skip.” If recognition is uncertain, clarify once or offer keypad input. Silence, a dropped call, and speech interrupted before the disclosure finishes leave the offer unconfirmed.

Do not ask for a name or number in the same turn as consent. If useful, collect optional details separately and confirm any number before including it. A disconnect after confirmed consent may finish the authorized local save, but must not trigger an unsolicited call or message. Say “Your report has been saved; no callback has been arranged” only after success and while the caller is still connected.

## Web

Show a single inline disclosure with **Prepare report** and **Not now** buttons. Use keyboard-accessible controls and a readable status message. Accept clear text confirmation only while this is the active offer; a topic change dismisses it. A request to talk to a human opens the offer rather than silently accepting it.

Disable repeated submissions while creating; show **Cancel preparation** until saving completes. After success, show **Saved locally — nothing sent**, plus download and delete controls. On failure, retain the recorded consent and show **Retry report**. The server must enforce consent, cancellation, ownership, and duplicate protection even if the browser is refreshed.

## Minimum acceptance checks

Verify yes/no/ambiguous replies, interrupted voice disclosure, low-confidence speech, keypad input, topic changes, reconnect/refresh, double clicks, withdrawal during generation, generation/save failures, and new facts before retry. Confirm that neither channel displays or speaks the hidden marker and neither reports a real transfer or callback.
