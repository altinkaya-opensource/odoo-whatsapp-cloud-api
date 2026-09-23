from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppReactionWebhook(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # The backend's unique main_backend boolean limits the available rows.
        cls.backend = cls.env["whatsapp.backend"].search([], limit=1)
        if not cls.backend:
            cls.backend = cls.env["whatsapp.backend"].create(
                {
                    "name": "Reaction webhook test",
                    "api_token": "test-token",
                    "phone_number_id": "reaction-webhook-test",
                }
            )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905551234568"}
            )
            cls.message = cls.env["whatsapp.message"].create(
                {
                    "backend_id": cls.backend.id,
                    "thread_id": cls.thread.id,
                    "message_id": "reaction-webhook-target",
                    "direction": "incoming",
                    "timestamp": 1,
                }
            )

    def test_reaction_sends_update_webhook(self):
        with trap_jobs() as trap:
            self.message.write({"reaction_emoji": "👍"})
        trap.assert_jobs_count(1)
        trap.assert_enqueued_job(
            self.message.send_webhook_payload, args=("message.updated",)
        )

    def test_other_writes_send_no_webhook(self):
        with trap_jobs() as trap:
            self.message.write({"status": "read"})
        trap.assert_jobs_count(0)
