from winui3.microsoft.windows.applicationmodel.dynamicdependency.bootstrap import initialize, InitializeOptions
import winui3.microsoft.windows.ai.machinelearning as winml
import shutil
from pathlib import Path


def provider_paths():
    with initialize(version='2.5', min_version='2.5.1.0', options=InitializeOptions.NONE):
        providers = winml.ExecutionProviderCatalog.get_default().find_all_providers()
        paths = {}
        for provider in providers:
            if provider.name != 'VitisAIExecutionProvider':
                continue
            if provider.ready_state != winml.ExecutionProviderReadyState.READY:
                provider.ensure_ready_async().get()
            if provider.library_path:
                source = Path(provider.library_path).parent
                local = Path(__file__).resolve().parent.parent / 'data/npu-cache/provider'
                local.mkdir(parents=True, exist_ok=True)
                for file in source.iterdir():
                    if file.is_file():
                        target = local / file.name
                        if not target.exists() or target.stat().st_size != file.stat().st_size:
                            shutil.copy2(file, target)
                short = str(local)
                import ctypes
                buffer = ctypes.create_unicode_buffer(32768)
                if ctypes.windll.kernel32.GetShortPathNameW(str(local), buffer, len(buffer)):
                    short = buffer.value
                paths[provider.name] = str(Path(short) / Path(provider.library_path).name)
        return paths
