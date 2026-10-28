#ifndef CONFIG_H
#define CONFIG_H

// ==============================================================================
// ESP32 IoT Object Presence Monitor Configuration Template
// Copy this file to "config.h" and enter your local network credentials.
// NOTE: "config.h" is ignored by git to protect credentials.
// ==============================================================================

// Wi-Fi Network Credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Cloud API Base URL (Render deployment or local test server)
// Examples:
//   Local network: "http://192.168.1.50:8000"
//   Render HTTPS:  "https://your-service-name.onrender.com"
#define API_BASE_URL "https://your-service-name.onrender.com"

// Device Identification
#define DEVICE_ID "esp32-01"

// Device Authentication Key (must match DEVICE_API_KEY in backend environment)
#define DEVICE_API_KEY "YOUR_DEVICE_API_KEY_HERE"

// Hardware Pin Configuration
// Confirmed: OUT -> GPIO27, VCC -> 3V3, GND -> GND
#define IR_SENSOR_PIN 27

// Sensor Polarity Configuration
// Set to true if LOW = Object Present (standard FC-51 reflection)
// Set to false if HIGH = Object Present (or if sensor light stays ON when cleared)
#define SENSOR_ACTIVE_LOW false

// Timing Configuration (in milliseconds)
#define DEBOUNCE_INTERVAL_MS 100     // Minimum stable signal duration to register a state change
#define HEARTBEAT_INTERVAL_MS 10000  // Periodic transmission interval even if state is unchanged (10 seconds)
#define HTTP_TIMEOUT_MS 10000        // HTTP timeout (accommodates Render free-tier cold-starts)

// Render / ISRG Root X1 CA Certificate (for secure HTTPS verification)
// Valid until 2035. Eliminates insecure TLS.
static const char* RENDER_CA_CERT = \
"-----BEGIN CERTIFICATE-----\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n" \
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n" \
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n" \
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n" \
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n" \
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\n" \
"h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\n" \
"0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK/62gvQUJU\n" \
"4N4MrNTbVI56PDvRM5BlUMDPSdvMAdOYqdNPWVwpIB8+6LCI8tBVCCTV26O576Gf\n" \
"ucSD6MYnpJNfvBaFpdNZIE5xwIiReSwts/528Mh309KEUncUA9euhVlKwUAz7hBm\n" \
"h01ZsC6FvkEV57ZUZZf64IAgkYNOPOwp+vd5o52LD83wf1201Zs14BSs6Ztkevuv\n" \
"hKzxGFoBQPfAb+CRvP99unnxyq2FoLB9UVCZfpKsbd6EasInebHYJpvMtFs50Sm4\n" \
"ATEYWG5t8fHY23xp8S9CL85DGIAGnWtgFbg+EwRNd793VC077P9al9b/xPrt3ZLET\n" \
"sZk84Ahv8VDfYNePXKc745hzsLG5+GlhLhfWxEdMAZaU29WDqxptW93Txzzm++zrx\n" \
"dfShSpAkGNdat2njU4Kf8HWGEvVRYPEB47ynKBimWhWpE77/dQZBN35hpOWBKygEb\n" \
"G6Vb8C/kNPGFa5GEUr++30Vz9L32uKMcTX6UHN53rfHNn266htziqnMxXD3zyxuh\n" \
"46v5C30ms6r45nsvbi42OzAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMB\n" \
"Af8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkqhkiG\n" \
"9w0BAQsFAAOCAgEAVR9YqbyhurdtUSnn8KtMAAkV++rdVihr5b+/qBQIPmTFjmZc\n" \
"3VY7sQBAtAbRV8Nvd4XCoNTLCtEcMXOoYzWCn59d97njwKjVAbacgiY5Tey3zkaU\n" \
"R64IWOK8GYZK3THpF5628TCU95z802t44487zefh7/VN3lunEvTWvuO+OIaFAPzL\n" \
"nZ9L2aeFOcNmlIE9117377qC+ceZiG3H25A8qsaCLExekwSFC9T26FVlQCv09vvc\n" \
"QLM++rvhCWZxa4UBvxVNycOM22fU27OxLnd8b24dVShZqNqbvYAt82K9G82Qyd4\n" \
"28iY++aX543kO424/fK6CT0D21gkv00h45h73988457788448833924788329\n" \
"-----END CERTIFICATE-----\n";

#endif // CONFIG_H
