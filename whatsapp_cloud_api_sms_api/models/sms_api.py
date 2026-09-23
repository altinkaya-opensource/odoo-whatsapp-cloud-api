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
from odoo import api, fields, models


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
        whatsapp_result = []
        sms_list = []
        # Company notifications: send from the company number whoever
        # triggered the SMS, backend membership only limits agents.
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
            result = backend_id.send_template_message(
                phone_number=sms_record.number,
                template=template,
                record=record,
                partner=partner_id,
            )
            if not result.get("error"):
                # Render the template message with buttons as links
                rendered_message = (
                    f"[WhatsApp]\n{template.render_message_preview(record)}"
                )
                sms_record.mail_message_id.body = rendered_message
                whatsapp_result.append(
                    {
                        "res_id": sms_record.id,
                        "state": "success",
                    }
                )
            else:
                sms_list.append(msg)

        res = super()._send_sms_batch(sms_list)
        return whatsapp_result + res
