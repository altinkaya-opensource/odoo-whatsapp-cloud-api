import base64
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase, new_test_user

from odoo.addons.queue_job.tests.common import trap_jobs

CREDENTIAL_FIELDS = (
    "api_token",
    "app_secret",
    "webhook_secret",
)


class TestWhatsAppSecurity(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_security_agent",
            password="Security-Test-1234",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        cls.manager = new_test_user(
            cls.env,
            login="whatsapp_security_manager",
            password="Security-Test-1234",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_manager",
        )
        cls.backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Security test",
                "api_token": "security-test-token",
                "phone_number_id": "security-test",
                "app_secret": "security-test-app-secret",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )
        cls.other_backend = cls.env["whatsapp.backend"].create(
            {
                "name": "Security test (other team)",
                "api_token": "security-test-other-token",
                "phone_number_id": "security-test-other",
            }
        )

    def _patch_meta(self):
        """Replace the Meta API calls so a send never leaves the test."""
        Backend = type(self.env["whatsapp.backend"])
        return (
            patch.object(
                Backend,
                "_call_whatsapp_api",
                return_value={"messages": [{"id": "wamid.security-test"}]},
            ),
            patch.object(Backend, "_upload_media_to_whatsapp", return_value="media-id"),
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

    def test_agents_only_see_their_backends(self):
        backends = self.env["whatsapp.backend"].with_user(self.agent).search([])
        self.assertIn(self.backend, backends)
        self.assertNotIn(self.other_backend, backends)
        managed = self.env["whatsapp.backend"].with_user(self.manager).search([])
        self.assertIn(self.other_backend, managed)

    def test_agents_cannot_send_from_other_backends(self):
        call_api, upload = self._patch_meta()
        with call_api as api_call, upload, trap_jobs():
            with self.assertRaises(AccessError):
                self.other_backend.with_user(self.agent).send_text_message(
                    "905550000001", "hello"
                )
            api_call.assert_not_called()
            self.backend.with_user(self.agent).send_text_message(
                "905550000001", "hello"
            )
            api_call.assert_called_once()

    def test_agents_send_only_attachments_they_can_read(self):
        # In this fork every internal user may read unlinked attachments;
        # private documents are protected by the record they belong to.
        restricted_record = self.env["ir.config_parameter"].search([], limit=1)
        foreign = self.env["ir.attachment"].create(
            {
                "name": "payslip.pdf",
                "datas": base64.b64encode(b"private"),
                "res_model": restricted_record._name,
                "res_id": restricted_record.id,
            }
        )
        own = (
            self.env["ir.attachment"]
            .with_user(self.agent)
            .create({"name": "photo.png", "datas": base64.b64encode(b"photo")})
        )
        backend = self.backend.with_user(self.agent)
        call_api, upload = self._patch_meta()
        with call_api, upload as upload_call, trap_jobs():
            with self.assertRaises(AccessError):
                backend.send_image_message("905550000001", attachment=foreign.id)
            upload_call.assert_not_called()
            backend.send_image_message("905550000001", attachment=own.id)
            upload_call.assert_called_once()

    def _code_variable(self):
        template = self.env["whatsapp.template"].create(
            {
                "name": "security_code_variable",
                "waba_id": "security-test-waba",
                "language": "en",
                "model_id": self.env["ir.model"]._get("res.partner").id,
                "components": [{"type": "BODY", "text": "Hi {{1}}"}],
            }
        )
        return self.env["whatsapp.template.variable"].create(
            {
                "template_id": template.id,
                "variable_position": 1,
                "component_type": "body",
                "value_type": "code",
                "python_code": "result = record.name.upper()",
            }
        )

    def test_only_administrators_edit_executable_code(self):
        variable = self._code_variable()
        with self.assertRaises(AccessError):
            variable.with_user(self.manager).write({"python_code": "result = 1"})
        script = self.env["whatsapp.chatbot.script"].search([], limit=1)
        if script:
            with self.assertRaises(AccessError):
                script.with_user(self.manager).write({"interactive_code": "pass"})

    def test_agents_still_render_code_variables(self):
        variable = self._code_variable()
        partner = self.env["res.partner"].create({"name": "code variable"})
        value = variable.with_user(self.agent).get_value_from_record(
            partner.with_user(self.agent)
        )
        self.assertEqual(value, "CODE VARIABLE")
