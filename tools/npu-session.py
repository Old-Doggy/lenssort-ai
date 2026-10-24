import base64
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort


def summarize_profile(events):
    provider_events = [event for event in events if event.get('args', {}).get('provider')]
    npu_events = [event for event in provider_events if event.get('args', {}).get('provider') == 'VitisAIExecutionProvider']
    cpu_events = [event for event in provider_events if event.get('args', {}).get('provider') == 'CPUExecutionProvider']
    npu_duration_us = sum(max(0, int(event.get('dur', 0) or 0)) for event in npu_events)
    cpu_duration_us = sum(max(0, int(event.get('dur', 0) or 0)) for event in cpu_events)
    return {
        'profileEventCount': len(provider_events),
        'profileScope': 'first-inference-session-profile',
        'npuKernelCount': len(npu_events),
        'npuKernelMs': round(npu_duration_us / 1000, 3),
        'cpuKernelCount': len(cpu_events),
        'cpuKernelMs': round(cpu_duration_us / 1000, 3),
    }


def main():
    root = Path(__file__).resolve().parent.parent
    result = subprocess.run([sys.executable, str(root / 'tools/winml_worker.py')], capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    paths = json.loads(result.stdout.strip().splitlines()[-1])
    for name, library in paths.items():
        ort.register_execution_provider_library(name, library)
    devices = [device for device in ort.get_ep_devices() if device.ep_name == 'VitisAIExecutionProvider' and device.device.type == ort.OrtHardwareDeviceType.NPU]
    if not devices:
        raise RuntimeError('AMD NPU provider unavailable; CPU-only fallback forbidden')
    options = ort.SessionOptions()
    options.log_severity_level = 2
    options.enable_profiling = True
    cache = root / 'data/npu-cache'
    cache.mkdir(parents=True, exist_ok=True)
    options.profile_file_prefix = str(cache / ('photo-' + str(time.time_ns())))
    options.add_provider_for_devices([devices[0]], {})
    model = root / 'public/models/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/onnx/model.onnx'
    session = ort.InferenceSession(str(model), sess_options=options)
    profile = None
    providers = []
    print(json.dumps({'type': 'ready', 'providers': session.get_providers(), 'model': str(model), 'onnxruntime': ort.__version__}), flush=True)
    for line in sys.stdin:
        message = json.loads(line)
        if message.get('type') == 'close':
            break
        try:
            data = np.frombuffer(base64.b64decode(message['tensor']), dtype='<f4').reshape((1, 3, 224, 224))
            started = time.perf_counter()
            output = session.run(None, {session.get_inputs()[0].name: data})[0].reshape(-1)
            duration = (time.perf_counter() - started) * 1000
            if output.size != 1000 or not np.isfinite(output).all():
                raise RuntimeError('Invalid NPU logits')
            if profile is None:
                profile = session.end_profiling()
                events = json.loads(Path(profile).read_text(encoding='utf-8'))
                providers = sorted({event.get('args', {}).get('provider') for event in events if event.get('args', {}).get('provider')})
                evidence = summarize_profile(events)
            if 'VitisAIExecutionProvider' not in providers or evidence['npuKernelCount'] < 1 or evidence['npuKernelMs'] <= 0:
                raise RuntimeError('No NPU offloading events; refusing CPU-only inference')
            print(json.dumps({'id': message['id'], 'logits': output.tolist(), 'classificationMs': duration, 'npuVerified': True, 'providers': providers, 'profile': profile, 'mixedCpuAuxiliary': 'CPUExecutionProvider' in providers, **evidence}), flush=True)
        except Exception as error:
            print(json.dumps({'id': message.get('id'), 'error': str(error)}), flush=True)
    del session


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'type': 'error', 'error': str(error)}), flush=True)
        raise
