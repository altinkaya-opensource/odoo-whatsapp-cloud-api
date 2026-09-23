from unittest.mock import patch

from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppSend(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Backend = cls.env["whatsapp.backend"]
        cls.backend = Backend.create(
            {
                "name": "Send test",
                "api_token": "send-test-token",
                "phone_number_id": "send-test",
            }
        )
        other_backend = Backend.create(
            {
                "name": "Send test (other)",
                "api_token": "send-test-other-token",
                "phone_number_id": "send-test-other",
            }
        )
        with trap_jobs():
            cls.thread = cls._create_thread_with_message(cls.backend)
            cls.other_thread = cls._create_thread_with_message(other_backend)

    @classmethod
    def _create_thread_with_message(cls, backend):
        thread = cls.env["whatsapp.thread"].create(
            {"backend_id": backend.id, "phone_number": "905550000002"}
        )
        # Same WhatsApp id on both backends: only unique per backend
        cls.env["whatsapp.message"].create(
            {
                "backend_id": backend.id,
                "thread_id": thread.id,
                "message_id": "wamid.shared",
                "direction": "incoming",
                "body": "hello",
                "timestamp": 1,
            }
        )
        return thread

    def _send(self, method, *args):
        Backend = type(self.env["whatsapp.backend"])
        response = {"messages": [{"id": "wamid.outgoing"}]}
        with (
            patch.object(Backend, "_call_whatsapp_api", return_value=response),
            trap_jobs(),
        ):
            return getattr(self.thread, method)(*args)

    def _target(self, thread):
        return thread.whatsapp_message_ids.filtered(
            lambda message: message.message_id == "wamid.shared"
        )

    def test_reaction_stays_in_its_thread(self):
        self._send("send_reaction_message", "👍", "wamid.shared")
        self.assertEqual(self._target(self.thread).reaction_emoji, "👍")
        self.assertFalse(self._target(self.other_thread).reaction_emoji)

    def test_reply_links_the_message_in_its_thread(self):
        result = self._send("send_reply_message", "answer", "wamid.shared")
        reply = self.env["whatsapp.message"].browse(result["message_id"])
        self.assertEqual(reply.replied_message_id, self._target(self.thread))
