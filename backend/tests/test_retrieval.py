"""Lexical retrieval unit tests (pure, no network)."""

from app.models import CatalogRecord
from app.retrieval import retrieve_candidates, score_record, tokenize


def _record(id, **fields):
    values = {'assigned_id': id}
    values.update(fields)
    return CatalogRecord(**values)


def test_tokenize_drops_stopwords_and_short_terms():
    assert tokenize('What affects pedestrian safety near schools?') == [
        'affects',
        'pedestrian',
        'safety',
        'schools',
    ]
    assert tokenize('a b c d e f g') == []


def test_score_record_weights_title_over_description():
    title_hit = _record('1', title='Floodplains map')
    desc_hit = _record('2', description='floodplains map details')
    assert score_record(['floodplains'], title_hit) == 5
    assert score_record(['floodplains'], desc_hit) == 2
    assert score_record(['zoning'], title_hit) == 0


def test_score_record_counts_each_field_once_per_term():
    record = _record('1', title='flood flood flood', tags=['flood'])
    assert score_record(['flood'], record) == 9


def test_retrieve_candidates_ranks_and_caps():
    records = [
        _record('1', title='Unrelated birds'),
        _record('2', title='Floodplains', description='river flooding zones'),
        _record('3', description='flood insurance notes'),
    ]
    result = retrieve_candidates('flood zones near rivers', records, top_k=2)
    assert [record.assigned_id for record in result.candidates] == ['2', '3']
    assert result.terms
    assert result.excluded_no_id == 0


def test_retrieve_candidates_breaks_ties_by_id():
    records = [
        _record('b', title='Flood data'),
        _record('a', title='Flood data'),
    ]
    result = retrieve_candidates('flood', records, top_k=2)
    assert [record.assigned_id for record in result.candidates] == ['a', 'b']


def test_retrieve_candidates_empty_without_terms_or_matches():
    records = [_record('1', title='Floodplains')]
    empty_terms = retrieve_candidates('what is the', records, top_k=5)
    assert empty_terms.candidates == []
    assert 'no searchable terms' in ' '.join(empty_terms.notes)
    no_match = retrieve_candidates('zoning ordinances', records, top_k=5)
    assert no_match.candidates == []
    assert 'no catalog records share terms' in ' '.join(no_match.notes)


def test_retrieve_candidates_excludes_records_without_ids():
    records = [
        _record(None, title='Floodplains everywhere'),
        _record('9', title='Floodplains'),
    ]
    result = retrieve_candidates('floodplains', records, top_k=5)
    assert [record.assigned_id for record in result.candidates] == ['9']
    assert result.excluded_no_id == 1
