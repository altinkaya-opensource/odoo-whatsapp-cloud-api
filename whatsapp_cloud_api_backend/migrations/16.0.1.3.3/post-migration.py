# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
"""Give each thread the BSUID of its latest customer message.

Meta sends the business-scoped user ID (contacts[0].user_id) with every
message since 31 March 2026. With it stored, a customer who later hides their
number behind a username stays in their thread (1,794 threads on 16test2).
A BSUID found on more than one thread of a backend is left out: the unique
constraint allows one, and the next message picks its thread.
"""

import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute(
        """
        WITH latest AS (
            SELECT DISTINCT ON (m.thread_id)
                   m.thread_id,
                   t.backend_id,
                   m.payload #>> '{entry,0,changes,0,value,contacts,0,user_id}'
                       AS bsuid
            FROM whatsapp_message m
            JOIN whatsapp_thread t ON t.id = m.thread_id
            WHERE m.direction = 'incoming'
              AND m.create_date >= '2026-03-31'
              AND m.payload #>> '{entry,0,changes,0,value,contacts,0,user_id}'
                  IS NOT NULL
            ORDER BY m.thread_id, m.id DESC
        ),
        single AS (
            SELECT backend_id, bsuid
            FROM latest
            GROUP BY backend_id, bsuid
            HAVING count(*) = 1
        )
        UPDATE whatsapp_thread t
        SET bsuid = latest.bsuid
        FROM latest
        JOIN single USING (backend_id, bsuid)
        WHERE t.id = latest.thread_id
          AND t.bsuid IS NULL
        """
    )
    _logger.info("Stored the WhatsApp user ID of %s threads", cr.rowcount)
