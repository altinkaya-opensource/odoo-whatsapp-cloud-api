from types import SimpleNamespace
from unittest.mock import patch

from odoo.tests.common import TransactionCase, new_test_user

from odoo.addons.queue_job.tests.common import trap_jobs

from ..controllers import main


class TestWhatsAppUnreadCount(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user = new_test_user(
            cls.env,
            login="whatsapp_unread_user",
            password="Unread-Test-1234",
            groups="whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        cls.other_user = new_test_user(
            cls.env,
            login="whatsapp_unread_other",
            password="Unread-Test-1234",
            groups="whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        # The backend's unique main_backend boolean limits the available rows.
        cls.backend = cls.env["whatsapp.backend"].search([], limit=1)
        if not cls.backend:
            cls.backend = cls.env["whatsapp.backend"].create(
                {
                    "name": "Unread count test",
                    "api_token": "test-token",
                    "phone_number_id": "unread-count-test",
                }
            )
        cls.backend.write({"user_ids": [(6, 0, (cls.user | cls.other_user).ids)]})
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905551234567"}
            )
            messages = cls.env["whatsapp.message"].create(
                [
                    {
                        "backend_id": cls.backend.id,
                        "thread_id": cls.thread.id,
                        "message_id": f"unread-count-{index}",
                        "direction": "incoming",
                        "timestamp": index,
                    }
                    for index in range(101)
                ]
            )
        cls.statuses = messages.read_status_ids.filtered(
            lambda status: status.user_id == cls.user
        )
        cls.other_statuses = messages.read_status_ids.filtered(
            lambda status: status.user_id == cls.other_user
        )

    def _get_count(self, for_badge=True):
        """Call the controller with a real non-superuser ORM environment."""
        request = SimpleNamespace(env=self.env(user=self.user))
        with patch.object(main, "request", request):
            kwargs = {"for_badge": True} if for_badge else {}
            result = main.WhatsAppCloudAPIBackendController().get_unread_count_endpoint(
                **kwargs
            )
            return result["unread_count"]

    def test_exact_count_for_other_clients(self):
        self.assertEqual(self._get_count(for_badge=False), 101)

    def test_badge_threshold(self):
        self.assertEqual(len(self.statuses), 101)
        self.assertEqual(self._get_count(), 100)
        self.statuses[:1].write({"is_read": True})
        self.assertEqual(self._get_count(), 100)
        self.statuses[1:2].write({"is_read": True})
        self.assertEqual(self._get_count(), 99)

    def test_other_users_unread_messages_are_excluded(self):
        self.assertEqual(
            len(self.other_statuses.filtered(lambda status: not status.is_read)), 101
        )
        self.statuses.write({"is_read": True})
        self.assertEqual(self._get_count(), 0)

    def test_revoked_backend_membership_excludes_old_statuses(self):
        self.backend.write({"user_ids": [(3, self.user.id)]})
        self.assertEqual(self._get_count(), 0)
        self.assertEqual(len(self.statuses.exists()), 101)

    def test_archived_backend_is_excluded(self):
        self.backend.active = False
        self.assertEqual(self._get_count(), 0)

    def test_search_threads_with_unread_messages(self):
        domain = [("id", "=", self.thread.id), ("unread_count", ">", 0)]
        threads = self.env["whatsapp.thread"].with_user(self.user)
        self.assertEqual(threads.search(domain), self.thread)
        self.statuses.write({"is_read": True})
        self.assertFalse(threads.search(domain))
        # The other user's unread messages still count for them only
        other_threads = self.env["whatsapp.thread"].with_user(self.other_user)
        self.assertEqual(other_threads.search(domain), self.thread)
