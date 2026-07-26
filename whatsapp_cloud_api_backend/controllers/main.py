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
import unicodedata
from urllib.parse import quote

from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

WP_ATTACHMENT_DOWNLOAD_PATH = "/whatsapp/attachment/download/"
WP_ATTACHMENT_UPLOAD_PATH = "/whatsapp/attachment/upload/"
WP_PROFILE_PICTURE_PATH = "/whatsapp/partner/profile_picture/"

# Uploads are proxied straight into ir.attachment, so cap what a single
# request may store.
WP_MAX_UPLOAD_BYTES = 100 * 1024 * 1024


class WhatsAppCloudAPIBackendController(http.Controller):
    def _get_whatsapp_attachment(self, attachment_id):
        """Return the attachment only if the user may reach it via WhatsApp.

        Attachments are read with sudo, so access has to be proven through a
        whatsapp.message the user can read: either the message points at the
        attachment (outgoing) or the attachment is attached to the message
        (incoming media). The record rules on whatsapp.message scope this to
        the backends the user is assigned to.
        """
        Attachment = request.env["ir.attachment"].sudo()
        attachment = Attachment.browse(attachment_id)
        if not attachment.exists():
            return Attachment.browse()

        domain = [("attachment_id", "=", attachment.id)]
        if attachment.res_model == "whatsapp.message" and attachment.res_id:
            domain = ["|"] + domain + [("id", "=", attachment.res_id)]

        try:
            linked_message = request.env["whatsapp.message"].search(domain, limit=1)
        except AccessError:
            return Attachment.browse()

        return attachment if linked_message else Attachment.browse()

    @http.route(
        WP_ATTACHMENT_DOWNLOAD_PATH + "<int:attachment_id>",
        type="http",
        auth="user",
        methods=["GET"],
        csrf=False,
    )
    def serve_attachment(self, attachment_id, **kwargs):
        attachment = self._get_whatsapp_attachment(attachment_id)
        if not attachment:
            raise http.request.not_found()
        if not attachment.mimetype or not attachment.datas:
            raise http.request.not_found()
        filecontent = base64.b64decode(attachment.datas)
        # Normalize filename to ASCII for fallback
        ascii_filename = unicodedata.normalize("NFKD", attachment.name)
        # Encode to ASCII, ignoring chars that can't be converted
        ascii_filename = (
            ascii_filename.encode("ascii", "ignore").decode("ascii") or "download"
        )
        # URL encode the original filename for UTF-8 support
        encoded_filename = quote(attachment.name, safe="")
        headers = [
            ("Content-Type", attachment.mimetype),
            ("Content-Length", len(filecontent)),
            (
                "Content-Disposition",
                f'attachment; filename="{ascii_filename}"; '
                f"filename*=UTF-8''{encoded_filename}",
            ),
        ]
        return http.request.make_response(filecontent, headers)

    @http.route(
        WP_ATTACHMENT_UPLOAD_PATH,
        type="http",
        auth="user",
        methods=["POST"],
        csrf=False,
    )
    def upload_attachment(self, **kwargs):
        Attachment = http.request.env["ir.attachment"].sudo()
        if "file" not in kwargs:
            return http.request.make_response("No file part in the request", status=400)
        file = kwargs.get("file")
        if file.filename == "":
            return http.request.make_response("No selected file", status=400)
        filecontent = file.read(WP_MAX_UPLOAD_BYTES + 1)
        if not filecontent:
            return http.request.make_response("Empty file", status=400)
        if len(filecontent) > WP_MAX_UPLOAD_BYTES:
            return http.request.make_response("File too large", status=413)
        # Normalize filename to handle international characters
        normalized_filename = unicodedata.normalize("NFKD", file.filename)
        safe_filename = (
            normalized_filename.encode("ascii", "ignore").decode("ascii") or "upload"
        )
        attachment = Attachment.create(
            {
                "name": safe_filename,
                "datas": base64.b64encode(filecontent),
                "mimetype": file.content_type,
            }
        )
        # Just return uploaded attachment ID for simplicity
        return http.request.make_response(f"{attachment.id}", status=200)

    @http.route(
        WP_PROFILE_PICTURE_PATH + "<int:partner_id>",
        type="http",
        auth="user",
        methods=["GET"],
        csrf=False,
    )
    def serve_profile_picture(self, partner_id, **kwargs):
        # Avatars are read with sudo, so only serve partners the user already
        # sees through a WhatsApp thread on one of their backends.
        try:
            thread = request.env["whatsapp.thread"].search(
                [("partner_id", "=", partner_id)], limit=1
            )
        except AccessError:
            raise http.request.not_found() from None
        if not thread:
            raise http.request.not_found()

        Partner = http.request.env["res.partner"].sudo()
        partner = Partner.browse(partner_id)
        commercial_partner = partner.commercial_partner_id
        if not commercial_partner.exists():
            raise http.request.not_found()
        if not commercial_partner.with_context(whatsapp_connector=True).avatar_256:
            raise http.request.not_found()

        filecontent = base64.b64decode(commercial_partner.avatar_256)
        headers = [
            ("Content-Type", "image/png"),
            ("Content-Length", len(filecontent)),
            (
                "Content-Disposition",
                f'inline; filename="partner_{partner_id}_profile_picture.png"',
            ),
        ]
        return http.request.make_response(filecontent, headers)

    @http.route(
        "/whatsapp/unread_count",
        type="json",
        auth="user",
        methods=["POST"],
    )
    def get_unread_count_endpoint(self, **kwargs):
        """Get total unread WhatsApp message count for current user."""
        backend_ids = request.env["whatsapp.backend"].search(
            [("user_ids", "in", request.env.user.id)]
        )
        available_thread_ids = [
            x["id"]
            for x in request.env["whatsapp.thread"].search_read(
                [("backend_id", "in", backend_ids.ids)], fields=["id"]
            )
        ]
        total_unread = request.env["whatsapp.message.read.status"].search_count(
            [
                ("is_read", "=", False),
                ("user_id", "=", request.env.user.id),
                ("message_id.thread_id.id", "in", available_thread_ids),
            ]
        )
        return {"unread_count": total_unread}

    @http.route(
        "/whatsapp/mark_all_read",
        type="json",
        auth="user",
        methods=["POST"],
    )
    def mark_all_as_read_endpoint(self, **kwargs):
        """Mark all unread WhatsApp messages as read for current user."""
        backend_ids = request.env["whatsapp.backend"].search(
            [("user_ids", "in", request.env.user.id)]
        )
        result = request.env["whatsapp.thread"].mark_all_as_read(backend_ids)
        return result

    @http.route(
        "/whatsapp/message/search",
        type="json",
        auth="user",
        methods=["POST"],
    )
    def search_messages_endpoint(self, **kwargs):
        """Search WhatsApp messages by content."""
        query = kwargs.get("query", "")
        limit = kwargs.get("limit", 20)
        offset = kwargs.get("offset", 0)
        return request.env["whatsapp.thread"].search_messages_by_content(
            query, limit=limit, offset=offset
        )
