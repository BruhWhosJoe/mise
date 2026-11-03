"""Normalization unit tests: aliases, missing fields, URLs, pagination."""

import pytest

from app.mcp_service import MCPMalformedError
from app.normalize import (
    parse_layer_names,
    parse_tags,
    coerce_bool,
    coerce_int,
    coerce_text,
    extract_records,
    first_present,
    normalize_preview,
    normalize_record,
    sanitize_url,
)


def test_first_present_skips_empty_and_missing():
    mapping = {'title': '   ', 'Title': None, 'name': 'Real Name'}
    assert (
        first_present(mapping, ('title', 'Title', 'name')) == 'Real Name'
    )
    assert first_present({}, ('title',)) is None


def test_coerce_text_accepts_scalars_only():
    assert coerce_text('  padded  ') == 'padded'
    assert coerce_text('   ') is None
    assert coerce_text(42) == '42'
    assert coerce_text(None) is None
    assert coerce_text(['a list']) is None
    assert coerce_text({'a': 'dict'}) is None


def test_coerce_int_variants():
    assert coerce_int(7) == 7
    assert coerce_int(' 12 ') == 12
    assert coerce_int(9.0) == 9
    assert coerce_int(True) is None
    assert coerce_int(9.5) is None
    assert coerce_int('many') is None
    assert coerce_int(None) is None


def test_coerce_bool_variants():
    assert coerce_bool(True) is True
    assert coerce_bool('yes') is True
    assert coerce_bool(0) is False
    assert coerce_bool('maybe') is None
    assert coerce_bool(None) is None


def test_sanitize_url_allows_only_http_hosts():
    assert sanitize_url('https://example.gov/data') == 'https://example.gov/data'
    assert sanitize_url('http://example.gov/x') == 'http://example.gov/x'
    assert sanitize_url('ftp://example.gov/x') is None
    assert sanitize_url('javascript:alert(1)') is None
    assert sanitize_url('/relative/path') is None
    assert sanitize_url('https://') is None
    assert sanitize_url('not a url') is None
    assert sanitize_url(None) is None


def test_extract_records_accepts_bare_list_and_envelopes():
    rows = [{'id': 'a'}, {'id': 'b'}]
    assert extract_records(rows) == rows
    assert extract_records({'records': rows}) == rows
    assert extract_records({'data': rows}) == rows
    assert extract_records({'layers': rows}) == rows
    assert extract_records({'records': 'nope'}) == []
    assert extract_records({'unrelated': 1}) == []
    assert extract_records(None) == []
    assert extract_records('text') == []


def test_extract_records_skips_non_mapping_items():
    payload = {'records': [{'id': 'a'}, 'junk', 42, None, {'id': 'b'}]}
    assert [dict(item) for item in extract_records(payload)] == [
        {'id': 'a'},
        {'id': 'b'},
    ]


def test_normalize_record_maps_aliases_and_preserves_raw():
    raw = {
        'LayerID': 'CA-123',
        'Name': 'Floodplains',
        'Abstract': 'coastal zones',
        'Publisher': 'State Geoportal',
        'AccessURL': 'https://example.gov/flood',
        'extra_field': 'kept',
    }
    record = normalize_record(raw)
    assert record.assigned_id == 'CA-123'
    assert record.title == 'Floodplains'
    assert record.description == 'coastal zones'
    assert record.source == 'State Geoportal'
    assert record.access_url == 'https://example.gov/flood'
    assert record.raw == raw


def test_normalize_record_missing_values_stay_missing():
    record = normalize_record({'id': 'x-1'})
    assert record.assigned_id == 'x-1'
    assert record.title is None
    assert record.description is None
    assert record.source is None
    assert record.access_url is None
    assert record.raw == {'id': 'x-1'}


def test_normalize_record_drops_unsafe_url_but_keeps_raw():
    raw = {'id': 'x-2', 'AccessURL': 'javascript:alert(1)'}
    record = normalize_record(raw)
    assert record.access_url is None
    assert record.raw['AccessURL'] == 'javascript:alert(1)'


def test_normalize_preview_preserves_pagination_and_counts():
    payload = {
        'records': [{'id': 'a'}, {'id': 'b'}],
        'has_more': True,
        'next_offset': 20,
        'total_records': 150,
    }
    page = normalize_preview(payload, offset=10, limit=20)
    assert page.offset == 10
    assert page.limit == 20
    assert page.returned == 2
    assert [record.assigned_id for record in page.records] == ['a', 'b']
    assert page.has_more is True
    assert page.next_offset == 20
    assert page.total_records == 150


