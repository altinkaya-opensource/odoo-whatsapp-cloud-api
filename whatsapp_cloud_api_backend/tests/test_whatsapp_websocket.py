from odoo import api
from odoo.tests.common import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestWhatsAppWebsocket(TransactionCase):
    def test_subscription_without_user_gets_no_backends(self):
        """A websocket that subscribes after its session ended has no user.
        It gets no WhatsApp channels instead of failing (Bugsink ODOO-182)."""
        no_user_env = api.Environment(self.env.cr, None, {})
        websocket = no_user_env["ir.websocket"]

        self.assertFalse(websocket._whatsapp_backend_channels(["whatsapp"]))
