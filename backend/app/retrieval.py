"""Local lexical candidate retrieval over cached catalog records.

Stage 1 of discovery: rank every cached record against the question with
transparent field-weighted whole-word matching, then hand the top
candidates to the Meta model for real relevance evaluation. This keeps
model context and quota bounded no matter how large the catalog grows.

Three guards keep generic catalog boilerplate from drowning out topical
matches (the observed failure: place words like "washington"/"dc" appear
in nearly every DC record, so substring matching filled the shortlist
with high-ID generic records and topical datasets never reached the
model):

- Whole-word matching with light stemming (``schools`` matches
  ``school``; ``flood`` does not match ``flooding``).
- IDF weighting computed once per catalog snapshot: in snapshots of 10+
  records, terms in more than ~30% of records score nothing; smaller
  snapshots use floored IDF so matched terms always count.
- When any topical (non-place, positively weighted) term exists, a
  candidate must match at least one of them.

Limitations (also surfaced to API consumers via coverage notes):
- Lexical only: unexpanded synonyms, typos, and paraphrases do not match.
- A high score means distinctive shared words, not proven relevance; the
  model and the human still judge.
- Records without an AssignedID are excluded from candidates because no
  recommendation could cite them; they still count as retrieved.
"""

from __future__ import annotations

import math
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

# Terms present in more than this share of snapshot records are ubiquitous
# (place names, portal boilerplate) and contribute nothing to ranking --
# but only once the snapshot is large enough for the ratio to mean
# anything. Smaller snapshots use floored IDF so matched terms count.
UBIQUITOUS_RATIO = 0.30
UBIQUITY_MIN_RECORDS = 10
MIN_IDF = 0.1

# Model-supplied expansion terms count slightly less than the user's words.
EXPANSION_TERM_WEIGHT = 0.7


@dataclass
class RetrievalResult:
    candidates: list[CatalogRecord]
    terms: list[str]
    excluded_no_id: int
    notes: list[str] = field(default_factory=list)


def stem(term: str) -> str:
    """Strip common plural/suffix endings so variants meet (pure).

    Deliberately small and idempotent: ``schools`` -> ``school``,
    ``crashes`` -> ``crash``, ``facilities`` -> ``facility``. Applied
    identically to query and record text, so both sides always agree.
    """
    if len(term) > 4 and term.endswith('ies'):
        return term[:-3] + 'y'
    if len(term) > 4 and term.endswith(('sses', 'xes', 'zes', 'ches', 'shes')):
        return term[:-2]
    if len(term) > 3 and term.endswith('s') and not term.endswith('ss'):
        return term[:-1]
    return term


def tokenize(text: str) -> list[str]:
    """Lowercase alphanumeric terms without stopwords, lightly stemmed."""
    terms = re.findall(r'[a-z0-9]+', text.lower())
    return [
        stem(term)
        for term in terms
        if term not in STOPWORDS and len(term) > 1
    ]


def _field_terms(record: CatalogRecord, attribute: str) -> set[str]:
    """Whole-word token set for one record field (pure)."""
    value = getattr(record, attribute, None)
    if value is None:
        return set()
    if isinstance(value, list):
        text = ' '.join(str(item) for item in value)
    else:
        text = str(value)
    return set(tokenize(text))


def compute_idf(
    records: list[CatalogRecord],
    *,
    ubiquitous_ratio: float = UBIQUITOUS_RATIO,
) -> dict[str, float]:
    """Per-term IDF over snapshot records (pure).

    Each record counts once per term across all searched fields. Once the
    snapshot holds at least ``UBIQUITY_MIN_RECORDS`` records, terms in
    more than ``ubiquitous_ratio`` of records get exactly 0.0; below that
    size every term keeps ``max(log(total / count), MIN_IDF)`` so a match
    always counts. Callers cache the result per snapshot; retrieval never
    recomputes it per question.
    """
    doc_freq: dict[str, int] = {}
    for record in records:
        seen: set[str] = set()
        for attribute, _weight in FIELD_WEIGHTS:
            seen |= _field_terms(record, attribute)
        for term in seen:
            doc_freq[term] = doc_freq.get(term, 0) + 1
    total = len(records)
    if total == 0:
        return {}
    apply_ubiquity = total >= UBIQUITY_MIN_RECORDS
    idf: dict[str, float] = {}
    for term, count in doc_freq.items():
        if apply_ubiquity and count / total > ubiquitous_ratio:
            idf[term] = 0.0
        else:
            idf[term] = max(math.log(total / count), MIN_IDF)
    return idf


