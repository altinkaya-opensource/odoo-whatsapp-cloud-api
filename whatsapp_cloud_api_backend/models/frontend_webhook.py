import hashlib
import hmac
import json
import logging
import time

import requests

_logger = logging.getLogger(__name__)


def generate_signature(secret, payload_json):
    """Generate HMAC SHA256 signature for the payload."""
    return hmac.new(
        secret.encode("utf-8"),
        payload_json.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


class WebhookSender:
    """Handles sending webhooks to external services."""

    @staticmethod
    def send_webhook(payload, backend):
        """Send webhook payload to configured URL."""
        webhook_url = backend.frontend_webhook_url
        webhook_secret = backend.sudo().frontend_webhook_secret

        if not webhook_url or not webhook_secret:
            raise ValueError("Webhook URL or secret not configured.")

        payload_json = json.dumps(payload, separators=(",", ":"))

        headers = {
            "Content-Type": "application/json",
            "x-odoo-signature": generate_signature(webhook_secret, payload_json),
        }

        try:
            response = requests.post(
                webhook_url, data=payload_json, headers=headers, timeout=60
            )

            response.raise_for_status()

            return response.json()
        except requests.RequestException as e:
            _logger.error("Failed to send WhatsApp webhook: %s", e)
            raise e

    # all dates in format '2025-10-18 14:30:00'
    @staticmethod
    def send_thread_webhook_payload(thread, event_type):
        """Send webhook payload for a WhatsApp thread event."""
        payload = {
            "event_type": event_type,
            "data": thread._frontend_payload(),
            "thread_id": thread.id,
            "timestamp": int(time.time()),
        }
        WebhookSender.send_webhook(payload, thread.backend_id)

    @staticmethod
    def send_message_webhook_payload(message, event_type):
        """Send webhook payload for a WhatsApp message event."""
        payload = {
            "event_type": event_type,
            "data": message._frontend_payload(),
            "thread_id": message.thread_id.id,
            "timestamp": int(time.time()),
        }
        WebhookSender.send_webhook(payload, message.backend_id)
