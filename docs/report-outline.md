# College Assignment Report Outline: IoT-Based Object Presence and Inventory Monitoring System

## 1. Title and Abstract
- **Project Title:** IoT-Based Object Presence and Inventory Monitoring System
- **Context:** Embedded IoT Assignment / Laboratory Project
- **Scope Clarification:** Single-position object presence monitoring using a digital IR proximity sensor. Discrete sampled observations; not an automated continuous inventory counter.
- **Abstract Summary:** Overview of end-to-end architecture from ESP32 edge telemetry to Supabase PostgreSQL and Render-hosted React + Flask web services.

---

## 2. Hardware Components & Circuit Design
### 2.1 Component Specifications
- **Microcontroller:** ESP32-WROOM-32 Development Board (Xtensa dual-core, 3.3V logic)
- **Sensor:** Active digital Infrared (IR) proximity module (TCRT5000 / FC-51 comparator circuit)
- **Power Supply:** 5V USB regulated to 3.3V onboard LDO

### 2.2 Pin Wiring Schematic
| Module Pin | ESP32 Pin | Function | Notes |
|:---|:---|:---|:---|
| **VCC** | **3V3** | Power Input | Operates at 3.3V logic to protect ESP32 GPIOs |
| **GND** | **GND** | Ground Reference | Common ground |
| **OUT** | **GPIO 27** | Digital Telemetry | Configured as `INPUT` |

### 2.3 Sensor Polarity & Calibration
- Standard active-low behavior (`SENSOR_ACTIVE_LOW = true`): IR reflection pulls comparator output to `LOW`.
- Sensitivity potentiometer calibration procedure to eliminate ambient light interference.

---

## 3. Firmware Implementation (PlatformIO / Arduino C++)
- **Debounce Logic:** ~100ms stable signal verification to reject optical jitter and mechanical flutter.
- **State Machine:**
  - Immediate transmission upon stable state change (`OBJECT PRESENT` <-> `NO OBJECT`).
  - Periodic heartbeat telemetry every 10 seconds.
- **Network Resilience:**
  - Non-blocking Wi-Fi reconnection state machine.
  - 10-second HTTP timeout accommodating Render free-tier cold starts.
  - Exponential backoff for transient failures.
- **Security:**
  - Pre-shared `X-API-Key` authentication.
  - Zero credentials in Serial logs.
  - Local configuration stored in ignored `config.h`.

---

## 4. Backend Architecture & REST API (Flask + Gunicorn)
- **Framework:** Python Flask with SQLAlchemy ORM and `psycopg` PostgreSQL driver.
- **Endpoints:**
  - `POST /api/readings`: Protected via constant-time `hmac.compare_digest` with `X-API-Key`. Strict payload validation.
  - `GET /api/latest?device_id=esp32-01`: Most recent timestamped reading.
  - `GET /api/readings?device_id=esp32-01&limit=50`: Bounded history query (1-200 limit).
  - `GET /health`: Liveness probe testing database connectivity.
  - Unknown `/api/*` routes return structured JSON 404.
- **Static Asset Serving:** Single-origin architecture serving compiled React assets directly from Gunicorn.

---

## 5. Database Design & Security (Supabase PostgreSQL)
### 5.1 Schema Design
- Table: `sensor_readings`
  - `id`: BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  - `device_id`: VARCHAR(64) NOT NULL
  - `object_detected`: BOOLEAN NOT NULL
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
- Composite Index: `(device_id, created_at DESC, id DESC)` for fast windowed telemetry retrieval.

### 5.2 Security & Permissions
- Row Level Security (RLS) enabled.
- Anonymous and public PostgREST access strictly revoked.
- Backend communicates via dedicated connection string with SSL encryption.

---

## 6. Frontend Dashboard (React + Vite + TypeScript)
- **Styling:** Tailwind CSS with dark slate theme, accessible contrast, and Lucide icons.
- **Telemetry Visualizations:**
  - Status Hero: `OBJECT PRESENT` (emerald), `NO OBJECT` (slate), `UNKNOWN` (amber).
  - Freshness Indicator: `LIVE` (<15s), `NORMAL` (15-30s), `STALE` (>30s alert banner).
  - Observation Timeline: Recharts step-area visualization of sampled presence states.
  - Derived Summary Metrics: Window count, present count, absent count, presence ratio.
  - Raw Telemetry Table: Detailed history with UTC and local timezone representations.
- **Live Updating:** Polling every 2 seconds using `AbortController` without overlapping requests. Retains last known state on connection failure without misreporting as absent.

---

## 7. Containerization & Cloud Deployment
- **Containerization:** Multi-stage Dockerfile (Node Alpine builder -> Python slim runtime).
- **Hosting:** Render free-tier Docker Web Service.
- **Inactivity & Cold Starts:** Behavior of Render free-tier spinning down after 15 minutes of inactivity and mitigation strategies.

---

## 8. Verification & Test Results
- Automated Pytest suite (11 unit tests covering validation, auth, limits, errors).
- TypeScript strict compiler check (`tsc -b`).
- End-to-end deployed API tests with simulated test device `test-verifier-99`.
- Automated test record database cleanup.

---

## 9. Report Screenshot Placeholders
- `[Screenshot 1: Hardware breadboard setup with ESP32 and IR sensor]`
- `[Screenshot 2: Serial Monitor output showing 100ms debounce and HTTP POST]`
- `[Screenshot 3: React Dashboard displaying OBJECT PRESENT state]`
- `[Screenshot 4: React Dashboard displaying NO OBJECT state]`
- `[Screenshot 5: React Dashboard showing STALE banner (>30s without readings)]`
- `[Screenshot 6: Supabase SQL Table Editor showing sensor_readings records]`
- `[Screenshot 7: Render Web Service deployment logs]`

---

## 10. Observations, Limitations, and Conclusion
- **Observations:** Responsive latency (~150ms) between physical obstacle placement and dashboard reflection.
- **Limitations:** Single fixed location; cannot detect item count or identity; optical sensor subject to surface reflectivity variance.
- **Conclusion:** Summary of project outcomes satisfying college embedded IoT curriculum criteria.
