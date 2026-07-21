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
import base64
import json
import logging
from datetime import timedelta
from http import HTTPStatus

import requests
from werkzeug.exceptions import Forbidden

from odoo import _, fields, http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WhatsAppCloudAPIWebhookController(http.Controller):
    _webhook_url = "/whatsapp/webhook"

    @http.route(
        _webhook_url,
        type="http",
        methods=["GET"],
        auth="public",
        csrf=False,
    )
    def whatsapp_webhook_verify(self, **kw):
        verify_token = kw.get("hub.verify_token")
        hub_mode = kw.get("hub.mode")
        hub_challenge = kw.get("hub.challenge")
        if not (verify_token and hub_mode and hub_challenge):
            return Forbidden()

        backend = (
            request.env["whatsapp.backend"]
            .sudo()
            .search(
                [("webhook_secret", "=", verify_token), ("active", "=", True)],
                limit=1,
            )
        )
        if hub_mode == "subscribe" and backend:
            response = request.make_response(hub_challenge)
            response.status_code = HTTPStatus.OK.value
            return response

        response = request.make_response({})
        response.status_code = HTTPStatus.FORBIDDEN.value
        return response

    @http.route(
        _webhook_url,
        type="json",
        methods=["POST"],
        auth="public",
        csrf=False,
    )
    def whatsapp_webhook(self, **kwargs):
        """
        Endpoint to handle WhatsApp Cloud API webhooks.
        """
        payload = json.loads(request.httprequest.data.decode("utf-8"))
        backend = self._find_backend_from_payload(payload)
        if not backend:
            _logger.warning(
                "WhatsApp webhook rejected: unable to resolve backend for payload: %s",
                payload,
            )
            return {"error": "invalid_webhook"}
        self._use_backend_language(backend)
        self._handle_webhook_payload(backend, payload)
        return {"status": "processed"}

    def _use_backend_language(self, backend):
        """Prepare language context for operations."""
        context = request.env.context.copy()
        if backend and backend.language:
            context["lang"] = backend.language.code
        request.env.context = context
        return context

    def _find_backend_from_payload(self, payload):
        entries = payload.get("entry") or []
        for entry in entries:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                metadata = value.get("metadata") or {}
                phone_number_id = metadata.get("phone_number_id")
                if not phone_number_id:
                    continue
                backend = (
                    request.env["whatsapp.backend"]
                    .sudo()
                    .search(
                        [
                            ("phone_number_id", "=", phone_number_id),
                            ("active", "=", True),
                        ],
                        limit=1,
                    )
                )
                if backend:
                    return backend
        return request.env["whatsapp.backend"].browse()

    def _handle_webhook_payload(self, backend, payload):
        if payload.get("object") != "whatsapp_business_account":
            _logger.debug(
                "Ignored webhook payload with unexpected object: %s",
                payload.get("object"),
            )
            return

        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                metadata = value.get("metadata") or {}
                phone_number_id = metadata.get("phone_number_id")
                if (
                    phone_number_id
                    and backend.phone_number_id
                    and phone_number_id != backend.phone_number_id
                ):
                    _logger.debug(
                        "Webhook phone_number_id (%s) does not "
                        "match backend (%s); skipping",
                        phone_number_id,
                        backend.phone_number_id,
                    )
                    continue
                for message in value.get("messages", []):
                    self._process_incoming_message(backend, value, message, payload)

    def _process_incoming_message(self, backend, value, message, full_payload):
        message_model = request.env["whatsapp.message"].sudo()
        msg_type_raw = message.get("type")
        msg_type = self._map_message_type(msg_type_raw)
        phone_number = message.get("from")
        contact = (value.get("contacts") or [{}])[0]
        partner = self._find_or_create_partner(phone_number, contact)
        thread = self._find_or_create_thread(backend, phone_number, partner, contact)
        reply_message = self._find_reply_message(backend, message)
        existing = message_model.search(
            [("backend_id", "=", backend.id), ("message_id", "=", message.get("id"))],
            limit=1,
        )

        msg_vals = {
            "backend_id": backend.id,
            "direction": "incoming",
            "message_id": message.get("id"),
            "conversation_id": (message.get("context") or {}).get("id"),
            "phone_number": phone_number,
            "partner_id": partner.id if partner else False,
            "thread_id": thread.id,
            "message_type": msg_type,
            "body": self._extract_body(message),
            "payload": full_payload,
            "status": "delivered",
            "replied_message_id": reply_message.id,
            "timestamp": int(message.get("timestamp")),
        }

        # Handle reaction-specific fields
        if msg_type == "reaction":
            reaction_data = message.get("reaction") or {}
            reaction_emoji = reaction_data.get("emoji", "")
            # Find the message being reacted to
            reacted_msg_id = reaction_data.get("message_id")
            if reacted_msg_id:
                reacted_message = message_model.search(
                    [
                        ("backend_id", "=", backend.id),
                        ("message_id", "=", reacted_msg_id),
                    ],
                    limit=1,
                )
                if reacted_message:
                    reacted_message.write({"reaction_emoji": reaction_emoji})
                    return

        if existing:
            existing.write(msg_vals)
            message_record = existing
        else:
            message_record = message_model.create(msg_vals)

        if msg_type == "media":
            attachment = self._ensure_media_attachment(
                message_record, message, msg_type_raw
            )
            if attachment:
                message_record.write({"attachment_id": attachment.id})
        thread._register_message(message_record)

        # Scripted chatbots handle text/interactive messages. Greeting-only
        # chatbots also acknowledge media-only first contacts.
        if (
            backend.chatbot_enabled
            and backend.chatbot_id
            and (
                msg_type in ("text", "interactive")
                or (backend.chatbot_id.greeting_only and msg_type == "media")
            )
        ):
            self._handle_chatbot_interaction(
                backend, thread, partner, message_record.body or ""
            )

    def _map_message_type(self, msg_type_raw):
        if msg_type_raw in {"image", "video", "audio", "document", "sticker"}:
            return "media"
        if msg_type_raw in {"text", "interactive", "template", "status", "reaction"}:
            return msg_type_raw
        return "unknown"

    def _extract_body(self, message):
        msg_type_raw = message.get("type")
        if msg_type_raw == "text":
            return (message.get("text") or {}).get("body")
        if msg_type_raw in {"image", "video", "audio", "document", "sticker"}:
            data = message.get(msg_type_raw) or {}
            return data.get("caption") or data.get("filename")
        if msg_type_raw == "reaction":
            reaction_data = message.get("reaction") or {}
            emoji = reaction_data.get("emoji", "")
            return f"Reacted with {emoji}" if emoji else "Removed reaction"
        interactive = message.get("interactive") or {}
        if interactive:
            for key in ("list_reply", "button_reply"):
                option = interactive.get(key) or {}
                if option.get("title"):
                    return option["title"]
        return None

    def _ensure_media_attachment(self, message_record, message, msg_type_raw):
        media_info = message.get(msg_type_raw) or {}
        media_id = media_info.get("id")
        if not media_id:
            return False
        attachment_model = request.env["ir.attachment"].sudo()

        # Check if attachment already exists
        existing = attachment_model.search(
            [
                ("res_model", "=", "whatsapp.message"),
                ("res_id", "=", message_record.id),
            ],
            limit=1,
        )
        if existing:
            return existing

        # Download media from WhatsApp
        backend = message_record.backend_id
        try:
            media_data = self._download_whatsapp_media(backend, media_id)
            if not media_data:
                _logger.warning(
                    "Failed to download media %s, creating URL attachment", media_id
                )
                # Fallback to URL attachment if download fails
                attachment_vals = {
                    "name": media_info.get("filename") or media_id,
                    "type": "url",
                    "url": self._build_media_url(media_id),
                    "mimetype": media_info.get("mime_type"),
                    "res_model": "whatsapp.message",
                    "res_id": message_record.id,
                    "description": media_info.get("caption"),
                }
                return attachment_model.create(attachment_vals)

            # Create binary attachment with downloaded data
            attachment_vals = {
                "name": media_info.get("filename") or media_id,
                "type": "binary",
                "datas": base64.b64encode(media_data).decode("utf-8"),
                "mimetype": media_info.get("mime_type"),
                "res_model": "whatsapp.message",
                "res_id": message_record.id,
                "description": media_info.get("caption"),
            }
            return attachment_model.create(attachment_vals)
        except Exception as e:
            _logger.exception("Error downloading WhatsApp media %s: %s", media_id, e)
            return False

    # def _match_partner(self, phone_number):
    #     if not phone_number:
    #         return False
    #     partner_env = request.env["res.partner"].sudo()
    #     partner = partner_env.search(
    #         [("phone_mobile_search", "ilike", phone_number)], limit=1
    #     )
    #     return partner

    def _find_or_create_partner(self, phone_number, contact):
        if not phone_number:
            return False
        partner_env = request.env["res.partner"].sudo()
        partner = partner_env.search(
            [("phone_mobile_search", "ilike", phone_number)], limit=1
        )
        if not partner:
            name = (contact or {}).get("profile", {}).get("name") or phone_number
            partner = partner_env.create(
                {
                    "name": name,
                    "mobile": phone_number,
                }
            )
        return partner

    def _build_media_url(self, media_id):
        return f"https://graph.facebook.com/v20.0/{media_id}"

    def _download_whatsapp_media(self, backend, media_id):
        """
        Download media from WhatsApp Cloud API.

        This requires two steps:
        1. Get the media URL by calling GET /{media_id}
        2. Download the actual file from the returned URL

        Both requests require Bearer token authentication.
        """
        if not backend or not backend.api_token:
            _logger.error("Backend or API token not available for media download")
            return False

        headers = {
            "Authorization": f"Bearer {backend.api_token}",
        }

        try:
            # Step 1: Get the media URL
            media_url = (
                f"https://graph.facebook.com/{backend.api_version or 'v20.0'}"
                f"/{media_id}"
            )
            response = requests.get(media_url, headers=headers, timeout=60)

            if response.status_code != 200:
                _logger.error(
                    "Failed to get media URL for %s: %s - %s",
                    media_id,
                    response.status_code,
                    response.text,
                )
                return False

            media_info = response.json()
            download_url = media_info.get("url")

            if not download_url:
                _logger.error("No download URL in media response for %s", media_id)
                return False

            # Step 2: Download the actual file
            download_response = requests.get(download_url, headers=headers, timeout=60)

            if download_response.status_code != 200:
                _logger.error(
                    "Failed to download media from %s: %s",
                    download_url,
                    download_response.status_code,
                )
                return False

            return download_response.content

        except requests.RequestException as e:
            _logger.exception(
                "Request error while downloading media %s: %s", media_id, e
            )
            return False
        except Exception as e:
            _logger.exception("Unexpected error downloading media %s: %s", media_id, e)
            return False

    def _find_or_create_thread(self, backend, phone_number, partner, contact):
        # Normalize phone number for consistent matching
        normalized_phone = backend._normalize_phone_number(phone_number)

        thread_model = request.env["whatsapp.thread"].sudo()
        thread = thread_model.search(
            [
                ("backend_id", "=", backend.id),
                ("phone_number", "=", normalized_phone),
            ],
            limit=1,
        )
        display_name = (contact or {}).get("profile", {}).get("name")

        if not thread:
            vals = {
                "backend_id": backend.id,
                "phone_number": normalized_phone,
                "partner_id": partner.id if partner else False,
            }
            if display_name:
                vals["name"] = display_name
            thread = thread_model.create(vals)
        else:
            update_vals = {}
            if partner and not thread.partner_id:
                update_vals["partner_id"] = partner.id
            if display_name and thread.name in {
                thread.phone_number,
                "WhatsApp Thread",
                False,
            }:
                update_vals["name"] = display_name
            if update_vals:
                thread.sudo().write(update_vals)
        return thread

    def _find_reply_message(self, backend_id, message):
        message_model = request.env["whatsapp.message"].sudo()
        if message.get("context", {}).get("id"):
            replied_message = message_model.search(
                [
                    ("backend_id", "=", backend_id.id),
                    ("message_id", "=", message["context"]["id"]),
                ],
                limit=1,
            )
            return replied_message
        return message_model

    # -------------------------------------------------------------------------
    # Chatbot Logic
    # -------------------------------------------------------------------------

    def _handle_chatbot_interaction(self, backend, thread, partner, message_text):
        """Process incoming message through chatbot logic.

        Args:
            backend: whatsapp.backend record
            thread: whatsapp.thread record
            partner: res.partner record
            message_text: User's message text
        """
        chatbot = backend.chatbot_id
        if not chatbot:
            return

        if chatbot.greeting_only:
            self._handle_greeting_only_chatbot(chatbot, thread)
            return

        # Check if chatbot is ended (human handoff)
        if thread.chatbot_ended:
            return

        # Check session timeout (24 hours)
        if self._is_chatbot_session_expired(thread):
            self._reset_chatbot_session(thread, chatbot)

        # Resolve next step
        next_step = self._resolve_chatbot_step(chatbot, thread, message_text)
        if not next_step:
            return

        # Execute the step
        self._execute_chatbot_step(backend, thread, partner, next_step, message_text)

    def _handle_greeting_only_chatbot(self, chatbot, thread):
        """Send one time-based plain greeting per rolling 24-hour period."""
        now = fields.Datetime.now()
        if (
            thread.chatbot_last_message_date
            and now - thread.chatbot_last_message_date < timedelta(hours=24)
        ):
            return

        message = chatbot._get_auto_reply_message(now)
        if not message:
            return

        thread.send_text_message(message)
        thread.sudo().write(
            {
                "chatbot_id": chatbot.id,
                "chatbot_step_sequence": 0,
                "chatbot_step_ended": False,
                "chatbot_last_message_date": now,
            }
        )

    def _is_chatbot_session_expired(self, thread):
        """Check if chatbot session has expired (24 hours of inactivity)."""
        if not thread.chatbot_last_message_date:
            return False

        now = fields.Datetime.now()
        elapsed = now - thread.chatbot_last_message_date
        return elapsed > timedelta(hours=24)

    def _reset_chatbot_session(self, thread, chatbot):
        """Reset chatbot session to initial state."""
        thread.sudo().write(
            {
                "chatbot_id": chatbot.id,
                "chatbot_step_sequence": 0,
                "chatbot_ended": False,
                "chatbot_last_message_date": fields.Datetime.now(),
            }
        )

    def _resolve_chatbot_step(self, chatbot, thread, message_text):
        """Determine which chatbot step to execute based on current
        state and user input.

        Returns:
            whatsapp.chatbot.script record or False
        """
        script_model = request.env["whatsapp.chatbot.script"].sudo()
        normalized_text = (message_text or "").strip()
        chatbot_domain = [("chatbot_id", "=", chatbot.id)]

        if not thread.chatbot_id or thread.chatbot_step_sequence == 0:
            first_step = script_model.search(
                chatbot_domain, order="sequence asc", limit=1
            )
            thread.sudo().write(
                {
                    "chatbot_id": chatbot.id,
                    "chatbot_step_sequence": first_step.sequence,
                    "chatbot_step_ended": False,
                }
            )
            return first_step

        if normalized_text == chatbot.main_menu_button_text:
            first_step = script_model.search(
                chatbot_domain, order="sequence asc", limit=1
            )
            thread.sudo().write(
                {
                    "chatbot_step_sequence": first_step.sequence,
                    "chatbot_step_ended": False,
                }
            )
            return first_step

        matched_step = script_model.search(
            chatbot_domain + [("name", "=", normalized_text)], limit=1
        )
        if matched_step and matched_step.sequence != thread.chatbot_step_sequence:
            thread.sudo().write(
                {
                    "chatbot_step_sequence": matched_step.sequence,
                    "chatbot_step_ended": False,
                }
            )
            return matched_step

        current_step = script_model.search(
            chatbot_domain + [("sequence", "=", thread.chatbot_step_sequence)],
            limit=1,
        )

        if current_step and current_step.option_ids:
            for option in current_step.option_ids:
                if (
                    option.message_text.strip() == normalized_text
                    and option.next_script_id
                ):
                    thread.sudo().write(
                        {
                            "chatbot_step_sequence": option.next_script_id.sequence,
                            "chatbot_step_ended": False,
                        }
                    )
                    return option.next_script_id

        if current_step:
            if current_step.step_type == "message" or thread.chatbot_step_ended:
                return False
            return current_step

        return script_model.search(chatbot_domain, order="sequence asc", limit=1)

    def _execute_chatbot_step(self, backend, thread, partner, step, message_text):
        """Execute a single chatbot step.

        Args:
            backend: whatsapp.backend record
            thread: whatsapp.thread record
            partner: res.partner record
            step: whatsapp.chatbot.script record
            message_text: User's incoming message
        """
        thread.sudo().write(
            {
                "chatbot_last_message_date": fields.Datetime.now(),
            }
        )

        if step.step_type == "message":
            # Simple message response
            if step.option_ids:
                # Has options - send as interactive message with buttons
                buttons = [
                    {
                        "title": option.message_text[:20],  # WhatsApp limit: 20 chars
                        "value": option.message_text,
                    }
                    for option in step.option_ids
                ]

                if len(buttons) <= 3:
                    # Use button message for <=3 buttons
                    thread.send_button_message(
                        body_text=step.answer or _("Please select an option:"),
                        buttons=buttons,
                    )
                else:
                    # Use list message for >3 options
                    sections = [
                        {
                            "title": _("Options"),
                            "rows": [
                                {
                                    "id": btn.get("value", str(idx)),
                                    "title": btn.get("title", "")[:24],
                                    "description": "",
                                }
                                for idx, btn in enumerate(buttons)
                            ],
                        }
                    ]
                    thread.send_list_message(
                        body_text=step.answer or _("Please select an option:"),
                        button_text=_("Select"),
                        sections=sections,
                    )
            else:
                if step.answer:
                    menu_text = backend.chatbot_id.main_menu_button_text
                    main_menu_button = [
                        {
                            "title": menu_text[:20],
                            "value": menu_text,
                        }
                    ]
                    thread.send_button_message(
                        body_text=step.answer,
                        buttons=main_menu_button,
                    )

        elif step.step_type == "interactive":
            # Execute Python code to get dynamic response
            extra_context = {
                "thread": thread,
                "backend": backend,
                "partner": partner,
            }
            result = step.eval_interactive(message_text, extra_context, backend)

            if result.get("END") or result.get("end"):
                thread.sudo().write({"chatbot_step_ended": True})

            attachment_id = result.get("attachment_id")
            if attachment_id:
                attachment = request.env["ir.attachment"].sudo().browse(attachment_id)
                if attachment:
                    caption = result.get("message") or result.get("answer") or ""
                    mimetype = attachment.mimetype or ""

                    if mimetype.startswith("image/"):
                        thread.send_image_message(
                            attachment=attachment.id, caption=caption
                        )
                    elif mimetype.startswith("video/"):
                        thread.send_video_message(
                            attachment=attachment.id, caption=caption
                        )
                    else:
                        thread.send_document_message(
                            attachment=attachment.id,
                            caption=caption,
                            filename=attachment.name,
                        )
                    return

            response_text = result.get("message") or result.get("answer") or ""
            buttons = result.get("buttons")

            # Send response
            if buttons and isinstance(buttons, list):
                # Check if buttons have descriptions (use list) or not (use buttons)
                has_description = any(
                    isinstance(btn, dict) and btn.get("description") for btn in buttons
                )

                if has_description or len(buttons) > 3:
                    # Use list message for >3 options or when descriptions present
                    sections = [
                        {
                            "title": _("Options"),
                            "rows": [
                                {
                                    "id": btn.get("value", str(idx)),
                                    "title": btn.get("title", "")[:24],
                                    "description": btn.get("description", "")[:72],
                                }
                                for idx, btn in enumerate(buttons)
                                if isinstance(btn, dict)
                            ],
                        }
                    ]
                    thread.send_list_message(
                        body_text=response_text,
                        button_text=_("Select"),
                        sections=sections,
                    )
                else:
                    # Use button message for <=3 buttons
                    thread.send_button_message(
                        body_text=response_text,
                        buttons=buttons,
                    )
            elif response_text:
                # No buttons returned - add Main Menu button automatically
                menu_text = backend.chatbot_id.main_menu_button_text
                main_menu_button = [
                    {
                        "title": menu_text[:20],  # WhatsApp limit: 20 chars
                        "value": menu_text,
                    }
                ]
                thread.send_button_message(
                    body_text=response_text,
                    buttons=main_menu_button,
                )
