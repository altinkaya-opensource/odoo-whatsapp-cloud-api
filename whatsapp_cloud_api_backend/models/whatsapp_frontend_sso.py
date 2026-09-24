# Copyright 2026 Altinkaya Enclosures
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl).
import hashlib
import secrets
from datetime import timedelta

from odoo import api, fields, models

# How long a sign-in link from Odoo stays usable
SSO_CODE_LIFETIME = timedelta(seconds=60)


def _hash_code(code):
    return hashlib.sha256(code.encode()).hexdigest()


class WhatsAppFrontendSso(models.TransientModel):
    """One-time codes that sign an Odoo user in to the WhatsApp frontend.

    The link Odoo opens carries a random code instead of a session id, so no
    session ends up in URLs, browser history or proxy logs. The frontend
    trades the code for a session of its own, server to server, once and
    within a minute. Only a hash of the code is stored.
    """

    _name = "whatsapp.frontend.sso"
    _description = "WhatsApp Frontend Sign-in Code"

    code_hash = fields.Char(required=True, index=True)
    user_id = fields.Many2one("res.users", required=True, ondelete="cascade")

    @api.model
    def _issue_code(self, user):
        """Return a new sign-in code for this user."""
        expired = self.sudo().search(
            [("create_date", "<", fields.Datetime.now() - SSO_CODE_LIFETIME)]
        )
        expired.unlink()
        code = secrets.token_urlsafe(32)
        self.sudo().create({"code_hash": _hash_code(code), "user_id": user.id})
        return code

    @api.model
    def _redeem(self, code):
        """Return the user of a valid code and use it up, or an empty record."""
        if not code or not isinstance(code, str):
            return self.env["res.users"]
        self.flush_model()
        # Delete and read in one statement: two concurrent exchanges of the
        # same code cannot both get the user
        self.env.cr.execute(
            """
            DELETE FROM whatsapp_frontend_sso
             WHERE code_hash = %s AND create_date >= %s
            RETURNING user_id
            """,
            (_hash_code(code), fields.Datetime.now() - SSO_CODE_LIFETIME),
        )
        row = self.env.cr.fetchone()
        self.invalidate_model()
        user = self.env["res.users"].sudo().browse(row[0] if row else [])
        return user.filtered("active")
