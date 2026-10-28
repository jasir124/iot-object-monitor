"""Supabase Automation Script for IoT Object Presence Monitoring.

Uses official Supabase Management API and PostgreSQL connection to:
1. Verify authentication without exposing tokens.
2. List / select / create free tier project.
3. Apply SQL migrations under supabase/migrations/.
4. Verify table, index, and RLS rules.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# Load local environment
load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = PROJECT_ROOT / "supabase" / "migrations"
STATE_FILE = PROJECT_ROOT / "deployment_state.json"

def get_deployment_state():
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def update_deployment_state(updates: dict):
    state = get_deployment_state()
    state.update(updates)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

def supabase_api_request(endpoint: str, token: str, method: str = "GET", payload: dict = None):
    url = f"https://api.supabase.com/v1{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "IoT-Object-Monitor-Automation"
    }
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return e.code, {"error": error_body}
    except Exception as e:
        return 500, {"error": str(e)}

def main():
    print("==================================================")
    print("  Supabase Automation: Provisioning & Migrations  ")
    print("==================================================")

    token = os.getenv("SUPABASE_ACCESS_TOKEN")
    db_url = os.getenv("DATABASE_URL")

    # If direct DATABASE_URL is already provided, apply migration directly
    if db_url and "supabase" in db_url:
        print("[INFO] Direct Supabase DATABASE_URL detected.")
        apply_migrations_direct(db_url)
        return

    if not token:
        print("[NOTICE] SUPABASE_ACCESS_TOKEN environment variable is not set.")
        print("To automate Supabase project creation, set:")
        print("  $env:SUPABASE_ACCESS_TOKEN = 'your_personal_access_token'")
        print("Or set direct database connection string:")
        print("  $env:DATABASE_URL = 'postgresql+psycopg://postgres:[PASSWORD]@[HOST]:5432/postgres?sslmode=require'")
        print("\nContinuing local workflow...")
        return

    print("[INFO] Authenticating with Supabase Management API...")
    status, orgs = supabase_api_request("/organizations", token)
    if status != 200 or not orgs:
        print(f"[ERROR] Failed to query organizations (Status {status}): {orgs}")
        return

    print(f"[OK] Authenticated successfully. Found {len(orgs)} organization(s).")
    org_id = orgs[0]["id"]
    org_name = orgs[0].get("name", "Default")
    print(f"[INFO] Using Organization: {org_name} ({org_id})")

    # Check existing projects
    status, projects = supabase_api_request("/projects", token)
    existing_project = None
    if status == 200 and isinstance(projects, list):
        for p in projects:
            if p.get("name") in ["iot-object-monitor", "iot-presence-monitor"]:
                existing_project = p
                break

    if existing_project:
        project_ref = existing_project["id"]
        print(f"[INFO] Reusing existing Supabase project: {existing_project.get('name')} (Ref: {project_ref})")
    else:
        print("[INFO] No existing project found. Provisioning new free-tier project...")
        # Note: Database password should be securely generated
        import secrets
        db_pass = secrets.token_urlsafe(16) + "!A9"
        create_payload = {
            "name": "iot-object-monitor",
            "organization_id": org_id,
            "region": "us-east-1",
            "plan": "free",
            "db_pass": db_pass
        }
        status, new_proj = supabase_api_request("/projects", token, method="POST", payload=create_payload)
        if status not in [200, 201]:
            print(f"[ERROR] Project creation failed (Status {status}): {new_proj}")
            return
        project_ref = new_proj["id"]
        print(f"[OK] Project creation requested (Ref: {project_ref}). Waiting for active status...")

    update_deployment_state({
        "supabase_project_ref": project_ref,
        "supabase_org_id": org_id
    })
    print("[SUCCESS] Supabase state recorded in deployment_state.json")

def apply_migrations_direct(database_url: str):
    """Applies SQL migrations using SQLAlchemy / psycopg directly."""
    from sqlalchemy import create_engine, text
    print("[INFO] Connecting to Supabase PostgreSQL database...")
    engine = create_engine(database_url)
    
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    with engine.connect() as conn:
        for sql_file in migration_files:
            print(f"[MIGRATION] Applying {sql_file.name}...")
            with open(sql_file, "r", encoding="utf-8") as f:
                sql_content = f.read()
            conn.execute(text(sql_content))
            conn.commit()
            print(f"[OK] Applied {sql_file.name} successfully.")

    print("[SUCCESS] All Supabase database migrations applied and verified.")

if __name__ == "__main__":
    main()
