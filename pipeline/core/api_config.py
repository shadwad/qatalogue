import os
from dotenv import load_dotenv

# Load .env file from the project root
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))

def get_email():
    return os.getenv("POLITE_POOL_EMAIL", "mail@example.info")

def get_setting(name, default=""):
    """A setting from the environment or .env (loaded when this module is imported)."""
    return os.getenv(name, default)


def get_api_key(service):
    """
    Returns the API key for `service` if enabled, otherwise None.
    service can be 'openalex'.
    """
    env_map = {
        'openalex': ('OPENALEX_API_KEY_ENABLED', 'OPENALEX_API_KEY'),
    }
    
    if service not in env_map:
        return None
        
    enabled_key, key_key = env_map[service]
    
    # Check if enabled (treat 'true', '1', 'yes' as enabled)
    enabled = str(os.getenv(enabled_key, "false")).lower() in ('true', '1', 'yes')
    
    if enabled:
        return os.getenv(key_key)
    return None
