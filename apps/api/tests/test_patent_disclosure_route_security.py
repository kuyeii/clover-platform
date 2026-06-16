from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
ROUTE_SOURCE = (API_ROOT / "app" / "api" / "patent_disclosure.py").read_text(encoding="utf-8")


def test_patent_job_stream_uses_standard_authorization_dependency() -> None:
    stream_route = ROUTE_SOURCE.split('@router.get("/api/jobs/{job_id}/stream")', maxsplit=1)[1].split(
        '@router.get("/api/cases/{case_id}/artifacts")',
        maxsplit=1,
    )[0]

    assert "Depends(require_patent_disclosure_user)" in stream_route
    assert "access_token" not in stream_route
    assert "Query(default=None)" not in stream_route


def test_patent_routes_do_not_accept_access_token_query_auth() -> None:
    assert "_current_user_for_sse" not in ROUTE_SOURCE
    assert "access_token" not in ROUTE_SOURCE
