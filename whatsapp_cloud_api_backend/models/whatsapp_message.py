# Copyright (C) 2025 Ahmet Yiğit Budak
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
from odoo import api, fields, models

from ..controllers.main import WP_ATTACHMENT_DOWNLOAD_PATH
from .frontend_webhook import WebhookSender


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
        ondelete="cascade",
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

    read_status_ids = fields.Many2many(
        comodel_name="whatsapp.message.read.status",
    )

    is_read_by_me = fields.Boolean(
        string="Read by Me",
        compute="_compute_is_read_by_me",
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

    @api.model_create_multi
    def create(self, vals_list):
        res = super().create(vals_list)
        for record in res:
            ReadStatus = self.env["whatsapp.message.read.status"]
            user_ids = record.backend_id.user_ids
            for user in user_ids:
                status = self.env["whatsapp.message.read.status"].create(
                    {
                        "message_id": record.id,
                        "user_id": user.id,
                        "is_read": record.direction == "outgoing",
                        "read_timestamp": fields.Datetime.now()
                        if record.direction == "outgoing"
                        else None,
                    }
                )
                ReadStatus |= status
            record.read_status_ids = [(6, 0, ReadStatus.ids)]

        # Send webhook payload for message creation
        res.with_delay().send_webhook_payload("message.created")

        return res

    def _compute_is_read_by_me(self):
        for record in self:
            read_status = record.read_status_ids.filtered(
                lambda r: r.user_id == self.env.user
            )
            if read_status:
                record.is_read_by_me = read_status.is_read
            else:  #  if no read status found for the user, consider as read
                record.is_read_by_me = True

    def mark_as_read_by_user(self, user):
        for record in self:
            read_status = record.read_status_ids.filtered(lambda r: r.user_id == user)
            if read_status and not read_status.is_read:
                read_status.is_read = True
                read_status.read_timestamp = fields.Datetime.now()

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


class WhatsAppMessageReadStatus(models.Model):
    _name = "whatsapp.message.read.status"
    _description = "WhatsApp Message Read Status"

    message_id = fields.Many2one(
        comodel_name="whatsapp.message",
        string="Message",
        required=True,
        ondelete="cascade",
        index=True,
        help="Message that has been read.",
    )
    user_id = fields.Many2one(
        comodel_name="res.users",
        string="User",
        required=True,
        ondelete="cascade",
        index=True,
        help="User who has read the message.",
    )
    is_read = fields.Boolean(
        default=False,
    )
    read_timestamp = fields.Datetime()
