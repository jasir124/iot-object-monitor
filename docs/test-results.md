# Test & Verification Results: IoT-Based Object Presence Monitoring System

**Execution Date:** 2026-10-28  
**Environment:** Windows 10/11, Python 3.11.4, Node v24.12.0, PlatformIO Core 6.2.0  
**Test Device Identifier:** `test-verifier-99` (simulated telemetry), `esp32-01` (hardware telemetry)

---

## 1. Local Build & Static Analysis Checks

| Check Category | Command / Target | Result | Evidence / Details |
|:---|:---|:---:|:---|
| **Backend Unit Tests** | `python -m pytest backend/tests -v` | **PASS** | 11/11 tests passed in 1.07s. Verified health check, 401 on missing/bad key, 415 on invalid content type, 400 on malformed JSON, strict boolean validation, 201 on valid states, empty database handling, device filtering, history limits, and JSON 404 handler. |
| **Frontend TypeScript** | `npm run typecheck` (`tsc -b`) | **PASS** | Strict TypeScript compilation with zero errors. `noUnusedLocals` and `allowImportingTsExtensions` verified. |
| **Frontend Production Build** | `npm run build` (`vite build`) | **PASS** | 2568 modules transformed. Generated `dist/index.html` (1.03 kB), CSS (15.87 kB), and bundled JS (567.83 kB). |
| **Single-Origin Asset Serving** | Flask `GET /` & `GET /assets/*` | **PASS** | Verified Flask correctly serves React SPA index with `no-cache` and hashed assets with `immutable`. |

---

## 2. API Security & Functional Verification

Executed using automated script `scripts/verify_deployment.py`:

| Test ID | Endpoint & Method | Input Condition | Expected Status | Actual Status | Verification Result |
|:---|:---|:---|:---:|:---:|:---:|
| **SEC-01** | `POST /api/readings` | Missing `X-API-Key` | 401 Unauthorized | 401 | **PASS** |
| **SEC-02** | `POST /api/readings` | Invalid `X-API-Key: bad-key` | 401 Unauthorized | 401 | **PASS** |
| **FUNC-01** | `GET /health` | Liveness probe | 200 Healthy | 200 | **PASS** (`{"database":"connected","status":"healthy"}`) |
| **FUNC-02** | `POST /api/readings` | Valid key, `object_detected: true` | 201 Created | 201 | **PASS** (Record created with ISO UTC timestamp) |
| **FUNC-03** | `GET /api/latest` | `device_id=test-verifier-99` | 200 OK | 200 | **PASS** (Returned `object_detected: true`) |
| **FUNC-04** | `GET /api/readings` | `device_id=test-verifier-99&limit=50` | 200 OK | 200 | **PASS** (Correct count and reverse chronological order) |
| **CLEAN-01**| Database Cleanup | Automated deletion of test rows | Complete | Complete | **PASS** (Zero test residue in persistent storage) |

---

## 3. UI/UX & Browser Integration Verification

Tested in dashboard runtime:
- **Presence State Transitions:** Verified visual indicators switch cleanly between `OBJECT PRESENT` (emerald), `NO OBJECT` (slate), and `UNKNOWN` (amber).
- **Freshness Stale Detection:** Tested elapsed timer. Alert banner triggers when reading age exceeds 30 seconds.
- **Connection Interruption Resilience:** Disconnecting the network preserves the last known observation state without erroneously resetting the status to `NO OBJECT`.
- **Observation Timeline Chart:** Step-area curve accurately displays discrete sampled events with tooltips.

---

## 4. Physical Hardware Verification Status

- **Board Connection:** ESP32 board detected via Silicon Labs CP2102 USB to UART bridge on port **`COM22`** (Driver Status: OK).
- **Sensor Circuit:**
  - Pin OUT wired to **GPIO 27**
  - Pin VCC wired to **3V3**
  - Pin GND wired to **GND**
- **Firmware Compilation:** `firmware/src/main.cpp` configured with 100ms debounce, 10s heartbeat, and non-blocking Wi-Fi state machine.
- **Upload Command:**
  ```powershell
  & "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -d firmware -t upload --upload-port COM22
  ```
