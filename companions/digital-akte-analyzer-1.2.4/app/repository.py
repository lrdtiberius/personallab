from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def safe_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


MAX_NUMERIC_12_2 = Decimal("9999999999.99")


def safe_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        decimal_value = Decimal(str(value))
        if not decimal_value.is_finite():
            return None
        rounded = decimal_value.quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        if abs(rounded) > MAX_NUMERIC_12_2:
            return None
        return rounded
    except (InvalidOperation, ValueError, TypeError):
        return None


def safe_confidence(value: Any) -> float:
    try:
        return min(max(float(value or 0), 0), 1)
    except (TypeError, ValueError):
        return 0.0


class Repository:
    def __init__(self, database_url: str) -> None:
        self.pool = ConnectionPool(database_url, min_size=1, max_size=5, open=False)

    def open(self) -> None:
        self.pool.open(wait=True, timeout=30)

    def close(self) -> None:
        self.pool.close()

    def migrate(self, schema_path: str = "/app/schema.sql") -> None:
        sql = Path(schema_path).read_text(encoding="utf-8")
        with self.pool.connection() as conn:
            conn.execute(sql)

    def ping(self) -> None:
        with self.pool.connection() as conn:
            conn.execute("SELECT 1").fetchone()

    def recover_interrupted(self) -> int:
        """Gibt Arbeitsstatus frei, die durch einen Neustart hängen blieben."""

        with self.pool.connection() as conn:
            rows = conn.execute(
                """
                UPDATE documents
                SET
                    analysis_status=CASE
                        WHEN analyzed_at IS NULL THEN 'pending'
                        WHEN needs_review THEN 'needs_review'
                        ELSE 'analyzed'
                    END,
                    last_analysis_error=(
                        'Vorheriger Auftrag wurde durch einen Neustart unterbrochen'
                    )
                WHERE analysis_status IN (
                    'analyzing',
                    'retry',
                    'ocr_processing'
                )
                RETURNING id
                """
            ).fetchall()
        return len(rows)

    def prepare_prompt_upgrade(self, prompt_version: str) -> int:
        """Markiert nur KI-Texte älterer Prompt-Versionen zur Erneuerung.

        Die bisherigen Ergebnisse bleiben bis zur erfolgreichen Neuanalyse
        lesbar. Dadurch gehen bei einem Abbruch keine Metadaten verloren.
        """

        with self.pool.connection() as conn:
            rows = conn.execute(
                """
                UPDATE documents
                SET analysis_status='pending', analyzed_at=NULL
                WHERE analyzed_at IS NOT NULL
                  AND COALESCE(analysis_prompt_version, '') <> %s
                RETURNING id
                """,
                (prompt_version,),
            ).fetchall()
        return len(rows)

    def upsert_document(self, item: dict[str, Any], detail: dict[str, Any] | None = None) -> dict[str, Any]:
        source = detail or item
        content = str(source.get("content") or "")
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest() if content else None
        correspondent = source.get("correspondent")
        if isinstance(correspondent, dict):
            correspondent = correspondent.get("name")
        document_type = source.get("document_type")
        if isinstance(document_type, dict):
            document_type = document_type.get("name")
        query = """
            INSERT INTO documents (
              paperless_id, title, document_type, correspondent, document_date,
              modified_at, content_hash
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (paperless_id) DO UPDATE SET
              title = EXCLUDED.title,
              document_type = COALESCE(EXCLUDED.document_type, documents.document_type),
              correspondent = EXCLUDED.correspondent,
              document_date = EXCLUDED.document_date,
              modified_at = EXCLUDED.modified_at,
              content_hash = COALESCE(EXCLUDED.content_hash, documents.content_hash)
            RETURNING id, paperless_id, content_hash, analyzed_at
        """
        with self.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                return cur.execute(
                    query,
                    (
                        int(source["id"]),
                        source.get("title"),
                        document_type,
                        correspondent,
                        safe_date(source.get("created") or source.get("document_date")),
                        source.get("modified"),
                        content_hash,
                    ),
                ).fetchone()

    def document_status(
        self,
        paperless_id: int,
    ) -> dict[str, Any] | None:
        with self.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                return cur.execute(
                    """
                    SELECT
                        id,
                        paperless_id,
                        content_hash,
                        analyzed_at,
                        analysis_status,
                        analysis_version,
                        analysis_attempts,
                        last_analysis_attempt,
                        last_analysis_error,
                        analyzed_content_hash,
                        needs_review
                    FROM documents
                    WHERE paperless_id=%s
                    """,
                    (paperless_id,),
                ).fetchone()

    def mark_analysis_started(
        self,
        document_id: str,
        *,
        model: str,
        prompt_version: str,
    ) -> int:
        with self.pool.connection() as conn:
            row = conn.execute(
                """
                UPDATE documents
                SET
                    analysis_status='analyzing',
                    analysis_attempts=analysis_attempts + 1,
                    last_analysis_attempt=NOW(),
                    last_analysis_error=NULL,
                    analysis_model=%s,
                    analysis_prompt_version=%s,
                    needs_review=FALSE
                WHERE id=%s
                RETURNING analysis_attempts
                """,
                (
                    model,
                    prompt_version,
                    document_id,
                ),
            ).fetchone()

        return int(row[0])

    def mark_no_ocr(
        self,
        document_id: str,
        *,
        model: str,
        prompt_version: str,
        message: str = "Dokument besitzt keinen OCR-Text",
    ) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                """
                UPDATE documents
                SET
                    analysis_status='no_ocr',
                    last_analysis_attempt=NOW(),
                    last_analysis_error=%s,
                    analysis_model=%s,
                    analysis_prompt_version=%s,
                    needs_review=FALSE
                WHERE id=%s
                """,
                (
                    message,
                    model,
                    prompt_version,
                    document_id,
                ),
            )

            conn.execute(
                """
                INSERT INTO analysis_results
                    (
                        document_id,
                        model,
                        prompt_version,
                        extracted_data,
                        error,
                        status
                    )
                VALUES (
                    %s, %s, %s, '{}'::jsonb, %s, 'no_ocr'
                )
                """,
                (
                    document_id,
                    model,
                    prompt_version,
                    message,
                ),
            )

    def mark_ocr_reprocess_started(
        self,
        document_id: str,
        *,
        model: str,
        prompt_version: str,
    ) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                """
                UPDATE documents
                SET
                    analysis_status='ocr_processing',
                    last_analysis_attempt=NOW(),
                    last_analysis_error=NULL,
                    analysis_model=%s,
                    analysis_prompt_version=%s,
                    needs_review=FALSE
                WHERE id=%s
                """,
                (
                    model,
                    prompt_version,
                    document_id,
                ),
            )

    def save_analysis(
        self,
        document_id: str,
        result: dict[str, Any],
        *,
        model: str,
        prompt_version: str,
        analysis_version: int,
        context_chars: int,
        retry: bool,
        content_truncated: bool,
        needs_review: bool,
    ) -> None:
        confidence = safe_confidence(
            result.get("confidence")
        )

        status = (
            "needs_review"
            if needs_review
            else "analyzed"
        )

        with self.pool.connection() as conn:
            attempt_row = conn.execute(
                """
                SELECT analysis_attempts
                FROM documents
                WHERE id=%s
                """,
                (document_id,),
            ).fetchone()

            attempt_number = (
                int(attempt_row[0])
                if attempt_row
                else None
            )

            # Automatisch erzeugte Kinddaten des Dokuments
            # bei einer erfolgreichen Neuanalyse ersetzen.
            conn.execute(
                "DELETE FROM events WHERE source_document=%s",
                (document_id,),
            )

            conn.execute(
                """
                DELETE FROM payments
                WHERE details->>'source_document'=%s
                """,
                (document_id,),
            )

            conn.execute(
                """
                INSERT INTO analysis_results
                    (
                        document_id,
                        model,
                        prompt_version,
                        detected_type,
                        confidence,
                        extracted_data,
                        raw_response,
                        status,
                        attempt_number,
                        context_chars,
                        retry,
                        content_truncated
                    )
                VALUES (
                    %s,%s,%s,%s,%s,
                    %s::jsonb,%s::jsonb,
                    %s,%s,%s,%s,%s
                )
                """,
                (
                    document_id,
                    model,
                    prompt_version,
                    result.get("document_type"),
                    confidence,
                    json.dumps(
                        result,
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        result,
                        ensure_ascii=False,
                    ),
                    status,
                    attempt_number,
                    context_chars,
                    retry,
                    content_truncated,
                ),
            )

            conn.execute(
                """
                UPDATE documents
                SET
                    document_type=COALESCE(
                        %s,
                        document_type
                    ),
                    summary=%s,
                    keywords=%s::jsonb,
                    confidence=%s,
                    analyzed_at=NOW(),
                    analysis_status=%s,
                    analysis_version=%s,
                    analyzed_content_hash=content_hash,
                    last_analysis_error=NULL,
                    analysis_model=%s,
                    analysis_prompt_version=%s,
                    needs_review=%s
                WHERE id=%s
                """,
                (
                    result.get("document_type"),
                    result.get("summary"),
                    json.dumps(
                        result.get("keywords") or [],
                        ensure_ascii=False,
                    ),
                    confidence,
                    status,
                    analysis_version,
                    model,
                    prompt_version,
                    needs_review,
                    document_id,
                ),
            )

            self._save_entities(
                conn,
                document_id,
                result.get("entities") or [],
            )

            self._save_events(
                conn,
                document_id,
                result.get("events") or [],
            )

            self._save_contract_and_payments(
                conn,
                document_id,
                result,
            )
    def save_analysis_error(
        self,
        document_id: str,
        error: str,
        *,
        model: str,
        prompt_version: str,
        status: str = "failed",
        context_chars: int | None = None,
        retry: bool = False,
        content_truncated: bool = False,
        needs_review: bool = False,
    ) -> None:
        with self.pool.connection() as conn:
            attempt_row = conn.execute(
                """
                SELECT analysis_attempts
                FROM documents
                WHERE id=%s
                """,
                (document_id,),
            ).fetchone()

            attempt_number = (
                int(attempt_row[0])
                if attempt_row
                else None
            )

            conn.execute(
                """
                INSERT INTO analysis_results
                    (
                        document_id,
                        model,
                        prompt_version,
                        extracted_data,
                        error,
                        status,
                        attempt_number,
                        context_chars,
                        retry,
                        content_truncated
                    )
                VALUES (
                    %s,%s,%s,'{}'::jsonb,%s,
                    %s,%s,%s,%s,%s
                )
                """,
                (
                    document_id,
                    model,
                    prompt_version,
                    error[:2000],
                    status,
                    attempt_number,
                    context_chars,
                    retry,
                    content_truncated,
                ),
            )

            conn.execute(
                """
                UPDATE documents
                SET
                    analysis_status=%s,
                    last_analysis_error=%s,
                    analysis_model=%s,
                    analysis_prompt_version=%s,
                    needs_review=%s
                WHERE id=%s
                """,
                (
                    status,
                    error[:2000],
                    model,
                    prompt_version,
                    needs_review,
                    document_id,
                ),
            )
    def _upsert_entity(self, conn: Any, entity_type: str, name: str, attributes: dict[str, Any]) -> str:
        row = conn.execute(
            """
            INSERT INTO entities (entity_type, name, normalized_name, attributes)
            VALUES (%s, %s, %s, %s::jsonb)
            ON CONFLICT (entity_type, normalized_name) DO UPDATE SET
              name=EXCLUDED.name,
              attributes=entities.attributes || EXCLUDED.attributes
            RETURNING id
            """,
            (entity_type, name, normalize_name(name), json.dumps(attributes, ensure_ascii=False)),
        ).fetchone()
        return str(row[0])

    def _save_entities(self, conn: Any, document_id: str, entities: list[Any]) -> None:
        for item in entities:
            if not isinstance(item, dict) or not str(item.get("name") or "").strip():
                continue
            entity_id = self._upsert_entity(
                conn,
                str(item.get("type") or "other")[:80],
                str(item["name"])[:500],
                item.get("attributes") if isinstance(item.get("attributes"), dict) else {},
            )
            conn.execute(
                """
                INSERT INTO entity_documents (entity_id, document_id, relation, confidence)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    entity_id,
                    document_id,
                    str(item.get("relation") or "mentioned_in")[:120],
                    safe_confidence(item.get("confidence")),
                ),
            )

    def _save_events(self, conn: Any, document_id: str, events: list[Any]) -> None:
        for event in events:
            if not isinstance(event, dict) or not safe_date(event.get("date")):
                continue
            conn.execute(
                """INSERT INTO events (event_date, event_type, description, source_document)
                   VALUES (%s, %s, %s, %s)""",
                (
                    safe_date(event.get("date")),
                    str(event.get("type") or "other")[:80],
                    str(event.get("description") or "")[:2000],
                    document_id,
                ),
            )

    def _save_contract_and_payments(
        self, conn: Any, document_id: str, result: dict[str, Any]
    ) -> None:
        contract = result.get("contract")
        entity_id: str | None = None
        if isinstance(contract, dict) and contract.get("contract_type"):
            name_parts = [
                str(value).strip()
                for value in (
                    contract.get("contract_type"),
                    contract.get("partner"),
                    contract.get("contract_number"),
                )
                if value
            ]
            name = " - ".join(name_parts)
            entity_id = self._upsert_entity(conn, "contract", name, {})
            conn.execute(
                """INSERT INTO entity_documents (entity_id, document_id, relation)
                   VALUES (%s, %s, 'contract_document') ON CONFLICT DO NOTHING""",
                (entity_id, document_id),
            )
            partner_id = None
            if contract.get("partner"):
                partner_id = conn.execute(
                    """INSERT INTO organizations (name, type) VALUES (%s, 'contract_partner')
                       ON CONFLICT (name, type) DO UPDATE SET name=EXCLUDED.name RETURNING id""",
                    (str(contract["partner"])[:500],),
                ).fetchone()[0]
            contract_id = conn.execute(
                """
                INSERT INTO contracts
                  (entity_id, contract_type, partner, contract_number, start_date, end_date,
                   cancellation_date, cancellation_info, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (entity_id) DO UPDATE SET
                  contract_type=EXCLUDED.contract_type, partner=EXCLUDED.partner,
                  contract_number=EXCLUDED.contract_number, start_date=EXCLUDED.start_date,
                  end_date=EXCLUDED.end_date, cancellation_date=EXCLUDED.cancellation_date,
                  cancellation_info=EXCLUDED.cancellation_info, status=EXCLUDED.status
                RETURNING id
                """,
                (
                    entity_id,
                    contract.get("contract_type"),
                    partner_id,
                    contract.get("contract_number"),
                    safe_date(contract.get("start_date")),
                    safe_date(contract.get("end_date")),
                    safe_date(contract.get("cancellation_date")),
                    contract.get("cancellation_info"),
                    contract.get("status") or "unknown",
                ),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO contract_details (contract_id, data) VALUES (%s, %s::jsonb)
                   ON CONFLICT (contract_id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()""",
                (contract_id, json.dumps(contract.get("details") or {}, ensure_ascii=False)),
            )
        for payment in result.get("payments") or []:
            if not isinstance(payment, dict) or safe_decimal(payment.get("amount")) is None:
                continue
            conn.execute(
                """
                INSERT INTO payments
                  (entity_id, amount, currency, interval, category, valid_from, valid_until, details)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
                """,
                (
                    entity_id,
                    safe_decimal(payment.get("amount")),
                    str(payment.get("currency") or "EUR")[:3].upper(),
                    payment.get("interval"),
                    payment.get("category"),
                    safe_date(payment.get("valid_from")),
                    safe_date(payment.get("valid_until")),
                    json.dumps({"source_document": document_id}),
                ),
            )

    def stats(self) -> dict[str, Any]:
        with self.pool.connection() as conn:
            with conn.cursor(
                row_factory=dict_row
            ) as cur:
                row = cur.execute(
                    """
                    SELECT
                        COUNT(*)::int
                            AS documents,

                        COUNT(*) FILTER (
                            WHERE analysis_status IN (
                                'analyzed',
                                'needs_review'
                            )
                        )::int
                            AS analyzed,

                        COUNT(*) FILTER (
                            WHERE analysis_status='pending'
                        )::int
                            AS pending,

                        COUNT(*) FILTER (
                            WHERE analysis_status='analyzing'
                        )::int
                            AS analyzing,

                        COUNT(*) FILTER (
                            WHERE analysis_status='failed'
                        )::int
                            AS failed,

                        COUNT(*) FILTER (
                            WHERE analysis_status='no_ocr'
                        )::int
                            AS no_ocr,

                        COUNT(*) FILTER (
                            WHERE analysis_status='ocr_processing'
                        )::int
                            AS ocr_processing,

                        COUNT(*) FILTER (
                            WHERE analysis_status='needs_review'
                        )::int
                            AS needs_review,

                        COALESCE(
                            SUM(analysis_attempts),
                            0
                        )::int
                            AS analysis_attempts,

                        MAX(analyzed_at)
                            AS last_analysis
                    FROM documents
                    """
                ).fetchone()

                return row
    def list_documents(self, *, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
        with self.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                return cur.execute(
                    """SELECT
                              documents.paperless_id,
                              documents.title,
                              documents.document_type,
                              documents.correspondent,
                              documents.document_date,
                              documents.summary,
                              documents.keywords,
                              documents.confidence,
                              documents.analyzed_at,
                              NULLIF(latest.extracted_data->>'short_title', '') AS short_title,
                              NULLIF(latest.extracted_data->>'category', '') AS category,
                              LEFT(COALESCE(latest.extracted_data::text, ''), 8000) AS search_text
                       FROM documents
                       LEFT JOIN LATERAL (
                           SELECT extracted_data
                           FROM analysis_results
                           WHERE analysis_results.document_id=documents.id
                             AND analysis_results.extracted_data IS NOT NULL
                           ORDER BY analysis_results.created_at DESC
                           LIMIT 1
                       ) AS latest ON TRUE
                       ORDER BY documents.paperless_id DESC
                       LIMIT %s OFFSET %s""",
                    (limit, offset),
                ).fetchall()
