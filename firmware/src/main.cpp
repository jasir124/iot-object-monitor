#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

#if __has_include("config.h")
  #include "config.h"
#else
  #include "config.example.h"
#endif

// ==============================================================================
// State Machine & Telemetry Variables
// ==============================================================================

// Debouncing variables
int lastRawReading = -1;
unsigned long lastRawChangeTime = 0;
bool currentStableDetection = false;
bool lastTransmittedDetection = false;
bool hasTransmittedFirstReading = false;

// Transmission timing
unsigned long lastHeartbeatTime = 0;
unsigned long lastTransmissionAttempt = 0;
const unsigned long MIN_RETRY_INTERVAL_MS = 3000;
bool pendingTransmission = false;
int consecutiveFailures = 0;

// ==============================================================================
// Helper: Sample the digital IR sensor with active-low/high polarity
// ==============================================================================
bool readSensorState() {
  int raw = digitalRead(IR_SENSOR_PIN);
  if (SENSOR_ACTIVE_LOW) {
    return (raw == LOW); // LOW indicates obstacle reflection
  } else {
    return (raw == HIGH);
  }
}

// ==============================================================================
// Helper: Ensure Wi-Fi is connected with non-blocking checks
// ==============================================================================
void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  static unsigned long lastConnectAttempt = 0;
  unsigned long now = millis();

  // Retry Wi-Fi connection every 5 seconds without blocking loop()
  if (now - lastConnectAttempt >= 5000) {
    lastConnectAttempt = now;
    Serial.print(F("[WiFi] Connecting to SSID: "));
    Serial.println(WIFI_SSID);
    WiFi.disconnect();
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

// ==============================================================================
// Helper: Send JSON Telemetry to Cloud API Endpoint
// ==============================================================================
bool transmitReading(bool detected) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP] Skipped transmission: Wi-Fi not connected"));
    return false;
  }

  String url = String(API_BASE_URL) + "/api/readings";
  Serial.print(F("[HTTP] POST "));
  Serial.println(url);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  bool isHttps = url.startsWith("https://");
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  if (isHttps) {
#ifdef RENDER_CA_CERT
    secureClient.setCACert(RENDER_CA_CERT);
#else
    secureClient.setInsecure(); // Fallback only if root CA not provided
#endif
    http.begin(secureClient, url);
  } else {
    http.begin(plainClient, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  // Construct JSON Payload
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["object_detected"] = detected;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.print(F("[HTTP] Sending: "));
  Serial.println(requestBody);

  int httpCode = http.POST(requestBody);
  unsigned long durationMs = millis() - lastTransmissionAttempt;

  bool success = false;
  if (httpCode > 0) {
    Serial.printf("[HTTP] Response Code: %d (took %lu ms)\n", httpCode, durationMs);
    if (httpCode == 200 || httpCode == 201) {
      success = true;
      String response = http.getString();
      Serial.printf("[HTTP] Success response: %s\n", response.c_str());
    } else {
      Serial.printf("[HTTP] Server responded with error status: %d\n", httpCode);
    }
  } else {
    Serial.printf("[HTTP] POST failed: %s (Check Render cold-start / connection)\n",
                  http.errorToString(httpCode).c_str());
  }

  http.end();
  return success;
}

// ==============================================================================
// Setup Routine
// ==============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("\n========================================================"));
  Serial.println(F("  IoT Object Presence & Inventory Monitoring System     "));
  Serial.println(F("  Target Hardware: ESP32 + Digital IR Sensor (GPIO 27)  "));
  Serial.println(F("========================================================"));

  // Configure digital IR proximity sensor pin
  pinMode(IR_SENSOR_PIN, INPUT);

  // Initial sensor state
  lastRawReading = digitalRead(IR_SENSOR_PIN);
  currentStableDetection = readSensorState();
  lastTransmittedDetection = currentStableDetection;

  Serial.printf("[HW] Sensor initialized on GPIO %d (Active %s)\n",
                IR_SENSOR_PIN, SENSOR_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.printf("[HW] Initial State: %s\n",
                currentStableDetection ? "OBJECT PRESENT" : "NO OBJECT");

  // Begin Wi-Fi connection
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print(F("[WiFi] Initializing connection to "));
  Serial.println(WIFI_SSID);

  // Synchronize system time via SNTP for valid TLS certificates
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

// ==============================================================================
// Main Loop (Non-blocking Debouncing + Telemetry)
// ==============================================================================
void loop() {
  unsigned long now = millis();

  // 1. Maintain Wi-Fi connectivity
  ensureWiFiConnected();

  // 2. Sample IR sensor with ~100ms stable debounce logic
  int rawState = digitalRead(IR_SENSOR_PIN);
  if (rawState != lastRawReading) {
    lastRawReading = rawState;
    lastRawChangeTime = now;
  }

  if ((now - lastRawChangeTime) >= DEBOUNCE_INTERVAL_MS) {
    bool evaluatedState = (SENSOR_ACTIVE_LOW ? (rawState == LOW) : (rawState == HIGH));
    if (evaluatedState != currentStableDetection) {
      currentStableDetection = evaluatedState;
      Serial.printf("[EVENT] Stable state changed -> %s\n",
                    currentStableDetection ? "OBJECT PRESENT" : "NO OBJECT");
      // Immediate transmission requested on state transition
      pendingTransmission = true;
    }
  }

  // 3. Evaluate Heartbeat interval (every 10s)
  if (!pendingTransmission && (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS)) {
    Serial.println(F("[HEARTBEAT] 10s interval reached, queuing transmission"));
    pendingTransmission = true;
  }

  // 4. Handle Pending Transmission with bounded backoff
  if (pendingTransmission || !hasTransmittedFirstReading) {
    if (WiFi.status() == WL_CONNECTED) {
      if (now - lastTransmissionAttempt >= MIN_RETRY_INTERVAL_MS) {
        lastTransmissionAttempt = now;
        bool ok = transmitReading(currentStableDetection);
        if (ok) {
          lastTransmittedDetection = currentStableDetection;
          lastHeartbeatTime = now;
          pendingTransmission = false;
          hasTransmittedFirstReading = true;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          Serial.printf("[WARN] Transmission attempt failed (%d consecutive failures)\n",
                        consecutiveFailures);
        }
      }
    }
  }

  // Responsive loop delay
  delay(10);
}
