from __future__ import annotations


def test_touch_activity_forwards_current_tool_to_kanban_heartbeat(monkeypatch):
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_active_tool")

    from run_agent import AIAgent
    from tools import kanban_tools

    calls: list[str | None] = []

    def fake_heartbeat(*, current_tool=None):
        calls.append(current_tool)
        return True

    monkeypatch.setattr(kanban_tools, "heartbeat_current_worker_from_env", fake_heartbeat)

    agent = AIAgent.__new__(AIAgent)
    setattr(agent, "_current_tool", "search_files")

    agent._touch_activity("executing tool: search_files")

    assert calls == ["search_files"]
