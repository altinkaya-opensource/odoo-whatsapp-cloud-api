import json

from odoo.tests.common import TransactionCase, new_test_user

from odoo.addons.bus.models.bus import channel_with_db, json_dump
from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppBus(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_bus_agent",
            password="Bus-Test-1234",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        Backend = cls.env["whatsapp.backend"]
        cls.backend = Backend.create(
            {
                "name": "Bus test",
                "api_token": "bus-test-token",
                "phone_number_id": "bus-test",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )
        cls.other_backend = Backend.create(
            {
                "name": "Bus test (other)",
                "api_token": "bus-test-other-token",
                "phone_number_id": "bus-test-other",
            }
        )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905550000013"}
            )
        cls.env.cr.precommit.run()

    def _commit_notifications(self):
        """Run the commit hooks and return what the backend's channel got."""
        before = self.env["bus.bus"].search([], order="id desc", limit=1).id
        self.env.cr.precommit.run()
        channel = json_dump(channel_with_db(self.env.cr.dbname, self.backend))
        notifications = self.env["bus.bus"].search(
            [("id", ">", before), ("channel", "=", channel)]
        )
        return [json.loads(n.message) for n in notifications]

    def _create_message(self):
        with trap_jobs():
            return self.env["whatsapp.message"].create(
                {
                    "backend_id": self.backend.id,
                    "thread_id": self.thread.id,
                    "message_id": "wamid.bus-test",
                    "direction": "outgoing",
                    "status": "sent",
                    "timestamp": 1,
                }
            )

    def test_one_notification_per_record_and_commit(self):
        message = self._create_message()
        with trap_jobs():
            message.write({"status": "delivered"})
        (notification,) = self._commit_notifications()
        self.assertEqual(notification["type"], "whatsapp/message")
        self.assertEqual(notification["payload"]["event"], "created")
        self.assertEqual(notification["payload"]["message"]["status"], "delivered")

    def test_status_changes_reach_the_chat(self):
        message = self._create_message()
        self._commit_notifications()
        with trap_jobs():
            message.write({"status": "read"})
        (notification,) = self._commit_notifications()
        self.assertEqual(notification["payload"]["event"], "updated")
        self.assertEqual(notification["payload"]["message"]["status"], "read")

    def test_chatbot_bookkeeping_is_silent(self):
        with trap_jobs():
            self.thread.write({"chatbot_step_sequence": 3})
        self.assertFalse(self._commit_notifications())
        with trap_jobs():
            self.thread.write({"last_message_preview": "Merhaba"})
        (notification,) = self._commit_notifications()
        self.assertEqual(notification["type"], "whatsapp/thread")

    def test_frontend_subscribes_to_member_backends_only(self):
        websocket = self.env["ir.websocket"].with_user(self.agent)
        channels = websocket._whatsapp_backend_channels(["whatsapp", "broadcast"])
        self.assertIn(self.backend, channels)
        self.assertNotIn(self.other_backend, channels)
        # The Odoo web client does not ask for them
        self.assertFalse(websocket._whatsapp_backend_channels(["broadcast"]))
