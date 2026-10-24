import argparse
import base64
import pathlib
import re
import shutil
import subprocess
import sys


def find_patch_executable():
    located = shutil.which('apply_patch')
    if not located:
        raise RuntimeError('apply_patch is not available in PATH')
    wrapper = pathlib.Path(located)
    if wrapper.suffix.lower() not in ('.bat', '.cmd'):
        return wrapper, []
    contents = wrapper.read_text(encoding='utf-8-sig')
    match = re.search(r'^\s*"([^"\r\n]+)"\s+--codex-run-as-apply-patch\s+%\*\s*$', contents, re.MULTILINE)
    if not match:
        raise RuntimeError('Unrecognized apply_patch wrapper; stop rather than guess')
    executable = pathlib.Path(match.group(1))
    if not executable.is_file():
        fallback = pathlib.Path.home() / 'codex-0.149.0' / 'node_modules' / '@openai' / 'codex-win32-x64' / 'vendor' / 'x86_64-pc-windows-msvc' / 'bin' / 'codex.exe'
        if not fallback.is_file():
            raise RuntimeError('Native apply_patch executable does not exist')
        executable = fallback
    return executable, ['--codex-run-as-apply-patch']


def main():
    parser = argparse.ArgumentParser(description='Submit UTF-8 patches through apply_patch without a batch shell')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--base64', dest='encoded_patch')
    source.add_argument('--patch-file', type=pathlib.Path)
    source.add_argument('--check', action='store_true')
    arguments = parser.parse_args()
    try:
        executable, prefix = find_patch_executable()
        if arguments.check:
            print(f'Native patch entry verified: {executable}')
            return 0
        patch = (
            base64.b64decode(arguments.encoded_patch, validate=True).decode('utf-8')
            if arguments.encoded_patch is not None
            else arguments.patch_file.read_text(encoding='utf-8-sig')
        )
        patch = patch.replace('\r\n', '\n').strip('\n') + '\n'
        if not patch.startswith('*** Begin Patch\n') or not patch.endswith('*** End Patch\n'):
            raise ValueError('Patch must have exact Begin Patch and End Patch delimiters')
        if len(patch.encode('utf-16-le')) // 2 > 24000:
            raise ValueError('Patch is too large for the verified Windows entry; split into smaller patches')
        result = subprocess.run([str(executable), *prefix, patch], shell=False)
        return result.returncode
    except (OSError, RuntimeError, ValueError) as error:
        print(f'Patch not submitted: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
