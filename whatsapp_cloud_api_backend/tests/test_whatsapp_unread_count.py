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
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Unread count test",
                "api_token": "test-token",
                "phone_number_id": "unread-count-test",
                "user_ids": [(6, 0, (cls.user | cls.other_user).ids)],
            }
        )
        with trap_jobs():
            cls.thread = cls.env["whatsapp.thread"].create(
                {"backend_id": cls.backend.id, "phone_number": "905551234567"}
            )
            cls._receive(cls.thread, 101)

    @classmethod
    def _receive(cls, thread, count, start=0):
        messages = cls.env["whatsapp.message"].create(
            [
                {
                    "backend_id": thread.backend_id.id,
                    "thread_id": thread.id,
                    "message_id": f"unread-count-{thread.id}-{start + index}",
                    "direction": "incoming",
                    "timestamp": start + index,
                }
                for index in range(count)
            ]
        )
        thread._register_message(messages[-1])
        return messages

    def _get_count(self, user=None, for_badge=True):
        """Call the controller with a real non-superuser ORM environment."""
        request = SimpleNamespace(env=self.env(user=user or self.user))
        with patch.object(main, "request", request):
            kwargs = {"for_badge": True} if for_badge else {}
            result = main.WhatsAppCloudAPIBackendController().get_unread_count_endpoint(
                **kwargs
            )
            return result["unread_count"]

    def test_exact_count_for_other_clients(self):
        self.assertEqual(self._get_count(for_badge=False), 101)

    def test_badge_threshold(self):
        self.assertEqual(self._get_count(), 100)

    def test_reading_is_per_user(self):
        self.thread.with_user(self.user).mark_as_read()
        self.assertEqual(self._get_count(), 0)
        self.assertEqual(self._get_count(self.other_user, for_badge=False), 101)

    def test_revoked_backend_membership_excludes_its_threads(self):
        self.backend.write({"user_ids": [(3, self.user.id)]})
        self.assertEqual(self._get_count(), 0)

    def test_archived_backend_is_excluded(self):
        self.backend.active = False
        self.assertEqual(self._get_count(), 0)

    def test_search_threads_with_unread_messages(self):
        domain = [("id", "=", self.thread.id), ("unread_count", ">", 0)]
        threads = self.env["whatsapp.thread"].with_user(self.user)
        self.assertEqual(threads.search(domain), self.thread)
        self.thread.with_user(self.user).mark_as_read()
        self.assertFalse(threads.search(domain))
        # The other user's unread messages still count for them only
        other_threads = self.env["whatsapp.thread"].with_user(self.other_user)
        self.assertEqual(other_threads.search(domain), self.thread)

    def test_thread_counts_every_unread_message(self):
        thread = self.thread.with_user(self.user)
        self.assertEqual(thread.unread_count, 101)
        thread.mark_as_read()
        self.assertEqual(thread.unread_count, 0)
        with trap_jobs():
            self._receive(self.thread, 2, start=101)
        thread.invalidate_recordset(["unread_count"])
        self.assertEqual(thread.unread_count, 2)
        # Per user, even inside one transaction
        self.assertEqual(self.thread.with_user(self.other_user).unread_count, 103)

    def test_joining_a_backend_starts_with_its_history_read(self):
        newcomer = new_test_user(
            self.env,
            login="whatsapp_unread_newcomer",
            password="Unread-Test-1234",
            groups="whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        self.backend.write({"user_ids": [(4, newcomer.id)]})
        self.assertEqual(self._get_count(newcomer), 0)
        with trap_jobs():
            self._receive(self.thread, 1, start=200)
        self.assertEqual(self._get_count(newcomer), 1)

    def test_mark_all_as_read(self):
        result = (
            self.env["whatsapp.thread"]
            .with_user(self.user)
            .mark_all_as_read(self.backend.with_user(self.user))
        )
        self.assertEqual(result, {"marked_count": 101})
        self.assertEqual(self._get_count(), 0)
        self.assertEqual(self._get_count(self.other_user), 100)
