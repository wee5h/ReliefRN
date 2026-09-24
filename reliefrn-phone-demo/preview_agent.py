"""Explicit, labeled offline preview. Never used as a fallback for Azure failures."""
from app import OFFER_MARKER


class PreviewAgents:
    test_mode = True

    def respond(self, chat, text):
        if any(word in text.lower() for word in ("callback", "call me", "human", "report")):
            return "I can help prepare your information for human follow-up.\n" + OFFER_MARKER
        if text.strip().lower() in {"no", "no thanks", "not now"}:
            return "No problem. What else would you like help with?"
        return "This is the offline preview. In the live app, ReliefRN uses your saved Assistance-agent to respond. You can ask for a callback to try the report flow."

    def write_report(self, chat):
        return "# OFFLINE PREVIEW — NOT AN AGENT-GENERATED REPORT\n\nThis file only verifies the local save and numbering flow. Live mode uses the saved WriteUp-agent and its existing instructions.\n\nCallback report consent: confirmed.\n\nNo message was sent to FEMA and no callback was scheduled.\n"
