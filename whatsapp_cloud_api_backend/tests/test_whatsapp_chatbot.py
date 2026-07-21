from datetime import datetime
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

from ..controllers.webhook import WhatsAppCloudAPIWebhookController


class TestWhatsAppChatbotGreeting(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.chatbot = cls.env["whatsapp.chatbot"].create(
            {
                "title": "Turkish Greeting",
                "greeting_only": True,
                "greeting_message": "Mesai ici",
                "out_of_hours_message": "Mesai disi",
            }
        )
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Greeting Test Backend",
                "api_token": "token",
                "phone_number_id": "123456",
                "chatbot_enabled": True,
                "chatbot_id": cls.chatbot.id,
            }
        )
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
        controller = WhatsAppCloudAPIWebhookController()
        with (
            patch.object(
                type(self.chatbot),
                "_get_auto_reply_message",
                return_value="Auto reply",
            ),
            patch.object(type(self.thread), "send_text_message") as send_text,
        ):
            controller._handle_greeting_only_chatbot(self.chatbot, self.thread)
            controller._handle_greeting_only_chatbot(self.chatbot, self.thread)

        send_text.assert_called_once_with("Auto reply")
        self.assertEqual(self.thread.chatbot_id, self.chatbot)
        self.assertTrue(self.thread.chatbot_last_message_date)
