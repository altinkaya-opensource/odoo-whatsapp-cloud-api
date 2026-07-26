# Copyright (C) 2025 Ahmet Yiğit Budak
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
import json
import time

from odoo import _, api, fields, models
from odoo.exceptions import UserError

from .frontend_webhook import WebhookSender


class WhatsAppThread(models.Model):
    _name = "whatsapp.thread"
    _description = "WhatsApp Thread"
    _order = "last_message_date desc, id desc"

    name = fields.Char(string="Subject", required=True, default="WhatsApp Thread")
    backend_id = fields.Many2one(
        comodel_name="whatsapp.backend",
        string="Backend",
        required=True,
        ondelete="cascade",
        index=True,
    )
    company_id = fields.Many2one(
        comodel_name="res.company",
        string="Company",
        related="backend_id.company_id",
        store=True,
        index=True,
    )
    partner_id = fields.Many2one(
        comodel_name="res.partner",
        string="Partner",
        ondelete="set null",
        index=True,
    )
    phone_number = fields.Char(required=True, index=True)
    whatsapp_message_ids = fields.One2many(
        comodel_name="whatsapp.message",
        inverse_name="thread_id",
        string="WhatsApp Messages",
    )
    last_message_id = fields.Many2one(
        comodel_name="whatsapp.message",
        string="Last Message",
        readonly=True,
    )
    last_message_date = fields.Datetime(readonly=True, index=True)
    last_message_preview = fields.Text(readonly=True)

    unread_count = fields.Integer(
        compute="_compute_unread_count",
    )

    has_avatar = fields.Boolean(
        compute="_compute_has_avatar",
    )

    # Chatbot fields
    chatbot_id = fields.Many2one(
        comodel_name="whatsapp.chatbot",
        string="Active Chatbot",
        help="Currently active chatbot for this conversation",
        ondelete="set null",
        index=True,
    )
    chatbot_step_sequence = fields.Integer(
        default=0,
        help="Current step in the chatbot conversation flow (0 = not started)",
    )
    chatbot_ended = fields.Boolean(
        default=False,
        help="If True, chatbot will not respond (human handoff mode)",
    )
    chatbot_step_ended = fields.Boolean(
        default=False,
        help="If True, current step won't re-execute until navigation occurs",
    )
    chatbot_last_message_date = fields.Datetime(
        string="Chatbot Last Interaction",
        help="Last time chatbot interacted with this thread (for timeout tracking)",
    )

    _sql_constraints = [
        (
            "whatsapp_thread_unique",
            "unique(backend_id, phone_number)",
            "A thread already exists for this backend and phone number.",
        )
    ]

    def send_webhook_payload(self, event_type):
        """Send the thread data to the frontend webhook."""
        for thread in self:
            WebhookSender.send_thread_webhook_payload(thread, event_type)

    @api.depends("partner_id", "partner_id.avatar_256")
    def _compute_has_avatar(self):
        """Compute whether the partner has an actual avatar image.

        Uses sudo() to bypass res.partner record rules, since WhatsApp
        threads may reference partners the current user cannot access.
        The partners are resolved for the whole recordset at once: calling
        sudo() per record would put every partner in its own prefetch group
        and read the avatars one query at a time.
        """
        threads = self.sudo().with_context(whatsapp_connector=True)
        partner_by_thread = {
            thread.id: thread.partner_id.commercial_partner_id.id for thread in threads
        }
        partners = threads.mapped("partner_id.commercial_partner_id")
        partner_ids_with_avatar = set(partners.filtered("avatar_256").ids)

        for record in self:
            record.has_avatar = (
                partner_by_thread.get(record.id) in partner_ids_with_avatar
            )

    def _compute_unread_count(self):
        """Compute the current user's unread count for each thread.

        One search for the whole recordset instead of one per thread: the
        chat list reads this field for every row it shows.
        """
        counts = {thread_id: 0 for thread_id in self.ids}

        if self.ids:
            statuses = self.env["whatsapp.message.read.status"].search(
                [
                    ("message_id.thread_id", "in", self.ids),
                    ("is_read", "=", False),
                    ("user_id", "=", self.env.user.id),
                ]
            )
            for thread_id in statuses.mapped("message_id").mapped("thread_id.id"):
                counts[thread_id] = counts.get(thread_id, 0) + 1

        for thread in self:
            thread.unread_count = counts.get(thread.id, 0)

    def read(self, fields=None, load="_classic_read"):
        """Override to bypass res.partner record rules when reading partner_id.

        WhatsApp threads may reference partners that the current user
        cannot access due to restrictive record rules on res.partner.
        For verified WhatsApp backend users, partner_id is read with
        elevated privileges so the thread list can display partner names.
        """
        if not fields or "partner_id" not in fields or load != "_classic_read":
            return super().read(fields, load=load)

        if not self.env.user.has_group(
            "whatsapp_cloud_api_backend.group_whatsapp_backend_user"
        ):
            return super().read(fields, load=load)

        # Read all fields except partner_id normally
        other_fields = [f for f in fields if f != "partner_id"]
        results = super().read(other_fields or ["id"], load=load)

        # Read partner_id with sudo to bypass res.partner record rules
        # Call super() explicitly to avoid re-entering this override
        sudo_partner_data = super(WhatsAppThread, self.sudo()).read(
            ["partner_id"], load=load
        )
        partner_map = {r["id"]: r["partner_id"] for r in sudo_partner_data}

        for r in results:
            r["partner_id"] = partner_map.get(r["id"], False)

        return results

    @api.model
    def _generate_thread_name(self, partner_id=None, phone_number=None):
        partner_name = ""
        if partner_id:
            partner = self.env["res.partner"].browse(partner_id)
            partner_name = partner.display_name
        phone_number = phone_number or ""
        if partner_name and phone_number:
            return f"{partner_name} ({phone_number})"
        return partner_name or phone_number or _("WhatsApp Thread")

    @api.model
    def create(self, vals):
        vals = dict(vals)
        if not vals.get("name"):
            vals["name"] = self._generate_thread_name(
                vals.get("partner_id"), vals.get("phone_number")
            )
        thread = super().create(vals)

        # Push the new thread to
        # frontend webhook

        thread.with_delay().send_webhook_payload("thread.created")

        return thread

    def write(self, vals):
        res = super().write(vals)
        if "name" not in vals and any(
            field in vals for field in ("partner_id", "phone_number")
        ):
            for thread in self:
                new_name = thread._generate_thread_name(
                    thread.partner_id.id, thread.phone_number
                )
                if new_name != thread.name:
                    super(WhatsAppThread, thread).write({"name": new_name})

        # Push the updated thread to
        # frontend webhook
        self.with_delay().send_webhook_payload("thread.updated")

        return res

    def _register_message(self, message_record):
        """Attach the WhatsApp message to the thread and update metadata."""
        self.ensure_one()
        if not message_record.thread_id or message_record.thread_id != self:
            message_record.sudo().write({"thread_id": self.id})

        updates = {
            "last_message_id": message_record.id,
            "last_message_date": message_record.create_date,
            "last_message_preview": message_record.body or False,
        }
        if message_record.partner_id and not self.partner_id:
            updates["partner_id"] = message_record.partner_id.id
        self.sudo().write(updates)
        return message_record

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _map_outgoing_status(raw_status):
        mapping = {
            None: "pending",
            "accepted": "sent",
            "sent": "sent",
            "delivered": "delivered",
            "read": "read",
            "failed": "failed",
            "held_for_quality_assessment": "pending",
        }
        return mapping.get(raw_status, "pending")

    def _get_media_id(self, media_id=None, attachment=None):
        """Get media ID from provided media_id or by uploading attachment.

        Args:
            media_id: WhatsApp media ID (if already uploaded)
            attachment: ir.attachment record or ID to upload

        Returns:
            str: WhatsApp media ID
        """
        if media_id:
            return media_id
        if attachment:
            if isinstance(attachment, int):
                attachment = self.env["ir.attachment"].browse(attachment).sudo()
            return self.backend_id._upload_media_to_whatsapp(attachment)
        return None

    def _send_message(
        self, *, payload, message_type, body=None, attachment=None, extra_vals=None
    ):
        self.ensure_one()
        backend = self.backend_id
        if not backend:
            raise UserError(_("A WhatsApp backend is required to send messages."))
        base_payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": self.phone_number,
        }
        base_payload.update(payload)
        # Deep copy for storage purposes to avoid later mutation
        stored_request = json.loads(json.dumps(base_payload))
        response = backend._call_whatsapp_api("messages", base_payload)
        message_info = (response.get("messages") or [{}])[0]
        raw_status = message_info.get("message_status")
        status = self._map_outgoing_status(raw_status)
        if not raw_status and message_info.get("id"):
            status = "sent"

        vals = {
            "backend_id": backend.id,
            "thread_id": self.id,
            "direction": "outgoing",
            "message_type": message_type,
            "phone_number": self.phone_number,
            "partner_id": self.partner_id.id if self.partner_id else False,
            "body": body,
            "payload": {"request": stored_request, "response": response},
            "status": status,
            "message_id": message_info.get("id"),
            "timestamp": int(time.time()),
        }
        if attachment:
            vals["attachment_id"] = attachment
        if extra_vals:
            vals.update(extra_vals)

        if message_type == "reaction":
            message_record = (
                self.env["whatsapp.message"]
                .sudo()
                .search([("message_id", "=", base_payload["reaction"]["message_id"])])
            )
            if message_record:
                message_record.write({"reaction_emoji": body})
        else:
            message_record = self.env["whatsapp.message"].sudo().create(vals)
            self._register_message(message_record)
        return {
            "message_id": message_record.id,
            "whatsapp_id": message_record.message_id,
            "status": message_record.status,
            "thread_id": self.id,
            "thread_name": self.name,
            "partner_id": self.partner_id.id if self.partner_id else False,
            "phone_number": self.phone_number,
            "timestamp": message_record.timestamp,
        }

    def mark_as_read(self):
        """
        Mark all incoming messages in this thread as read.
        Called when user opens a thread in the frontend.
        """
        messages = (
            self.env["whatsapp.message.read.status"]
            .search(
                [
                    ("message_id.thread_id", "=", self.id),
                    ("is_read", "=", False),
                    ("user_id", "=", self.env.user.id),
                ]
            )
            .mapped("message_id")
        )
        for msg in messages:
            msg.mark_as_read_by_user(self.env.user)

        return True

    @api.model
    def mark_all_as_read(self, backend_ids):
        """
        Mark ALL unread messages as read for the current user.
        Works across all threads, not just loaded ones.

        Args:
            backend_ids: Optional list of backend IDs to filter.
                        If None, uses all backends the user has access to.
        """
        user = self.env.user

        if not backend_ids:
            return {"marked_count": 0}

        # # Find all unread message statuses for this user in accessible threads
        # unread_statuses = self.env["whatsapp.message.read.status"].search([
        #     ("is_read", "=", False),
        #     ("user_id", "=", user.id),
        #     ("message_id.thread_id.backend_id", "in", backend_ids.ids),
        # ])

        # # Mark them all as read
        # unread_statuses.write({"is_read": True})

        # return {"marked_count": len(unread_statuses)}

        query = """
            UPDATE whatsapp_message_read_status rs
            SET is_read = TRUE
            FROM whatsapp_message m
            JOIN whatsapp_thread t ON m.thread_id = t.id
            WHERE rs.message_id = m.id
                AND rs.is_read = FALSE
                AND rs.user_id = %s
                AND t.backend_id IN %s
        """
        self.env.cr.execute(query, (user.id, tuple(backend_ids.ids)))
        marked_count = self.env.cr.rowcount
        self.env["whatsapp.message.read.status"].invalidate_cache(["is_read"])

        return {"marked_count": marked_count}

    @api.model
    def search_messages_by_content(self, query, limit=20, offset=0):
        """Search message bodies and return the most recent match per thread."""
        if not query or not query.strip():
            return []

        # Get backends the current user has access to
        backend_ids = (
            self.env["whatsapp.backend"]
            .search([("user_ids", "in", self.env.user.id)])
            .ids
        )
        if not backend_ids:
            return []

        Message = self.env["whatsapp.message"]
        domain = [
            ("body", "ilike", query.strip()),
            ("thread_id.backend_id", "in", backend_ids),
        ]

        # Fetch messages ordered by timestamp desc, deduplicate by thread
        needed = offset + limit
        seen_threads = set()
        unique_messages = []
        batch_size = max(needed * 3, 100)
        search_offset = 0

        while len(unique_messages) < needed:
            batch = Message.search(
                domain,
                order="timestamp desc",
                limit=batch_size,
                offset=search_offset,
            )
            if not batch:
                break
            for msg in batch:
                if msg.thread_id.id not in seen_threads:
                    seen_threads.add(msg.thread_id.id)
                    unique_messages.append(msg)
                    if len(unique_messages) >= needed:
                        break
            search_offset += batch_size

        # Apply pagination
        paginated = unique_messages[offset : offset + limit]

        result = []
        for msg in paginated:
            thread = msg.thread_id
            # Use sudo to bypass res.partner record rules
            partner = thread.sudo().partner_id
            result.append(
                {
                    "thread_id": thread.id,
                    "thread_name": thread.name,
                    "phone_number": thread.phone_number,
                    "backend_id": thread.backend_id.id,
                    "partner_id": partner.id or None,
                    "partner_name": partner.display_name or None,
                    "message_id": msg.id,
                    "message_body": (msg.body or "")[:200],
                    "message_timestamp": msg.timestamp,
                }
            )
        return result

    # -------------------------------------------------------------------------
    # Sending API
    # -------------------------------------------------------------------------

    def send_text_message(self, body, preview_url=False):
        self.ensure_one()
        if not body:
            raise UserError(_("Body is required to send a text message."))
        payload = {
            "type": "text",
            "text": {
                "body": body,
            },
        }
        if preview_url:
            payload["text"]["preview_url"] = True
        return self._send_message(payload=payload, message_type="text", body=body)

    def send_reply_message(self, body, reply_to_message_id, preview_url=False):
        self.ensure_one()
        if not reply_to_message_id:
            raise UserError(
                _("Reply message requires a message identifier to reply to.")
            )
        if not body:
            raise UserError(_("Body is required to send a reply message."))
        payload = {
            "type": "text",
            "context": {"message_id": reply_to_message_id},
            "text": {
                "body": body,
            },
        }
        if preview_url:
            payload["text"]["preview_url"] = True
        return self._send_message(payload=payload, message_type="text", body=body)

    def send_reaction_message(self, emoji, target_message_id):
        self.ensure_one()
        if not target_message_id:
            raise UserError(_("Reaction message requires a target message identifier."))
        if not emoji:
            raise UserError(_("Reaction message requires an emoji."))
        payload = {
            "type": "reaction",
            "reaction": {
                "message_id": target_message_id,
                "emoji": emoji,
            },
        }
        return self._send_message(payload=payload, message_type="reaction", body=emoji)

    def send_document_message(
        self,
        *,
        media_id=None,
        link=None,
        caption=None,
        filename=None,
        attachment=None,
    ):
        self.ensure_one()
        media_id = self._get_media_id(media_id, attachment)

        document = {}
        if media_id:
            document["id"] = media_id
        elif link:
            document["link"] = link
        else:
            raise UserError(
                _(
                    "Document message requires either an attachment, "
                    "media ID, or a link."
                )
            )

        if caption:
            document["caption"] = caption
        if filename:
            document["filename"] = filename

        body_value = caption or filename or _("Document")
        payload = {
            "type": "document",
            "document": document,
        }
        return self._send_message(
            payload=payload,
            message_type="media",
            body=body_value,
            attachment=attachment,
        )

    def send_button_message(
        self,
        body_text,
        buttons,
        *,
        header_text=None,
        footer_text=None,
    ):
        """Send an interactive message with reply buttons (max 3 buttons).

        Args:
            body_text: Main message text
            buttons: List of dicts with 'title' and optional 'value' keys
                     Example: [{'title': 'Option 1', 'value': '1'}, ...]
            header_text: Optional header text
            footer_text: Optional footer text

        Returns:
            dict with message info
        """
        self.ensure_one()
        if not body_text:
            raise UserError(_("Body text is required for button messages."))
        if not buttons or not isinstance(buttons, list):
            raise UserError(_("Buttons must be a non-empty list."))
        if len(buttons) > 3:
            raise UserError(_("WhatsApp supports maximum 3 reply buttons."))

        button_list = []
        for idx, btn in enumerate(buttons):
            if not isinstance(btn, dict) or "title" not in btn:
                raise UserError(_("Each button must have a 'title' key."))
            button_list.append(
                {
                    "type": "reply",
                    "reply": {
                        "id": btn.get("value", str(idx)),
                        "title": btn["title"][:20],  # WhatsApp limit: 20 chars
                    },
                }
            )

        interactive = {
            "type": "button",
            "body": {"text": body_text},
            "action": {"buttons": button_list},
        }
        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}

        payload = {
            "type": "interactive",
            "interactive": interactive,
        }
        return self._send_message(
            payload=payload, message_type="interactive", body=body_text
        )

    def send_cta_url_message(
        self,
        body_text,
        button_text,
        url,
        *,
        header_text=None,
        footer_text=None,
    ):
        self.ensure_one()
        if not body_text:
            raise UserError(_("Body text is required for an interactive CTA message."))
        if not button_text or not url:
            raise UserError(_("CTA button text and URL are required."))
        interactive = {
            "type": "button",
            "body": {"text": body_text},
            "action": {
                "buttons": [
                    {
                        "type": "cta_url",
                        "text": button_text,
                        "url": url,
                    }
                ]
            },
        }
        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}
        payload = {
            "type": "interactive",
            "interactive": interactive,
        }
        return self._send_message(
            payload=payload, message_type="interactive", body=body_text
        )

    def send_list_message(
        self,
        body_text,
        button_text,
        sections,
        *,
        header_text=None,
        footer_text=None,
    ):
        self.ensure_one()
        if not sections:
            raise UserError(
                _("Interactive list message requires at least one section.")
            )
        if not body_text or not button_text:
            raise UserError(
                _("Body text and button text are required for list messages.")
            )
        interactive = {
            "type": "list",
            "body": {"text": body_text},
            "action": {"button": button_text, "sections": sections},
        }
        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}
        payload = {
            "type": "interactive",
            "interactive": interactive,
        }
        return self._send_message(
            payload=payload, message_type="interactive", body=body_text
        )

    def send_image_message(
        self,
        *,
        media_id=None,
        link=None,
        caption=None,
        attachment=None,
    ):
        self.ensure_one()
        media_id = self._get_media_id(media_id, attachment)

        image = {}
        if media_id:
            image["id"] = media_id
        elif link:
            image["link"] = link
        else:
            raise UserError(
                _("Image message requires either an attachment, media ID, or a link.")
            )

        if caption:
            image["caption"] = caption

        body_value = caption or _("Image")
        payload = {
            "type": "image",
            "image": image,
        }
        return self._send_message(
            payload=payload,
            message_type="media",
            body=body_value,
            attachment=attachment,
        )

    def send_video_message(
        self,
        *,
        media_id=None,
        link=None,
        caption=None,
        attachment=None,
    ):
        self.ensure_one()
        media_id = self._get_media_id(media_id, attachment)

        video = {}
        if media_id:
            video["id"] = media_id
        elif link:
            video["link"] = link
        else:
            raise UserError(
                _("Video message requires either an attachment, media ID, or a link.")
            )

        if caption:
            video["caption"] = caption

        body_value = caption or _("Video")
        payload = {
            "type": "video",
            "video": video,
        }
        return self._send_message(
            payload=payload,
            message_type="media",
            body=body_value,
            attachment=attachment,
        )

    def send_template_message(self, template, record=None):
        """Send a template message to this thread

        Args:
            template: whatsapp.template record
            record: Optional Odoo record for variable substitution

        Returns:
            dict with message info
        """
        self.ensure_one()

        if not template:
            raise UserError(_("A template is required to send a template message."))

        if template.status != "APPROVED":
            raise UserError(
                _("Template '%s' is not approved and cannot be sent.") % template.name
            )

        # Verify template belongs to this backend's WABA
        if template.waba_id != self.backend_id.waba_id:
            raise UserError(
                _(
                    "Template '%s' belongs to a different WhatsApp Business Account "
                    "and cannot be used with this backend."
                )
                % template.name
            )

        # Build template payload
        template_payload = template.build_payload_for_record(record)

        payload = {
            "type": "template",
            "template": template_payload,
        }

        # Generate rendered body for message record (with variables substituted)
        body_preview = template.render_message_preview(record)

        return self._send_message(
            payload=payload,
            message_type="template",
            body=body_preview,
            extra_vals={"template_id": template.id},
        )
