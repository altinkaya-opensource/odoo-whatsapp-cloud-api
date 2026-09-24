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
import hashlib
import hmac
import json
import logging
from http import HTTPStatus

from werkzeug.exceptions import BadRequest, Forbidden

from odoo import _, http
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
        type="http",
        methods=["POST"],
        auth="public",
        csrf=False,
    )
    def whatsapp_webhook(self, **kwargs):
        """
        Endpoint to handle WhatsApp Cloud API webhooks.
        """
        raw_body = request.httprequest.data
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise BadRequest(_("Invalid JSON payload")) from exc
        if not isinstance(payload, dict):
            raise BadRequest(_("Expected a JSON object"))
        backend = self._find_backend_from_payload(payload)
        if not backend:
            _logger.warning(
                "WhatsApp webhook rejected: unable to resolve backend for payload: %s",
                payload,
            )
            return request.make_json_response({"error": "invalid_webhook"}, status=400)
        if not self._verify_payload_signature(backend, raw_body):
            return request.make_json_response(
                {"error": "invalid_signature"}, status=403
            )
        request.env["whatsapp.webhook"].sudo()._enqueue_payload(backend, payload)
        return request.make_json_response({"status": "queued"})

    def _verify_payload_signature(self, backend, raw_body):
        """Check Meta's X-Hub-Signature-256 header against the app secret.

        The backend is resolved from the (still untrusted) payload only to
        pick which secret to check the signature with.
        """
        app_secret = backend.sudo().app_secret
        if not app_secret:
            _logger.warning(
                "WhatsApp webhook for backend %s accepted without signature "
                "verification: no Meta app secret configured.",
                backend.name,
            )
            return True

        header = request.httprequest.headers.get("X-Hub-Signature-256") or ""
        received = header[len("sha256=") :] if header.startswith("sha256=") else ""
        expected = hmac.new(
            app_secret.encode("utf-8"), raw_body, hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(received, expected):
            _logger.warning(
                "WhatsApp webhook rejected for backend %s: invalid signature.",
                backend.name,
            )
            return False

        return True

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