def test_normalize_preview_missing_pagination_stays_missing():
    page = normalize_preview([{'id': 'a'}], offset=0, limit=20)
    assert page.returned == 1
    assert page.has_more is None
    assert page.next_offset is None
    assert page.total_records is None


def test_normalize_preview_accepts_cased_pagination_aliases():
    payload = {
        'data': [{'ID': 'a'}],
        'hasMore': 'yes',
        'nextOffset': '5',
        'totalRecords': 9,
    }
    page = normalize_preview(payload, offset=0, limit=5)
    assert page.has_more is True
    assert page.next_offset == 5
    assert page.total_records == 9


# Live get_metadata_catalog shape observed 2026-11-02: records arrive in a
# "rows" envelope with Always Search fields only (no AccessURL here).
LIVE_PAGE = {
    'total_records': 1660,
    'offset': 0,
    'requested_limit': 3,
    'returned_records': 3,
    'has_more': True,
    'continuation_required': True,
    'next_offset': 3,
    'records_remaining': 1657,
    'catalog_identifier_field': 'AssignedID',
    'always_search_fields': [
        'AssignedID',
        'Title',
        'LayerList',
        'Summary',
        'Description',
        'Tags',
    ],
    'additional_fields_requested': [],
    'selected_fields': [
        'AssignedID',
        'Title',
        'LayerList',
        'Summary',
        'Description',
        'Tags',
    ],
    'rows': [
        {
            'AssignedID': '1',
            'Title': 'Aerial Photography (Orthophoto) - 2009',
            'LayerList': '[{"id":null,"name":"Ortho/Ortho_2009"}]',
            'Summary': (
                'This data is used for the planning and management of '
                'Washington, D.C. by local government agencies.'
            ),
            'Description': '2009 Aerial Photography',
            'Tags': '',
        },
        {
            'AssignedID': '2',
            'Title': 'Aerial Photography (Orthophoto) - 2010',
            'LayerList': '[{"id":null,"name":"Ortho/Ortho_2010"}]',
            'Summary': (
                'This data is used for the planning and management of '
                'Washington, D.C. by local government agencies.'
            ),
            'Description': '2010 Aerial Photography',
            'Tags': '',
        },
        {
            'AssignedID': '3',
            'Title': 'Building Footprints - 2021',
            'LayerList': '[{"id":null,"name":"Structures/Buildings_2021"}]',
            'Summary': 'Building footprint polygons for Washington, D.C.',
            'Description': 'Building footprints',
            'Tags': 'structures',
        },
    ],
}


def test_normalize_preview_parses_live_rows_envelope():
    page = normalize_preview(LIVE_PAGE, offset=0, limit=3)
    assert page.offset == 0
    assert page.limit == 3
    assert page.returned == 3
    assert [record.assigned_id for record in page.records] == ['1', '2', '3']
    assert all(
        isinstance(record.assigned_id, str) for record in page.records
    )
    assert [record.title for record in page.records] == [
        'Aerial Photography (Orthophoto) - 2009',
        'Aerial Photography (Orthophoto) - 2010',
        'Building Footprints - 2021',
    ]
    assert page.records[0].description == '2009 Aerial Photography'
    assert page.records[0].access_url is None
    assert page.records[0].raw == LIVE_PAGE['rows'][0]
    assert page.has_more is True
    assert page.next_offset == 3
    assert page.total_records == 1660


def test_normalize_preview_allows_genuinely_empty_pages():
    past_end = {
        'total_records': 1660,
        'offset': 1660,
        'returned_records': 0,
        'rows': [],
        'has_more': False,
    }
    page = normalize_preview(past_end, offset=1660, limit=20)
    assert page.records == []
    assert page.returned == 0
    assert normalize_preview([], offset=0, limit=20).returned == 0
    assert (
        normalize_preview({'total_records': 0}, offset=0, limit=20).returned
        == 0
    )


def test_normalize_preview_rejects_inconsistent_nonempty_payloads():
    without_rows = {
        key: value for key, value in LIVE_PAGE.items() if key != 'rows'
    }
    with pytest.raises(MCPMalformedError):
        normalize_preview(without_rows, offset=0, limit=3)
    with pytest.raises(MCPMalformedError):
        normalize_preview({'total_records': 1660}, offset=0, limit=20)
    unusable = dict(LIVE_PAGE, rows=['junk', 42, None])
    with pytest.raises(MCPMalformedError):
        normalize_preview(unusable, offset=0, limit=3)


