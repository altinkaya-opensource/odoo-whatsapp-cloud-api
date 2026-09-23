from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase, new_test_user

CREDENTIAL_FIELDS = (
    "api_token",
    "app_secret",
    "webhook_secret",
    "frontend_webhook_secret",
)


class TestWhatsAppSecurity(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_security_agent",
            password="Security-Test-1234",
            groups="whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        cls.manager = new_test_user(
            cls.env,
            login="whatsapp_security_manager",
            password="Security-Test-1234",
            groups="whatsapp_cloud_api_backend.group_whatsapp_backend_manager",
        )
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Security test",
                "api_token": "security-test-token",
                "phone_number_id": "security-test",
                "app_secret": "security-test-app-secret",
                "frontend_webhook_secret": "security-test-frontend-secret",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )

    def test_agents_cannot_read_credentials(self):
        backend = self.backend.with_user(self.agent)
        for field_name in CREDENTIAL_FIELDS:
            with self.assertRaises(AccessError, msg=field_name):
                backend.read([field_name])
        # Sending still works: the Meta client reads the token with sudo
        self.assertEqual(backend._get_api_token(), "security-test-token")

    def test_managers_can_read_credentials(self):
        values = self.backend.with_user(self.manager).read(list(CREDENTIAL_FIELDS))
        self.assertEqual(values[0]["api_token"], "security-test-token")
