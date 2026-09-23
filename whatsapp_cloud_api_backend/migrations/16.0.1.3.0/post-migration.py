# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
"""Move read state from one row per (message, user) to one per (thread, user).

Odoo 16 removes the ir.model of a model deleted from the code but keeps its
table, so the old read statuses and their relation table are dropped here
once the cursors are computed (about 1.4M rows each on production).
"""

import logging

from odoo.tools import sql

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    if not sql.table_exists(cr, "whatsapp_message_read_status"):
        return
    cr.execute(
        """
        UPDATE whatsapp_thread t
           SET last_incoming_message_id = latest.id
          FROM (
              SELECT thread_id, max(id) AS id
                FROM whatsapp_message
               WHERE direction = 'incoming'
               GROUP BY thread_id
          ) latest
         WHERE latest.thread_id = t.id
        """
    )
    # A member's cursor sits just before their oldest unread customer
    # message, or on the newest message when nothing is unread. A read
    # message after an unread one counts as unread again.
    cr.execute(
        """
        INSERT INTO whatsapp_thread_member
            (thread_id, user_id, seen_message_cursor,
             create_uid, create_date, write_uid, write_date)
        SELECT t.id, rel.res_users_id,
               COALESCE(unread.first_unread_id - 1, newest.id, 0),
               1, now() at time zone 'UTC', 1, now() at time zone 'UTC'
          FROM whatsapp_thread t
          JOIN res_users_whatsapp_backend_rel rel
            ON rel.whatsapp_backend_id = t.backend_id
          LEFT JOIN (
              SELECT thread_id, max(id) AS id
                FROM whatsapp_message
               GROUP BY thread_id
          ) newest ON newest.thread_id = t.id
          LEFT JOIN (
              SELECT m.thread_id, s.user_id, min(m.id) AS first_unread_id
                FROM whatsapp_message_read_status s
                JOIN whatsapp_message m ON m.id = s.message_id
               WHERE s.is_read IS NOT TRUE
                 AND m.direction = 'incoming'
               GROUP BY m.thread_id, s.user_id
          ) unread
            ON unread.thread_id = t.id AND unread.user_id = rel.res_users_id
        ON CONFLICT (thread_id, user_id) DO NOTHING
        """
    )
    _logger.info("Created %s WhatsApp thread read positions", cr.rowcount)
    cr.execute("DROP TABLE IF EXISTS whatsapp_message_whatsapp_message_read_status_rel")
    cr.execute("DROP TABLE whatsapp_message_read_status")
