import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  EyeOff,
  HelpCircle,
  Layers,
  Radio,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  SensorReading,
  PresenceState,
  FreshnessState,
  ApiConnectionState,
  LatestApiResponse,
  HistoryApiResponse,
  HealthApiResponse,
} from "./types";

export function App() {
  const [deviceId, setDeviceId] = useState<string>("esp32-01");
  const [selectedLimit, setSelectedLimit] = useState<number>(50);

  // Data states
  const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
  const [history, setHistory] = useState<SensorReading[]>([]);
  const [healthStatus, setHealthStatus] = useState<HealthApiResponse | null>(null);

  // UI / Status states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [apiConnection, setApiConnection] = useState<ApiConnectionState>("DISCONNECTED");
  const [apiErrorMessage, setApiErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Active polling guard
  const isPollingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Update second timer for live reading age calculation
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Calculate age of the latest reading in seconds
  const calculateAgeSeconds = (timestamp?: string | null): number | null => {
    if (!timestamp) return null;
    const readingTime = new Date(timestamp).getTime();
    const diffMs = currentTime.getTime() - readingTime;
    return Math.max(0, Math.floor(diffMs / 1000));
  };

  const readingAgeSec = calculateAgeSeconds(latestReading?.created_at);

  // Determine freshness state
  let freshnessState: FreshnessState = "UNKNOWN";
  if (readingAgeSec !== null) {
    if (readingAgeSec < 15) {
      freshnessState = "LIVE";
    } else if (readingAgeSec <= 30) {
      freshnessState = "NORMAL";
    } else {
      freshnessState = "STALE";
    }
  }

  // Determine presence state
  const presenceState: PresenceState =
    latestReading === null
      ? "UNKNOWN"
      : latestReading.object_detected
      ? "PRESENT"
      : "ABSENT";

  // Data fetching logic with AbortController and non-overlapping execution
  const fetchData = useCallback(
    async (isManualTrigger = false) => {
      if (isPollingRef.current && !isManualTrigger) return;
      isPollingRef.current = true;

      if (isManualTrigger) {
        setIsRefreshing(true);
      }

      // Abort previous in-flight requests if manual refresh
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Fetch latest reading, history, and health in parallel
        const [latestRes, historyRes, healthRes] = await Promise.all([
          fetch(`/api/latest?device_id=${encodeURIComponent(deviceId)}`, {
            signal: controller.signal,
          }),
          fetch(
            `/api/readings?device_id=${encodeURIComponent(deviceId)}&limit=${selectedLimit}`,
            { signal: controller.signal }
          ),
          fetch("/health", { signal: controller.signal }),
        ]);

        if (latestRes.ok && historyRes.ok) {
          const latestJson: LatestApiResponse = await latestRes.json();
          const historyJson: HistoryApiResponse = await historyRes.json();

          if (latestJson.status === "success") {
            setLatestReading(latestJson.data);
          }
          if (historyJson.status === "success") {
            setHistory(historyJson.data || []);
          }

          setApiConnection("CONNECTED");
          setApiErrorMessage(null);
        } else {
          setApiConnection("DEGRADED");
          setApiErrorMessage("API returned non-200 status code");
        }

        if (healthRes.ok) {
          const healthJson: HealthApiResponse = await healthRes.json();
          setHealthStatus(healthJson);
        }
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          // Retain last known reading; do not convert failure to NO OBJECT!
          setApiConnection("DISCONNECTED");
          setApiErrorMessage("Connection to API failed (cold-start or network interruption)");
        }
      } finally {
        isPollingRef.current = false;
        setIsLoading(false);
        if (isManualTrigger) {
          setIsRefreshing(false);
        }
      }
    },
    [deviceId, selectedLimit]
  );

  // Polling loop: every 2000ms
  useEffect(() => {
    fetchData(); // initial fetch
    const interval = setInterval(() => {
      fetchData(false);
    }, 2000);

    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  // Derived metrics from loaded history
  const totalLoaded = history.length;
  const presentCount = history.filter((r) => r.object_detected).length;
  const absentCount = totalLoaded - presentCount;
  const presenceRatio =
    totalLoaded > 0 ? Math.round((presentCount / totalLoaded) * 100) : 0;

  // Chart data preparation (chronological order for chart: oldest to newest)
  const chartData = [...history]
    .reverse()
    .map((item) => {
      const d = new Date(item.created_at);
      return {
        time: d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        timestamp: d.toISOString(),
        val: item.object_detected ? 1 : 0,
        status: item.object_detected ? "Present" : "Absent",
      };
    });

  // Format local timestamp nicely
  const formatLocalTime = (isoString?: string | null): string => {
    if (!isoString) return "Never";
    const d = new Date(isoString);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()} (${
      Intl.DateTimeFormat().resolvedOptions().timeZone
    })`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 flex flex-col justify-between">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Box className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  IoT Object Presence & Inventory Monitor
                </h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                  Single-position IR proximity monitoring with ESP32 & Supabase.
                  <span className="text-slate-500 ml-1">
                    (Sampled presence observations; not an automated count).
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            {/* API Connection Indicator */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                apiConnection === "CONNECTED"
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                  : apiConnection === "DEGRADED"
                  ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
                  : "bg-rose-950/40 border-rose-800/60 text-rose-300"
              }`}
            >
              {apiConnection === "CONNECTED" ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span>API Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                  <span>{apiConnection === "DEGRADED" ? "Degraded" : "Offline / Cold Start"}</span>
                </>
              )}
            </div>

            {/* Manual Refresh Button */}
            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-xs font-medium text-slate-200 transition-all cursor-pointer disabled:opacity-60"
              title="Manually trigger immediate refresh"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* Stale Data Warning Banner */}
        {freshnessState === "STALE" && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm animate-pulse">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400" />
            <div>
              <span className="font-semibold">Device Stream Stale:</span> No updates received for{" "}
              <strong>{readingAgeSec} seconds</strong> (&gt;30s threshold). Ensure the ESP32 is
              powered on and connected to Wi-Fi.
            </div>
          </div>
        )}

        {/* API Error Notice Banner (when in trouble, but previous data retained) */}
        {apiErrorMessage && apiConnection !== "CONNECTED" && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{apiErrorMessage}. Retaining last known reading state.</span>
          </div>
        )}

        {/* Main Status Hero & Metadata Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Primary Status Hero Card */}
          <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl relative overflow-hidden backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Current Monitored Location Status
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Device:</span>
                <input
                  type="text"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value.trim() || "esp32-01")}
                  className="bg-slate-950 border border-slate-700 text-xs px-2.5 py-1 rounded font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  title="Filter dashboard by Device ID"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 py-4">
              <div className="flex items-center gap-4">
                {presenceState === "PRESENT" && (
                  <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-500/10 animate-pulse">
                    <CheckCircle2 className="w-12 h-12" />
                  </div>
                )}
                {presenceState === "ABSENT" && (
                  <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700 text-slate-400">
                    <EyeOff className="w-12 h-12" />
                  </div>
                )}
                {presenceState === "UNKNOWN" && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    <HelpCircle className="w-12 h-12" />
                  </div>
                )}

                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                    {presenceState === "PRESENT" && (
                      <span className="text-emerald-400">OBJECT PRESENT</span>
                    )}
                    {presenceState === "ABSENT" && (
                      <span className="text-slate-300">NO OBJECT</span>
                    )}
                    {presenceState === "UNKNOWN" && (
                      <span className="text-amber-400">UNKNOWN (Awaiting Data)</span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    {presenceState === "PRESENT" &&
                      "Digital IR sensor reports active reflection at fixed monitoring point."}
                    {presenceState === "ABSENT" &&
                      "Digital IR sensor beam is clear. No object detected in front of sensor."}
                    {presenceState === "UNKNOWN" &&
                      "No records found for this device ID yet. Ensure ESP32 is transmitting."}
                  </p>
                </div>
              </div>

              {/* Freshness Badge */}
              <div className="flex flex-col items-start sm:items-end justify-center border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-6">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                  Freshness
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      freshnessState === "LIVE"
                        ? "bg-emerald-500 animate-ping"
                        : freshnessState === "NORMAL"
                        ? "bg-sky-500"
                        : freshnessState === "STALE"
                        ? "bg-amber-500"
                        : "bg-slate-600"
                    }`}
                  />
                  <span
                    className={`text-sm font-bold font-mono ${
                      freshnessState === "LIVE"
                        ? "text-emerald-400"
                        : freshnessState === "NORMAL"
                        ? "text-sky-400"
                        : freshnessState === "STALE"
                        ? "text-amber-400"
                        : "text-slate-400"
                    }`}
                  >
                    {freshnessState}
                  </span>
                </div>
                <span className="text-xs text-slate-400 mt-1 font-mono">
                  {readingAgeSec !== null ? `${readingAgeSec}s ago` : "--"}
                </span>
              </div>
            </div>

            {/* Bottom Metadata Bar */}
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Last Reading: {formatLocalTime(latestReading?.created_at)}</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>Polling: 2000ms</span>
              </div>
            </div>
          </div>

          {/* Device & Architecture Details Card */}
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl flex flex-col justify-between backdrop-blur-sm">
            <div>
              <h2 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3 flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" /> System Metrics
              </h2>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400">Device ID</span>
                  <span className="font-mono text-emerald-400 font-semibold">{deviceId}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400">Database Engine</span>
                  <span className="font-mono text-slate-200 flex items-center gap-1">
                    <Database className="w-3 h-3 text-emerald-400" />
                    Supabase PostgreSQL
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <span className="text-slate-400">Backend Status</span>
                  <span className="font-mono text-slate-200">
                    {healthStatus?.status === "healthy" ? (
                      <span className="text-emerald-400 font-medium">Healthy (200)</span>
                    ) : (
                      <span className="text-amber-400 font-medium">Checking...</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              Hardware: ESP32 + Digital IR sensor connected to <strong>GPIO 27</strong> with 100ms
              debounce & 10s heartbeat.
            </div>
          </div>
        </div>

        {/* Derived Summary Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400">Window Observations</span>
            <div className="text-2xl font-bold font-mono text-white mt-1">{totalLoaded}</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400">Present Observations</span>
            <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
              {presentCount}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400">Absent Observations</span>
            <div className="text-2xl font-bold font-mono text-slate-300 mt-1">{absentCount}</div>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400">Presence Ratio</span>
            <div className="text-2xl font-bold font-mono text-sky-400 mt-1">{presenceRatio}%</div>
          </div>
        </div>

        {/* Observation History Chart */}
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 gap-2">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Sampled Observation Timeline
              </h2>
              <p className="text-xs text-slate-400">
                1 = Object Present, 0 = Absent. Represents discrete sampled events over time.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">History Limit:</span>
              <select
                value={selectedLimit}
                onChange={(e) => setSelectedLimit(Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value={20}>Last 20</option>
                <option value={50}>Last 50</option>
                <option value={100}>Last 100</option>
              </select>
            </div>
          </div>

          <div className="h-48 sm:h-64 w-full mt-2">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="presenceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="time"
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 1]}
                    tickFormatter={(val) => (val === 1 ? "Present" : "Absent")}
                    stroke="#64748b"
                    fontSize={11}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#090d16",
                      borderColor: "#334155",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                    }}
                    labelFormatter={(label) => `Time: ${label}`}
                    formatter={(_val: any, _name: any, item: any) => [
                      item.payload.status,
                      "State",
                    ]}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="val"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#presenceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                {isLoading ? "Loading telemetry..." : "No readings recorded yet for this device."}
              </div>
            )}
          </div>
        </div>

        {/* Recent Readings Table */}
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" /> Recent Raw Readings
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              Showing {history.length} events
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">ID</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Device</th>
                  <th className="py-2.5 px-3">Recorded Time (Local)</th>
                  <th className="py-2.5 px-3">UTC Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {history.length > 0 ? (
                  history.map((reading) => {
                    const localStr = new Date(reading.created_at).toLocaleString();
                    return (
                      <tr key={reading.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2 px-3 text-slate-400">#{reading.id}</td>
                        <td className="py-2 px-3">
                          {reading.object_detected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium text-[11px] border border-emerald-500/30">
                              <Eye className="w-3 h-3" /> PRESENT
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium text-[11px] border border-slate-700">
                              <EyeOff className="w-3 h-3" /> ABSENT
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-300">{reading.device_id}</td>
                        <td className="py-2 px-3 text-slate-200">{localStr}</td>
                        <td className="py-2 px-3 text-slate-400">{reading.created_at}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 font-sans">
                      {isLoading ? "Fetching readings..." : "No events recorded."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto w-full mt-8 pt-4 border-t border-slate-900 text-center text-xs text-slate-400">
        <p>
          IoT-Based Object Presence and Inventory Monitoring System &bull; ESP32 &bull; React &bull;
          Flask &bull; Supabase &bull; Render
        </p>
      </footer>
    </div>
  );
}

export default App;
