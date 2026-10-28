export interface SensorReading {
  id: number;
  device_id: string;
  object_detected: boolean;
  created_at: string;
}

export type PresenceState = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export type FreshnessState = 'LIVE' | 'NORMAL' | 'STALE' | 'UNKNOWN';

export type ApiConnectionState = 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';

export interface LatestApiResponse {
  status: 'success' | 'error';
  device_id?: string;
  data: SensorReading | null;
  message?: string;
}

export interface HistoryApiResponse {
  status: 'success' | 'error';
  device_id?: string;
  count: number;
  data: SensorReading[];
  message?: string;
}

export interface HealthApiResponse {
  status: 'healthy' | 'degraded';
  database: 'connected' | 'error';
  timestamp: string;
}

export interface AppConfig {
  supabase_url: string;
  supabase_anon_key: string;
  default_device_id: string;
  app_title: string;
  realtime_enabled: boolean;
}

export interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: 'present' | 'absent' | 'info';
  timestamp: string;
}
