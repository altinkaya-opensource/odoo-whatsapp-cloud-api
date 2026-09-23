from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs


class TestSmsFallback(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        backend = cls.env["whatsapp.backend"].create(
            {
                "name": "SMS fallback test",
                "api_token": "sms-test-token",
                "phone_number_id": "sms-test",
                "waba_id": "sms-test-waba",
            }
        )
        cls.env["whatsapp.template"].create(
            {
                "name": "sms_fallback_test",
                "waba_id": "sms-test-waba",
                "language": "tr",
                "model_id": cls.env["ir.model"]._get("res.partner").id,
                "components": [{"type": "BODY", "text": "Kargonuz yolda"}],
                "default_sms_template": True,
                "status": "APPROVED",
            }
        )
        cls.rejected = cls._create_sms(backend, "905550000007")
        cls.accepted = cls._create_sms(backend, "905550000008")

    @classmethod
    def _create_sms(cls, backend, number):
        partner = cls.env["res.partner"].create({"name": number, "mobile": number})
        with trap_jobs():
            cls.env["whatsapp.thread"].create(
                {
                    "backend_id": backend.id,
                    "phone_number": number,
                    "partner_id": partner.id,
                }
            )
        mail_message = cls.env["mail.message"].create(
            {
                "model": "res.partner",
                "res_id": partner.id,
                "partner_ids": [(6, 0, partner.ids)],
                "message_type": "sms",
                "body": "Kargonuz yolda",
            }
        )
        return cls.env["sms.sms"].create(
            {
                "number": number,
                "body": "Kargonuz yolda",
                "partner_id": partner.id,
                "mail_message_id": mail_message.id,
            }
        )

    def _try_whatsapp_first(self):
        Backend = type(self.env["whatsapp.backend"])
        responses = [
            UserError("rejected"),
            {"messages": [{"id": "wamid.sms-fallback"}]},
        ]
        with (
            patch.object(Backend, "_call_whatsapp_api", side_effect=responses),
            trap_jobs(),
        ):
            return self.env["sms.api"]._try_whatsapp_first(
                [{"res_id": self.rejected.id}, {"res_id": self.accepted.id}]
            )

    def test_one_rejected_number_does_not_fail_the_batch(self):
        whatsapp_result, sms_list = self._try_whatsapp_first()
        self.assertEqual(
            whatsapp_result, [{"res_id": self.accepted.id, "state": "success"}]
        )
        self.assertEqual(sms_list, [{"res_id": self.rejected.id}])

    def test_failed_delivery_is_texted_once(self):
        self._try_whatsapp_first()
        message = self.env["whatsapp.message"].search(
            [("message_id", "=", "wamid.sms-fallback")]
        )
        self.assertEqual(message.sms_fallback_number, "905550000008")
        SmsSms = type(self.env["sms.sms"])
        with patch.object(SmsSms, "_send") as send, trap_jobs():
            message.write({"status": "failed"})
            message.write({"status": "failed"})
        send.assert_called_once()
        self.assertFalse(message.sms_fallback_number)
        self.assertIn("Kargonuz yolda", self.accepted.mail_message_id.body)