def score_record(
    terms: list[str],
    record: CatalogRecord,
    weights: dict[str, float] | None = None,
) -> float:
    """Field-weighted whole-word matches, scaled by per-term weights."""
    score = 0.0
    stemmed = [stem(term) for term in terms]
    for attribute, field_weight in FIELD_WEIGHTS:
        present = _field_terms(record, attribute)
        if not present:
            continue
        for term in stemmed:
            if term in present:
                if weights is None:
                    term_weight = 1.0
                else:
                    term_weight = weights.get(term, 0.0)
                score += field_weight * term_weight
    return score


def _matches_any(record: CatalogRecord, terms: list[str]) -> bool:
    """True when any searched field holds any term whole-word (pure)."""
    for attribute, _weight in FIELD_WEIGHTS:
        present = _field_terms(record, attribute)
        if any(term in present for term in terms):
            return True
    return False


def retrieve_candidates(
    question: str,
    records: list[CatalogRecord],
    top_k: int,
    *,
    idf: dict[str, float] | None = None,
    expansion_terms: tuple[str, ...] | list[str] = (),
    expansion_weight: float = EXPANSION_TERM_WEIGHT,
    place_terms: tuple[str, ...] | list[str] = (),
) -> RetrievalResult:
    """Rank cached records and return the top scoring candidates.

    ``idf`` is the snapshot's cached weights (computed from ``records``
    when omitted). ``expansion_terms`` are model-supplied topical phrases
    (tokenized here; a term the user also wrote keeps full weight).
    ``place_terms`` are never scored: place names are not topical terms.
    When any positively weighted term exists, candidates must match at
    least one of them whole-word.
    """
    question_terms = tokenize(question)
    extra: list[str] = []
    for keyword in expansion_terms:
        extra.extend(tokenize(keyword))
    places: set[str] = set()
    for name in place_terms:
        places.update(tokenize(name))
    scored: list[str] = []
    seen: set[str] = set()
    for term in question_terms + extra:
        if term in places or term in seen:
            continue
        seen.add(term)
        scored.append(term)
    if not scored:
        return RetrievalResult(
            candidates=[],
            terms=[],
            excluded_no_id=0,
            notes=['question has no searchable terms after stopword removal'],
        )
    weights: dict[str, float] = {}
    if idf is None:
        idf = compute_idf(records)
    # A scored term absent from the weights matches nothing in the
    # weighted snapshot; treat it as maximally distinctive so a stale or
    # partial table can never silence a real match.
    unseen = max(idf.values()) if idf else 1.0
    question_set = set(question_terms)
    for term in scored:
        base = 1.0 if term in question_set else expansion_weight
        weights[term] = base * idf.get(term, unseen)
    topical = [term for term in scored if weights[term] > 0]
    usable = [record for record in records if record.assigned_id is not None]
    excluded = len(records) - len(usable)
    ranked: list[tuple[float, CatalogRecord]] = []
    for record in usable:
        if topical and not _matches_any(record, topical):
            continue
        score = score_record(scored, record, weights)
        if score > 0:
            ranked.append((score, record))
    if not ranked:
        if topical:
            notes = ['no catalog records share topical terms with the question']
        else:
            notes = ['no catalog records share terms with the question']
        if excluded:
            notes.append(
                f'{excluded} retrieved record(s) lack IDs and were excluded'
            )
        return RetrievalResult(
            candidates=[], terms=scored, excluded_no_id=excluded, notes=notes
        )
    ranked.sort(
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
    candidates = [record for _score, record in ranked[: max(top_k, 0)]]
    return RetrievalResult(
        candidates=candidates,
        terms=scored,
        excluded_no_id=excluded,
        notes=notes,
    )
