import base64

from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppPreview(TransactionCase):
    """The chat list preview of a thread follows its last message."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Labels are translated; the assertions are in English
        cls.env = cls.env(context=dict(cls.env.context, lang="en_US"))
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Preview test",
                "api_token": "preview-test-token",
                "phone_number_id": "preview-test",
            }
        )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905551110003"}
            )

    def _receive(self, body=False, mimetype=None, name="1624728515705702"):
        """Register an incoming message and return the thread's preview."""
        attachment = self.env["ir.attachment"]
        if mimetype:
            attachment = attachment.sudo().create(
                {
                    "name": name,
                    "datas": base64.b64encode(b"preview test"),
                    "mimetype": mimetype,
                }
            )
        with trap_jobs():
            message = self.env["whatsapp.message"].create(
                {
                    "backend_id": self.backend.id,
                    "thread_id": self.thread.id,
                    "direction": "incoming",
                    "message_type": "media" if mimetype else "text",
                    "body": body,
                    "attachment_id": attachment.id,
                    "timestamp": 1,
                }
            )
            self.thread._register_message(message)
        return self.thread.last_message_preview

    def test_media_without_caption_shows_its_type(self):
        self.assertEqual(self._receive(mimetype="image/jpeg"), "📷 Photo")
        self.assertEqual(self._receive(mimetype="video/mp4"), "🎥 Video")
        self.assertEqual(
            self._receive(mimetype="audio/ogg; codecs=opus"), "🎤 Voice message"
        )
        self.assertEqual(self._receive(mimetype="image/webp"), "🙂 Sticker")
        self.assertEqual(
            self._receive(mimetype="application/pdf", name="SS378159.pdf"),
            "📄 SS378159.pdf",
        )

    def test_caption_follows_the_type(self):
        self.assertEqual(
            self._receive(body="Ödeme yapıldı", mimetype="image/jpeg"),
            "📷 Ödeme yapıldı",
        )

    def test_text_is_shown_as_written(self):
        self.assertEqual(self._receive(body="Merhaba"), "Merhaba")
        self.assertFalse(self._receive())
