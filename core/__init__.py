"""Shared core for AgentCore Payments Media Content PoC."""

from .config import DemoConfig, load_config
from .callbacks import DemoCallbacks, PrintCallbacks, CollectorCallbacks


def create_agent(config: DemoConfig, callbacks=None):
    """Lazy import to avoid requiring strands at import time."""
    from .agent import create_agent as _create_agent
    return _create_agent(config, callbacks)


__all__ = ["DemoConfig", "load_config", "create_agent", "DemoCallbacks", "PrintCallbacks", "CollectorCallbacks"]
