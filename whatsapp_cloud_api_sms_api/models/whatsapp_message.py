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
from odoo import fields, models


class WhatsAppMessage(models.Model):
    _inherit = "whatsapp.message"

    sms_fallback_number = fields.Char(
        help="Number to text if Meta later reports this notification as failed.",
    )
    sms_fallback_body = fields.Text(
        help="SMS text replaced by this WhatsApp notification.",
    )
    sms_fallback_mail_message_id = fields.Many2one(
        comodel_name="mail.message",
        ondelete="set null",
        help="Chatter message of the notification, updated if it goes by SMS.",
    )

    def write(self, vals):
        res = super().write(vals)
        if vals.get("status") == "failed":
            self.filtered("sms_fallback_number")._send_sms_fallback()
        return res

    def _send_sms_fallback(self):
        """Text the notifications WhatsApp could not deliver, once."""
        for message in self.sudo():
            sms = (
                self.env["sms.sms"]
                .sudo()
                .create(
                    {
                        "number": message.sms_fallback_number,
                        "body": message.sms_fallback_body,
                        "partner_id": message.partner_id.id,
                        "mail_message_id": message.sms_fallback_mail_message_id.id,
                    }
                )
            )
            if message.sms_fallback_mail_message_id:
                message.sms_fallback_mail_message_id.body = message.sms_fallback_body
            message.sms_fallback_number = False
            sms.with_context(sms_skip_whatsapp=True).send(raise_exception=False)
