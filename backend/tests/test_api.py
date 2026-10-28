import os
import pytest
from datetime import datetime, timezone
from backend.app import create_app
from backend.database import Base, get_engine

TEST_API_KEY = "test-secret-key-12345"

@pytest.fixture
def client(tmp_path):
    # Use isolated SQLite database per test session
    db_file = tmp_path / "test.db"
    db_url = f"sqlite:///{db_file}"

    test_config = {
        "TESTING": True,
        "DATABASE_URL": db_url,
        "DEVICE_API_KEY": TEST_API_KEY,
    }

    app = create_app(test_config=test_config)
    with app.test_client() as client:
        yield client


def test_health_check(client):
    """GET /health should return 200 and healthy status."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"
    assert "timestamp" in data


def test_missing_api_key(client):
    """POST /api/readings without X-API-Key should return 401."""
    res = client.post(
        "/api/readings",
        json={"device_id": "esp32-01", "object_detected": True}
    )
    assert res.status_code == 401
    assert "Unauthorized" in res.get_json()["message"]


def test_invalid_api_key(client):
    """POST /api/readings with wrong X-API-Key should return 401."""
    res = client.post(
        "/api/readings",
        headers={"X-API-Key": "wrong-key"},
        json={"device_id": "esp32-01", "object_detected": True}
    )
    assert res.status_code == 401
    assert "Unauthorized" in res.get_json()["message"]


def test_wrong_content_type(client):
    """POST /api/readings with non-JSON content type should return 415."""
    res = client.post(
        "/api/readings",
        headers={"X-API-Key": TEST_API_KEY, "Content-Type": "text/plain"},
        data="device_id=esp32-01"
    )
    assert res.status_code == 415


def test_malformed_json(client):
    """POST /api/readings with malformed JSON string should return 400."""
    res = client.post(
        "/api/readings",
        headers={"X-API-Key": TEST_API_KEY, "Content-Type": "application/json"},
        data="{\"device_id\": "
    )
    assert res.status_code == 400


def test_missing_and_invalid_fields(client):
    """POST /api/readings should strictly validate fields."""
    headers = {"X-API-Key": TEST_API_KEY}

    # Missing device_id
    res = client.post("/api/readings", headers=headers, json={"object_detected": True})
    assert res.status_code == 400

    # Invalid characters in device_id
    res = client.post("/api/readings", headers=headers, json={"device_id": "bad/id!", "object_detected": True})
    assert res.status_code == 400

    # Missing object_detected
    res = client.post("/api/readings", headers=headers, json={"device_id": "esp32-01"})
    assert res.status_code == 400

    # Non-boolean object_detected (string "true")
    res = client.post("/api/readings", headers=headers, json={"device_id": "esp32-01", "object_detected": "true"})
    assert res.status_code == 400

    # Non-boolean object_detected (integer 1)
    # Note: Python bool inherits from int, but isinstance(1, bool) is False.
    res = client.post("/api/readings", headers=headers, json={"device_id": "esp32-01", "object_detected": 1})
    assert res.status_code == 400


def test_valid_inserts_both_states(client):
    """POST /api/readings should succeed for both True and False presence states."""
    headers = {"X-API-Key": TEST_API_KEY}

    # Insert True
    res1 = client.post("/api/readings", headers=headers, json={"device_id": "esp32-01", "object_detected": True})
    assert res1.status_code == 201
    d1 = res1.get_json()["data"]
    assert d1["object_detected"] is True
    assert d1["device_id"] == "esp32-01"

    # Insert False
    res2 = client.post("/api/readings", headers=headers, json={"device_id": "esp32-01", "object_detected": False})
    assert res2.status_code == 201
    d2 = res2.get_json()["data"]
    assert d2["object_detected"] is False
    assert d2["device_id"] == "esp32-01"


def test_empty_database_latest(client):
    """GET /api/latest on empty database should return 200 with data: None."""
    res = client.get("/api/latest?device_id=esp32-01")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "success"
    assert data["data"] is None
    assert "No readings recorded yet" in data["message"]


def test_latest_reading_and_device_filtering(client):
    """GET /api/latest should return the most recent reading for the requested device."""
    headers = {"X-API-Key": TEST_API_KEY}

    client.post("/api/readings", headers=headers, json={"device_id": "dev-A", "object_detected": True})
    client.post("/api/readings", headers=headers, json={"device_id": "dev-B", "object_detected": False})
    client.post("/api/readings", headers=headers, json={"device_id": "dev-A", "object_detected": False})

    # dev-A latest should be False
    res_a = client.get("/api/latest?device_id=dev-A")
    assert res_a.status_code == 200
    assert res_a.get_json()["data"]["object_detected"] is False

    # dev-B latest should be False
    res_b = client.get("/api/latest?device_id=dev-B")
    assert res_b.status_code == 200
    assert res_b.get_json()["data"]["object_detected"] is False

    # dev-C has no readings
    res_c = client.get("/api/latest?device_id=dev-C")
    assert res_c.status_code == 200
    assert res_c.get_json()["data"] is None


def test_readings_history_and_limits(client):
    """GET /api/readings should return bounded, deterministically ordered readings."""
    headers = {"X-API-Key": TEST_API_KEY}

    for i in range(10):
        client.post("/api/readings", headers=headers, json={"device_id": "esp32-01", "object_detected": (i % 2 == 0)})

    # Request limit=5
    res = client.get("/api/readings?device_id=esp32-01&limit=5")
    assert res.status_code == 200
    data = res.get_json()
    assert data["count"] == 5
    assert len(data["data"]) == 5

    # Check ordering: newest reading (highest id) first
    ids = [item["id"] for item in data["data"]]
    assert ids == sorted(ids, reverse=True)

    # Invalid limits
    assert client.get("/api/readings?device_id=esp32-01&limit=0").status_code == 400
    assert client.get("/api/readings?device_id=esp32-01&limit=201").status_code == 400
    assert client.get("/api/readings?device_id=esp32-01&limit=abc").status_code == 400


def test_unknown_api_route(client):
    """Unknown /api routes must return JSON 404, never HTML."""
    res = client.get("/api/nonexistent/endpoint")
    assert res.status_code == 404
    data = res.get_json()
    assert data["status"] == "error"
    assert "API endpoint not found" in data["message"]
