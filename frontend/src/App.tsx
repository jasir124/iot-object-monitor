import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownCircle,
  Box,
  Clock,
  Database,
  Radio,
  RefreshCw,
  Sparkles,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Wifi,
  X,
  Zap,
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
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import confetti from "canvas-confetti";

import {
  SensorReading,
  PresenceState,
  FreshnessState,
  ApiConnectionState,
  LatestApiResponse,
  HistoryApiResponse,
  HealthApiResponse,
  AppConfig,
  ToastNotification,
} from "./types";

// ==============================================================================
// Audio Synthesis Utility (Web Audio API - No external assets required)
// ==============================================================================
function playChime(type: "present" | "absent") {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "present") {
      // Pleasant rising harmonic chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "triangle";

      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.2); // D6

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.5);
    } else {
      // Gentle descending tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25); // A4

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

export function App() {
  const [deviceId] = useState<string>("esp32-01");
  const [selectedLimit, setSelectedLimit] = useState<number>(50);

  // Data states
  const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
  const [history, setHistory] = useState<SensorReading[]>([]);
  const [healthStatus, setHealthStatus] = useState<HealthApiResponse | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);

  // Realtime & Connection states
  const [isRealtimeActive, setIsRealtimeActive] = useState<boolean>(false);
  const [apiConnection, setApiConnection] = useState<ApiConnectionState>("DISCONNECTED");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Interactive settings
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [invertPolarity, setInvertPolarity] = useState<boolean>(() => {
    const saved = localStorage.getItem("invert_sensor_polarity");
    // Default to true (Active-HIGH) so the currently latched cleared state immediately shows NO OBJECT
    return saved !== null ? saved === "true" : true;
  });
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [dwellStartTime, setDwellStartTime] = useState<Date | null>(null);

  const toggleInvertPolarity = () => {
    setInvertPolarity((prev) => {
      const next = !prev;
      localStorage.setItem("invert_sensor_polarity", String(next));
      lastDetectionStateRef.current = null;
      pushToast(
        "⚙️ Sensor Polarity Switched",
        `Detection logic flipped to ${next ? "Inverted (Active-HIGH)" : "Normal (Active-LOW)"}.`,
        "info"
      );
      return next;
    });
  };

  // Guards & Refs
  const lastDetectionStateRef = useRef<boolean | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clock tick every second for dwell time & freshness
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Helper to spawn popups / toasts
  const pushToast = useCallback((title: string, message: string, type: "present" | "absent" | "info") => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    const newToast: ToastNotification = {
      id,
      title,
      message,
      type,
      timestamp: new Date().toLocaleTimeString(),
    };

    setToasts((prev) => [newToast, ...prev.slice(0, 4)]);

    // Auto dismiss after 4.5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Dismiss toast
  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // 1. Fetch App Config & Supabase Realtime details on load
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const json = await res.json();
          if (json.status === "success") {
            setAppConfig(json.data);
          }
        }
      } catch {
        // Fallback default config
      }
    };
    fetchConfig();
  }, []);

  // Handle incoming reading from either WebSocket Realtime or HTTP Poller
  const processReading = useCallback((reading: SensorReading, source: "realtime" | "poll") => {
    setLatestReading(reading);
    setApiConnection("CONNECTED");

    // Check for state transitions (factoring in polarity calibration)
    const prevState = lastDetectionStateRef.current;
    const currentState = invertPolarity ? !reading.object_detected : reading.object_detected;

    if (prevState === null) {
      lastDetectionStateRef.current = currentState;
      setDwellStartTime(new Date(reading.created_at));
    } else if (prevState !== currentState) {
      lastDetectionStateRef.current = currentState;
      setDwellStartTime(new Date(reading.created_at));

      if (currentState) {
        // Object placed!
        pushToast(
          "📦 Object Placed in Monitored Zone",
          `IR proximity sensor (GPIO 27) detected object presence via ${source === "realtime" ? "Supabase Realtime" : "Telemetry"}.`,
          "present"
        );
        if (soundEnabled) playChime("present");
        try {
          confetti({
            particleCount: 45,
            spread: 60,
            origin: { y: 0.8 },
            colors: ["#10b981", "#34d399", "#059669"],
          });
        } catch {
          // ignore
        }
      } else {
        // Object removed!
        pushToast(
          "💨 Monitored Zone Cleared",
          `Object removed from dock zone. IR beam path is now clear.`,
          "absent"
        );
        if (soundEnabled) playChime("absent");
      }
    }

    // Prepend to history if not duplicate
    setHistory((prev) => {
      if (prev.some((r) => r.id === reading.id)) return prev;
      return [reading, ...prev.slice(0, selectedLimit - 1)];
    });
  }, [pushToast, soundEnabled, selectedLimit, invertPolarity]);

  // 2. Connect Supabase Realtime WebSocket when config is ready
  useEffect(() => {
    if (!appConfig?.supabase_url || !appConfig?.supabase_anon_key) return;

    try {
      const supabase = createClient(appConfig.supabase_url, appConfig.supabase_anon_key);
      const channel = supabase
        .channel("public:sensor_readings")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "sensor_readings",
          },
          (payload) => {
            const newRow = payload.new as SensorReading;
            if (!newRow || (newRow.device_id && newRow.device_id !== deviceId)) return;
            processReading(newRow, "realtime");
          }
        )
        .subscribe((status) => {
          setIsRealtimeActive(status === "SUBSCRIBED");
        });

      realtimeChannelRef.current = channel;

      return () => {
        supabase.removeChannel(channel);
      };
    } catch {
      setIsRealtimeActive(false);
    }
  }, [appConfig, deviceId, processReading]);

  // 3. HTTP Poller (Reliable background synchronizer)
  const fetchData = useCallback(async (isManualRefresh = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (isManualRefresh) setIsRefreshing(true);

    try {
      const [latestRes, historyRes, healthRes] = await Promise.all([
        fetch(`/api/latest?device_id=${encodeURIComponent(deviceId)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        }),
        fetch(`/api/readings?device_id=${encodeURIComponent(deviceId)}&limit=${selectedLimit}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        }),
        fetch("/health", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        }),
      ]);

      if (latestRes.ok) {
        const latestJson: LatestApiResponse = await latestRes.json();
        if (latestJson.status === "success" && latestJson.data) {
          processReading(latestJson.data, "poll");
        }
      }

      if (historyRes.ok) {
        const historyJson: HistoryApiResponse = await historyRes.json();
        if (historyJson.status === "success" && Array.isArray(historyJson.data)) {
          setHistory(historyJson.data);
        }
      }

      if (healthRes.ok) {
        const healthJson: HealthApiResponse = await healthRes.json();
        setHealthStatus(healthJson);
      }

      setApiConnection("CONNECTED");
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setApiConnection("DISCONNECTED");
      }
    } finally {
      setIsLoading(false);
      if (isManualRefresh) setIsRefreshing(false);
    }
  }, [deviceId, selectedLimit, processReading]);

  // Initial fetch and poll interval (every 4 seconds fallback)
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(false), 4000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Dwell duration calculation
  const getDwellTimeStr = () => {
    if (!dwellStartTime) return "Just started";
    const diffSec = Math.max(0, Math.floor((currentTime.getTime() - dwellStartTime.getTime()) / 1000));
    if (diffSec < 60) return `${diffSec}s`;
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  };

  // Freshness calculation
  const readingAgeSec = latestReading
    ? Math.max(0, Math.floor((currentTime.getTime() - new Date(latestReading.created_at).getTime()) / 1000))
    : null;

  const freshnessState: FreshnessState =
    readingAgeSec === null ? "UNKNOWN" : readingAgeSec <= 15 ? "LIVE" : readingAgeSec <= 35 ? "NORMAL" : "STALE";

  const effectiveLatestDetected = latestReading
    ? (invertPolarity ? !latestReading.object_detected : latestReading.object_detected)
    : null;

  const presenceState: PresenceState =
    latestReading === null ? "UNKNOWN" : effectiveLatestDetected ? "PRESENT" : "ABSENT";

  // Recharts timeline data prep
  const chartData = [...history]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((item) => {
      const isDet = invertPolarity ? !item.object_detected : item.object_detected;
      return {
        time: new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        detected: isDet ? 1 : 0,
        state: isDet ? "Present" : "Empty",
        id: item.id,
      };
    });

  // Occupancy metrics
  const detectedCount = history.filter((r) => invertPolarity ? !r.object_detected : r.object_detected).length;
  const totalCount = history.length;
  const occupancyPercentage = totalCount > 0 ? Math.round((detectedCount / totalCount) * 100) : 0;

  // Transitions counter
  let transitionCount = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const aDet = invertPolarity ? !history[i].object_detected : history[i].object_detected;
    const bDet = invertPolarity ? !history[i + 1].object_detected : history[i + 1].object_detected;
    if (aDet !== bDet) {
      transitionCount++;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 bg-grid-pattern text-slate-800 flex flex-col font-sans relative selection:bg-emerald-500/20">
      {/* ==================================================================== */}
      {/* Floating Animated Toast Notifications (Option 2 - Real-time Popups)   */}
      {/* ==================================================================== */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-2xl shadow-lg border backdrop-blur-md transition-all transform animate-toast-slide ${
              toast.type === "present"
                ? "bg-white/95 border-emerald-300 text-slate-800 shadow-emerald-500/10 ring-1 ring-emerald-500/20"
                : toast.type === "absent"
                ? "bg-white/95 border-amber-300 text-slate-800 shadow-amber-500/10 ring-1 ring-amber-500/20"
                : "bg-white/95 border-slate-200 text-slate-800 shadow-slate-500/10"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  toast.type === "present"
                    ? "bg-emerald-100 text-emerald-700"
                    : toast.type === "absent"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {toast.type === "present" ? <Box className="w-5 h-5" /> : <ArrowDownCircle className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-900 tracking-tight">{toast.title}</h4>
                  <span className="text-[10px] text-slate-400 font-mono">{toast.timestamp}</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-snug">{toast.message}</p>
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-slate-400 hover:text-slate-600 p-1 -mr-1 rounded-lg hover:bg-slate-100 transition-colors"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ==================================================================== */}
      {/* Top Navigation Bar - Light Theme                                      */}
      {/* ==================================================================== */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Project Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">SpotSense</h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 rounded-full border border-emerald-200">
                  v2.0 Live
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                IoT Object Presence &amp; Realtime Inventory Monitor
              </p>
            </div>
          </div>

          {/* Right Controls: Realtime badge, Sound toggle, Refresh */}
          <div className="flex items-center gap-2.5">
            {/* API / DB Health Badge */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                apiConnection === "CONNECTED"
                  ? "bg-slate-50 border-slate-200 text-slate-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
              title={`API Connection: ${apiConnection} | Database: ${healthStatus?.database ?? "unknown"}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  apiConnection === "CONNECTED" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <span>{healthStatus?.database === "connected" ? "PostgreSQL 17" : "Connecting"}</span>
            </div>

            {/* Realtime WebSocket Badge */}
            <div
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                isRealtimeActive
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm shadow-emerald-500/10"
                  : "bg-slate-100 border-slate-200 text-slate-600"
              }`}
              title={isRealtimeActive ? "Subscribed to Supabase Realtime WebSocket" : "Falling back to HTTP polling"}
            >
              <span className="relative flex h-2 w-2">
                {isRealtimeActive && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isRealtimeActive ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                ></span>
              </span>
              <span>{isRealtimeActive ? "Supabase Realtime" : "Polling Active"}</span>
            </div>

            {/* Sensor Polarity Invert / Calibration Button */}
            <button
              onClick={toggleInvertPolarity}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all shadow-sm ${
                invertPolarity
                  ? "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                  : "bg-white border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-50"
              }`}
              title="Flip sensor logic between Normal (Active-LOW) and Inverted (Active-HIGH)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">Polarity:</span>
              <span className="font-semibold">{invertPolarity ? "Inverted (Active-HIGH)" : "Normal (Active-LOW)"}</span>
            </button>

            {/* Sound Chime Toggle */}
            <button
              onClick={() => {
                setSoundEnabled(!soundEnabled);
                if (!soundEnabled) playChime("present");
              }}
              className={`p-2 rounded-xl border text-xs font-medium transition-all ${
                soundEnabled
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 shadow-sm"
                  : "bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              }`}
              title={soundEnabled ? "Mute detection chimes" : "Enable detection chimes"}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Manual Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-medium shadow-sm transition-all disabled:opacity-50"
              title="Refresh telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-emerald-600" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* Subtle Sync Progress Indicator */}
      {isLoading && (
        <div className="w-full h-1 bg-slate-100 overflow-hidden">
          <div className="h-full bg-emerald-500 animate-pulse w-2/3"></div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Stale Warning Banner (if hardware stops sending for > 35s)            */}
      {/* ==================================================================== */}
      {freshnessState === "STALE" && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-amber-800 text-xs font-medium flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>
            Telemetry is stale (last reading was {readingAgeSec}s ago). The ESP32 may be disconnected from Wi-Fi or powered off.
          </span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* Main Content Area                                                     */}
      {/* ==================================================================== */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* ================================================================== */}
        {/* Top Hero Grid: Creative Visualizer + Status Card                   */}
        {/* ================================================================== */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Creative Monitored Zone Visualizer (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between">
            {/* Background Radial Glow */}
            <div
              className={`absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl opacity-30 pointer-events-none transition-all duration-700 ${
                presenceState === "PRESENT" ? "bg-emerald-400" : "bg-slate-300"
              }`}
            />

            {/* Card Header */}
            <div className="flex items-center justify-between z-10">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Fixed Location Sensor Zone
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-0.5">Dock Zone Alpha (Slot A-01)</h2>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${
                    presenceState === "PRESENT"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      presenceState === "PRESENT" ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                    }`}
                  />
                  {presenceState === "PRESENT" ? "OCCUPIED" : "VACANT"}
                </span>
              </div>
            </div>

            {/* Creative Zone Illustration Graphic */}
            <div className="py-8 my-auto flex items-center justify-center relative min-h-[220px]">
              {presenceState === "PRESENT" ? (
                // --- PRESENT STATE GRAPHIC ---
                <div className="relative flex flex-col items-center animate-package-float">
                  {/* Optical IR Beams from side sensor */}
                  <div className="absolute -left-16 top-1/2 -translate-y-1/2 flex items-center">
                    <div className="w-14 h-0.5 bg-gradient-to-r from-emerald-500/20 via-emerald-500 to-transparent animate-beam-pulse"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-md shadow-emerald-500"></div>
                  </div>

                  {/* 3D Cargo / Package Graphic */}
                  <div className="relative w-36 h-36 bg-gradient-to-br from-emerald-500 via-teal-600 to-emerald-700 rounded-3xl shadow-2xl shadow-emerald-500/30 border border-emerald-300/40 flex flex-col items-center justify-center text-white p-4 transform rotate-1">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-2 shadow-inner">
                      <Box className="w-7 h-7 text-white" />
                    </div>
                    <span className="text-[11px] font-mono tracking-wider font-semibold uppercase opacity-90">
                      ITEM DETECTED
                    </span>
                    <span className="text-[9px] font-mono text-emerald-100 mt-0.5">IR Reflection Active</span>
                  </div>

                  {/* Landing Dock Base Ring */}
                  <div className="w-48 h-8 rounded-[100%] bg-emerald-100 border border-emerald-300/60 shadow-lg -mt-3 z-[-1] flex items-center justify-center">
                    <div className="w-40 h-5 rounded-[100%] bg-emerald-200/50"></div>
                  </div>
                </div>
              ) : (
                // --- EMPTY STATE GRAPHIC ---
                <div className="relative flex flex-col items-center">
                  {/* Empty Sensor Dock with Pulse Ring */}
                  <div className="relative w-44 h-44 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border border-emerald-400/30 animate-ring-pulse"></div>
                    <div className="w-24 h-24 rounded-full bg-slate-100 flex flex-col items-center justify-center text-slate-400">
                      <Radio className="w-8 h-8 text-slate-400 animate-pulse" />
                      <span className="text-[10px] font-mono font-medium text-slate-400 mt-1">Scanning...</span>
                    </div>
                  </div>
                  <div className="w-48 h-6 rounded-[100%] bg-slate-200/70 border border-slate-300/60 -mt-3 z-[-1]"></div>
                </div>
              )}
            </div>

            {/* Footer Summary in Card */}
            <div className="z-10 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>
                  Current status held for: <strong className="text-slate-800 font-semibold">{getDwellTimeStr()}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                <span>Pin: GPIO 27</span>
                <span>•</span>
                <span>Active LOW (TCRT5000)</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Hardware Panel (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-6 justify-between">
            {/* Primary Status Card */}
            <div
              className={`rounded-3xl p-6 border transition-all shadow-sm ${
                presenceState === "PRESENT"
                  ? "bg-emerald-500 text-white border-emerald-600 shadow-emerald-500/20"
                  : "bg-white text-slate-800 border-slate-200/90"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${
                    presenceState === "PRESENT" ? "text-emerald-100" : "text-slate-400"
                  }`}
                >
                  Live Detection Status
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    presenceState === "PRESENT" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {freshnessState === "LIVE" ? "• 0s Delay" : `${readingAgeSec}s ago`}
                </span>
              </div>

              <div className="flex items-baseline gap-3 mb-2">
                <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                  {presenceState === "PRESENT" ? "OBJECT PRESENT" : "NO OBJECT"}
                </h3>
              </div>

              <p
                className={`text-xs leading-relaxed ${
                  presenceState === "PRESENT" ? "text-emerald-50" : "text-slate-500"
                }`}
              >
                {presenceState === "PRESENT"
                  ? "Digital IR sensor beam is interrupted. Physical item is resting in monitored position."
                  : "Digital IR sensor beam is unobstructed. Monitored position is currently vacant."}
              </p>

              <div
                className={`mt-6 pt-4 border-t flex items-center justify-between text-xs ${
                  presenceState === "PRESENT" ? "border-emerald-400/40 text-emerald-100" : "border-slate-100 text-slate-400"
                }`}
              >
                <span>Latest Reading ID: #{latestReading?.id ?? "--"}</span>
                <span className="font-mono">
                  {latestReading
                    ? new Date(latestReading.created_at).toLocaleTimeString()
                    : "--"}
                </span>
              </div>
            </div>

            {/* Hardware & Network Telemetry Card */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm flex-1 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">ESP32 Device Node</h3>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">
                  {deviceId}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 my-2">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Wi-Fi Network</span>
                  <span className="text-xs font-semibold text-slate-800 truncate block mt-0.5">Amal Jyothi New</span>
                  <span className="text-[10px] text-emerald-600 font-mono font-medium block mt-0.5">Signal: -58 dBm</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-medium uppercase block">Node IP Address</span>
                  <span className="text-xs font-mono font-semibold text-slate-800 block mt-0.5">192.168.56.253</span>
                  <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Port: COM22 (CP2102)</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-slate-400" />
                  <span>Supabase Mumbai (ap-south-1)</span>
                </span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Render Singapore</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================== */}
        {/* KPI Mini-Cards Row                                                 */}
        {/* ================================================================== */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {/* Card 1: Dwell Duration */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Zone Dwell Time</span>
              <Clock className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{getDwellTimeStr()}</div>
            <p className="text-[11px] text-slate-400 mt-1">Duration in current state</p>
          </div>

          {/* Card 2: Occupancy Rate */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Occupancy Rate</span>
              <Activity className="w-4 h-4 text-teal-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{occupancyPercentage}%</div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${occupancyPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Card 3: State Transitions */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">State Changes</span>
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{transitionCount}</div>
            <p className="text-[11px] text-slate-400 mt-1">Total transitions in buffer</p>
          </div>

          {/* Card 4: Database Rows Recorded */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">Telemetry Samples</span>
              <Database className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
            <p className="text-[11px] text-slate-400 mt-1">Logged in Supabase</p>
          </div>
        </div>

        {/* ================================================================== */}
        {/* Interactive Presence Timeline Graph (Recharts Light Theme)         */}
        {/* ================================================================== */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Presence Observation Timeline</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Timestamped step-graph showing when an object was placed (1.0) and removed (0.0).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 font-medium">Readings buffer:</label>
              <select
                value={selectedLimit}
                onChange={(e) => setSelectedLimit(Number(e.target.value))}
                className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-xl px-3 py-1.5 text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value={25}>Latest 25</option>
                <option value={50}>Latest 50</option>
                <option value={100}>Latest 100</option>
              </select>
            </div>
          </div>

          <div className="h-64 w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="presenceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    stroke="#cbd5e1"
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 1.2]}
                    ticks={[0, 1]}
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    stroke="#cbd5e1"
                    tickFormatter={(v) => (v === 1 ? "Present" : "Empty")}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3 shadow-lg text-xs">
                            <span className="text-slate-400 block font-mono text-[10px]">{data.time}</span>
                            <span className="font-bold text-slate-900 mt-1 block">
                              State: {data.state}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
                              Record ID: #{data.id}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="detected"
                    stroke="#059669"
                    strokeWidth={2.5}
                    fill="url(#presenceGrad)"
                    dot={{ r: 3, fill: "#059669", strokeWidth: 1, stroke: "#ffffff" }}
                    activeDot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#ffffff" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Awaiting telemetry stream...
              </div>
            )}
          </div>
        </div>

        {/* ================================================================== */}
        {/* Recent Sensor Events Table                                         */}
        {/* ================================================================== */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Telemetry Ingestions</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Full chronological ledger stored in Supabase PostgreSQL 17.
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">Showing {history.length} records</span>
          </div>

          <div className="overflow-x-auto -mx-6 sm:-mx-8">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-y border-slate-100 font-medium">
                <tr>
                  <th className="py-3 px-6 sm:px-8">Record ID</th>
                  <th className="py-3 px-4">Monitored State</th>
                  <th className="py-3 px-4">Hardware Node</th>
                  <th className="py-3 px-4">Timestamp (Local)</th>
                  <th className="py-3 px-6 sm:px-8 text-right">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {history.slice(0, 15).map((row) => {
                  const ageSec = Math.max(0, Math.floor((currentTime.getTime() - new Date(row.created_at).getTime()) / 1000));
                  const isDet = invertPolarity ? !row.object_detected : row.object_detected;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-6 sm:px-8 font-mono text-slate-500">#{row.id}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            isDet
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isDet ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          {isDet ? "PRESENT" : "NO OBJECT"}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">{row.device_id}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-6 sm:px-8 text-right font-mono text-slate-400 text-[11px]">
                        {ageSec < 60 ? `${ageSec}s ago` : `${Math.floor(ageSec / 60)}m ago`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ==================================================================== */}
      {/* Footer                                                               */}
      {/* ==================================================================== */}
      <footer className="bg-white border-t border-slate-200/80 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>SpotSense IoT Object Presence Monitor • Single-Point IR Verification</span>
          <div className="flex items-center gap-4 text-slate-500">
            <span>ESP32 CP2102 COM22</span>
            <span>•</span>
            <span>Supabase PostgreSQL 17</span>
            <span>•</span>
            <span>Render Singapore</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
