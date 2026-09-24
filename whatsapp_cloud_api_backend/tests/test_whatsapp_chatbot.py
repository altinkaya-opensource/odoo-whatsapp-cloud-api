from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from odoo import _
from odoo.exceptions import UserError, ValidationError
from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs

from ..models import whatsapp_backend, whatsapp_webhook


class TestWhatsAppChatbotGreeting(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Error texts are asserted in English; a database in another language
        # translates them
        cls.env = cls.env(context=dict(cls.env.context, lang="en_US"))
        cls.chatbot = cls.env["whatsapp.chatbot"].create(
            {
                "title": "Turkish Greeting",
                "greeting_only": True,
                "greeting_message": "Mesai ici",
                "out_of_hours_message": "Mesai disi",
            }
        )
        # Reuse a backend because unique(main_backend) limits new records.
        cls.backend = cls.env["whatsapp.backend"].search([], limit=1)
        if not cls.backend:
            cls.backend = cls.env["whatsapp.backend"].create(
                {
                    "name": "Greeting Test Backend",
                    "api_token": "token",
                    "phone_number_id": "123456",
                }
            )
        cls.backend.write(
            {
                "chatbot_enabled": True,
                "chatbot_id": cls.chatbot.id,
            }
        )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {
                    "backend_id": cls.backend.id,
                    "phone_number": "905551234567",
                }
            )

    def test_select_message_by_istanbul_hour(self):
        # Europe/Istanbul is UTC+3; weekends intentionally use the same hours.
        self.assertEqual(
            self.chatbot._get_auto_reply_message(datetime(2026, 7, 25, 4, 59)),
            "Mesai disi",
        )
        self.assertEqual(
            self.chatbot._get_auto_reply_message(datetime(2026, 7, 25, 5, 0)),
            "Mesai ici",
        )
        self.assertEqual(
            self.chatbot._get_auto_reply_message(datetime(2026, 7, 25, 14, 59)),
            "Mesai ici",
        )
        self.assertEqual(
            self.chatbot._get_auto_reply_message(datetime(2026, 7, 25, 15, 0)),
            "Mesai disi",
        )

    def test_greeting_messages_are_required(self):
        with self.assertRaises(ValidationError):
            self.env["whatsapp.chatbot"].create(
                {
                    "title": "Incomplete Greeting",
                    "greeting_only": True,
                    "greeting_message": "Hello",
                }
            )

    def test_plain_greeting_is_sent_once_per_24_hours(self):
        processor = self.env["whatsapp.webhook"]
        with (
            trap_jobs(),
            patch.object(
                type(self.chatbot),
                "_get_auto_reply_message",
                return_value="Auto reply",
            ),
            patch.object(type(self.thread), "send_text_message") as send_text,
        ):
            processor._handle_greeting_only_chatbot(self.chatbot, self.thread)
            processor._handle_greeting_only_chatbot(self.chatbot, self.thread)

        send_text.assert_called_once_with("Auto reply")
        self.assertEqual(self.thread.chatbot_id, self.chatbot)
        self.assertTrue(self.thread.chatbot_last_message_date)

    def test_incoming_survives_reply_failure_and_next_message_can_reply(self):
        processor = self.env["whatsapp.webhook"]
        incoming = {
            "id": "greeting-incoming-test",
            "type": "text",
            "from": self.thread.phone_number,
            "timestamp": "1789376400",
            "text": {"body": "Hello"},
        }

        def fail_reply(*args, **kwargs):
            self.thread.write({"chatbot_last_message_date": datetime(2026, 9, 14)})
            raise UserError(_("Simulated reply failure"))

        with (
            trap_jobs(),
            patch.object(
                type(processor), "_find_or_create_partner", return_value=False
            ),
            patch.object(
                type(processor), "_find_or_create_thread", return_value=self.thread
            ),
            patch.object(
                type(self.backend), "_call_whatsapp_api", side_effect=fail_reply
            ),
            self.assertLogs(whatsapp_webhook.__name__, level="ERROR"),
        ):
            processor._process_incoming_message(self.backend, {}, incoming, {})

        message = self.env["whatsapp.message"].search(
            [("message_id", "=", incoming["id"]), ("backend_id", "=", self.backend.id)]
        )
        self.assertEqual(len(message), 1)
        self.assertEqual(message.body, "Hello")
        self.assertIn("Simulated reply failure", message.payload["chatbot_error"])
        self.assertEqual(self.thread.last_message_id, message)
        self.assertFalse(self.thread.chatbot_last_message_date)

        incoming["id"] = "greeting-incoming-retry-test"
        with (
            trap_jobs(),
            patch.object(
                type(processor), "_find_or_create_partner", return_value=False
            ),
            patch.object(
                type(processor), "_find_or_create_thread", return_value=self.thread
            ),
            patch.object(
                type(self.backend),
                "_call_whatsapp_api",
                return_value={"messages": [{"id": "greeting-outgoing-test"}]},
            ),
        ):
            processor._process_incoming_message(self.backend, {}, incoming, {})
        self.assertTrue(self.thread.chatbot_last_message_date)
        self.assertEqual(self.thread.last_message_id.direction, "outgoing")

    def test_delivery_failure_is_stored_and_late_status_cannot_regress(self):
        with trap_jobs():
            message = self.env["whatsapp.message"].create(
                {
                    "backend_id": self.backend.id,
                    "thread_id": self.thread.id,
                    "message_id": "delivery-result-test",
                    "timestamp": 1789376400,
                    "status": "sent",
                    "payload": {"request": {"type": "text"}},
                }
            )
        processor = self.env["whatsapp.webhook"]
        status = {
            "id": message.message_id,
            "status": "failed",
            "timestamp": "1789376401",
            "errors": [{"code": 131026, "title": "Message undeliverable"}],
        }
        payload = {
            "object": "whatsapp_business_account",
            "entry": [{"changes": [{"value": {"statuses": [status]}}]}],
        }
        with (
            trap_jobs() as trap,
            self.assertLogs(whatsapp_webhook.__name__, level="WARNING"),
        ):
            processor._enqueue_payload(self.backend, payload)
            trap.perform_enqueued_jobs()
        self.assertEqual(message.status, "failed")
        self.assertEqual(message.payload["request"], {"type": "text"})
        self.assertEqual(message.payload["status_update"]["errors"][0]["code"], 131026)
        processor._process_message_status(
            self.backend, dict(status, status="sent", timestamp="1789376400")
        )
        self.assertEqual(message.status, "failed")
        processor._process_message_status(self.backend, dict(status, status="read"))
        processor._process_message_status(self.backend, dict(status, status="sent"))
        self.assertEqual(message.status, "read")
        # Old status of an unknown message: dropped, not retried
        processor._process_message_status(SimpleNamespace(id=-1), status)
        self.assertEqual(message.status, "read")

    def test_api_error_keeps_meta_code_and_details(self):
        response = Mock(status_code=400)
        cases = [
            (
                {
                    "message": "Message undeliverable",
                    "code": 131026,
                    "error_data": {"details": "Simulated delivery error detail"},
                },
                r"131026.*Simulated delivery error detail",
            ),
            ("Unexpected API response", "Unexpected API response"),
            ({"message": "Undeliverable", "error_data": "unexpected"}, "Undeliverable"),
        ]
        for error, expected in cases:
            response.json.return_value = {"error": error}
            with (
                self.subTest(error=error),
                patch.object(whatsapp_backend.requests, "post", return_value=response),
                self.assertLogs(whatsapp_backend.__name__, level="ERROR"),
                self.assertRaisesRegex(UserError, expected),
            ):
                self.backend._call_whatsapp_api("messages", {})

    def test_missing_message_id_does_not_start_greeting_cooldown(self):
        processor = self.env["whatsapp.webhook"]
        with (
            patch.object(type(self.backend), "_call_whatsapp_api", return_value={}),
            self.assertLogs(
                "odoo.addons.whatsapp_cloud_api_backend.models.whatsapp_thread", "ERROR"
            ),
            self.assertRaisesRegex(UserError, "did not return a message ID"),
        ):
            processor._handle_greeting_only_chatbot(self.chatbot, self.thread)
        self.assertFalse(self.thread.chatbot_last_message_date)
