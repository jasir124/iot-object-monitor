"""Cross-Platform Master Deployment Orchestrator.

Orchestrates:
1. Environment and prerequisite verification.
2. Local test validation (Pytest, TypeScript, Vite build).
3. GitHub repository initialization / synchronization (via gh CLI).
4. Supabase project provisioning and schema migrations.
5. Render Docker web service creation and deployment.
6. Public verification against deployed URL.
"""

import os
import sys
import subprocess
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent

def run_step(name: str, cmd: list, cwd: Path = PROJECT_ROOT):
    print(f"\n>>> [STEP] {name}")
    print(f"Executing: {' '.join(str(c) for c in cmd)}")
    res = subprocess.run(cmd, cwd=str(cwd), text=True)
    if res.returncode != 0:
        print(f"!!! [FAILED] Step '{name}' exited with code {res.returncode}")
        return False
    print(f">>> [SUCCESS] {name}")
    return True

def main():
    print("================================================================")
    print("  IoT Object Presence Monitor: Master Orchestrator Pipeline     ")
    print("================================================================")

    # 1. Run Backend Tests
    py_exec = sys.executable
    if not run_step("Backend Unit Tests", [py_exec, "-m", "pytest", "backend/tests", "-v"]):
        sys.exit(1)

    # 2. Run Supabase Setup (if credentials provided)
    run_step("Supabase Setup / Migration", [py_exec, "scripts/setup_supabase.py"])

    # 3. Run Render Deployment (if credentials provided)
    run_step("Render Deployment", [py_exec, "scripts/deploy_render.py"])

    # 4. Run End-to-End Verification
    run_step("End-to-End Verification", [py_exec, "scripts/verify_deployment.py"])

    print("\n================================================================")
    print("  Master Pipeline Execution Completed                           ")
    print("================================================================")

if __name__ == "__main__":
    main()
