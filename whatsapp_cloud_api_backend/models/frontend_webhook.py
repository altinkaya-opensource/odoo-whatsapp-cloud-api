import hashlib
import hmac
import json
import logging
import time

import requests

from ..controllers.main import WP_ATTACHMENT_DOWNLOAD_PATH

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
        webhook_secret = backend.frontend_webhook_secret

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
            "data": {
                "id": thread.id,
                "name": thread.name,
                "last_message_date": thread.last_message_date.strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                if thread.last_message_date
                else None,
                "last_message_preview": thread.last_message_preview,
                "phone_number": thread.phone_number,
                "backend_id": (
                    [thread.backend_id.id, thread.backend_id.name]
                    if thread.backend_id
                    else False
                ),
                "write_date": thread.write_date.strftime("%Y-%m-%d %H:%M:%S")
                if thread.write_date
                else None,
                # unread_count is deliberately absent: it is per-user, while
                # this payload is fanned out to every user of the backend.
                # Each client tracks its own count and re-syncs it from
                # /whatsapp/unread_count.
                "partner_id": (
                    [thread.partner_id.id, thread.partner_id.name]
                    if thread.partner_id
                    else False
                ),
                "has_avatar": bool(thread.partner_id and thread.partner_id.avatar_256),
            },
            "thread_id": thread.id,
            "timestamp": int(time.time()),
        }

        WebhookSender.send_webhook(payload, thread.backend_id)

    @staticmethod
    def send_message_webhook_payload(message, event_type):
        """Send webhook payload for a WhatsApp message event."""
        # Build attachment data with full metadata (mimetype, url, file_size)
        attachment_data = False
        attachment_full_data = None
        if message.attachment_id:
            base_url = (
                message.env["ir.config_parameter"].sudo().get_param("web.base.url")
            )
            attachment_data = [message.attachment_id.id, message.attachment_id.name]
            attachment_full_data = {
                "id": message.attachment_id.id,
                "name": message.attachment_id.name,
                "mimetype": message.attachment_id.mimetype,
                "url": (
                    f"{base_url}{WP_ATTACHMENT_DOWNLOAD_PATH}"
                    f"{message.attachment_id.id}"
                ),
                "file_size": message.attachment_id.file_size,
            }

        payload = {
            "event_type": event_type,
            "data": {
                "id": message.id,
                # Required: the frontend fans this event out only to the
                # sessions that have access to this backend.
                "backend_id": (
                    [message.backend_id.id, message.backend_id.name]
                    if message.backend_id
                    else False
                ),
                "body": message.body,
                "status": message.status,
                "direction": message.direction,
                "attachment_id": attachment_data,
                "attachment": attachment_full_data,
                "message_id": message.message_id,
                "replied_message_id": (
                    [
                        message.replied_message_id.id,
                        message.replied_message_id.message_id,
                    ]
                    if message.replied_message_id
                    else False
                ),
                "create_date": message.create_date.strftime("%Y-%m-%d %H:%M:%S")
                if message.create_date
                else None,
                "create_uid": (
                    [message.create_uid.id, message.create_uid.name]
                    if message.create_uid
                    else False
                ),
                "write_date": message.write_date.strftime("%Y-%m-%d %H:%M:%S")
                if message.write_date
                else None,
                "timestamp": message.timestamp,
                "reaction_emoji": message.reaction_emoji,
            },
            "thread_id": message.thread_id.id,
            "timestamp": int(time.time()),
        }

        WebhookSender.send_webhook(payload, message.backend_id)
