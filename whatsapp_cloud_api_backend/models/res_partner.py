# Copyright 2025 Erol Develi (https://github.com/erlinberg)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import fields, models


class ResPartner(models.Model):
    _inherit = "res.partner"

    has_whatsapp_conversation = fields.Boolean(
        compute="_compute_has_whatsapp_conversation",
        string="Has WhatsApp Conversation",
        help="Indicates if this partner has any WhatsApp conversation threads.",
    )
    whatsapp_thread_ids = fields.One2many(
        comodel_name="whatsapp.thread",
        inverse_name="partner_id",
        string="WhatsApp Threads",
    )
    # Incoming WhatsApp messages look their sender up by this exact value
    phone_sanitized = fields.Char(index="btree_not_null")

    def _compute_has_whatsapp_conversation(self):
        """Compute whether the partner has any WhatsApp conversation threads."""
        user_has_access = self.env["whatsapp.thread"].check_access_rights(
            "read", raise_exception=False
        )
        for partner in self:
            partner.has_whatsapp_conversation = bool(
                user_has_access and partner.whatsapp_thread_ids
            )

    def action_open_whatsapp_chat(self):
        """
        Open the WhatsApp frontend with this partner's most recent conversation.

        This method:
        1. Finds the most recent WhatsApp thread for this partner
        2. Generates a one-time sign-in link with the thread ID
        3. Returns an action to open the URL in a new browser tab
        """
        self.ensure_one()
        thread = fields.first(self.whatsapp_thread_ids)
        return {
            "type": "ir.actions.act_url",
            "url": thread.backend_id._get_frontend_login_url(thread),
            "target": "new",
        }

    def action_open_whatsapp_stats(self):
        """Open the WhatsApp Statistics report filtered to this partner."""
        self.ensure_one()
        action = self.env["ir.actions.act_window"]._for_xml_id(
            "whatsapp_cloud_api_backend.action_whatsapp_message_report"
        )
        action["domain"] = [("partner_id", "=", self.id)]
        action["context"] = {
            "search_default_partner_initiated": 1,
        }
        return action

    def _compute_avatar(self, avatar_field, image_field):
        """
        Override avatar computation to prevent Odoo from auto-generating
        default avatars.

        By default, Odoo automatically generates avatar images from partner initials
        when no avatar is set. This override allows the WhatsApp connector to
        distinguish between actual uploaded images and missing avatars by returning
        empty bytes instead of auto-generated placeholders.

        This enables the frontend to show appropriate fallback UI when partners
        have no actual profile picture.
        """
        # When called from WhatsApp connector,
        # return raw image data without auto-generation
        if self._context.get("whatsapp_connector"):
            for record in self:
                avatar = record[image_field]
                if not avatar:
                    avatar = b""
                record[avatar_field] = avatar
            return True
        else:
            return super()._compute_avatar(avatar_field, image_field)
