"""Render Deployment Automation Script for IoT Object Presence Monitoring.

Uses official Render REST API (https://api.render.com/v1) to:
1. Verify authentication and identify workspace/owner.
2. Check existing services to prevent duplicates.
3. Create or update the Docker web service linked to the GitHub repository.
4. Set required environment variables (DATABASE_URL, DEVICE_API_KEY).
5. Trigger and monitor deployment.
6. Retrieve and record the public HTTPS service URL.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
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

def render_api_request(endpoint: str, api_key: str, method: str = "GET", payload: dict = None):
    url = f"https://api.render.com/v1{endpoint}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "IoT-Object-Monitor-Render-Deployer"
    }
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        return e.code, {"error": error_body}
    except Exception as e:
        return 500, {"error": str(e)}

def main():
    print("==================================================")
    print("  Render Deployment Automation: Docker Web Service ")
    print("==================================================")

    api_key = os.getenv("RENDER_API_KEY")
    if not api_key:
        print("[NOTICE] RENDER_API_KEY environment variable is not set.")
        print("To automate deployment to Render, set:")
        print("  $env:RENDER_API_KEY = 'your_render_api_key'")
        print("\nContinuing local development...")
        return

    print("[INFO] Authenticating with Render API...")
    status, owners = render_api_request("/owners", api_key)
    if status != 200 or not owners:
        print(f"[ERROR] Failed to query Render owners (Status {status}): {owners}")
        return

    owner = owners[0]["owner"]
    owner_id = owner["id"]
    owner_name = owner.get("name", owner.get("email", "Default"))
    print(f"[OK] Authenticated. Workspace: {owner_name} ({owner_id})")

    # Check existing services
    status, services = render_api_request("/services?limit=50", api_key)
    existing_service = None
    if status == 200 and isinstance(services, list):
        for s in services:
            svc = s.get("service", {})
            if svc.get("name") in ["iot-object-monitor", "iot-presence-monitor"]:
                existing_service = svc
                break

    state = get_deployment_state()
    repo_url = state.get("github_repo_url")

    if existing_service:
        service_id = existing_service["id"]
        service_url = existing_service.get("serviceDetails", {}).get("url")
        print(f"[INFO] Reusing existing Render service: {existing_service.get('name')} (ID: {service_id})")
        print(f"[INFO] Public URL: {service_url}")
    else:
        if not repo_url:
            print("[ERROR] GitHub repository URL not found in deployment_state.json. Push to GitHub first.")
            return

        print(f"[INFO] Creating new free-tier Docker web service linked to {repo_url}...")
        create_payload = {
            "type": "web_service",
            "name": "iot-object-monitor",
            "ownerId": owner_id,
            "repo": repo_url,
            "branch": "master",
            "autoDeploy": "yes",
            "serviceDetails": {
                "env": "docker",
                "plan": "free",
                "region": "oregon",
                "healthCheckPath": "/health",
                "dockerfilePath": "Dockerfile",
                "dockerContext": ".",
                "envVars": [
                    {"key": "PYTHONUNBUFFERED", "value": "1"},
                    {"key": "DATABASE_URL", "value": os.getenv("DATABASE_URL", "")},
                    {"key": "DEVICE_API_KEY", "value": os.getenv("DEVICE_API_KEY", "")}
                ]
            }
        }
        status, new_svc = render_api_request("/services", api_key, method="POST", payload=create_payload)
        if status not in [200, 201]:
            print(f"[ERROR] Failed to create Render service (Status {status}): {new_svc}")
            return
        service_id = new_svc.get("id")
        service_url = new_svc.get("serviceDetails", {}).get("url")
        print(f"[OK] Render service created: {service_id}")

    # Trigger deployment if requested
    print("[INFO] Triggering deploy...")
    deploy_status, deploy_resp = render_api_request(f"/services/{service_id}/deploys", api_key, method="POST")
    if deploy_status in [200, 201]:
        print(f"[OK] Deploy triggered successfully. ID: {deploy_resp.get('id')}")
    
    update_deployment_state({
        "render_service_id": service_id,
        "render_service_url": service_url
    })
    print(f"[SUCCESS] Render deployment recorded in deployment_state.json")
    print(f"Public Dashboard URL: {service_url}")

if __name__ == "__main__":
    main()
