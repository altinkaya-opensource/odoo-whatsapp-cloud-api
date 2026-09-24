# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
"""Label the chat list preview of threads whose last message has media.

A photo, video, voice message or sticker without a caption left the preview
empty, so the list showed nothing, or the text of the message before it
(127 threads on 16test2).
"""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    threads = env["whatsapp.thread"].search(
        [("last_message_id.attachment_id", "!=", False)]
    )
    for thread in threads:
        message = thread.last_message_id
        lang = thread.backend_id.language.code
        if lang:
            message = message.with_context(lang=lang)
        thread.last_message_preview = message._preview_text()
