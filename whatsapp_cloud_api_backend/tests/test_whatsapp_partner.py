from odoo.tests.common import TransactionCase

from odoo.addons.queue_job.tests.common import trap_jobs


class TestWhatsAppPartner(TransactionCase):
    def _find_or_create(self, phone_number):
        return self.env["whatsapp.webhook"]._find_or_create_partner(
            phone_number, {"profile": {"name": "WhatsApp sender"}}
        )

    def test_matches_locally_typed_numbers(self):
        partner = self.env["res.partner"].create(
            {
                "name": "Local format",
                "mobile": "0555 000 00 04",
                "country_id": self.env.ref("base.tr").id,
            }
        )
        self.assertEqual(partner.phone_sanitized, "+905550000004")
        self.assertEqual(self._find_or_create("905550000004"), partner)

    def test_creates_unknown_senders(self):
        partner = self._find_or_create("905550000005")
        self.assertEqual(partner.name, "WhatsApp sender")

    def test_deleting_a_partner_keeps_the_conversation(self):
        partner = self.env["res.partner"].create({"name": "Duplicate"})
        backend = self.env["whatsapp.backend"].search([], limit=1)
        with trap_jobs():
            thread = self.env["whatsapp.thread"].create(
                {
                    "backend_id": backend.id,
                    "phone_number": "905550000006",
                    "partner_id": partner.id,
                }
            )
            message = self.env["whatsapp.message"].create(
                {
                    "backend_id": backend.id,
                    "thread_id": thread.id,
                    "partner_id": partner.id,
                    "message_id": "wamid.partner-delete",
                    "direction": "incoming",
                    "timestamp": 1,
                }
            )
            partner.unlink()
        self.assertTrue(message.exists())
        self.assertFalse(message.partner_id)
