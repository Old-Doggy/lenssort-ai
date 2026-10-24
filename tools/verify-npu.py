import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort


def main():
    root = Path(__file__).resolve().parent.parent
    process = subprocess.run([sys.executable, str(root / 'tools/winml_worker.py')], capture_output=True, text=True, timeout=90)
    if process.returncode != 0:
        raise RuntimeError(process.stderr)
    paths = json.loads(process.stdout.strip().splitlines()[-1])
    for name, library in paths.items():
        ort.register_execution_provider_library(name, library)
    devices = [device for device in ort.get_ep_devices() if device.ep_name == 'VitisAIExecutionProvider' and device.device.type == ort.OrtHardwareDeviceType.NPU]
    if not devices:
        raise RuntimeError('No AMD NPU EP device')
    options = ort.SessionOptions()
    options.log_severity_level = 0
    options.enable_profiling = True
    cache = root / 'data/npu-cache'
    cache.mkdir(parents=True, exist_ok=True)
    options.profile_file_prefix = str(cache / 'npu-profile')
    options.add_provider_for_devices([devices[0]], {})
    model = root / 'public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/onnx/model.onnx'
    started = time.perf_counter()
    session = ort.InferenceSession(str(model), sess_options=options)
    data = np.full((1, 3, 224, 224), .1, dtype=np.float32)
    durations = []
    for _ in range(4):
        start = time.perf_counter()
        logits = session.run(None, {session.get_inputs()[0].name: data})[0]
        if logits.size != 1000 or not np.isfinite(logits).all():
            raise RuntimeError('Invalid NPU inference output')
        durations.append((time.perf_counter() - start) * 1000)
    profile = session.end_profiling()
    events = json.loads(Path(profile).read_text(encoding='utf-8'))
    providers = sorted({event.get('args', {}).get('provider') for event in events if event.get('args', {}).get('provider')})
    if 'VitisAIExecutionProvider' not in providers:
        raise RuntimeError('NPU offloading profile not verified: ' + str(providers))
    report = {'status': 'passed', 'onnxruntime': ort.__version__, 'libraryPaths': paths, 'providers': providers, 'activeProviders': session.get_providers(), 'durationsMs': durations, 'totalMs': (time.perf_counter() - started) * 1000, 'profile': profile, 'syntheticInput': True, 'npuVerified': True}
    (root / 'artifacts/npu-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
