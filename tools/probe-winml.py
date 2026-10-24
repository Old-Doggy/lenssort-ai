import json
import os
import subprocess
import sys
from pathlib import Path

import onnxruntime as ort


def main():
    report = {
        'python': sys.executable,
        'onnxruntimeVersion': getattr(ort, '__version__', None),
        'providers': ort.get_available_providers(),
        'hasEpDevices': hasattr(ort, 'get_ep_devices'),
        'hasRegisterLibrary': hasattr(ort, 'register_execution_provider_library'),
    }
    if hasattr(ort, 'get_ep_devices'):
        report['epDevicesBefore'] = [str(device) for device in ort.get_ep_devices()]
    worker = Path(__file__).parent / 'winml_worker.py'
    process = subprocess.run([sys.executable, str(worker)], capture_output=True, text=True, timeout=30)
    report['workerExit'] = process.returncode
    report['workerStdout'] = process.stdout
    report['workerStderr'] = process.stderr
    if process.returncode == 0:
        for line in process.stdout.splitlines():
            if line.strip().startswith('{'):
                paths = json.loads(line)
                report['providerPaths'] = paths
                for name, library in paths.items():
                    if library and os.path.exists(library):
                        ort.register_execution_provider_library(name, library)
    if hasattr(ort, 'get_ep_devices'):
        report['epDevicesAfter'] = [str(device) for device in ort.get_ep_devices()]
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
