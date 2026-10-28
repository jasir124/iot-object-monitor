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
// State Variables
// ==============================================================================
int lastRawReading = -1;
unsigned long lastRawChangeTime = 0;
bool currentStableDetection = false;
bool lastTransmittedDetection = false;
bool hasTransmittedFirstReading = false;
bool timeSynchronized = false;

unsigned long lastHeartbeatTime = 0;
unsigned long lastTransmissionAttempt = 0;
const unsigned long MIN_RETRY_INTERVAL_MS = 3000;
bool pendingTransmission = false;
int consecutiveFailures = 0;

// ==============================================================================
// Helper: Read IR Sensor with Configured Polarity
// ==============================================================================
bool readSensorState() {
  int raw = digitalRead(IR_SENSOR_PIN);
  return (SENSOR_ACTIVE_LOW ? (raw == LOW) : (raw == HIGH));
}

static WiFiClientSecure secureClient;
static bool secureClientInitialized = false;

// ==============================================================================
// Helper: Transmit Telemetry over HTTPS
// ==============================================================================
bool transmitReading(bool detected) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP] Skipped: Wi-Fi not connected"));
    return false;
  }

  if (!secureClientInitialized) {
    secureClient.setInsecure(); // Accepts modern TLS certificates
    secureClientInitialized = true;
  }

  String url = String(API_BASE_URL) + "/api/readings";
  Serial.print(F("[HTTP] POST "));
  Serial.println(url);

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);

  if (!http.begin(secureClient, url)) {
    Serial.println(F("[HTTP] http.begin failed"));
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["object_detected"] = detected;

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.print(F("[HTTP] Payload: "));
  Serial.println(requestBody);

  int httpCode = http.POST(requestBody);
  bool success = false;

  if (httpCode > 0) {
    Serial.printf("[HTTP] Code: %d\n", httpCode);
    if (httpCode == 200 || httpCode == 201) {
      success = true;
      String response = http.getString();
      Serial.printf("[HTTP] Response: %s\n", response.c_str());
    } else {
      Serial.printf("[HTTP] Server returned error: %d\n", httpCode);
    }
  } else {
    Serial.printf("[HTTP] Failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
  secureClient.stop();
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

  pinMode(IR_SENSOR_PIN, INPUT);

  lastRawReading = digitalRead(IR_SENSOR_PIN);
  currentStableDetection = readSensorState();
  lastTransmittedDetection = currentStableDetection;

  Serial.printf("[HW] Sensor on GPIO %d (Active %s)\n",
                IR_SENSOR_PIN, SENSOR_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.printf("[HW] Initial State: %s\n",
                currentStableDetection ? "OBJECT PRESENT" : "NO OBJECT");

  // Initialize Wi-Fi in Station mode
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Connecting to: %s\n", WIFI_SSID);
}

// ==============================================================================
// Main Loop
// ==============================================================================
void loop() {
  unsigned long now = millis();

  // 1. Monitor Wi-Fi connection state
  static bool wasConnected = false;
  bool isConnected = (WiFi.status() == WL_CONNECTED);

  if (isConnected && !wasConnected) {
    wasConnected = true;
    Serial.printf("[WiFi] Connected! IP: %s | RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    if (!timeSynchronized) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      timeSynchronized = true;
    }
  } else if (!isConnected && wasConnected) {
    wasConnected = false;
    Serial.println(F("[WiFi] Connection lost, reconnecting..."));
  }

  // 2. Debounce IR sensor reading (~100ms stable debounce)
  int rawState = digitalRead(IR_SENSOR_PIN);
  if (rawState != lastRawReading) {
    lastRawReading = rawState;
    lastRawChangeTime = now;
  }

  if ((now - lastRawChangeTime) >= DEBOUNCE_INTERVAL_MS) {
    bool evaluated = (SENSOR_ACTIVE_LOW ? (rawState == LOW) : (rawState == HIGH));
    if (evaluated != currentStableDetection) {
      currentStableDetection = evaluated;
      Serial.printf("[EVENT] Sensor state -> %s\n",
                    currentStableDetection ? "OBJECT PRESENT" : "NO OBJECT");
      pendingTransmission = true;
    }
  }

  // 3. Heartbeat every 10 seconds
  if (!pendingTransmission && (now - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS)) {
    Serial.println(F("[HEARTBEAT] 10s timer, queuing update"));
    pendingTransmission = true;
  }

  // 4. Send telemetry when connected
  if (pendingTransmission || !hasTransmittedFirstReading) {
    if (isConnected) {
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
          Serial.printf("[WARN] Attempt failed (%d consecutive failures)\n",
                        consecutiveFailures);
        }
      }
    }
  }

  delay(10);
}
