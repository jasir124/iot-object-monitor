import os
import re
import hmac
from datetime import datetime, timezone
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, make_response
from sqlalchemy import text
from sqlalchemy.orm import scoped_session, sessionmaker
from dotenv import load_dotenv

from .database import get_engine, init_db, SensorReading

# Load environment variables
load_dotenv()

# Determine paths
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

def create_app(test_config=None):
    app = Flask(
        __name__,
        static_folder=str(FRONTEND_DIST / "assets") if (FRONTEND_DIST / "assets").exists() else None,
        static_url_path="/assets"
    )

    # Configuration defaults
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024  # 16 KB max payload
    app.config["DEVICE_API_KEY"] = os.getenv("DEVICE_API_KEY", "")
    app.config["DATABASE_URL"] = os.getenv("DATABASE_URL", "sqlite:///sensor_readings.db")

    if test_config:
        app.config.update(test_config)

    # Setup database engine and session
    engine = get_engine(app.config["DATABASE_URL"])
    init_db(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Session = scoped_session(session_factory)

    @app.teardown_appcontext
    def remove_session(exception=None):
        Session.remove()

    # Regex for valid device_id
    DEVICE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-\.]{1,64}$")

    # --- API Authentication Middleware ---
    def verify_api_key(provided_key: str) -> bool:
        configured_key = app.config.get("DEVICE_API_KEY", "")
        if not configured_key or not provided_key:
            return False
        return hmac.compare_digest(provided_key.encode("utf-8"), configured_key.encode("utf-8"))

    # --- Health Check Endpoint ---
    @app.route("/health", methods=["GET"])
    def health():
        """Lightweight health check testing service and database liveness."""
        db_status = "connected"
        http_status = 200
        try:
            db_session = Session()
            db_session.execute(text("SELECT 1"))
        except Exception as e:
            db_status = "error"
            http_status = 503

        return jsonify({
            "status": "healthy" if db_status == "connected" else "degraded",
            "database": db_status,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }), http_status

    # --- Ingest Reading Endpoint ---
    @app.route("/api/readings", methods=["POST"])
    def post_reading():
        """Ingest a new timestamped sensor reading from an authorized ESP32."""
        # 1. Verify API Key
        auth_header = request.headers.get("X-API-Key", "")
        if not verify_api_key(auth_header):
            return jsonify({
                "status": "error",
                "message": "Unauthorized: Missing or invalid X-API-Key header"
            }), 401

        # 2. Verify Content-Type
        if not request.is_json:
            return jsonify({
                "status": "error",
                "message": "Unsupported Media Type: Request must be application/json"
            }), 415

        # 3. Parse JSON Body
        try:
            data = request.get_json(silent=False)
        except Exception:
            return jsonify({
                "status": "error",
                "message": "Malformed JSON payload"
            }), 400

        if not isinstance(data, dict):
            return jsonify({
                "status": "error",
                "message": "Invalid JSON: Payload must be a JSON object"
            }), 400

        # 4. Validate device_id
        device_id = data.get("device_id")
        if not device_id or not isinstance(device_id, str):
            return jsonify({
                "status": "error",
                "message": "Missing or invalid 'device_id': Must be a non-empty string"
            }), 400

        device_id = device_id.strip()
        if not DEVICE_ID_REGEX.match(device_id):
            return jsonify({
                "status": "error",
                "message": "Invalid 'device_id': Must be 1-64 alphanumeric characters, hyphens, or underscores"
            }), 400

        # 5. Validate object_detected (Strict Boolean)
        if "object_detected" not in data:
            return jsonify({
                "status": "error",
                "message": "Missing required field: 'object_detected'"
            }), 400

        object_detected = data.get("object_detected")
        if not isinstance(object_detected, bool):
            return jsonify({
                "status": "error",
                "message": "Invalid 'object_detected': Must be an explicit JSON boolean (true or false)"
            }), 400

        # 6. Insert Reading
        db_session = Session()
        try:
            reading = SensorReading(
                device_id=device_id,
                object_detected=object_detected,
                created_at=datetime.now(timezone.utc)
            )
            db_session.add(reading)
            db_session.commit()
            return jsonify({
                "status": "success",
                "data": reading.to_dict()
            }), 201
        except Exception:
            db_session.rollback()
            return jsonify({
                "status": "error",
                "message": "Database insertion failed"
            }), 500

    # --- Query Latest Reading ---
    @app.route("/api/latest", methods=["GET"])
    def get_latest():
        """Retrieve the latest reading for a given device_id."""
        device_id = request.args.get("device_id", "esp32-01").strip()
        if not DEVICE_ID_REGEX.match(device_id):
            return jsonify({
                "status": "error",
                "message": "Invalid 'device_id' parameter"
            }), 400

        db_session = Session()
        try:
            reading = (
                db_session.query(SensorReading)
                .filter(SensorReading.device_id == device_id)
                .order_by(SensorReading.created_at.desc(), SensorReading.id.desc())
                .first()
            )
            if not reading:
                return jsonify({
                    "status": "success",
                    "device_id": device_id,
                    "data": None,
                    "message": f"No readings recorded yet for device '{device_id}'"
                }), 200

            return jsonify({
                "status": "success",
                "device_id": device_id,
                "data": reading.to_dict()
            }), 200
        except Exception:
            return jsonify({
                "status": "error",
                "message": "Database query failed"
            }), 500

    # --- Query Reading History ---
    @app.route("/api/readings", methods=["GET"])
    def get_readings():
        """Retrieve recent readings for a device with bounded limit."""
        device_id = request.args.get("device_id", "esp32-01").strip()
        if not DEVICE_ID_REGEX.match(device_id):
            return jsonify({
                "status": "error",
                "message": "Invalid 'device_id' parameter"
            }), 400

        limit_param = request.args.get("limit", "50")
        try:
            limit = int(limit_param)
            if limit < 1 or limit > 200:
                raise ValueError()
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "Invalid 'limit' parameter: Must be an integer between 1 and 200"
            }), 400

        db_session = Session()
        try:
            readings = (
                db_session.query(SensorReading)
                .filter(SensorReading.device_id == device_id)
                .order_by(SensorReading.created_at.desc(), SensorReading.id.desc())
                .limit(limit)
                .all()
            )
            return jsonify({
                "status": "success",
                "device_id": device_id,
                "count": len(readings),
                "data": [r.to_dict() for r in readings]
            }), 200
        except Exception:
            return jsonify({
                "status": "error",
                "message": "Database query failed"
            }), 500

    # --- Unknown API Route Handler (JSON 404, never HTML) ---
    @app.route("/api", defaults={"subpath": ""})
    @app.route("/api/<path:subpath>")
    def api_not_found(subpath):
        return jsonify({
            "status": "error",
            "message": f"API endpoint not found: /api/{subpath}",
            "error_code": 404
        }), 404

    # --- SPA Frontend Asset and Index Serving ---
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        if not FRONTEND_DIST.exists():
            return jsonify({
                "status": "backend_ready",
                "message": "Frontend distribution not built yet. Run 'npm run build' in frontend directory."
            }), 200

        target_file = FRONTEND_DIST / path
        if path and target_file.exists() and not target_file.is_dir():
            response = make_response(send_from_directory(str(FRONTEND_DIST), path))
            # Cache hashed static assets permanently
            if "assets/" in path:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response

        # Return index.html for client-side routing
        index_file = FRONTEND_DIST / "index.html"
        if index_file.exists():
            response = make_response(send_from_directory(str(FRONTEND_DIST), "index.html"))
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response

        return "Index file missing", 404

    return app

# Application entrypoint for Gunicorn
app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
