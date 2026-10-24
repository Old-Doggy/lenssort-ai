import json
from winml_discovery import provider_paths

if __name__ == '__main__':
    print(json.dumps(provider_paths()))
