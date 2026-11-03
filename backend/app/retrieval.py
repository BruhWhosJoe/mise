"""Local lexical candidate retrieval over cached catalog records.

Stage 1 of discovery: rank every cached record against the question with
transparent field-weighted term matching, then hand the top candidates to
the Meta model for real relevance evaluation. This keeps model context and
quota bounded no matter how large the catalog grows.

Limitations (also surfaced to API consumers via coverage notes):
- Lexical only: synonyms, typos, and paraphrases do not match.
- A high score means shared words, not proven relevance; the model and the
  human still judge.
- Records without an AssignedID are excluded from candidates because no
  recommendation could cite them; they still count as retrieved.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .models import CatalogRecord

STOPWORDS = frozenset(
    """
    a an and are as at be by for from has have how in is it its of on or
    that the their there these this to was what when where which who with
    would do does show find get me my our out over under more most any all
    about into than then them they we you your near across within between
    """.split()
)

# (record attribute, weight); title and tags carry the question's intent best.
FIELD_WEIGHTS: tuple[tuple[str, int], ...] = (
    ('title', 5),
    ('tags', 4),
    ('organization_name', 3),
    ('item_type', 3),
    ('portal_name', 2),
    ('summary', 2),
    ('description', 2),
    ('layer_names', 2),
)


@dataclass
class RetrievalResult:
    candidates: list[CatalogRecord]
    terms: list[str]
    excluded_no_id: int
    notes: list[str] = field(default_factory=list)


def tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric terms without stopwords."""
    terms = re.findall(r'[a-z0-9]+', text.lower())
    return [term for term in terms if term not in STOPWORDS and len(term) > 1]


def _field_texts(record: CatalogRecord, attribute: str) -> list[str]:
    value = getattr(record, attribute, None)
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).lower() for item in value]
    return [str(value).lower()]


def score_record(terms: list[str], record: CatalogRecord) -> int:
    """Weighted count of distinct query terms appearing per field."""
    score = 0
    for attribute, weight in FIELD_WEIGHTS:
        texts = _field_texts(record, attribute)
        if not texts:
            continue
        for term in terms:
            if any(term in text for text in texts):
                score += weight
    return score


def retrieve_candidates(
    question: str, records: list[CatalogRecord], top_k: int
) -> RetrievalResult:
    """Rank cached records and return the top scoring candidates."""
    terms = tokenize(question)
    if not terms:
        return RetrievalResult(
            candidates=[],
            terms=[],
            excluded_no_id=0,
            notes=['question has no searchable terms after stopword removal'],
        )
    usable = [record for record in records if record.assigned_id is not None]
    excluded = len(records) - len(usable)
    scored = [
        (score_record(terms, record), record) for record in usable
    ]
    scored = [(score, record) for score, record in scored if score > 0]
    if not scored:
        notes = ['no catalog records share terms with the question']
        if excluded:
            notes.append(
                f'{excluded} retrieved record(s) lack IDs and were excluded'
            )
        return RetrievalResult(
            candidates=[], terms=terms, excluded_no_id=excluded, notes=notes
        )
    scored.sort(
        key=lambda pair: (
            -pair[0],
            pair[1].assigned_id or '',
        )
    )
    notes = []
    if excluded:
        notes.append(
            f'{excluded} retrieved record(s) lack IDs and were excluded'
        )
    candidates = [record for _score, record in scored[: max(top_k, 0)]]
    return RetrievalResult(
        candidates=candidates,
        terms=terms,
        excluded_no_id=excluded,
        notes=notes,
    )
