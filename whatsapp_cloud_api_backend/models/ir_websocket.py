# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
from odoo import models

# String channel the WhatsApp frontend and the systray of WhatsApp users
# subscribe with; other Odoo web client tabs do not get the conversations.
FRONTEND_CHANNEL = "whatsapp"


class IrWebsocket(models.AbstractModel):
    _inherit = "ir.websocket"

    def _build_bus_channel_list(self, channels):
        channels = super()._build_bus_channel_list(channels)
        return channels + list(self._whatsapp_backend_channels(channels))

    def _whatsapp_backend_channels(self, channels):
        """Give the WhatsApp frontend the channels of the user's backends.

        Odoo re-checks the session on every websocket message, and only
        backends the user is a member of are returned.
        """
        if FRONTEND_CHANNEL not in channels or self.env.user._is_public():
            return self.env["whatsapp.backend"]
        return self.env["whatsapp.backend"].search([("user_ids", "in", self.env.uid)])
