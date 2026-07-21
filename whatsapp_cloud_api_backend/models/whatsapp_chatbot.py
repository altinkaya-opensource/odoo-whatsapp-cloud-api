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

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class WhatsAppChatbot(models.Model):
    _name = "whatsapp.chatbot"
    _description = "WhatsApp Chatbot Automation"
    _rec_name = "title"
    _order = "sequence, title"

    title = fields.Char(
        required=True,
        translate=True,
        help="Name of the chatbot",
    )
    active = fields.Boolean(
        default=True,
        help="If unchecked, this chatbot will be disabled",
    )
    sequence = fields.Integer(
        default=10,
        help="Used to order chatbots in the list",
    )
    script_ids = fields.One2many(
        comodel_name="whatsapp.chatbot.script",
        inverse_name="chatbot_id",
        string="Conversation Scripts",
        help="Define the conversation flow steps",
    )
    main_menu_button_text = fields.Char(
        translate=True,
        default="Main Menu",
        required=True,
        help="Text displayed on the button to return to main menu",
    )
    greeting_only = fields.Boolean(
        help="Send one plain greeting per 24 hours instead of running scripts.",
    )
    greeting_message = fields.Text(
        help="Message sent between 08:00 and 18:00 Europe/Istanbul time.",
    )
    out_of_hours_message = fields.Text(
        string="Out-of-Hours Message",
        help="Message sent outside 08:00-18:00 Europe/Istanbul time.",
    )

    @api.constrains("greeting_only", "greeting_message", "out_of_hours_message")
    def _check_greeting_messages(self):
        for chatbot in self:
            if chatbot.greeting_only and (
                not chatbot.greeting_message or not chatbot.out_of_hours_message
            ):
                raise ValidationError(
                    _("Greeting-only chatbots require both greeting messages.")
                )

    def _get_auto_reply_message(self, timestamp=None):
        self.ensure_one()
        local_timestamp = fields.Datetime.context_timestamp(
            self.with_context(tz="Europe/Istanbul"),
            timestamp or fields.Datetime.now(),
        )
        if 8 <= local_timestamp.hour < 18:
            return self.greeting_message
        return self.out_of_hours_message
