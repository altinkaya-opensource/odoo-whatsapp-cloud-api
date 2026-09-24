# Copyright 2025 Erol Develi (https://github.com/erlinberg)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).

from odoo import http
from odoo.http import get_default_session, request, root


class WhatsAppFrontendAuthController(http.Controller):
    @http.route(
        "/whatsapp/frontend/sso-url",
        type="json",
        auth="user",
        methods=["POST"],
    )
    def get_sso_url(self, **kwargs):
        """
        Generate SSO URL for the WhatsApp frontend application.

        This endpoint:
        1. Checks if the current user has assigned WhatsApp backends
        2. Returns a one-time sign-in link to the frontend of the first one

        Returns:
            dict: {'url': str} with SSO URL, or {'error': str} if not available
        """
        user = request.env.user

        # Find backends assigned to the current user
        Backend = request.env["whatsapp.backend"]
        backends = Backend.sudo().search([("user_ids", "in", user.id)], limit=1)

        if not backends:
            return {
                "error": "No WhatsApp backend assigned to your user. "
                "Please contact your administrator."
            }

        if not backends.frontend_webhook_url:
            return {
                "error": "WhatsApp frontend URL not configured. "
                "Please contact your administrator."
            }

        return {"url": backends._get_frontend_login_url()}

    @http.route(
        "/whatsapp/frontend/sso/exchange",
        type="json",
        auth="public",
        methods=["POST"],
        csrf=False,
    )
    def exchange_sso_code(self, code=None, **kwargs):
        """Trade a sign-in code for a new session of its user.

        Called by the frontend's server, which has no session yet. The code
        works once, for a minute. The session is a new one, so signing out
        of the frontend does not sign the user out of Odoo.
        """
        user = request.env["whatsapp.frontend.sso"].sudo()._redeem(code)
        if not user:
            return {"error": "invalid_code"}
        session = root.session_store.new()
        session.update(get_default_session(), db=request.db)
        session.update(pre_login=user.login, pre_uid=user.id)
        session.finalize(request.env)
        root.session_store.save(session)
        return {"session_id": session.sid}
