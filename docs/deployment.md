# Cloud Deployment Guide: Supabase & Render

This guide describes how to provision the cloud database on Supabase and deploy the unified Docker web service to Render.

---

## 1. Prerequisites & Access Keys

The deployment relies on free-tier resources across GitHub, Supabase, and Render.

| Provider | Purpose | Authentication / Credential | Scope / Type |
|:---|:---|:---|:---|
| **GitHub** | Source Code Hosting | Authenticated `gh` CLI | `repo` scope |
| **Supabase** | Managed PostgreSQL Storage | `SUPABASE_ACCESS_TOKEN` | Personal Access Token (Management API) |
| **Supabase DB** | Direct Database Connections | `DATABASE_URL` | PostgreSQL connection string with password |
| **Render** | Docker Container Hosting | `RENDER_API_KEY` | Render API Key |

---

## 2. GitHub Automation

Push the workspace to a project-specific repository:
```powershell
# 1. Initialize git and stage tracked files (secrets are excluded by .gitignore)
git add .
git commit -m "feat: complete IoT object presence monitoring system"

# 2. Create remote repository using gh CLI (private or public)
gh repo create iot-object-monitor --public --source=. --remote=origin --push
```

---

## 3. Supabase Database Setup

### Option A: Automated via Management API
Set your Supabase access token in PowerShell:
```powershell
$env:SUPABASE_ACCESS_TOKEN = "your_supabase_personal_access_token"
python scripts/setup_supabase.py
```

### Option B: Manual via Supabase Dashboard
1. Go to [database.new](https://database.new) and create a free project named `iot-object-monitor`.
2. In the **SQL Editor**, open and execute [`supabase/migrations/20261028000001_create_sensor_readings.sql`](../supabase/migrations/20261028000001_create_sensor_readings.sql).
3. Navigate to **Project Settings &rarr; Database &rarr; Connection string &rarr; URI**.
4. Copy the connection URI:
   ```text
   postgresql+psycopg://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
   ```

---

## 4. Render Web Service Deployment

### Option A: Automated via Render API
```powershell
$env:RENDER_API_KEY = "your_render_api_key"
$env:DATABASE_URL = "your_supabase_connection_string"
python scripts/deploy_render.py
```

### Option B: Deploying via Blueprint (`render.yaml`)
1. In your [Render Dashboard](https://dashboard.render.com), click **New + &rarr; Blueprint**.
2. Connect your `iot-object-monitor` GitHub repository.
3. Render reads [`render.yaml`](../render.yaml) automatically and provisions a Docker Web Service on the free plan.
4. Under **Environment Variables**, fill in the two un-synced variables:
   - `DATABASE_URL`: Your Supabase connection string.
   - `DEVICE_API_KEY`: The generated 48-character device key (e.g., `db4315a84d3dd4d12963367ea830463b60056853df83df49`).
5. Click **Apply Blueprint**.

---

## 5. Deployed Application Verification

Once Render finishes building the Docker container and reports **Live**, run:
```powershell
$env:DEPLOYED_URL = "https://your-service.onrender.com"
python scripts/verify_deployment.py
```

The script verifies:
- `/health` endpoint response
- Public dashboard HTML serving
- Rejection of unauthorized POST requests (401)
- Simulated telemetry ingestion and retrieval
- Database cleanup of test rows

---

## 6. Free-Tier Behavior & Maintenance

### Render Inactivity Sleep:
- Render free-tier web services spin down after 15 minutes of inactivity.
- The first request after sleep initiates a **cold-start** (~30-50 seconds).
- The ESP32 firmware includes a **10,000ms HTTP timeout** and automatic retry backoff to survive cold starts cleanly.
- Before presenting in college demos, open the dashboard in a browser 1 minute in advance to warm up the container.

### Supabase Pausing:
- Supabase free databases pause after 1 week of inactivity. Sending regular telemetry from the ESP32 keeps the database active.
