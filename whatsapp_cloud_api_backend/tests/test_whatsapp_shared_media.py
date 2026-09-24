import base64
from unittest.mock import patch

from odoo.tests.common import TransactionCase, new_test_user

from odoo.addons.queue_job.tests.common import trap_jobs

MEDIA_DOMAIN = [
    "|",
    ("attachment_id.mimetype", "=like", "image/%"),
    ("attachment_id.mimetype", "=like", "video/%"),
]


class TestWhatsAppSharedMedia(TransactionCase):
    """The chat's media gallery filters a thread's messages by attachment type."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_media_agent",
            password="Media-Test-1234",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Shared media test",
                "api_token": "media-test-token",
                "phone_number_id": "media-test",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )
        cls.other_backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Shared media test (other team)",
                "api_token": "media-test-other-token",
                "phone_number_id": "media-test-other",
            }
        )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905551110001"}
            )
            cls.other_thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.other_backend.id, "phone_number": "905551110002"}
            )
            cls.photo = cls._message(cls.thread, "image/jpeg")
            cls.video = cls._message(cls.thread, "video/mp4")
            cls.document = cls._message(cls.thread, "application/pdf")
            cls.other_photo = cls._message(cls.other_thread, "image/png")

    @classmethod
    def _message(cls, thread, mimetype):
        attachment = (
            cls.env["ir.attachment"]
            .sudo()
            .create(
                {
                    "name": f"shared-{mimetype.replace('/', '-')}",
                    "datas": base64.b64encode(b"shared media test"),
                    "mimetype": mimetype,
                }
            )
        )
        return cls.env["whatsapp.message"].create(
            {
                "backend_id": thread.backend_id.id,
                "thread_id": thread.id,
                "message_id": f"shared-media-{thread.id}-{mimetype}",
                "direction": "incoming",
                "message_type": "media",
                "attachment_id": attachment.id,
                "timestamp": 1,
            }
        )

    def _search(self, thread, domain):
        return (
            self.env["whatsapp.message"]
            .with_user(self.agent)
            .search([("thread_id", "=", thread.id)] + domain)
        )

    def test_media_and_files_split_by_mimetype(self):
        self.assertEqual(
            self._search(self.thread, MEDIA_DOMAIN), self.photo | self.video
        )
        files = self._search(
            self.thread,
            [
                ("attachment_id", "!=", False),
                ("attachment_id.mimetype", "not like", "image/"),
                ("attachment_id.mimetype", "not like", "video/"),
            ],
        )
        self.assertEqual(files, self.document)

    def test_other_backends_media_stays_hidden(self):
        self.assertFalse(self._search(self.other_thread, MEDIA_DOMAIN))

    def test_filter_joins_instead_of_searching_attachments(self):
        # ir.attachment's search loads every match of the database to check
        # access; the gallery must not go through it.
        Attachment = type(self.env["ir.attachment"])
        with patch.object(
            Attachment, "_search", autospec=True, side_effect=Attachment._search
        ) as attachment_search:
            self._search(self.thread, MEDIA_DOMAIN)
        attachment_search.assert_not_called()
