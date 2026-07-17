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


def test_delegate_task_loop_skeleton_batch_uses_minimal_live_graph_contract(
    loop_delegate_env, monkeypatch
):
    from tools import delegate_tool, loop_tools

    captured = []

    def fake_create_graph(args, **_kwargs):
        captured.append(args)
        return json.dumps(
            {
                "ok": True,
                "root_task_id": "t_root",
                "items": [
                    {
                        "client_id": "research",
                        "task_id": "t_research",
                        "status": "triage",
                        "needs_specification": True,
                        "parents": [],
                    },
                    {
                        "client_id": "build",
                        "task_id": "t_build",
                        "status": "todo",
                        "needs_specification": True,
                        "parents": ["t_research"],
                    },
                    {
                        "client_id": "verify",
                        "task_id": "t_verify",
                        "status": "todo",
                        "needs_specification": True,
                        "parents": ["t_build"],
                    },
                ],
                "edges": [
                    {"parent_id": "t_research", "child_id": "t_build"},
                    {"parent_id": "t_build", "child_id": "t_verify"},
                ],
                "dispatch": {"spawned": []},
                "subscribed": True,
            }
        )

    monkeypatch.setattr(loop_tools, "_handle_loop_create_graph", fake_create_graph)
    monkeypatch.setattr(delegate_tool, "_get_max_concurrent_children", lambda: 1)

    out = json.loads(
        delegate_tool.delegate_task(
            mode="loop",
            decompose=True,
            root_task_id="t_root",
            tasks=[
                {"id": "research", "title": "Research current behavior"},
                {
                    "id": "build",
                    "goal": "Implement the selected approach",
                    "depends_on": ["research"],
                    "assignee": "foreground-must-not-route",
                },
                {
                    "id": "verify",
                    "title": "Verify end to end",
                    "depends_on": ["build"],
                },
            ],
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["count"] == 3
    assert out["root_task_id"] == "t_root"
    assert out["edges"] == [["t_research", "t_build"], ["t_build", "t_verify"]]
    assert all(item["needs_specification"] for item in out["items"])
    assert "immediately" in out["note"]
    assert len(captured) == 1
    assert captured[0]["root_task_id"] == "t_root"
    assert captured[0]["shared_context"] is None
    assert captured[0]["nodes"] == [
        {
            "client_id": "research",
            "title": "Research current behavior",
            "depends_on": [],
        },
        {
            "client_id": "build",
            "title": "Implement the selected approach",
            "depends_on": ["research"],
        },
        {
            "client_id": "verify",
            "title": "Verify end to end",
            "depends_on": ["build"],
        },
    ]
    assert all("assignee" not in node and "context" not in node for node in captured[0]["nodes"])


def test_delegate_task_loop_schema_and_prompt_explain_live_graph_ownership():
    from agent.prompt_builder import KANBAN_GUIDANCE
    from tools.delegate_tool import DELEGATE_TASK_SCHEMA, _build_tasks_param_description

    properties = DELEGATE_TASK_SCHEMA["parameters"]["properties"]
    task_properties = properties["tasks"]["items"]["properties"]

    assert "root_task_id" in properties
    assert "immediately-submitted skeleton" in properties["decompose"]["description"]
    assert "auto-decomposer" in properties["decompose"]["description"]
    assert "title" in task_properties
    assert "Ignored" in task_properties["assignee"]["description"]
    assert "does not apply" in _build_tasks_param_description()
    assert "Creating nodes submits them immediately" in KANBAN_GUIDANCE
    assert "no separate Submit" in KANBAN_GUIDANCE


def test_delegate_task_loop_direct_batch_keeps_existing_concurrency_limit(
    loop_delegate_env, monkeypatch
):
    from tools import delegate_tool

    monkeypatch.setattr(delegate_tool, "_get_max_concurrent_children", lambda: 1)

    out = json.loads(
        delegate_tool.delegate_task(
            mode="loop",
            decompose=False,
            tasks=[
                {"goal": "First direct task", "assignee": "worker-a"},
                {"goal": "Second direct task", "assignee": "worker-b"},
            ],
            parent_agent=DummyParent(),
        )
    )

    assert "Too many tasks" in out["error"]
    assert "max_concurrent_children is 1" in out["error"]


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
    assert task.session_id == "tui-session-123"
    assert task.tenant is None
    assert "Repo: /tmp/hermes-agent" in (task.body or "")
    assert "delegate_task_mode_loop" in (task.body or "")
    assert [
        (s["platform"], s["chat_id"], s["notifier_profile"])
        for s in subs
    ] == [("tui", "tui-session-123", "planner")]


def test_delegate_task_loop_mode_pokes_dispatcher(loop_delegate_env, monkeypatch):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    def fail_child_build(*_args, **_kwargs):
        raise AssertionError("loop mode should not build ephemeral child agents")

    monkeypatch.setattr(delegate_tool, "_build_child_agent", fail_child_build)
    monkeypatch.setattr("hermes_cli.profiles.profile_exists", lambda name: name == "worker-a")
    monkeypatch.setattr(kb, "_default_spawn", lambda task, workspace, *, board=None: 5150)

    out = json.loads(
        delegate_tool.delegate_task(
            goal="Start this durable Loop task now",
            mode="loop",
            assignee="worker-a",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["loop_status"] == "running"

    conn = kb.connect()
    try:
        task = kb.get_task(conn, out["loop_item_id"])
        events = [event.kind for event in kb.list_events(conn, out["loop_item_id"])]
    finally:
        conn.close()

    assert task is not None
    assert task.status == "running"
    assert task.worker_pid == 5150
    assert "claimed" in events
    assert "spawned" in events


def test_delegate_task_loop_mode_uses_session_context_over_stale_env(
    loop_delegate_env, monkeypatch
):
    from gateway.session_context import clear_session_vars, set_session_vars
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    monkeypatch.setenv("HERMES_SESSION_ID", "stale-env-session")
    monkeypatch.setenv("HERMES_SESSION_KEY", "stale-env-session")
    tokens = set_session_vars(
        session_id="fresh-runtime-session",
        session_key="fresh-context-session",
        tenant="fresh-context-session",
    )
    try:
        out = json.loads(
            delegate_tool.delegate_task(
                goal="Verify session routing",
                mode="loop",
                assignee="reviewer-qa",
                parent_agent=DummyParent(),
            )
        )
    finally:
        clear_session_vars(tokens)

    conn = kb.connect()
    try:
        task = kb.get_task(conn, out["loop_item_id"])
        subs = kb.list_notify_subs(conn, out["loop_item_id"])
    finally:
        conn.close()

    assert task is not None
    assert task.session_id == "fresh-context-session"
    assert task.tenant is None
    assert '"origin_session_id": "fresh-context-session"' in (task.body or "")
    assert '"origin_session_id": "fresh-runtime-session"' not in (task.body or "")
    assert '"origin_session_id": "stale-env-session"' not in (task.body or "")
    assert [(s["platform"], s["chat_id"]) for s in subs] == [
        ("tui", "fresh-context-session")
    ]


def test_delegate_task_loop_mode_keeps_custom_tenant_metadata_separate_from_source_session(
    loop_delegate_env,
    monkeypatch,
):
    from gateway.session_context import reset_session_vars_for_tests, set_session_vars
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    monkeypatch.setenv("HERMES_SESSION_ID", "stale-runtime-session")
    monkeypatch.setenv("HERMES_SESSION_KEY", "stale-key-session")
    monkeypatch.setenv("HERMES_TENANT", "legacy-env-tenant")
    tokens = set_session_vars(
        session_id="runtime-tip-session",
        session_key="source-root-session",
        tenant="legacy-context-tenant",
    )
    try:
        out = json.loads(
            delegate_tool.delegate_task(
                goal="Verify custom tenant routing",
                mode="loop",
                assignee="reviewer-qa",
                tenant="custom-origin-metadata",
                parent_agent=DummyParent(),
            )
        )
    finally:
        del tokens
        reset_session_vars_for_tests()

    conn = kb.connect()
    try:
        task = kb.get_task(conn, out["loop_item_id"])
        subs = kb.list_notify_subs(conn, out["loop_item_id"])
    finally:
        conn.close()

    assert task is not None
    assert task.session_id == "source-root-session"
    assert task.tenant == "custom-origin-metadata"
    body = task.body or ""
    assert '"origin_session_id": "source-root-session"' in body
    assert '"origin_session_id": "runtime-tip-session"' not in body
    assert '"origin_session_id": "legacy-context-tenant"' not in body
    assert [(s["platform"], s["chat_id"]) for s in subs] == [
        ("tui", "source-root-session")
    ]


def test_delegate_task_loop_single_decompose_preserves_legacy_goal_metadata(
    loop_delegate_env,
):
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
    assert task.assignee == "peacock"
    assert task.goal_mode is True
    assert task.goal_max_turns == 7
    assert task.needs_specification is False


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
    assert child.session_id == "tui-session-123"
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
    assert out["edges"] == []
    first, second = out["items"]
    assert first["decompose"] is True
    assert first["goal_mode"] is True
    assert first["parents"] == []
    assert second["decompose"] is False
    assert second["goal_mode"] is False
    assert second["parents"] == []

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


def test_delegate_task_loop_mode_batch_dependencies_create_links(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {"id": "research", "goal": "Research constraints", "assignee": "researcher-a"},
                {
                    "client_id": "write",
                    "goal": "Write plan",
                    "assignee": "writer-a",
                    "depends_on": ["research"],
                },
                {
                    "client_id": "review",
                    "goal": "Review plan",
                    "assignee": "reviewer-qa",
                    "depends_on": ["write"],
                },
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["count"] == 3
    research, write, review = out["items"]
    assert [item["client_id"] for item in out["items"]] == [
        "research",
        "write",
        "review",
    ]
    assert research["parents"] == []
    assert write["parents"] == [research["loop_item_id"]]
    assert review["parents"] == [write["loop_item_id"]]
    assert out["edges"] == [
        [research["loop_item_id"], write["loop_item_id"]],
        [write["loop_item_id"], review["loop_item_id"]],
    ]

    conn = kb.connect()
    try:
        research_task = kb.get_task(conn, research["loop_item_id"])
        write_task = kb.get_task(conn, write["loop_item_id"])
        review_task = kb.get_task(conn, review["loop_item_id"])
        assert kb.parent_ids(conn, write["loop_item_id"]) == [research["loop_item_id"]]
        assert kb.parent_ids(conn, review["loop_item_id"]) == [write["loop_item_id"]]
    finally:
        conn.close()

    assert research_task is not None
    assert research_task.status == "ready"
    assert write_task is not None
    assert write_task.status == "todo"
    assert review_task is not None
    assert review_task.status == "todo"


def test_delegate_task_loop_mode_depends_on_existing_task_id(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    conn = kb.connect()
    try:
        parent_id = kb.create_task(conn, title="External gate", assignee="gate-worker")
    finally:
        conn.close()

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {
                    "client_id": "child",
                    "goal": "Run after external gate",
                    "assignee": "worker-a",
                    "depends_on": [parent_id],
                }
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert out["status"] == "dispatched"
    assert out["edges"] == [[parent_id, out["loop_item_id"]]]
    assert out["parents"] == [parent_id]
    conn = kb.connect()
    try:
        child = kb.get_task(conn, out["loop_item_id"])
        assert kb.parent_ids(conn, out["loop_item_id"]) == [parent_id]
    finally:
        conn.close()

    assert child is not None
    assert child.status == "todo"


def test_delegate_task_loop_mode_unknown_dependency_creates_no_tasks(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {
                    "client_id": "child",
                    "goal": "Blocked child",
                    "assignee": "worker-a",
                    "depends_on": ["missing-parent"],
                }
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert "error" in out
    assert "unknown dependency" in out["error"]
    conn = kb.connect()
    try:
        assert kb.list_tasks(conn) == []
    finally:
        conn.close()


def test_delegate_task_loop_mode_cycle_creates_no_tasks(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {
                    "client_id": "a",
                    "goal": "A",
                    "assignee": "worker-a",
                    "depends_on": ["b"],
                },
                {
                    "client_id": "b",
                    "goal": "B",
                    "assignee": "worker-b",
                    "depends_on": ["a"],
                },
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert "error" in out
    assert "cycle" in out["error"]
    conn = kb.connect()
    try:
        assert kb.list_tasks(conn) == []
    finally:
        conn.close()


def test_delegate_task_loop_mode_duplicate_alias_creates_no_tasks(loop_delegate_env):
    from hermes_cli import kanban_db as kb
    from tools import delegate_tool

    out = json.loads(
        delegate_tool.delegate_task(
            tasks=[
                {"id": "same", "goal": "First", "assignee": "worker-a"},
                {"client_id": "same", "goal": "Second", "assignee": "worker-b"},
            ],
            mode="loop",
            parent_agent=DummyParent(),
        )
    )

    assert "error" in out
    assert "duplicate" in out["error"]
    conn = kb.connect()
    try:
        assert kb.list_tasks(conn) == []
    finally:
        conn.close()


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
