import base64
import hashlib
import json
import pathlib
import subprocess
import sys
from datetime import datetime, timezone


ROOT = pathlib.Path(__file__).resolve().parent.parent
HELPER = ROOT / 'tools' / 'apply_patch_utf8.py'
PROBE = ROOT / 'artifacts' / 'patch-entry-probe' / '中文补丁.txt'
REPORT = ROOT / 'artifacts' / 'windows-patch-entry-evaluation.json'
LARGE_PATCH = ROOT / 'artifacts' / 'patch-entry-probe' / 'oversized.patch'


def call_helper(patch=None, arguments=None):
    encoded = base64.b64encode(patch.encode('utf-8')).decode('ascii') if patch is not None else None
    return subprocess.run(
        [sys.executable, str(HELPER), *(arguments if arguments is not None else ['--base64', encoded])],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace',
    )


def call_helper_file(path):
    return call_helper(arguments=['--patch-file', str(path)])


def main():
    report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'checks': [], 'passed': False}
    source_hash = hashlib.sha256((ROOT / 'src' / 'App.tsx').read_bytes()).hexdigest()
    created = False

    def record(name, result, expected_exit, content_valid=True):
        passed = result.returncode == expected_exit and content_valid
        report['checks'].append({
            'name': name, 'passed': passed, 'expectedExit': expected_exit,
            'actualExit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
        })
        if not passed:
            raise AssertionError(name)

    try:
        if PROBE.exists():
            raise RuntimeError('Probe already exists; stop without overwriting it')
        record('nativeEntryAvailable', call_helper(arguments=['--check']), 0)
        add_patch = f'*** Begin Patch\n*** Add File: {PROBE.as_posix()}\n+中文路径与正文\n+单引号：\'keep\'；双引号："like"\n+第二行：0–100\n*** End Patch\n'
        result = call_helper(add_patch)
        created = result.returncode == 0
        record('unicodeMultilineQuotedAdd', result, 0, PROBE.read_text(encoding='utf-8') == '中文路径与正文\n单引号：\'keep\'；双引号："like"\n第二行：0–100\n' if created else False)
        update_patch = f'*** Begin Patch\n*** Update File: {PROBE.as_posix()}\n@@\n-第二行：0–100\n+第二行：已验证 +8/-8\n*** End Patch\n'
        record('unicodeUpdate', call_helper(update_patch), 0, True)
        if '第二行：已验证 +8/-8' not in PROBE.read_text(encoding='utf-8'):
            raise AssertionError('Updated text mismatch')
        record('invalidBase64Rejected', call_helper(arguments=['--base64', '!!!']), 1)
        record('missingDelimitersRejected', call_helper('中文 invalid patch'), 1)
        LARGE_PATCH.parent.mkdir(parents=True, exist_ok=True)
        LARGE_PATCH.write_text('*** Begin Patch\n' + 'x' * 25000 + '\n*** End Patch\n', encoding='utf-8')
        record('oversizedPatchRejected', call_helper_file(LARGE_PATCH), 1)
        report['sourceUnchanged'] = source_hash == hashlib.sha256((ROOT / 'src' / 'App.tsx').read_bytes()).hexdigest()
        if not report['sourceUnchanged']:
            raise AssertionError('Source changed during patch entry test')
        report['passed'] = True
    except (OSError, RuntimeError, AssertionError) as error:
        report['error'] = str(error)
    finally:
        if created and PROBE.exists():
            result = call_helper(f'*** Begin Patch\n*** Delete File: {PROBE.as_posix()}\n*** End Patch\n')
            cleaned = result.returncode == 0 and not PROBE.exists()
            report['checks'].append({'name': 'probeCleanup', 'passed': cleaned, 'actualExit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
            report['passed'] = report['passed'] and cleaned
        if LARGE_PATCH.exists():
            LARGE_PATCH.unlink()
        probe_directory = PROBE.parent
        if probe_directory.exists() and not any(probe_directory.iterdir()):
            probe_directory.rmdir()
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        history_directory = REPORT.parent / 'windows-patch-entry-history'
        history_directory.mkdir(parents=True, exist_ok=True)
        run_name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        report['historyReport'] = str(history_directory / f'{run_name}.json')
        report_text = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
        with pathlib.Path(report['historyReport']).open('x', encoding='utf-8') as history_file:
            history_file.write(report_text)
        REPORT.write_text(report_text, encoding='utf-8')
        print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
