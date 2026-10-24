import json
from winui3.microsoft.windows.applicationmodel.dynamicdependency.bootstrap import initialize, InitializeOptions
import winui3.microsoft.windows.ai.machinelearning as winml


def discover(ensure=False):
    entries = []
    with initialize(version='2.5', min_version='2.5.1.0', options=InitializeOptions.NONE):
        catalog = winml.ExecutionProviderCatalog.get_default()
        for provider in catalog.find_all_providers():
            entry = {'name': provider.name, 'state': str(provider.ready_state), 'libraryPath': provider.library_path}
            if ensure and provider.name == 'VitisAIExecutionProvider' and provider.ready_state != winml.ExecutionProviderReadyState.READY:
                result = provider.ensure_ready_async().get()
                entry['ensureStatus'] = str(result.status)
                entry['state'] = str(provider.ready_state)
                entry['libraryPath'] = provider.library_path
            entries.append(entry)
    return entries


if __name__ == '__main__':
    import sys
    print(json.dumps(discover('--ensure' in sys.argv)))
