#!/usr/bin/env python3
"""Run connected tests only on an explicit emulator, then reinstall the debug app."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def valid_snapshot(payload, exit_code):
    if exit_code == 0:
        try:
            state = json.loads(payload)
            if isinstance(state, dict) and state.get('version') == 2 and isinstance(state.get('cards'), dict):
                return payload
        except (ValueError, UnicodeDecodeError):
            pass  # adb can put a shell error on stdout with exit code zero
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', default='emulator-5554')
    parser.add_argument('--live-catalogue', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'emulator-\d+', args.serial):
        parser.error('This test runner refuses physical devices')
    sdk = Path(os.environ.get('ANDROID_HOME', Path.home()/'Library/Android/sdk'))
    adb = shutil.which('adb') or str(sdk/'platform-tools/adb')
    device = [adb, '-s', args.serial]
    subprocess.run(device+['get-state'], check=True)
    original = subprocess.run(device+['exec-out', 'run-as', 'com.randspy.langocard', 'cat', 'files/learning-v2.json'], capture_output=True)
    backup = valid_snapshot(original.stdout, original.returncode)
    if backup:
        directory = ROOT/'apps/android/build/test-recovery'
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        (directory/f'{args.serial}-{stamp}.json').write_bytes(backup)
    command = [str(ROOT/'apps/android/gradlew'), '-p', str(ROOT/'apps/android'), ':app:connectedDebugAndroidTest']
    if args.live_catalogue:
        command += ['-Pandroid.testInstrumentationRunnerArguments.liveCatalogue=true']
    env = dict(os.environ, ANDROID_SERIAL=args.serial)
    result = 1
    try:
        result = subprocess.run(command, env=env).returncode
    finally:
        apk = ROOT/'apps/android/app/build/outputs/apk/debug/app-debug.apk'
        if apk.exists():
            subprocess.run(device+['install', '-r', str(apk)], check=True)
            if backup:
                subprocess.run(device+['shell', 'am', 'force-stop', 'com.randspy.langocard'], check=True)
                subprocess.run(device+['shell', 'run-as', 'com.randspy.langocard', 'mkdir', '-p', 'files'], check=True)
                subprocess.run(device+['shell', 'run-as', 'com.randspy.langocard', 'tee', 'files/learning-v2.json'],
                               input=backup, stdout=subprocess.DEVNULL, check=True)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
