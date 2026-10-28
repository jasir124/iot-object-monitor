import json
import urllib.request
import os
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("SUPABASE_ACCESS_TOKEN", "")
ref = os.getenv("SUPABASE_PROJECT_REF", "kvmkvwyjvzelgwkmhlbh")

if not token:
    raise ValueError("SUPABASE_ACCESS_TOKEN environment variable not set")

# 1. Fetch anon key
keys_req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/api-keys",
    headers={"Authorization": f"Bearer {token}"}
)
with urllib.request.urlopen(keys_req) as resp:
    keys = json.loads(resp.read().decode())
    anon_key = next((k["api_key"] for k in keys if k["name"] == "anon"), None)
    print("Anon key retrieved:", bool(anon_key))

# 2. Execute SQL to enable Realtime and grant SELECT to anon
sql = """
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'sensor_readings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sensor_readings;
  END IF;
END $$;
GRANT SELECT ON sensor_readings TO anon, authenticated;
DROP POLICY IF EXISTS "Allow public read access to sensor readings" ON sensor_readings;
CREATE POLICY "Allow public read access to sensor readings" ON sensor_readings FOR SELECT TO anon USING (true);
"""

query_req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(query_req) as resp:
        print("SQL query executed successfully:", resp.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.read().decode())

print("Supabase Project URL:", f"https://{ref}.supabase.co")
if anon_key:
    env_content = ""
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            env_content = f.read()
    with open(".env", "a", encoding="utf-8") as f:
        if "SUPABASE_URL" not in env_content:
            f.write(f"\nSUPABASE_URL=https://{ref}.supabase.co\n")
        if "SUPABASE_ANON_KEY" not in env_content:
            f.write(f"SUPABASE_ANON_KEY={anon_key}\n")
    print("Updated .env with SUPABASE_URL and SUPABASE_ANON_KEY")
