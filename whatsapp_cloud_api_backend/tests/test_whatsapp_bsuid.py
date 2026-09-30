import time
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs

BSUID = "TR.1809375520086763"
PHONE = "905550000021"


class TestWhatsAppBsuid(TransactionCase):
    """Senders with a WhatsApp username may hide their phone number."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "BSUID test",
                "api_token": "bsuid-test-token",
                "phone_number_id": "bsuid-test",
            }
        )
        cls.processor = cls.env["whatsapp.webhook"]
        cls.Backend = type(cls.backend)

    def _receive(self, message_id, phone=None):
        """Process one text message the way Meta sends it."""
        message = {
            "id": message_id,
            "from_user_id": BSUID,
            "type": "text",
            "timestamp": str(int(time.time())),
            "text": {"body": "Merhaba"},
        }
        contact = {
            "profile": {"name": "fatihcan", "username": "fatihcan01"},
            "user_id": BSUID,
        }
        if phone:
            message["from"] = phone
            contact["wa_id"] = phone
        with (
            trap_jobs(),
            patch.object(
                type(self.processor), "_find_or_create_partner", return_value=False
            ),
        ):
            self.processor._process_incoming_message(
                self.backend, {"contacts": [contact]}, message, {}
            )
        return self.env["whatsapp.message"].search(
            [("backend_id", "=", self.backend.id), ("message_id", "=", message_id)]
        )

    def _send_text(self, recipient):
        response = {"messages": [{"id": "wamid.bsuid-out"}]}
        with (
            patch.object(
                self.Backend, "_call_whatsapp_api", return_value=response
            ) as api_call,
            trap_jobs(),
        ):
            self.backend.send_text_message(recipient, "Merhaba")
        return api_call.call_args.args[1]

    def test_message_without_a_number_opens_a_thread(self):
        message = self._receive("wamid.bsuid-1")
        thread = message.thread_id
        self.assertTrue(message)
        self.assertEqual(thread.bsuid, BSUID)
        self.assertFalse(thread.phone_number)
        self.assertEqual(thread.name, "fatihcan")

    def test_customer_who_hides_their_number_stays_in_their_thread(self):
        with trap_jobs():
            thread = self.env["whatsapp.thread"].create(
                {"backend_id": self.backend.id, "phone_number": PHONE}
            )
        self._receive("wamid.bsuid-2", phone=PHONE)
        self.assertEqual(thread.bsuid, BSUID)
        later = self._receive("wamid.bsuid-3")
        self.assertEqual(later.thread_id, thread)

    def test_number_that_arrives_later_joins_the_thread(self):
        thread = self._receive("wamid.bsuid-4").thread_id
        again = self._receive("wamid.bsuid-5", phone=PHONE)
        self.assertEqual(again.thread_id, thread)
        self.assertEqual(thread.phone_number, PHONE)

    def test_reply_goes_to_the_bsuid(self):
        self._receive("wamid.bsuid-6")
        payload = self._send_text(BSUID)
        self.assertEqual(payload["recipient"], BSUID)
        self.assertNotIn("to", payload)
        self.assertFalse(
            self.env["whatsapp.thread"].search(
                [("backend_id", "=", self.backend.id), ("phone_number", "!=", False)]
            ),
            "The BSUID must not be read as a phone number",
        )

    def test_reply_to_a_number_goes_to_the_number(self):
        payload = self._send_text(PHONE)
        self.assertTrue(payload.get("to"))
        self.assertNotIn("recipient", payload)

    def test_unknown_bsuid_is_refused(self):
        with self.assertRaises(UserError):
            self.backend.send_text_message("TR.999", "Merhaba")
