"""Lexical retrieval unit tests (pure, no network)."""

import math

from app.models import CatalogRecord
from app.retrieval import (
    compute_idf,
    retrieve_candidates,
    score_record,
    stem,
    tokenize,
)


def _record(id, **fields):
    values = {'assigned_id': id}
    values.update(fields)
    return CatalogRecord(**values)


def _distractors(*ids):
    """Unrelated records that keep topical terms discriminative."""
    titles = {
        'd1': 'Bird counts',
        'd2': 'Zoning maps',
        'd3': 'Soil survey',
        'd4': 'Library branches',
        'd5': 'Park boundaries',
    }
    return [_record(id, title=titles[id]) for id in ids]


def test_tokenize_drops_stopwords_and_short_terms():
    assert tokenize('What affects pedestrian safety near schools?') == [
        'affect',
        'pedestrian',
        'safety',
        'school',
    ]
    assert tokenize('a b c d e f g') == []


def test_stem_meets_plural_variants():
    assert stem('schools') == 'school'
    assert stem('crashes') == 'crash'
    assert stem('collisions') == 'collision'
    assert stem('crosswalks') == 'crosswalk'
    assert stem('facilities') == 'facility'
    assert stem('safety') == 'safety'
    assert stem('dc') == 'dc'
    assert stem('class') == 'class'
    assert stem('bus') == 'bus'


def test_score_record_weights_title_over_description():
    title_hit = _record('1', title='Floodplains map')
    desc_hit = _record('2', description='floodplains map details')
    assert score_record(['floodplains'], title_hit) == 5
    assert score_record(['floodplains'], desc_hit) == 2
    assert score_record(['zoning'], title_hit) == 0


def test_score_record_counts_each_field_once_per_term():
    record = _record('1', title='flood flood flood', tags=['flood'])
    assert score_record(['flood'], record) == 9


def test_score_record_matches_whole_words_only():
    record = _record('1', title='Crash reports', description='Flooding zones')
    assert score_record(['car'], record) == 0
    assert score_record(['flood'], record) == 0
    assert score_record(['crash'], record) == 5
    assert score_record(['crashes'], record) == 5
    schools = _record('2', title='School programs')
    assert score_record(['schools'], schools) == 5


def test_score_record_applies_per_term_weights():
    record = _record('1', title='Flood crash data')
    assert (
        score_record(['flood', 'crash'], record, {'flood': 2.0, 'crash': 0.0})
        == 10.0
    )
    assert score_record(['flood'], record, {}) == 0.0


def test_compute_idf_zeroes_ubiquitous_terms():
    records = [
        _record(
            str(index),
            title='Washington DC record',
            tags=['washington'],
        )
        for index in range(9)
    ]
    records.append(_record('9', title='Crash data'))
    idf = compute_idf(records)
    assert idf['washington'] == 0.0
    assert idf['dc'] == 0.0
    assert idf['record'] == 0.0
    assert idf['crash'] == math.log(10)
    assert compute_idf([]) == {}


def test_small_catalogs_use_floored_idf_without_zeroing():
    # 1-of-2 is 50%: floored, never zeroed, so matches always count.
    records = [
        _record('1', title='Flood risk zones'),
        _record('2', title='Bird counts'),
    ]
    idf = compute_idf(records)
    assert idf['flood'] == math.log(2)
    assert idf['flood'] > 0
    result = retrieve_candidates('flood risk in DC', records, top_k=5)
    assert [record.assigned_id for record in result.candidates] == ['1']


def test_retrieve_candidates_ranks_and_caps():
    records = [
        _record('1', title='Unrelated birds'),
        _record('2', title='Floodplains', description='river flooding zones'),
        _record('3', description='flood insurance notes'),
        *_distractors('d2'),
    ]
    result = retrieve_candidates('flood zones near rivers', records, top_k=2)
    assert [record.assigned_id for record in result.candidates] == ['2', '3']
    assert result.terms
    assert result.excluded_no_id == 0


def test_retrieve_candidates_breaks_ties_by_id():
    records = [
        _record('b', title='Flood data'),
        _record('a', title='Flood data'),
        *_distractors('d1', 'd2', 'd3', 'd4', 'd5'),
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
    assert 'no catalog records share topical terms' in ' '.join(
        no_match.notes
    )


def test_retrieve_candidates_excludes_records_without_ids():
    records = [
        _record(None, title='Unrelated birds'),
        _record('9', title='Floodplains'),
        *_distractors('d1', 'd2', 'd3'),
    ]
    result = retrieve_candidates('floodplains', records, top_k=5)
    assert [record.assigned_id for record in result.candidates] == ['9']
    assert result.excluded_no_id == 1


def test_topical_requirement_blocks_ubiquitous_only_matches():
    records = [
        _record(
            f'g{index}',
            title='Aerial photography',
            portal_name='opendata.dc.gov',
            tags=['Washington', 'DC'],
        )
        for index in range(8)
    ]
    records.append(
        _record('t1', title='Crash reports', description='pedestrian collisions')
    )
    result = retrieve_candidates(
        'pedestrian safety in Washington DC',
        records,
        top_k=5,
        place_terms=('Washington DC',),
    )
    assert [record.assigned_id for record in result.candidates] == ['t1']


def test_expansion_terms_add_recall_below_user_weight():
    records = [
        _record('u', title='Pedestrian handbook'),
        _record('x', title='Crash handbook'),
        *_distractors('d1', 'd2'),
    ]
    result = retrieve_candidates(
        'pedestrian', records, top_k=2, expansion_terms=('crash',)
    )
    # Same field, same rarity: the user's own word outranks expansion.
    assert [record.assigned_id for record in result.candidates] == ['u', 'x']
    assert 'crash' in result.terms


def test_expansion_term_match_is_enough_for_candidacy():
    records = [
        _record('e', title='Collision diagrams'),
        *_distractors('d1', 'd2', 'd3'),
    ]
    result = retrieve_candidates(
        'pedestrian safety', records, top_k=5, expansion_terms=('collision',)
    )
    assert [record.assigned_id for record in result.candidates] == ['e']


def test_place_terms_never_score():
    records = [
        _record('p', title='Washington DC overview'),
        _record('t', title='Crash reports'),
        *_distractors('d1', 'd2'),
    ]
    result = retrieve_candidates(
        'crash data in Washington DC',
        records,
        top_k=5,
        place_terms=('Washington', 'DC'),
    )
    assert [record.assigned_id for record in result.candidates] == ['t']


def test_explicit_idf_overrides_catalog_weights():
    records = [
        _record('a', title='Flood data'),
        _record('b', title='Flood data'),
    ]
    result = retrieve_candidates('flood', records, top_k=2, idf={'flood': 2.0})
    assert [record.assigned_id for record in result.candidates] == ['a', 'b']
