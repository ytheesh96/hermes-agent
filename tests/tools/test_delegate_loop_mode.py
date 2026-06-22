from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture
def loop_delegate_env(monkeypatch, tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_PROFILE", "planner")
    monkeypatch.setenv("HERMES_SESSION_ID", "session-123")
    monkeypatch.setenv("HERMES_SESSION_KEY", "tui-session-123")
    monkeypatch.delenv("HERMES_KANBAN_DB", raising=False)
    monkeypatch.delenv("HERMES_KANBAN_BOARD", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from gateway.session_context import _UNSET, _VAR_MAP
    for var in _VAR_MAP.values():
        var.set(_UNSET)

    from hermes_cli import kanban_db as kb

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    return home


class DummyParent:
    _delegate_depth = 0
    _memory_manager = None
    session_id = "parent-session"
    model = "test-model"
    provider = "test-provider"


def test_delegate_task_loop_mode_creates_durable_loop_item(loop_delegate_env, monkeypatch):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    def fail_child_build(*_args, **_kwargs):
        raise AssertionError("loop mode should not build ephemeral child agents")

    monkeypatch.setattr(delegate_tool, "_build_child_agent", fail_child_build)
    monkeypatch.setattr(
        delegate_tool,
        "_resolve_delegation_credentials",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("loop mode should not resolve subagent credentials")
        ),
    )

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Review the Loop adapter",
            context="Repo: /tmp/hermes-agent\nCheck routing and tests.",
            mode="loop",
            assignee="reviewer-qa",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["mode"] == "loop"
    assert out["count"] == 1
    assert out["assignee"] == "reviewer-qa"
    assert out["loop_item_id"].startswith("t_")
    assert out["subscribed"] is True
    assert out["auto_reentry"] is True

    conn = kb.connect()
    try:
        task = kb.get_task(conn, out["loop_item_id"])
        subs = kb.list_notify_subs(conn, out["loop_item_id"])
    finally:
        conn.close()

    assert task is not None
    assert task.title == "Review the Loop adapter"
    assert task.assignee == "reviewer-qa"
    assert task.session_id == "session-123"
    assert "Repo: /tmp/hermes-agent" in (task.body or "")
    assert "delegate_task_mode_loop" in (task.body or "")
    assert [
        (s["platform"], s["chat_id"], s["notifier_profile"])
        for s in subs
    ] == [("tui", "tui-session-123", "planner")]


def test_delegate_task_loop_mode_forwards_goal_mode_and_decompose(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Coordinate a multi-stage submission",
            context="Break the work into durable cards and keep going until done.",
            mode="loop",
            assignee="peacock",
            decompose=True,
            goal_mode=True,
            goal_max_turns=7,
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["loop_status"] == "triage"

    conn = kb.connect()
    try:
        task = kb.get_task(conn, out["loop_item_id"])
    finally:
        conn.close()

    assert task is not None
    assert task.status == "triage"
    assert task.goal_mode is True
    assert task.goal_max_turns == 7


def test_delegate_task_loop_decompose_preserves_loop_lineage(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Coordinate a decomposed Loop graph",
            mode="loop",
            assignee="peacock",
            decompose=True,
            parent_agent=DummyParent(),
        )
    )
    root_id = out["loop_item_id"]

    conn = kb.connect()
    try:
        child_ids = kb.decompose_triage_task(
            conn,
            root_id,
            root_assignee="peacock",
            children=[
                {
                    "title": "Research",
                    "body": "Find constraints.",
                    "assignee": "research-worker",
                    "parents": [],
                }
            ],
            author="test-decomposer",
        )
        assert child_ids is not None
        root = kb.get_task(conn, root_id)
        child = kb.get_task(conn, child_ids[0])
        child_loop_root = kb._loop_root_for_task(conn, child_ids[0])
    finally:
        conn.close()

    assert root is not None
    assert root.created_by == f"loop:{root_id}"
    assert child is not None
    assert child.created_by == f"loop:{root_id}"
    assert child.session_id == "session-123"
    assert child_loop_root == root_id


def test_delegate_task_loop_mode_supports_per_task_goal_and_decompose(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {
                    "goal": "Plan a durable graph",
                    "assignee": "peacock",
                    "decompose": True,
                    "goal_mode": True,
                    "goal_max_turns": 5,
                },
                {"goal": "Quick review", "assignee": "reviewer-qa"},
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["count"] == 2
    first, second = out["items"]
    assert first["decompose"] is True
    assert first["goal_mode"] is True
    assert second["decompose"] is False
    assert second["goal_mode"] is False

    conn = kb.connect()
    try:
        first_task = kb.get_task(conn, first["loop_item_id"])
        second_task = kb.get_task(conn, second["loop_item_id"])
    finally:
        conn.close()

    assert first_task is not None
    assert first_task.status == "triage"
    assert first_task.goal_mode is True
    assert first_task.goal_max_turns == 5
    assert second_task is not None
    assert second_task.status == "ready"
    assert second_task.goal_mode is False


def test_delegate_task_loop_mode_uses_default_assignee(loop_delegate_env):
    (loop_delegate_env / "config.yaml").write_text(
        "kanban:\n  default_assignee: worker-a\n",
        encoding="utf-8",
    )

    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Use configured worker",
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["assignee"] == "worker-a"


def test_delegate_task_loop_mode_requires_assignee_without_default(loop_delegate_env):
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Needs a durable worker",
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert "error" in out
    assert "assignee" in out["error"]
