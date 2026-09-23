from odoo.tests.common import TransactionCase, new_test_user

from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppReport(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_report_agent",
            password="Report-Test-1234",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        Backend = cls.env["whatsapp.backend"]
        cls.backend = Backend.create(
            {
                "name": "Report test",
                "api_token": "report-test-token",
                "phone_number_id": "report-test",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )
        cls.other_backend = Backend.create(
            {
                "name": "Report test (other)",
                "api_token": "report-test-other-token",
                "phone_number_id": "report-test-other",
            }
        )
        public = cls.env.ref("base.public_user")
        with trap_jobs():
            cls.thread = cls._thread(cls.backend)
            cls.first_incoming = cls._message(cls.thread, public, "incoming", 1000)
            # The chatbot answers webhooks as the public user within seconds
            cls.bot_reply = cls._message(cls.thread, public, "outgoing", 1002)
            cls.agent_reply = cls._message(cls.thread, cls.agent, "outgoing", 1600)
            other_thread = cls._thread(cls.other_backend)
            cls._message(other_thread, public, "incoming", 1000)
        cls.env["whatsapp.message.report"]._refresh_report()

    @classmethod
    def _thread(cls, backend):
        return cls.env["whatsapp.thread"].create(
            {"backend_id": backend.id, "phone_number": "905550000010"}
        )

    @classmethod
    def _message(cls, thread, user, direction, timestamp):
        return (
            cls.env["whatsapp.message"]
            .with_user(user)
            .sudo()
            .create(
                {
                    "backend_id": thread.backend_id.id,
                    "thread_id": thread.id,
                    "message_id": f"wamid.report-{thread.id}-{timestamp}",
                    "direction": direction,
                    "timestamp": timestamp,
                }
            )
        )

    def test_messages_know_who_wrote_them(self):
        self.assertTrue(self.bot_reply.is_automated)
        self.assertFalse(self.agent_reply.is_automated)

    def test_response_time_ignores_the_chatbot(self):
        row = self.env["whatsapp.message.report"].search(
            [("id", "=", self.first_incoming.id)]
        )
        self.assertEqual(row.response_seconds, 600)
        self.assertEqual(row.responded_5min, 0)
        self.assertEqual(row.responded_1h, 1)

    def test_agents_see_only_their_backends(self):
        rows = (
            self.env["whatsapp.message.report"]
            .with_user(self.agent)
            .search([("backend_id", "in", (self.backend | self.other_backend).ids)])
        )
        self.assertEqual(rows.backend_id, self.backend)
