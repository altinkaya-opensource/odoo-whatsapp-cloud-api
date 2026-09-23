# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
from odoo import api, fields, models


class WhatsAppThreadMember(models.Model):
    """How far one user has read one thread.

    One row per (thread, user) instead of one per (message, user): incoming
    messages after the cursor are unread, the same model as Discuss'
    seen_message_id.
    """

    _name = "whatsapp.thread.member"
    _description = "WhatsApp Thread Reader"

    thread_id = fields.Many2one(
        comodel_name="whatsapp.thread",
        required=True,
        ondelete="cascade",
        index=True,
    )
    user_id = fields.Many2one(
        comodel_name="res.users",
        required=True,
        ondelete="cascade",
        index=True,
    )
    seen_message_cursor = fields.Integer(
        help="Id of the newest message of the thread when the user last read "
        "it. Incoming messages with a higher id are unread.",
    )

    _sql_constraints = [
        (
            "thread_user_unique",
            "unique(thread_id, user_id)",
            "A user has one read position per thread.",
        )
    ]

    @api.model
    def _mark_seen(self, threads, users):
        """Move the users' cursor on these threads to their latest message."""
        if not threads or not users:
            return
        threads.flush_recordset(["last_message_id"])
        self.env.cr.execute(
            """
            INSERT INTO whatsapp_thread_member
                (thread_id, user_id, seen_message_cursor,
                 create_uid, create_date, write_uid, write_date)
            SELECT t.id, u.id, COALESCE(t.last_message_id, 0),
                   %(uid)s, now() at time zone 'UTC',
                   %(uid)s, now() at time zone 'UTC'
              FROM whatsapp_thread t
             CROSS JOIN unnest(%(user_ids)s) AS u(id)
             WHERE t.id IN %(thread_ids)s
            ON CONFLICT (thread_id, user_id) DO UPDATE
               SET seen_message_cursor = GREATEST(
                       whatsapp_thread_member.seen_message_cursor,
                       EXCLUDED.seen_message_cursor
                   ),
                   write_uid = EXCLUDED.write_uid,
                   write_date = EXCLUDED.write_date
            """,
            {
                "uid": self.env.uid,
                "user_ids": users.ids,
                "thread_ids": tuple(threads.ids),
            },
        )
        self.invalidate_model()
        threads.invalidate_recordset(["unread_count"])
