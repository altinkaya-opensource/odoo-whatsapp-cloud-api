import time
from unittest.mock import patch

from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.exception import RetryableJobError
from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppWebhookJobs(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Webhook jobs test",
                "api_token": "jobs-test-token",
                "phone_number_id": "jobs-test",
            }
        )
        cls.processor = cls.env["whatsapp.webhook"]

    def _incoming(self, message_id="wamid.jobs-in"):
        return {
            "id": message_id,
            "type": "text",
            "from": "905550000011",
            "timestamp": str(int(time.time())),
            "text": {"body": "Merhaba"},
        }

    def test_request_only_queues_work(self):
        status = {"id": "wamid.jobs-out", "status": "read", "timestamp": "1"}
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "metadata": {"phone_number_id": "jobs-test"},
                                "messages": [self._incoming()],
                                "statuses": [status],
                            }
                        }
                    ]
                }
            ],
        }
        with trap_jobs() as trap:
            self.processor._enqueue_payload(self.backend, payload)
            trap.assert_jobs_count(1, only=self.processor._process_incoming_message)
            trap.assert_jobs_count(1, only=self.processor._process_message_status)
            self.assertFalse(
                self.env["whatsapp.message"].search(
                    [("message_id", "=", "wamid.jobs-in")]
                )
            )
            keys = {job.identity_key for job in trap.enqueued_jobs}
            self.assertIn(f"whatsapp-message-{self.backend.id}-wamid.jobs-in", keys)

    def test_redelivery_is_processed_once(self):
        Processor = type(self.processor)
        with (
            trap_jobs(),
            patch.object(Processor, "_find_or_create_partner", return_value=False),
            patch.object(Processor, "_handle_chatbot_interaction") as chatbot,
        ):
            self.backend.chatbot_enabled = True
            self.backend.chatbot_id = self.env["whatsapp.chatbot"].create(
                {"title": "Jobs test bot"}
            )
            for _attempt in range(2):
                self.processor._process_incoming_message(
                    self.backend, {}, self._incoming(), {}
                )
        messages = self.env["whatsapp.message"].search(
            [("backend_id", "=", self.backend.id), ("message_id", "=", "wamid.jobs-in")]
        )
        self.assertEqual(len(messages), 1)
        chatbot.assert_called_once()

    def test_status_before_its_message_is_retried_briefly(self):
        fresh = {
            "id": "wamid.not-yet",
            "status": "sent",
            "timestamp": str(int(time.time())),
        }
        with self.assertRaises(RetryableJobError):
            self.processor._process_message_status(self.backend, fresh)
        # Statuses of messages Odoo never sent stop being retried
        self.processor._process_message_status(self.backend, dict(fresh, timestamp="1"))

    def test_concurrent_thread_creation_reuses_the_thread(self):
        with trap_jobs():
            thread = self.env["whatsapp.thread"].create(
                {"backend_id": self.backend.id, "phone_number": "905550000012"}
            )
        Thread = type(self.env["whatsapp.thread"])
        real_search = Thread.search
        calls = []

        def search_misses_once(records, *args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                return records.browse()
            return real_search(records, *args, **kwargs)

        with (
            trap_jobs(),
            patch.object(Thread, "search", search_misses_once),
            self.assertLogs("odoo.sql_db", "ERROR"),
        ):
            found = self.processor._find_or_create_thread(
                self.backend, "905550000012", False, {}
            )
        self.assertEqual(found, thread)
