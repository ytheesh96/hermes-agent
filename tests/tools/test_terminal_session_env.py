import json

from gateway.session_context import clear_session_vars, set_current_session_id, set_session_vars
from tools import terminal_tool as terminal_tool_module


def _clear_terminal_envs() -> None:
    with terminal_tool_module._env_lock:
        terminal_tool_module._active_environments.clear()
        terminal_tool_module._last_activity.clear()


def test_reused_terminal_environment_refreshes_current_session_id(monkeypatch):
    monkeypatch.setenv("TERMINAL_ENV", "local")
    _clear_terminal_envs()
    try:
        set_current_session_id("old-session")
        first = json.loads(
            terminal_tool_module.terminal_tool(
                command='printf "%s" "$HERMES_SESSION_ID"',
                task_id="terminal-session-env-regression",
                timeout=10,
            )
        )
        assert first["output"] == "old-session"

        set_current_session_id("new-session")
        second = json.loads(
            terminal_tool_module.terminal_tool(
                command='printf "%s" "$HERMES_SESSION_ID"',
                task_id="terminal-session-env-regression",
                timeout=10,
            )
        )
        assert second["output"] == "new-session"
    finally:
        set_current_session_id("")
        _clear_terminal_envs()


def test_reused_terminal_environment_refreshes_current_tenant(monkeypatch):
    monkeypatch.setenv("TERMINAL_ENV", "local")
    _clear_terminal_envs()
    tokens = []
    try:
        tokens = set_session_vars(session_id="old-session", tenant="old-tenant")
        first = json.loads(
            terminal_tool_module.terminal_tool(
                command='printf "%s|%s" "$HERMES_SESSION_ID" "$HERMES_TENANT"',
                task_id="terminal-tenant-env-regression",
                timeout=10,
            )
        )
        assert first["output"] == "old-session|old-tenant"
        clear_session_vars(tokens)

        tokens = set_session_vars(session_id="new-session", tenant="new-tenant")
        second = json.loads(
            terminal_tool_module.terminal_tool(
                command='printf "%s|%s" "$HERMES_SESSION_ID" "$HERMES_TENANT"',
                task_id="terminal-tenant-env-regression",
                timeout=10,
            )
        )
        assert second["output"] == "new-session|new-tenant"
    finally:
        clear_session_vars(tokens)
        _clear_terminal_envs()
