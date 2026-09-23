# Copyright (C) 2025 Ahmet Yiğit Budak
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
from odoo import SUPERUSER_ID, api, fields, models, tools

from ..controllers.main import WP_ATTACHMENT_DOWNLOAD_PATH
from .frontend_webhook import WebhookSender
from .whatsapp_bus import queue_frontend_notification

# Changes the chat view shows: sent to the frontend as "updated"
FRONTEND_MESSAGE_FIELDS = {"body", "status", "attachment_id", "reaction_emoji"}


class WhatsAppMessage(models.Model):
    _name = "whatsapp.message"
    _description = "WhatsApp Message"
    _order = "timestamp desc, id desc"
    _rec_name = "message_id"

    backend_id = fields.Many2one(
        comodel_name="whatsapp.backend",
        string="Backend",
        required=True,
        ondelete="cascade",
    )
    direction = fields.Selection(
        selection=[("incoming", "Incoming"), ("outgoing", "Outgoing")],
        default="outgoing",
        required=True,
        help="Indicates whether the message was received from or sent to WhatsApp.",
    )
    message_id = fields.Char(
        string="Message ID",
        copy=False,
        index=True,
        help="Identifier provided by the WhatsApp Cloud API.",
    )
    conversation_id = fields.Char(
        string="Conversation ID",
        help="External conversation identifier supplied by the WhatsApp API.",
    )
    phone_number = fields.Char(
        help="Counterparty phone number in international format.",
    )
    partner_id = fields.Many2one(
        comodel_name="res.partner",
        string="Partner",
        # Deleting a duplicate partner must not delete the conversation
        ondelete="set null",
        index=True,
        help="Optional partner related to the counterparty of the message.",
    )
    thread_id = fields.Many2one(
        comodel_name="whatsapp.thread",
        string="Thread",
        required=True,
        ondelete="cascade",
        index=True,
        help="Conversation this message belongs to.",
    )
    message_type = fields.Selection(
        selection=[
            ("text", "Text"),
            ("media", "Media"),
            ("interactive", "Interactive"),
            ("reaction", "Reaction"),
            ("template", "Template"),
            ("status", "Status"),
            ("unknown", "Unknown"),
        ],
        default="text",
        required=True,
        help="Type of message exchanged with the WhatsApp Cloud API.",
    )
    body = fields.Text(help="Text content of the message, if any.")
    attachment_id = fields.Many2one(
        comodel_name="ir.attachment",
        string="Attachment",
        help="Optional media or document associated with the message.",
    )
    payload = fields.Json(
        help="Raw payload returned by the WhatsApp Cloud API for traceability.",
    )
    status = fields.Selection(
        selection=[
            ("draft", "Draft"),
            ("pending", "Pending"),
            ("sent", "Sent"),
            ("delivered", "Delivered"),
            ("read", "Read"),
            ("failed", "Failed"),
        ],
        default="pending",
        required=True,
        help="Lifecycle state of the message in the WhatsApp Cloud API.",
    )

    company_id = fields.Many2one(
        comodel_name="res.company",
        string="Company",
        related="backend_id.company_id",
        store=True,
    )

    replied_message_id = fields.Many2one(
        comodel_name="whatsapp.message",
        string="Replied Message",
        help="Reference to the message this message is replying to, if any.",
    )

    reaction_emoji = fields.Char()

    template_id = fields.Many2one(
        comodel_name="whatsapp.template",
        string="Template Used",
        help="Template used for this message, if any.",
        ondelete="set null",
    )

    timestamp = fields.Integer(
        required=True,
    )

    is_automated = fields.Boolean(
        string="Automated",
        compute="_compute_is_automated",
        store=True,
        help="Created by the system (crons, SMS fallback) or by the chatbot, "
        "which answers webhooks as the public user, rather than by an agent.",
    )

    _sql_constraints = [
        (
            "whatsapp_message_unique",
            "unique(message_id, backend_id)",
            "A message with the same identifier already exists for this backend.",
        )
    ]

    def send_webhook_payload(self, event_type):
        """Send the message data to the frontend webhook."""
        for message in self:
            WebhookSender.send_message_webhook_payload(message, event_type)

    def init(self):
        """Index incoming messages by thread for the unread counts."""
        res = super().init()
        tools.create_index(
            self.env.cr,
            "whatsapp_message_incoming_thread_idx",
            self._table,
            ["thread_id", "id"],
            where="direction = 'incoming'",
        )
        return res

    @api.model_create_multi
    def create(self, vals_list):
        res = super().create(vals_list)

        # Send webhook payload for message creation
        res.with_delay().send_webhook_payload("message.created")
        queue_frontend_notification(res, "created")

        return res

    def write(self, vals):
        res = super().write(vals)
        # A reaction is stored on the message it targets, not as a new record,
        # so the frontend only learns about it through an update event.
        if "reaction_emoji" in vals:
            self.with_delay().send_webhook_payload("message.updated")
        if FRONTEND_MESSAGE_FIELDS.intersection(vals):
            queue_frontend_notification(self, "updated")
        return res

    def _frontend_payload(self):
        """Return the message as the frontend reads it."""
        self.ensure_one()
        attachment = self.attachment_id
        attachment_data = False
        attachment_full_data = None
        if attachment:
            base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
            attachment_data = [attachment.id, attachment.name]
            attachment_full_data = {
                "id": attachment.id,
                "name": attachment.name,
                "mimetype": attachment.mimetype,
                "url": f"{base_url}{WP_ATTACHMENT_DOWNLOAD_PATH}{attachment.id}",
                "file_size": attachment.file_size,
            }
        return {
            "id": self.id,
            # Required: the frontend fans this event out only to the
            # sessions that have access to this backend.
            "backend_id": (
                [self.backend_id.id, self.backend_id.name] if self.backend_id else False
            ),
            "body": self.body,
            "status": self.status,
            "direction": self.direction,
            "attachment_id": attachment_data,
            "attachment": attachment_full_data,
            "message_id": self.message_id,
            "replied_message_id": (
                [self.replied_message_id.id, self.replied_message_id.message_id]
                if self.replied_message_id
                else False
            ),
            "create_date": fields.Datetime.to_string(self.create_date) or None,
            "create_uid": (
                [self.create_uid.id, self.create_uid.name] if self.create_uid else False
            ),
            "write_date": fields.Datetime.to_string(self.write_date) or None,
            "timestamp": self.timestamp,
            "reaction_emoji": self.reaction_emoji,
        }

    @api.depends("create_uid")
    def _compute_is_automated(self):
        for message in self:
            creator = message.create_uid
            message.is_automated = creator.id == SUPERUSER_ID or creator.share

    def name_get(self):
        direction_labels = dict(self._fields["direction"].selection)
        result = []
        for record in self:
            name = (
                record.message_id
                or record.phone_number
                or direction_labels.get(record.direction, "")
            )
            if record.create_date:
                name = f"{name} [{fields.Datetime.to_string(record.create_date)}]"
            result.append((record.id, name))
        return result

    @api.model
    def search_read(self, domain=None, fields=None, offset=0, limit=None, order=None):
        res = super().search_read(
            domain=domain, fields=fields, offset=offset, limit=limit, order=order
        )
        if "attachment_id" in (fields or []) and self.env.context.get(
            "whatsapp_connector"
        ):
            base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
            for record in res:
                if record.get("attachment_id"):
                    attachment_record = (
                        self.env["ir.attachment"]
                        .browse(record["attachment_id"][0])
                        .sudo()
                    )
                    record["attachment"] = {
                        "id": attachment_record.id,
                        "name": attachment_record.name,
                        "mimetype": attachment_record.mimetype,
                        "url": (
                            f"{base_url}{WP_ATTACHMENT_DOWNLOAD_PATH}"
                            f"{attachment_record.id}"
                        ),
                        "file_size": attachment_record.file_size,
                    }
        return res
