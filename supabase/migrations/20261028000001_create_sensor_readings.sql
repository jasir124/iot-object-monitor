-- Migration: Create sensor_readings table for IoT Object Presence Monitoring
-- Created: 2026-10-28
-- Description: Stores timestamped object presence events recorded by ESP32 devices.

CREATE TABLE IF NOT EXISTS public.sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    object_detected BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT chk_device_id_non_empty CHECK (length(trim(device_id)) > 0)
);

-- Index for efficient querying of recent readings per device
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_created
    ON public.sensor_readings (device_id, created_at DESC, id DESC);

-- Enable Row Level Security (RLS) to enforce backend-only access
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

-- Block unrestricted public and anonymous access through Supabase PostgREST
REVOKE ALL ON TABLE public.sensor_readings FROM anon;
REVOKE ALL ON TABLE public.sensor_readings FROM authenticated;

-- Comments for database documentation
COMMENT ON TABLE public.sensor_readings IS 'Stores timestamped object presence readings from IoT sensor devices.';
COMMENT ON COLUMN public.sensor_readings.device_id IS 'Identifier of the reporting ESP32 device (e.g., esp32-01).';
COMMENT ON COLUMN public.sensor_readings.object_detected IS 'Boolean presence flag: true if an object was detected, false otherwise.';
COMMENT ON COLUMN public.sensor_readings.created_at IS 'UTC timestamp recorded when the reading was registered.';
