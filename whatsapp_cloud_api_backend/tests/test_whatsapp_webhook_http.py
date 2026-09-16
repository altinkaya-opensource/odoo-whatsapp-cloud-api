import hashlib
import hmac
import json
from unittest.mock import patch

from odoo.tests import HttpCase, tagged

from ..controllers.webhook import WhatsAppCloudAPIWebhookController


@tagged("post_install", "-at_install")
class TestWhatsAppWebhookHTTP(HttpCase):
    def test_raw_json_callback_uses_http_status_codes(self):
        backend = self.env["whatsapp.backend"].search([], limit=1)
        values = {
            "active": True,
            "phone_number_id": "webhook-http-test",
            "app_secret": "webhook-http-secret",
            "webhook_secret": "webhook-http-verify",
        }
        if backend:
            backend.write(values)
        else:
            backend = backend.create(
                dict(values, name="Webhook test", api_token="test-token")
            )
        # A status-only callback exercises routing without contacting a customer.
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": backend.phone_number_id}
                            }
                        }
                    ]
                }
            ],
        }
        raw = json.dumps(payload).encode()
        signature = hmac.new(
            backend.app_secret.encode(), raw, hashlib.sha256
        ).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-Hub-Signature-256": f"sha256={signature}",
        }
        response = self.url_open("/whatsapp/webhook", data=raw, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "processed"})

        with self.assertLogs(
            "odoo.addons.whatsapp_cloud_api_backend.controllers.webhook", "WARNING"
        ):
            response = self.url_open(
                "/whatsapp/webhook",
                data=raw,
                headers=dict(headers, **{"X-Hub-Signature-256": "sha256=wrong"}),
            )
        self.assertEqual(response.status_code, 403)

        with (
            patch.object(
                WhatsAppCloudAPIWebhookController,
                "_handle_webhook_payload",
                side_effect=RuntimeError("Simulated ingestion failure"),
            ),
            self.assertLogs("odoo.http", "ERROR"),
        ):
            response = self.url_open("/whatsapp/webhook", data=raw, headers=headers)
        self.assertEqual(response.status_code, 500)

        payload["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = (
            "unknown-webhook-test"
        )
        for invalid in (b"[]", b"{not-json", json.dumps(payload).encode()):
            signature = hmac.new(
                backend.app_secret.encode(), invalid, hashlib.sha256
            ).hexdigest()
            with self.subTest(body=invalid):
                response = self.url_open(
                    "/whatsapp/webhook",
                    data=invalid,
                    headers=dict(
                        headers, **{"X-Hub-Signature-256": f"sha256={signature}"}
                    ),
                )
                self.assertEqual(response.status_code, 400)

        response = self.url_open(
            "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=webhook-http-verify&hub.challenge=12345"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "12345")
        response = self.url_open(
            "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345"
        )
        self.assertEqual(response.status_code, 403)
