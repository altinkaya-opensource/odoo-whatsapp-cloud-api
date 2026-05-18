# Copyright (C) 2025 Ahmet Yiğit Budak (https://github.com/yibudak)
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
import logging
import re
import secrets

import phonenumbers
import requests
from requests import RequestException

from odoo import _, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WhatsAppBackend(models.Model):
    _name = "whatsapp.backend"
    _description = "WhatsApp Cloud API Backend"
    # _inherit = ["mail.thread", "mail.activity.mixin"]

    def _get_domain_user_ids(self):
        whatsapp_group_user = self.env.ref(
            "whatsapp_cloud_api_backend.group_whatsapp_backend_user"
        )
        whatsapp_group_manager = self.env.ref(
            "whatsapp_cloud_api_backend.group_whatsapp_backend_manager"
        )
        return [
            ("id", "in", (whatsapp_group_user.users + whatsapp_group_manager.users).ids)
        ]

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    main_backend = fields.Boolean(default=False)
    api_token = fields.Char(string="API Token", required=True)
    phone_number_id = fields.Char(string="Phone Number ID", required=True)
    api_version = fields.Char(string="API Version", required=True, default="v23.0")
    webhook_secret = fields.Char(
        required=True,
        default=lambda self: secrets.token_urlsafe(32),
    )
    language = fields.Many2one(
        comodel_name="res.lang",
    )
    user_ids = fields.Many2many(
        comodel_name="res.users",
        string="Users",
        help="Users who can use this WhatsApp backend to send messages.",
        domain=lambda self: self._get_domain_user_ids(),
    )
    message_ids = fields.One2many(
        comodel_name="whatsapp.message",
        inverse_name="backend_id",
        string="Messages",
        readonly=True,
        help="Messages sent or received via this backend.",
    )
    company_id = fields.Many2one(
        comodel_name="res.company",
        string="Company",
        default=lambda self: self.env.company,
    )

    frontend_webhook_url = fields.Char(
        string="Frontend Webhook URL",
        help="URL to send WhatsApp thread and message updates to the frontend.",
    )
    frontend_webhook_secret = fields.Char(
        help="Secret token to authenticate frontend webhook requests.",
    )

    # Chatbot configuration
    chatbot_id = fields.Many2one(
        comodel_name="whatsapp.chatbot",
        string="Default Chatbot",
        help="Chatbot to use for incoming messages on this backend",
        ondelete="set null",
    )
    chatbot_enabled = fields.Boolean(
        string="Enable Chatbot",
        default=False,
        help="If enabled, incoming messages will be handled by the chatbot",
    )

    # Template configuration
    waba_id = fields.Char(
        string="WhatsApp Business Account ID",
        help="WABA ID required for fetching message templates. "
        "Find this in Meta Business Suite > WhatsApp Manager > Settings.",
    )
    template_count = fields.Integer(
        compute="_compute_template_count",
    )

    _sql_constraints = [
        (
            "main_backend_unique",
            "unique(main_backend)",
            "There can be only one main WhatsApp backend.",
        ),
    ]

    def _compute_template_count(self):
        Template = self.env["whatsapp.template"]
        for record in self:
            if record.waba_id:
                record.template_count = Template.search_count(
                    [("waba_id", "=", record.waba_id)]
                )
            else:
                record.template_count = 0

    # -------------------------------------------------------------------------
    # WhatsApp Cloud API helpers
    # -------------------------------------------------------------------------

    def _graph_api_base_url(self):
        self.ensure_one()
        if not self.phone_number_id:
            raise UserError(_("Phone number ID is required to use the WhatsApp API."))
        version = self.api_version or "v17.0"
        return f"https://graph.facebook.com/{version}/{self.phone_number_id}"

    def _waba_api_base_url(self):
        """Get base URL for WABA-level API calls (templates, etc.)"""
        self.ensure_one()
        if not self.waba_id:
            raise UserError(
                _("WhatsApp Business Account ID is required for this operation.")
            )
        version = self.api_version or "v17.0"
        return f"https://graph.facebook.com/{version}/{self.waba_id}"

    def _call_whatsapp_api(self, endpoint, payload):
        self.ensure_one()
        if not self.api_token:
            raise UserError(_("API token is required to call the WhatsApp API."))
        url = f"{self._graph_api_base_url()}/{endpoint}"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)
        except RequestException as exc:
            _logger.exception("WhatsApp API request failed")
            raise UserError(_("Unable to contact WhatsApp API: %s") % exc) from exc

        if response.status_code >= 400:
            try:
                error_content = response.json()
            except ValueError:
                error_content = response.text

            if isinstance(error_content, dict):
                error_message = (
                    error_content.get("error", {}).get("message")
                    or error_content.get("message")
                    or str(error_content)
                )
            else:
                error_message = error_content

            _logger.error(
                "WhatsApp API error (status %s): %s",
                response.status_code,
                error_message,
            )
            raise UserError(_("WhatsApp API error: %s") % error_message)

        try:
            return response.json()
        except ValueError as exc:
            _logger.exception("Invalid JSON response received from WhatsApp API")
            raise UserError(_("Invalid response from WhatsApp API.")) from exc

    def _upload_media_to_whatsapp(self, attachment):
        """Upload media to WhatsApp and return the media ID.

        Args:
            attachment: ir.attachment record containing the media file

        Returns:
            str: WhatsApp media ID
        """
        self.ensure_one()
        if not self.api_token:
            raise UserError(_("API token is required to upload media to WhatsApp."))
        if not attachment:
            raise UserError(_("Attachment is required to upload media."))

        url = f"{self._graph_api_base_url()}/media"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
        }

        # Get file data from attachment
        file_data = attachment.raw
        if not file_data:
            raise UserError(_("Attachment has no file data."))

        # Prepare multipart form data
        files = {"file": (attachment.name, file_data, attachment.mimetype)}
        data = {
            "messaging_product": "whatsapp",
            "type": attachment.mimetype,
        }

        try:
            response = requests.post(
                url, headers=headers, files=files, data=data, timeout=60
            )
        except RequestException as exc:
            _logger.exception("WhatsApp media upload failed")
            raise UserError(_("Unable to upload media to WhatsApp: %s") % exc) from exc

        if response.status_code >= 400:
            try:
                error_content = response.json()
            except ValueError:
                error_content = response.text

            if isinstance(error_content, dict):
                error_message = (
                    error_content.get("error", {}).get("message")
                    or error_content.get("message")
                    or str(error_content)
                )
            else:
                error_message = error_content

            _logger.error(
                "WhatsApp media upload error (status %s): %s",
                response.status_code,
                error_message,
            )
            raise UserError(_("WhatsApp media upload error: %s") % error_message)

        try:
            result = response.json()
            media_id = result.get("id")
            if not media_id:
                raise UserError(_("WhatsApp API did not return a media ID."))
            _logger.info("Media uploaded to WhatsApp successfully: %s", media_id)
            return media_id
        except ValueError as exc:
            _logger.exception("Invalid JSON response received from WhatsApp API")
            raise UserError(_("Invalid response from WhatsApp API.")) from exc

    # ---------------------------------------------------------------------
    # Template operations
    # ---------------------------------------------------------------------

    def action_sync_templates(self):
        """Fetch templates from WhatsApp Cloud API and sync to Odoo"""
        self.ensure_one()

        if not self.waba_id:
            raise UserError(
                _("WhatsApp Business Account ID is required to sync templates.")
            )

        Template = self.env["whatsapp.template"]

        # Fetch templates from WhatsApp API
        url = f"{self._waba_api_base_url()}/message_templates"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
        }

        try:
            response = requests.get(url, headers=headers, timeout=60)
        except RequestException as exc:
            _logger.exception("WhatsApp template sync failed")
            raise UserError(_("Unable to fetch templates: %s") % exc) from exc

        if response.status_code >= 400:
            try:
                error_content = response.json()
            except ValueError:
                error_content = response.text

            if isinstance(error_content, dict):
                error_message = (
                    error_content.get("error", {}).get("message")
                    or error_content.get("message")
                    or str(error_content)
                )
            else:
                error_message = error_content

            raise UserError(_("Failed to fetch templates: %s") % error_message)

        try:
            data = response.json()
        except ValueError as exc:
            raise UserError(_("Invalid response from WhatsApp API.")) from exc

        templates_data = data.get("data", [])

        synced_count = 0
        for tpl_data in templates_data:
            # Find existing template by template_id, waba_id, and language
            existing = Template.search(
                [
                    ("template_id", "=", tpl_data["id"]),
                    ("waba_id", "=", self.waba_id),
                    ("language", "=", tpl_data.get("language")),
                ],
                limit=1,
            )

            vals = {
                "name": tpl_data["name"],
                "template_id": tpl_data["id"],
                "status": tpl_data.get("status", "PENDING"),
                "category": tpl_data.get("category"),
                "language": tpl_data.get("language"),
                "components": tpl_data.get("components", []),
                "waba_id": self.waba_id,
                "last_synced": fields.Datetime.now(),
            }

            if existing:
                existing.write(vals)
            else:
                Template.create(vals)

            synced_count += 1

        _logger.info("Synced %d templates for backend %s", synced_count, self.name)

        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": _("Templates Synced"),
                "message": _("%d templates synchronized from WhatsApp.") % synced_count,
                "type": "success",
            },
        }

    def action_view_templates(self):
        """Open templates view for this WABA"""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Message Templates"),
            "res_model": "whatsapp.template",
            "view_mode": "tree,form",
            "domain": [("waba_id", "=", self.waba_id)],
            "context": {"default_waba_id": self.waba_id},
        }

    # ---------------------------------------------------------------------
    # Thread helpers
    # ---------------------------------------------------------------------

    def _normalize_phone_number(self, phone, default_region="TR"):
        """
        Normalize phone number to E.164 format (without +).
        WhatsApp uses this format: country code + national number (e.g., 905551234567)
        """
        if not phone:
            return phone
        try:
            parsed = phonenumbers.parse(phone, default_region)
            if phonenumbers.is_valid_number(parsed):
                e164 = phonenumbers.format_number(
                    parsed, phonenumbers.PhoneNumberFormat.E164
                )
                return e164.lstrip("+")
        except phonenumbers.NumberParseException:
            _logger.debug("Could not parse phone number: %s", phone)
        # Fallback: just strip non-digit characters
        return re.sub(r"\D", "", phone)

    def _get_or_create_thread(self, phone_number, partner=None, contact_name=None):
        self.ensure_one()
        if not phone_number:
            raise UserError(
                _("A phone number is required to identify the WhatsApp thread.")
            )
        # Normalize phone number for consistent matching
        normalized_phone = self._normalize_phone_number(phone_number)

        thread_model = self.env["whatsapp.thread"].sudo()
        thread = thread_model.search(
            [("backend_id", "=", self.id), ("phone_number", "=", normalized_phone)],
            limit=1,
        )
        create_vals = None
        if not thread:
            create_vals = {
                "backend_id": self.id,
                "phone_number": normalized_phone,
                "partner_id": partner.id if partner else False,
            }
            if contact_name:
                create_vals["name"] = contact_name
            thread = thread_model.create(create_vals)
        else:
            update_vals = {}
            if partner and not thread.partner_id:
                update_vals["partner_id"] = partner.id
            if contact_name and thread.name in {
                thread.phone_number,
                "WhatsApp Thread",
                False,
            }:
                update_vals["name"] = contact_name
            if update_vals:
                thread.sudo().write(update_vals)
        return thread

    # ---------------------------------------------------------------------
    # Public Backend API
    # ---------------------------------------------------------------------

    def initialize_web(self):
        user = self.env.user
        backend_ids = self.sudo().search([("user_ids", "in", user.id)])

        if not backend_ids:
            return {
                "error": "this user has no backend assigned",
            }
        company_id = fields.first(backend_ids.mapped("company_id"))

        base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
        image_url_tpl = f"{base_url}/web/image?model=res.users&field=avatar_128&id="
        users_list = [
            {
                "id": backend_user.id,
                "name": backend_user.name,
                "image_url": f"{image_url_tpl}{backend_user.id}",
            }
            for backend_user in backend_ids.mapped("user_ids")
        ]

        # Backend names mapping for frontend selector
        backend_names = {backend.id: backend.name for backend in backend_ids}

        return {
            "backend_ids": backend_ids.ids,
            "backend_names": backend_names,
            "language": self.env.user.lang,
            "company_id": company_id.id,
            "user_id": user.id,
            "users": users_list,
        }

    # ---------------------------------------------------------------------
    # Public sending API
    # ---------------------------------------------------------------------

    def send_text_message(
        self, phone_number, body, *, preview_url=False, partner=None, contact_name=None
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_text_message(body, preview_url=preview_url)

    def send_reply_message(
        self,
        phone_number,
        body,
        reply_to_message_id,
        *,
        preview_url=False,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        data = thread.send_reply_message(
            body, reply_to_message_id, preview_url=preview_url
        )

        # Link the replied message
        message_record = self.env["whatsapp.message"].search(
            [("id", "=", data["message_id"])]
        )
        reply_record = self.env["whatsapp.message"].search(
            [("message_id", "=", reply_to_message_id)]
        )
        message_record.sudo().write({"replied_message_id": reply_record.id})

        return data

    def send_reaction_message(
        self,
        phone_number,
        emoji,
        target_message_id,
        *,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_reaction_message(emoji, target_message_id)

    def send_document_message(
        self,
        phone_number,
        *,
        media_id=None,
        link=None,
        caption=None,
        filename=None,
        attachment=None,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_document_message(
            media_id=media_id,
            link=link,
            caption=caption,
            filename=filename,
            attachment=attachment,
        )

    def send_cta_url_message(
        self,
        phone_number,
        body_text,
        button_text,
        url,
        *,
        header_text=None,
        footer_text=None,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_cta_url_message(
            body_text,
            button_text,
            url,
            header_text=header_text,
            footer_text=footer_text,
        )

    def send_list_message(
        self,
        phone_number,
        body_text,
        button_text,
        sections,
        *,
        header_text=None,
        footer_text=None,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_list_message(
            body_text,
            button_text,
            sections,
            header_text=header_text,
            footer_text=footer_text,
        )

    def send_image_message(
        self,
        phone_number,
        *,
        media_id=None,
        link=None,
        caption=None,
        attachment=None,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_image_message(
            media_id=media_id,
            link=link,
            caption=caption,
            attachment=attachment,
        )

    def send_video_message(
        self,
        phone_number,
        *,
        media_id=None,
        link=None,
        caption=None,
        attachment=None,
        partner=None,
        contact_name=None,
    ):
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        return thread.send_video_message(
            media_id=media_id,
            link=link,
            caption=caption,
            attachment=attachment,
        )

    def send_template_message(
        self,
        phone_number,
        template,
        *,
        record=None,
        partner=None,
        contact_name=None,
    ):
        """Send a template message via WhatsApp

        Args:
            phone_number: Recipient phone number
            template: whatsapp.template record or template ID
            record: Optional Odoo record for variable mapping
            partner: Optional partner record
            contact_name: Optional contact name
        """
        thread = self._get_or_create_thread(
            phone_number, partner=partner, contact_name=contact_name
        )
        # Set human handoff mode - chatbot should not respond after template message
        thread.chatbot_ended = True
        return thread.send_template_message(template, record=record)

    def get_simple_templates(self):
        """Return APPROVED templates with no model_id for this backend's WABA.

        Used by the frontend chat to list re-engagement templates that can be
        sent without an Odoo record context (no variable substitution).
        """
        self.ensure_one()
        templates = self.env["whatsapp.template"].search(
            [
                ("status", "=", "APPROVED"),
                ("model_id", "=", False),
                ("waba_id", "=", self.waba_id),
                ("active", "=", True),
            ]
        )
        return [
            {
                "id": template.id,
                "name": template.name,
                "language": template.language or "",
                "category": template.category or "",
                "header_text": template.header_text or "",
                "body_text": template.body_text or "",
                "footer_text": template.footer_text or "",
                "preview": template.render_message_preview(None),
            }
            for template in templates
        ]

    def send_simple_template(self, phone_number, template_id):
        """Send a no-record template message to a phone number.

        Restricted to templates with no model_id so the frontend cannot
        accidentally send model-bound templates without variable values.
        """
        self.ensure_one()
        template = self.env["whatsapp.template"].browse(template_id)
        if not template.exists():
            raise UserError(_("Template not found."))
        if template.model_id:
            raise UserError(
                _(
                    "Template '%s' requires a record context and cannot be sent "
                    "from the chat picker."
                )
                % template.name
            )
        return self.send_template_message(phone_number, template, record=None)
