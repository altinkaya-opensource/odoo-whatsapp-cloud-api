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

from odoo import SUPERUSER_ID, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class SmsApi(models.AbstractModel):
    _inherit = "sms.api"

    @api.model
    def _send_sms_batch(self, messages):
        """
        Inherited to try to send WhatsApp messages before
        falling back to SMS. In WhatsApp Cloud API, there is
        no way to check if a number is WhatsApp capable without
        sending a message first. That's why we attempt to send
        WhatsApp messages first, and if it fails, we send SMS
        messages as a fallback.
        """
        if self.env.context.get("sms_skip_whatsapp"):
            return super()._send_sms_batch(messages)
        whatsapp_result, sms_list = self._try_whatsapp_first(messages)
        res = super()._send_sms_batch(sms_list)
        return whatsapp_result + res

    @api.model
    def _try_whatsapp_first(self, messages):
        """Send what WhatsApp can take; return (results, messages left for SMS).

        Each send runs in its own savepoint, so one rejected number only
        sends that message by SMS instead of failing the whole batch.
        """
        whatsapp_result = []
        sms_list = []
        # Company notifications: sent as the superuser, whoever triggered the
        # SMS. Backend membership only limits agents, and the statistics
        # count the messages as automated rather than as agent replies.
        backend_model = self.env["whatsapp.backend"].sudo()
        for msg in messages:
            sms_record = self.env["sms.sms"].browse(msg["res_id"])
            # There should be only one partner
            partner_id = fields.first(sms_record.mail_message_id.partner_ids)
            record = self.env[sms_record.mail_message_id.model].browse(
                sms_record.mail_message_id.res_id
            )
            # Get the last used backend (whatsapp threads are already ordered)
            backend_id = fields.first(
                partner_id.sudo().whatsapp_thread_ids
            ).backend_id or backend_model.search([("main_backend", "=", True)], limit=1)
            if not backend_id:
                sms_list.append(msg)
                continue
            backend_id = backend_id.with_user(SUPERUSER_ID)
            template = self.env["whatsapp.template"].search(
                [
                    ("default_sms_template", "=", True),
                    ("model_id.model", "=", sms_record.mail_message_id.model),
                    ("waba_id", "=", backend_id.waba_id),
                ],
                limit=1,
            )
            if not template:
                sms_list.append(msg)
                continue
            try:
                with self.env.cr.savepoint():
                    result = backend_id.send_template_message(
                        phone_number=sms_record.number,
                        template=template,
                        record=record,
                        partner=partner_id,
                    )
            except UserError as error:
                _logger.warning(
                    "WhatsApp rejected SMS %s, sending it by SMS: %s",
                    sms_record.id,
                    error,
                )
                sms_list.append(msg)
                continue
            # Meta reports undeliverable numbers later, as a "failed"
            # status: keep what is needed to text the customer then.
            self.env["whatsapp.message"].sudo().browse(result["message_id"]).write(
                {
                    "sms_fallback_number": sms_record.number,
                    "sms_fallback_body": sms_record.body,
                    "sms_fallback_mail_message_id": sms_record.mail_message_id.id,
                }
            )
            # Render the template message with buttons as links
            rendered_message = f"[WhatsApp]\n{template.render_message_preview(record)}"
            sms_record.mail_message_id.body = rendered_message
            whatsapp_result.append(
                {
                    "res_id": sms_record.id,
                    "state": "success",
                }
            )
        return whatsapp_result, sms_list