RICH_ROW = {
    'AssignedID': '7',
    'Title': 'Zoning Districts',
    'Summary': 'Zoning district boundaries.',
    'Description': 'Zoning districts, long form.',
    'Tags': 'planning, zoning; land use',
    'PortalName': 'DC GeoPortal',
    'OrganizationName': 'Office of Planning',
    'PortalItemType': 'Feature Service',
    'UpdateDate': '2024-05-01',
    'ModifiedDate': '2024-06-15',
    'TemporalRange': '2020-2024',
    'AccessURL': 'https://example.gov/zoning',
    'ServiceEndpointURL': 'https://example.gov/zoning/FeatureServer',
    'DownloadURL': 'https://example.gov/zoning.zip',
    'UseLimitations': 'Public use allowed.',
    'AccessConstraints': 'None.',
    'LayerList': '[{"id": 0, "name": "Zoning"}, {"id": 1, "name": "Overlays"}]',
    'Extent': '{"xmin": 1, "ymin": 2}',
    'CoordinateSystemCode': 'EPSG:26985',
}


def test_normalize_record_maps_extended_card_fields():
    record = normalize_record(RICH_ROW)
    assert record.summary == 'Zoning district boundaries.'
    assert record.portal_name == 'DC GeoPortal'
    assert record.organization_name == 'Office of Planning'
    assert record.item_type == 'Feature Service'
    assert record.tags == ['planning', 'zoning', 'land use']
    assert record.access_url == 'https://example.gov/zoning'
    assert (
        record.service_endpoint_url
        == 'https://example.gov/zoning/FeatureServer'
    )
    assert record.download_url == 'https://example.gov/zoning.zip'
    assert record.update_date == '2024-05-01'
    assert record.modified_date == '2024-06-15'
    assert record.temporal_range == '2020-2024'
    assert record.use_limitations == 'Public use allowed.'
    assert record.access_constraints == 'None.'
    assert record.layer_names == ['Zoning', 'Overlays']
    assert record.coordinate_system == 'EPSG:26985'
    assert record.raw == RICH_ROW


def test_normalize_record_keeps_absent_extended_fields_missing():
    record = normalize_record({'AssignedID': '7', 'Title': 'Zoning'})
    assert record.summary is None
    assert record.portal_name is None
    assert record.organization_name is None
    assert record.item_type is None
    assert record.tags is None
    assert record.service_endpoint_url is None
    assert record.download_url is None
    assert record.update_date is None
    assert record.modified_date is None
    assert record.temporal_range is None
    assert record.use_limitations is None
    assert record.access_constraints is None
    assert record.layer_names is None
    assert record.coordinate_system is None


def test_normalize_record_drops_unsafe_extra_urls():
    record = normalize_record(
        {
            'id': 'x',
            'ServiceEndpointURL': 'ftp://example.gov/svc',
            'DownloadURL': 'javascript:alert(1)',
        }
    )
    assert record.service_endpoint_url is None
    assert record.download_url is None


def test_parse_tags_variants():
    assert parse_tags('aerial, imagery, 2009') == ['aerial', 'imagery', '2009']
    assert parse_tags('aerial; imagery') == ['aerial', 'imagery']
    assert parse_tags(['a', ' b ', '', None, 7]) == ['a', 'b', '7']
    assert parse_tags('') is None
    assert parse_tags('  ') is None
    assert parse_tags([]) is None
    assert parse_tags(None) is None
    assert parse_tags(42) == ['42']


def test_parse_layer_names_variants():
    assert parse_layer_names('[{"id":null,"name":"Ortho/2009"}]') == [
        'Ortho/2009'
    ]
    assert parse_layer_names([{'name': 'A'}, {'Title': 'B'}]) == ['A', 'B']
    assert parse_layer_names(['Solo', '  ', 9]) == ['Solo']
    assert parse_layer_names('Single Layer') == ['Single Layer']
    assert parse_layer_names({'name': 'Only'}) == ['Only']
    assert parse_layer_names('') is None
    assert parse_layer_names([]) is None
    assert parse_layer_names([{'id': 1}]) is None
    assert parse_layer_names(None) is None
    assert parse_layer_names(42) is None
