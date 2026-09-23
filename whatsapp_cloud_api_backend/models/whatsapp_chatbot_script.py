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

from datetime import datetime

import requests

from odoo import _, api, fields, models
from odoo.tools.safe_eval import safe_eval, wrap_module


class WhatsAppChatbotScript(models.Model):
    _name = "whatsapp.chatbot.script"
    _description = "WhatsApp Chatbot Script Step"
    _order = "chatbot_id, sequence, id"

    name = fields.Char(
        string="Step Name",
        required=True,
        help="Internal name for this conversation step",
    )
    chatbot_id = fields.Many2one(
        comodel_name="whatsapp.chatbot",
        string="Chatbot",
        required=True,
        ondelete="cascade",
        index=True,
    )
    sequence = fields.Integer(
        default=10,
        help="Order of execution in the chatbot flow",
    )
    step_type = fields.Selection(
        selection=[
            ("message", "Simple Message"),
            ("interactive", "Interactive (with Python code)"),
        ],
        required=True,
        default="message",
        help="Type of chatbot step",
    )
    message = fields.Text(
        string="Message to Send",
        translate=True,
        compute="_compute_message",
        store=True,
        help="Message text to send to user",
    )
    answer = fields.Text(
        string="Default Answer",
        translate=True,
        help="Default response text (can be overridden by interactive code)",
    )
    interactive_code = fields.Text(
        string="Interactive Python Code",
        help=(
            "Python code to compute dynamic responses for interactive steps.\n\n"
            "Available variables:\n"
            "  • message_text: str - incoming user message\n"
            "  • values: dict - modify to set response\n"
            "  • record: whatsapp.chatbot.script - current script record\n"
            "  • env: odoo environment\n"
            "  • extra: dict - additional context (thread, backend, partner)\n\n"
            "Response keys in values dict:\n"
            "  • message/answer: text to send\n"
            "  • buttons: list of {'title': 'Text', 'value': 'val'}\n"
            "  • attachment_id: ID of ir.attachment to send as media\n"
            "  • END: True to stop re-execution until button click\n\n"
            "Examples:\n"
            "  values['message'] = 'Hello World'\n"
            "  values['buttons'] = [{'title': 'Yes', 'value': '1'}]\n"
            "  values['attachment_id'] = 123  # Send image/video/document\n"
            "  values['END'] = True  # Stop until next button click\n\n"
            "Available modules: datetime, re, requests"
        ),
        # The code runs with the webhook's sudo env, so writing it is as
        # powerful as being an administrator.
        groups="base.group_system",
    )
    option_ids = fields.One2many(
        comodel_name="whatsapp.chatbot.script.option",
        inverse_name="script_id",
        string="User Options",
        help="Define multiple choice options that lead to this or other steps",
    )
    parent_script_id = fields.Many2one(
        comodel_name="whatsapp.chatbot.script",
        string="Parent Script",
        help="Parent step that leads to this step",
        ondelete="set null",
    )

    @api.depends("option_ids", "option_ids.message_text")
    def _compute_message(self):
        """Compute message from options if available"""
        for record in self:
            if record.option_ids:
                messages = record.option_ids.mapped("message_text")
                record.message = ", ".join(filter(None, messages))
            else:
                record.message = record.answer or ""

    @api.model_create_multi
    def create(self, vals_list):
        """Auto-increment sequence for new steps in same chatbot"""
        for vals in vals_list:
            if "sequence" not in vals and vals.get("chatbot_id"):
                # Get max sequence for this chatbot
                max_seq = self.search_read(
                    [("chatbot_id", "=", vals["chatbot_id"])],
                    ["sequence"],
                    order="sequence desc",
                    limit=1,
                )
                if max_seq:
                    vals["sequence"] = max_seq[0]["sequence"] + 1
                else:
                    vals["sequence"] = 1
        return super().create(vals_list)

    def eval_interactive(self, message_text, extra=None, backend=None):
        """Execute interactive Python code and return computed values.

        Args:
            message_text: Incoming user message text
            extra: Dictionary with additional context (thread, backend, partner)
            backend: WhatsApp backend record for language context

        Returns:
            dict with keys: answer, message, buttons
        """
        self.ensure_one()

        # Set language context from backend
        if backend and backend.language:
            self = self.with_context(lang=backend.language.code)

        # Default values
        base_values = {
            "answer": self.answer or "",
            "message": self.message or "",
            "buttons": None,
        }

        # If not interactive or no code, return defaults
        code = self.sudo().interactive_code
        if self.step_type != "interactive" or not code:
            return base_values

        # Prepare sandbox for safe_eval
        sandbox = {
            "datetime": datetime,
            "re": wrap_module(
                __import__("re"),
                [
                    "compile",
                    "search",
                    "match",
                    "fullmatch",
                    "findall",
                    "finditer",
                    "sub",
                    "subn",
                    "split",
                    "escape",
                    "purge",
                    "ASCII",
                    "IGNORECASE",
                    "LOCALE",
                    "MULTILINE",
                    "DOTALL",
                    "VERBOSE",
                ],
            ),
            "requests": wrap_module(
                requests,
                [
                    "get",
                    "post",
                    "put",
                    "delete",
                    "patch",
                    "head",
                    "options",
                    "request",
                    "Session",
                ],
            ),
            "_": _,
            "callable": callable,
            "len": len,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
            "tuple": tuple,
            "set": set,
        }

        # Prepare values dict that code can modify
        values = dict(base_values)

        # Add execution context
        sandbox.update(
            {
                "message_text": message_text or "",
                "values": values,
                "record": self,
                "env": self.env,
                "extra": extra or {},
            }
        )

        # Execute the code
        try:
            safe_eval(
                code,
                sandbox,
                sandbox,
                mode="exec",
                nocopy=True,
            )
        except Exception as e:
            # Log error but don't break the flow
            import logging

            _logger = logging.getLogger(__name__)
            _logger.error(
                "Error executing interactive code for script %s: %s",
                self.name,
                str(e),
                exc_info=True,
            )
            return base_values

        # Ensure required keys exist
        values.setdefault("answer", base_values["answer"])
        values.setdefault("message", base_values["message"])
        values.setdefault("buttons", base_values["buttons"])

        return values


class WhatsAppChatbotScriptOption(models.Model):
    _name = "whatsapp.chatbot.script.option"
    _description = "Chatbot Script User Option"
    _order = "script_id, sequence, id"

    script_id = fields.Many2one(
        comodel_name="whatsapp.chatbot.script",
        string="Script Step",
        required=True,
        ondelete="cascade",
        index=True,
    )
    sequence = fields.Integer(
        default=10,
    )
    message_text = fields.Text(
        string="Option Text",
        translate=True,
        required=True,
        help="Text that user must send to select this option",
    )
    next_script_id = fields.Many2one(
        comodel_name="whatsapp.chatbot.script",
        string="Next Step",
        help="Script step to execute when user selects this option",
        ondelete="set null",
    )
