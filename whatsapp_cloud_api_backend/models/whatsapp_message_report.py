# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
from odoo import fields, models, tools

# Threshold (in seconds) that splits a thread into separate sessions and
# also caps how long a "first response" can take before it is treated as
# unanswered. Matches the WhatsApp 24h customer-service window.
SESSION_GAP_SECONDS = 86400


class WhatsAppMessageReport(models.Model):
    _name = "whatsapp.message.report"
    _description = "WhatsApp Statistics"
    _auto = False
    _order = "create_date desc"

    # Identity / dimensions
    partner_id = fields.Many2one("res.partner", string="Partner", readonly=True)
    backend_id = fields.Many2one("whatsapp.backend", string="Backend", readonly=True)
    thread_id = fields.Many2one("whatsapp.thread", string="Thread", readonly=True)
    agent_user_id = fields.Many2one("res.users", string="Agent", readonly=True)
    is_system_user = fields.Boolean(string="System / Bot", readonly=True)

    direction = fields.Selection(
        selection=[("incoming", "Incoming"), ("outgoing", "Outgoing")],
        readonly=True,
    )
    message_type = fields.Selection(
        selection=[
            ("text", "Text"),
            ("media", "Media"),
            ("interactive", "Interactive"),
            ("reaction", "Reaction"),
            ("template", "Template"),
            ("status", "Status"),
            ("unknown", "Unknown"),
        ],
        readonly=True,
    )
    is_template = fields.Boolean(string="Template", readonly=True)
    is_reaction = fields.Boolean(string="Reaction", readonly=True)
    status = fields.Selection(
        selection=[
            ("draft", "Draft"),
            ("pending", "Pending"),
            ("sent", "Sent"),
            ("delivered", "Delivered"),
            ("read", "Read"),
            ("failed", "Failed"),
        ],
        readonly=True,
    )

    # Time
    create_date = fields.Datetime(readonly=True)
    timestamp = fields.Integer(readonly=True)
    date_day = fields.Date(string="Day", readonly=True)
    date_week = fields.Date(string="Week", readonly=True)
    date_month = fields.Date(string="Month", readonly=True)
    hour_of_day = fields.Integer(string="Hour", readonly=True)

    # Session / response
    session_id = fields.Integer(readonly=True)
    session_started_by = fields.Selection(
        selection=[("partner", "Partner"), ("business", "Business")],
        readonly=True,
    )
    is_session_first_incoming = fields.Boolean(
        string="Session First Incoming",
        readonly=True,
        help="True on the first incoming message of each session. "
        "Group by this flag for one row per session.",
    )
    response_seconds = fields.Integer(
        string="Response Time (s)",
        readonly=True,
        help="Time between the partner's first message in a session and our "
        "first reply. NULL if there was no reply within 24h.",
    )
    # 0/1 integer flags with avg aggregation so the pivot shows the
    # response-rate percentage directly (e.g. 0.87 = 87% answered).
    responded_5min = fields.Integer(
        string="Replied ≤ 5 min",
        readonly=True,
        group_operator="avg",
    )
    responded_1h = fields.Integer(
        string="Replied ≤ 1 h",
        readonly=True,
        group_operator="avg",
    )
    responded_24h = fields.Integer(
        string="Replied ≤ 24 h",
        readonly=True,
        group_operator="avg",
    )

    count = fields.Integer(readonly=True)

    def init(self):
        tools.drop_view_if_exists(self.env.cr, self._table)
        self.env.cr.execute(
            f"""
            CREATE OR REPLACE VIEW {self._table} AS
            WITH ordered AS (
                SELECT
                    m.id, m.partner_id, m.backend_id, m.thread_id,
                    m.create_uid, m.create_date, m.timestamp,
                    m.direction, m.message_type, m.status, m.template_id,
                    LAG(m.timestamp) OVER w AS prev_ts
                FROM whatsapp_message m
                WINDOW w AS (PARTITION BY m.thread_id ORDER BY m.timestamp, m.id)
            ),
            sessioned AS (
                SELECT *,
                    SUM(
                        CASE
                            WHEN prev_ts IS NULL OR (timestamp - prev_ts) > %(gap)s
                            THEN 1 ELSE 0
                        END
                    ) OVER (
                        PARTITION BY thread_id
                        ORDER BY timestamp, id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS session_seq
                FROM ordered
            ),
            session_aggs AS (
                SELECT *,
                    FIRST_VALUE(direction) OVER ws AS sess_started_dir,
                    MIN(CASE WHEN direction='incoming' THEN timestamp END)
                        OVER ws AS first_in_ts,
                    MIN(CASE WHEN direction='incoming' THEN id END)
                        OVER ws AS first_in_id
                FROM sessioned
                WINDOW ws AS (PARTITION BY thread_id, session_seq)
            ),
            with_response AS (
                SELECT *,
                    MIN(
                        CASE
                            WHEN direction='outgoing' AND timestamp >= first_in_ts
                            THEN timestamp
                        END
                    ) OVER (PARTITION BY thread_id, session_seq) AS first_out_ts
                FROM session_aggs
            )
            SELECT
                id,
                partner_id,
                backend_id,
                thread_id,
                create_uid                          AS agent_user_id,
                (create_uid = 1)                    AS is_system_user,
                direction,
                message_type,
                status,
                (template_id IS NOT NULL)           AS is_template,
                (message_type = 'reaction')         AS is_reaction,
                create_date,
                timestamp,
                date_trunc('day',   create_date)::date  AS date_day,
                date_trunc('week',  create_date)::date  AS date_week,
                date_trunc('month', create_date)::date  AS date_month,
                EXTRACT(hour FROM create_date)::int     AS hour_of_day,
                session_seq                         AS session_id,
                CASE
                    WHEN sess_started_dir = 'incoming' THEN 'partner'
                    ELSE 'business'
                END                                 AS session_started_by,
                (direction = 'incoming' AND id = first_in_id)
                                                    AS is_session_first_incoming,
                CASE
                    WHEN direction = 'incoming'
                         AND id = first_in_id
                         AND first_out_ts IS NOT NULL
                         AND (first_out_ts - first_in_ts) <= %(gap)s
                    THEN first_out_ts - first_in_ts
                END                                 AS response_seconds,
                CASE
                    WHEN direction = 'incoming'
                         AND id = first_in_id
                         AND first_out_ts IS NOT NULL
                         AND (first_out_ts - first_in_ts) <= 300
                    THEN 1 ELSE 0
                END                                 AS responded_5min,
                CASE
                    WHEN direction = 'incoming'
                         AND id = first_in_id
                         AND first_out_ts IS NOT NULL
                         AND (first_out_ts - first_in_ts) <= 3600
                    THEN 1 ELSE 0
                END                                 AS responded_1h,
                CASE
                    WHEN direction = 'incoming'
                         AND id = first_in_id
                         AND first_out_ts IS NOT NULL
                         AND (first_out_ts - first_in_ts) <= %(gap)s
                    THEN 1 ELSE 0
                END                                 AS responded_24h,
                1                                   AS count
            FROM with_response
            """,
            {"gap": SESSION_GAP_SECONDS},
        )
