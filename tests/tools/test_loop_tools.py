from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def loop_env(monkeypatch, tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_PROFILE", "planner")
    monkeypatch.delenv("HERMES_KANBAN_DB", raising=False)
    monkeypatch.delenv("HERMES_KANBAN_BOARD", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    from gateway.session_context import _UNSET, _VAR_MAP
    for var in _VAR_MAP.values():
        var.set(_UNSET)

    from hermes_cli import kanban_db as kb

    kb._INITIALIZED_PATHS.clear()
    kb.init_db()
    return "tenant-a"


def _call(args):
    from tools import loop_tools as wt

    return json.loads(wt._handle_loop_graph(args))


def _call_loop(tool_name: str, args: dict):
    from tools import loop_tools as wt

    handlers = {
        "loop_create": wt._handle_loop_create,
        "loop_create_graph": wt._handle_loop_create_graph,
        "loop_status": wt._handle_loop_status,
        "loop_list_queue": wt._handle_loop_list_queue,
        "loop_update": wt._handle_loop_update,
        "loop_block": wt._handle_loop_block,
        "loop_request_review": wt._handle_loop_request_review,
    }
    return json.loads(handlers[tool_name](args))


def test_loop_graph_tool_is_in_core_but_minimal_and_gated(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_KANBAN_TASK", raising=False)
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))

    import tools.loop_tools  # ensure registered
    from tools.registry import invalidate_check_fn_cache, registry
    from toolsets import resolve_toolset

    invalidate_check_fn_cache()
    schema = registry.get_definitions(set(resolve_toolset("hermes-cli")), quiet=True)
    names = {s["function"].get("name") for s in schema if "function" in s}
    assert "loop_graph" in names
    assert not any(n.startswith("loop_") and n != "loop_graph" for n in names)
    loop_schema = next(s["function"] for s in schema if s["function"].get("name") == "loop_graph")
    exposed = json.dumps(loop_schema).lower()
    for obsolete in ("add_node", "branch_kind", "decision_group_id", "frontier", "planning node", "selection_state"):
        assert obsolete not in exposed

    (home / "config.yaml").write_text("loop:\n  enabled: false\n")
    invalidate_check_fn_cache()
    schema = registry.get_definitions(set(resolve_toolset("hermes-cli")), quiet=True)
    names = {s["function"].get("name") for s in schema if "function" in s}
    assert "loop_graph" not in names


def test_loop_graph_triage_uses_loop_safe_planning_on_the_scoped_board(loop_env, monkeypatch):
    from hermes_cli import kanban_db as kb

    calls = []

    def fake_decompose(task_id, *, author=None, loop_safe=False):
        calls.append((task_id, author, loop_safe, kb.get_current_board()))
        return SimpleNamespace(
            child_ids=["t_child"],
            fanout=True,
            new_title=None,
            ok=True,
            reason="decomposed into 1 children",
            task_id=task_id,
        )

    monkeypatch.setattr("hermes_cli.kanban_decompose.decompose_task", fake_decompose)

    result = _call(
        {
            "action": "triage",
            "author": "foreground-triage",
            "board": "default",
            "root_task_id": "t_root",
        }
    )

    assert result == {
        "child_ids": ["t_child"],
        "fanout": True,
        "new_title": None,
        "ok": True,
        "reason": "decomposed into 1 children",
        "state": "planned",
        "task_id": "t_root",
    }
    assert calls == [("t_root", "foreground-triage", True, "default")]


def test_loop_delegation_toolset_is_explicit_and_gated(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_KANBAN_TASK", raising=False)
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))

    import tools.loop_tools  # ensure registered
    from tools.registry import invalidate_check_fn_cache, registry
    from toolsets import resolve_toolset

    expected = {
        "loop_create",
        "loop_status",
        "loop_update",
        "loop_block",
        "loop_request_review",
        "loop_list_queue",
    }
    assert set(resolve_toolset("loop_delegation")) == expected

    invalidate_check_fn_cache()
    schema = registry.get_definitions(set(resolve_toolset("loop_delegation")), quiet=True)
    names = {s["function"].get("name") for s in schema if "function" in s}
    assert names == expected

    (home / "config.yaml").write_text("loop:\n  enabled: false\n")
    invalidate_check_fn_cache()
    schema = registry.get_definitions(set(resolve_toolset("loop_delegation")), quiet=True)
    assert schema == []


def test_loop_create_async_requires_activation_and_proof_packet(loop_env, monkeypatch):
    monkeypatch.setenv("HERMES_SESSION_ID", "session-123")
    denied = _call_loop(
        "loop_create",
        {
            "objective": "Implement durable delegation",
            "assignee": "worker-a",
            "tenant": loop_env,
            "proof_packet": {"summary": "user requested implementation"},
        },
    )
    assert denied["ok"] is False
    assert denied["error"] == "activation_required"

    missing_proof = _call_loop(
        "loop_create",
        {
            "objective": "Implement durable delegation",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
        },
    )
    assert missing_proof["ok"] is False
    assert missing_proof["error"] == "proof_packet_required"

    created = _call_loop(
        "loop_create",
        {
            "objective": "Implement durable delegation",
            "acceptance_criteria": ["returns a stable Loop handle"],
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "user requested implementation"},
            "idempotency_key": "loop-create-async",
            "execution": {"mode": "async"},
        },
    )

    assert created["ok"] is True
    assert created["status"] == "ready"
    assert created["execution"]["mode"] == "async"
    assert created["foreground_reentry"] == "on_final_or_blocker"
    assert created["approval_required"] is False
    assert created["proof_packet"] == {"summary": "user requested implementation"}

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        task = kb.get_task(conn, created["loop_item_id"])
        assert task is not None
        assert task.title == "Implement durable delegation"
        assert task.assignee == "worker-a"
        assert task.tenant == loop_env
        assert task.session_id == "session-123"
        assert task.created_by == "loop_delegation:planner"
        assert "returns a stable Loop handle" in (task.body or "")
    finally:
        conn.close()


def test_loop_create_pokes_dispatcher_for_ready_work(loop_env, monkeypatch):
    """Loop delegation should not require a separate manual dispatch command."""
    from hermes_cli import kanban_db as kb

    monkeypatch.setattr("hermes_cli.profiles.profile_exists", lambda name: name == "worker-a")
    monkeypatch.setattr(kb, "_default_spawn", lambda task, workspace, *, board=None: 4242)

    created = _call_loop(
        "loop_create",
        {
            "objective": "Start promptly without manual dispatch",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "user requested durable routing"},
            "idempotency_key": "loop-create-auto-dispatch",
            "execution": {"mode": "async"},
        },
    )

    assert created["ok"] is True
    assert created["status"] == "running"
    assert created["dispatch"]["spawned"] == [created["loop_item_id"]]

    conn = kb.connect()
    try:
        task = kb.get_task(conn, created["loop_item_id"])
        events = [event.kind for event in kb.list_events(conn, created["loop_item_id"])]
    finally:
        conn.close()

    assert task is not None
    assert task.status == "running"
    assert task.worker_pid == 4242
    assert "claimed" in events
    assert "spawned" in events


def test_loop_create_auto_subscribes_tui_session(loop_env, monkeypatch):
    monkeypatch.setenv("HERMES_SESSION_KEY", "loop-create-tui-session")

    created = _call_loop(
        "loop_create",
        {
            "objective": "Report durable result back here",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "user requested durable routing"},
            "idempotency_key": "loop-create-auto-subscribe",
        },
    )

    assert created["ok"] is True
    assert created["subscribed"] is True

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        subs = kb.list_notify_subs(conn, created["loop_item_id"])
    finally:
        conn.close()

    assert [(s["platform"], s["chat_id"]) for s in subs] == [
        ("tui", "loop-create-tui-session")
    ]


def test_loop_create_keeps_source_session_and_tenant_independent(loop_env, monkeypatch):
    monkeypatch.setenv("HERMES_SESSION_ID", "source-runtime-session")
    monkeypatch.delenv("HERMES_SESSION_KEY", raising=False)
    monkeypatch.setenv("HERMES_TENANT", "legacy-env-tenant")

    created = _call_loop(
        "loop_create",
        {
            "objective": "Keep routing identity separate from metadata",
            "assignee": "worker-a",
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "user requested durable routing"},
            "idempotency_key": "loop-create-independent-source-tenant",
        },
    )

    assert created["ok"] is True

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        task = kb.get_task(conn, created["loop_item_id"])
        subs = kb.list_notify_subs(conn, created["loop_item_id"])
    finally:
        conn.close()

    assert task is not None
    assert task.session_id == "source-runtime-session"
    assert task.tenant is None
    assert [(s["platform"], s["chat_id"]) for s in subs] == [
        ("tui", "source-runtime-session")
    ]


def test_loop_create_auto_subscribes_gateway_session(loop_env, monkeypatch):
    monkeypatch.setenv("HERMES_SESSION_PLATFORM", "telegram")
    monkeypatch.setenv("HERMES_SESSION_CHAT_ID", "chat-1")
    monkeypatch.setenv("HERMES_SESSION_THREAD_ID", "thread-1")
    monkeypatch.setenv("HERMES_SESSION_USER_ID", "user-1")

    created = _call_loop(
        "loop_create",
        {
            "objective": "Report durable result to gateway chat",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "gateway durable routing"},
            "idempotency_key": "loop-create-gateway-subscribe",
        },
    )

    assert created["ok"] is True
    assert created["subscribed"] is True

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        subs = kb.list_notify_subs(conn, created["loop_item_id"])
    finally:
        conn.close()

    assert [
        (s["platform"], s["chat_id"], s["thread_id"], s["user_id"])
        for s in subs
    ] == [("telegram", "chat-1", "thread-1", "user-1")]


def test_loop_status_list_update_block_and_request_review(loop_env):
    created = _call_loop(
        "loop_create",
        {
            "objective": "Verify a durable workflow",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "start workflow"},
            "idempotency_key": "loop-status-flow",
        },
    )
    task_id = created["loop_item_id"]

    status = _call_loop("loop_status", {"loop_item_id": task_id})
    assert status["ok"] is True
    assert status["item"]["id"] == task_id
    assert status["item"]["status"] == "ready"
    assert "comments" not in status
    assert status["counts"]["comments"] == 0

    listed = _call_loop("loop_list_queue", {"tenant": loop_env})
    assert listed["ok"] is True
    assert [item["id"] for item in listed["items"]] == [task_id]

    updated = _call_loop(
        "loop_update",
        {
            "loop_item_id": task_id,
            "note": "bounded implementation note",
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "recording status"},
        },
    )
    assert updated["ok"] is True
    assert updated["status"] == "ready"
    assert updated["comment_id"] is not None

    detailed = _call_loop(
        "loop_status",
        {"loop_item_id": task_id, "include_details": True},
    )
    assert detailed["counts"]["comments"] == 1
    assert detailed["comments"][0]["body"] == "bounded implementation note"

    blocked = _call_loop(
        "loop_block",
        {
            "loop_item_id": task_id,
            "reason": "Waiting for proof packet review",
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "block with evidence"},
        },
    )
    assert blocked["ok"] is True
    assert blocked["status"] == "blocked"

    review = _call_loop(
        "loop_request_review",
        {
            "loop_item_id": task_id,
            "reviewer": "reviewer-qa",
            "summary": "Ready for review",
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "review with evidence"},
        },
    )
    assert review["ok"] is True
    assert review["status"] == "review"
    assert review["reviewer"] == "reviewer-qa"


def test_loop_create_sync_timeout_and_completion_wait(loop_env):
    timed_out = _call_loop(
        "loop_create",
        {
            "objective": "Long durable workflow",
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "bounded wait"},
            "idempotency_key": "loop-sync-timeout",
            "execution": {"mode": "sync", "wait_until": "done", "timeout_seconds": 0.01},
        },
    )
    assert timed_out["ok"] is True
    assert timed_out["status"] == "ready"
    assert timed_out["foreground_reentry"] == "will_continue_async"
    assert timed_out["warnings"] == ["sync wait timed out; durable Loop work continues asynchronously"]

    from hermes_cli import kanban_db as kb

    completed_title = "Completes while sync create waits"
    done = threading.Event()

    def complete_when_created():
        deadline = time.time() + 3
        while time.time() < deadline:
            conn = kb.connect()
            try:
                matches = [t for t in kb.list_tasks(conn, tenant=loop_env) if t.title == completed_title]
                if matches:
                    kb.complete_task(conn, matches[0].id, summary="completed during sync wait")
                    done.set()
                    return
            finally:
                conn.close()
            time.sleep(0.05)

    thread = threading.Thread(target=complete_when_created)
    thread.start()
    completed = _call_loop(
        "loop_create",
        {
            "objective": completed_title,
            "assignee": "worker-a",
            "tenant": loop_env,
            "activation": "explicit_user_request",
            "proof_packet": {"summary": "bounded wait completion"},
            "idempotency_key": "loop-sync-completion",
            "execution": {"mode": "sync", "wait_until": "done", "timeout_seconds": 3},
        },
    )
    thread.join(timeout=3)

    assert done.is_set()
    assert completed["ok"] is True
    assert completed["status"] == "done"
    assert completed["foreground_reentry"] == "completed_in_tool_result"
    assert completed["summary"] == "completed during sync wait"


def test_loop_create_graph_submits_atomic_title_only_skeletons(loop_env, monkeypatch):
    monkeypatch.setattr(
        "tools.loop_tools._poke_dispatcher_once",
        lambda _kb, _conn, _board, _warnings: {"spawned": []},
    )

    result = _call_loop(
        "loop_create_graph",
        {
            "activation": "explicit_user_request",
            "proof_packet": {"source": "test"},
            "tenant": loop_env,
            "nodes": [
                {"client_id": "research", "title": "Research constraints", "depends_on": []},
                {"client_id": "build", "title": "Build the change", "depends_on": ["research"]},
            ],
        },
    )

    assert result["ok"] is True
    assert [item["status"] for item in result["items"]] == ["triage", "todo"]
    assert all(item["needs_specification"] for item in result["items"])
    assert result["root_task_id"]
    assert len(result["edges"]) == 2

    from hermes_cli import kanban_db as kb

    ids = {item["client_id"]: item["task_id"] for item in result["items"]}
    conn = kb.connect()
    try:
        assert kb.parent_ids(conn, ids["build"]) == [ids["research"]]
        assert kb.parent_ids(conn, result["root_task_id"]) == [ids["build"]]
        assert kb.list_runs(conn, ids["research"]) == []
        assert kb.list_runs(conn, ids["build"]) == []
    finally:
        conn.close()


def test_legacy_patch_round_trips_planning_nodes_without_tasks_or_task_links(loop_env):
    root = loop_env
    out = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-create",
            "operations": [
                {
                    "op": "add_node",
                    "client_id": "a",
                    "title": "Research options",
                    "body": "Define research scope",
                    "suggested_owner": "researcher-a",
                    "active": True,
                    "frontier": True,
                },
                {
                    "op": "add_node",
                    "client_id": "b",
                    "title": "Synthesize plan",
                    "parents": ["a"],
                },
            ],
        }
    )

    assert out["ok"] is True
    assert out["previous_revision"] == 0
    assert out["graph_revision"] > 0
    assert set(out) <= {
        "ok",
        "root_task_id",
        "previous_revision",
        "graph_revision",
        "created",
        "updated",
        "archived",
        "duplicate",
        "validation",
    }
    created_by_client = {item["client_id"]: item["task_id"] for item in out["created"]}

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        assert kb.get_task(conn, created_by_client["a"]) is None
        assert kb.get_task(conn, created_by_client["b"]) is None
        assert [t for t in kb.list_tasks(conn, status="scheduled") if t.tenant == "tenant-a"] == []
        assert conn.execute("SELECT COUNT(*) FROM task_links").fetchone()[0] == 0

        plan_rows = conn.execute(
            "SELECT node_id, title, body, status, suggested_owner, active, frontier "
            "FROM loop_plan_nodes WHERE root_task_id = ? ORDER BY created_at ASC, node_id ASC",
            (root,),
        ).fetchall()
        assert [row["node_id"] for row in plan_rows] == [created_by_client["a"], created_by_client["b"]]
        assert [row["title"] for row in plan_rows] == ["Research options", "Synthesize plan"]
        assert [row["status"] for row in plan_rows] == ["scheduled", "scheduled"]
        assert plan_rows[0]["body"] == "Define research scope"
        assert plan_rows[0]["suggested_owner"] == "researcher-a"
        assert plan_rows[0]["active"] == 1
        assert plan_rows[0]["frontier"] == 1

        plan_edges = conn.execute(
            "SELECT parent_id, child_id FROM loop_plan_edges WHERE root_task_id = ? ORDER BY parent_id, child_id",
            (root,),
        ).fetchall()
        assert [(row["parent_id"], row["child_id"]) for row in plan_edges] == [
            (created_by_client["a"], created_by_client["b"])
        ]
    finally:
        conn.close()

    read = _call({"action": "read", "root_task_id": root, "include_nodes": True})
    by_id = {node["task_id"]: node for node in read["nodes"]}
    assert by_id[created_by_client["a"]]["is_plan_node"] is True
    assert by_id[created_by_client["a"]]["suggested_owner"] == "researcher-a"
    assert by_id[created_by_client["b"]]["parents"] == [created_by_client["a"]]


def test_patch_rejects_stale_revision_and_replays_duplicate_mutation(loop_env):
    root = loop_env
    first = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-once",
            "operations": [{"op": "add_node", "client_id": "x", "title": "Only once"}],
        }
    )
    assert first["ok"] is True

    stale = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-stale",
            "operations": [{"op": "add_node", "client_id": "y", "title": "Too late"}],
        }
    )
    assert stale["ok"] is False
    assert stale["error"] == "stale_revision"
    assert stale["current_revision"] == first["graph_revision"]

    duplicate = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-once",
            "operations": [{"op": "add_node", "client_id": "x", "title": "Only once"}],
        }
    )
    assert duplicate == {**first, "duplicate": True}

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        assert [t for t in kb.list_tasks(conn, status="scheduled") if t.title == "Only once"] == []
        rows = conn.execute(
            "SELECT node_id FROM loop_plan_nodes WHERE root_task_id = ? AND title = ? AND status != 'archived'",
            (root, "Only once"),
        ).fetchall()
        assert len(rows) == 1
    finally:
        conn.close()


def test_running_sibling_heartbeat_does_not_stale_pending_graph_patch(loop_env):
    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    conn = kb.connect()
    try:
        root = kb.create_task(conn, title="Live root", initial_status="scheduled")
        with kb.write_txn(conn):
            conn.execute(
                "UPDATE tasks SET created_by = ? WHERE id = ?",
                (f"loop:{root}", root),
            )
        running = kb.create_task(
            conn,
            title="Long-running sibling",
            created_by=f"loop:{root}",
        )
        pending = kb.create_task(
            conn,
            title="Pending sibling",
            created_by=f"loop:{root}",
            triage=True,
        )
        claimed = kb.claim_task(conn, running, claimer="worker:heartbeat")
        assert claimed is not None and claimed.current_run_id is not None

        revision = graph.graph_revision(conn, root)
        assert kb.heartbeat_worker(
            conn,
            running,
            note="still working",
            expected_run_id=claimed.current_run_id,
            current_tool="terminal",
        )
        assert graph.graph_revision(conn, root) == revision

        result = graph.apply_patch(
            conn,
            root,
            expected_revision=revision,
            mutation_id="edit-pending-after-heartbeat",
            operations=[
                {
                    "op": "update_node",
                    "task_id": pending,
                    "title": "Pending sibling, revised",
                }
            ],
        )
        assert result["ok"] is True
        assert kb.get_task(conn, pending).title == "Pending sibling, revised"

        # Revision filtering does not replace the in-transaction state guard.
        # Simulate an external writer that omitted its event and verify the
        # active target is still rejected under the patch write lock.
        locked_revision = result["graph_revision"]
        with kb.write_txn(conn):
            conn.execute(
                "UPDATE tasks SET status = 'running' WHERE id = ?",
                (pending,),
            )
        assert graph.graph_revision(conn, root) == locked_revision
        with pytest.raises(graph.LoopError) as exc_info:
            graph.apply_patch(
                conn,
                root,
                expected_revision=locked_revision,
                mutation_id="reject-active-target",
                operations=[
                    {
                        "op": "update_node",
                        "task_id": pending,
                        "title": "Must not apply",
                    }
                ],
            )
        assert exc_info.value.code == "unsafe_status"
    finally:
        conn.close()


@pytest.mark.parametrize("op_name", ["update_node", "archive_node", "mark_node", "set_parents"])
def test_patch_rejects_mutation_targets_outside_requested_root(loop_env, op_name):
    root = loop_env
    created = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-root-a",
            "operations": [{"op": "add_node", "client_id": "a", "title": "Root A node"}],
        }
    )

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        unrelated = kb.create_task(conn, title="Unrelated triage", assignee=None, triage=True)
    finally:
        conn.close()

    other_created = _call(
        {
            "action": "patch",
            "root_task_id": "tenant-b",
            "expected_revision": 0,
            "mutation_id": "m-root-b",
            "operations": [{"op": "add_node", "client_id": "b", "title": "Root B node"}],
        }
    )
    other_node = other_created["created"][0]["task_id"]

    for target in [unrelated, other_node]:
        operation = {"op": op_name, "task_id": target}
        if op_name == "update_node":
            operation["title"] = "Should not change"
        elif op_name == "mark_node":
            operation["active"] = True
        elif op_name == "set_parents":
            operation["parents"] = []

        out = _call(
            {
                "action": "patch",
                "root_task_id": root,
                "expected_revision": created["graph_revision"],
                "mutation_id": f"m-{op_name}-{target}",
                "operations": [operation],
            }
        )

        assert out["ok"] is False
        assert out["error"] == "wrong_root"

    conn = kb.connect()
    try:
        unrelated_task = kb.get_task(conn, unrelated)
        other_task = conn.execute(
            "SELECT title FROM loop_plan_nodes WHERE root_task_id = ? AND node_id = ?",
            ("tenant-b", other_node),
        ).fetchone()
        assert unrelated_task is not None and unrelated_task.title == "Unrelated triage"
        assert other_task is not None and other_task["title"] == "Root B node"
    finally:
        conn.close()


@pytest.mark.parametrize("parent_kind", ["external", "other_root"])
def test_add_node_rejects_parents_outside_requested_root(loop_env, parent_kind):
    root = loop_env
    created = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-root-a-parent-source",
            "operations": [{"op": "add_node", "client_id": "a", "title": "Root A node"}],
        }
    )

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        external = kb.create_task(conn, title="External triage", assignee=None, triage=True)
    finally:
        conn.close()

    other_created = _call(
        {
            "action": "patch",
            "root_task_id": "tenant-b",
            "expected_revision": 0,
            "mutation_id": "m-other-root-parent-source",
            "operations": [{"op": "add_node", "client_id": "b", "title": "Root B node"}],
        }
    )
    parent_id = {
        "external": external,
        "other_root": other_created["created"][0]["task_id"],
    }[parent_kind]

    out = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": created["graph_revision"],
            "mutation_id": f"m-add-node-bad-parent-{parent_kind}",
            "operations": [{"op": "add_node", "client_id": "child", "title": "Child", "parents": [parent_id]}],
        }
    )

    assert out["ok"] is False
    assert out["error"] == "wrong_root"

    conn = kb.connect()
    try:
        assert [t for t in kb.list_tasks(conn, status="scheduled") if t.title == "Child"] == []
        assert conn.execute(
            "SELECT 1 FROM loop_plan_nodes WHERE root_task_id = ? AND client_id = ?",
            (root, "child"),
        ).fetchone() is None
    finally:
        conn.close()


def test_add_node_allows_existing_same_root_parent_and_prior_client_id_parent(loop_env):
    root = loop_env
    first = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-existing-parent-source",
            "operations": [{"op": "add_node", "client_id": "existing", "title": "Existing parent"}],
        }
    )
    existing_id = first["created"][0]["task_id"]

    out = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": first["graph_revision"],
            "mutation_id": "m-add-allowed-parents",
            "operations": [
                {"op": "add_node", "client_id": "same-root-child", "title": "Same-root child", "parents": [existing_id]},
                {"op": "add_node", "client_id": "prior-client-child", "title": "Prior-client child", "parents": ["same-root-child"]},
            ],
        }
    )

    assert out["ok"] is True
    ids = {item["client_id"]: item["task_id"] for item in out["created"]}

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        rows = conn.execute(
            "SELECT parent_id, child_id FROM loop_plan_edges WHERE root_task_id = ? ORDER BY parent_id, child_id",
            (root,),
        ).fetchall()
        assert {(row["parent_id"], row["child_id"]) for row in rows} == {
            (existing_id, ids["same-root-child"]),
            (ids["same-root-child"], ids["prior-client-child"]),
        }
        assert conn.execute("SELECT COUNT(*) FROM task_links").fetchone()[0] == 0
    finally:
        conn.close()


def test_patch_replays_duplicate_mutation_that_started_before_first_commit(loop_env, monkeypatch):
    root = loop_env

    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    original_append_graph_event = graph._append_graph_event
    first_thread_entered_commit = threading.Event()
    release_first_thread = threading.Event()
    results = []
    errors = []

    def slow_first_commit(conn, root_task_id, task_ids, payload):
        if payload.get("mutation_id") == "m-concurrent":
            first_thread_entered_commit.set()
            release_first_thread.wait(timeout=5)
        return original_append_graph_event(conn, root_task_id, task_ids, payload)

    monkeypatch.setattr(graph, "_append_graph_event", slow_first_commit)

    def apply_from_thread():
        conn = kb.connect()
        try:
            results.append(
                graph.apply_patch(
                    conn,
                    root,
                    expected_revision=0,
                    mutation_id="m-concurrent",
                    operations=[{"op": "add_node", "client_id": "x", "title": "Only once concurrently"}],
                )
            )
        except Exception as exc:  # captured so assertion failures show both thread outcomes
            errors.append(exc)
        finally:
            conn.close()

    first = threading.Thread(target=apply_from_thread)
    first.start()
    assert first_thread_entered_commit.wait(timeout=5)

    duplicate_thread = threading.Thread(target=apply_from_thread)
    duplicate_thread.start()
    time.sleep(0.2)
    release_first_thread.set()
    first.join(timeout=5)
    duplicate_thread.join(timeout=5)
    assert not first.is_alive()
    assert not duplicate_thread.is_alive()
    assert errors == []

    assert len(results) == 2
    first_result = next(item for item in results if item["duplicate"] is False)
    replay_result = next(item for item in results if item["duplicate"] is True)
    assert replay_result == {**first_result, "duplicate": True}

    conn = kb.connect()
    try:
        assert [t for t in kb.list_tasks(conn, status="scheduled") if t.title == "Only once concurrently"] == []
        rows = conn.execute(
            "SELECT node_id FROM loop_plan_nodes WHERE root_task_id = ? AND title = ? AND status != 'archived'",
            (root, "Only once concurrently"),
        ).fetchall()
        assert len(rows) == 1
    finally:
        conn.close()


def test_patch_validates_cycles_and_keeps_ready_running_rows_safe(loop_env):
    root = loop_env
    created = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-chain",
            "operations": [
                {"op": "add_node", "client_id": "a", "title": "A"},
                {"op": "add_node", "client_id": "b", "title": "B", "parents": ["a"]},
            ],
        }
    )
    ids = {item["client_id"]: item["task_id"] for item in created["created"]}

    cycle = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": created["graph_revision"],
            "mutation_id": "m-cycle",
            "operations": [{"op": "set_parents", "task_id": ids["a"], "parents": [ids["b"]]}],
        }
    )
    assert cycle["ok"] is False
    assert cycle["error"] == "validation_failed"
    assert "cycle" in cycle["message"]

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        ready = kb.create_task(conn, title="Dispatchable", assignee="worker")
        assert kb.get_task(conn, ready).status == "ready"
    finally:
        conn.close()

    unsafe = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": created["graph_revision"],
            "mutation_id": "m-unsafe",
            "operations": [{"op": "update_node", "task_id": ready, "title": "Nope"}],
        }
    )
    assert unsafe["ok"] is False
    assert unsafe["error"] == "unsafe_status"


def test_patch_can_rewire_a_pending_live_skeleton_to_completed_results(loop_env):
    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    conn = kb.connect()
    try:
        root = kb.create_task(conn, title="Live root", initial_status="scheduled")
        with kb.write_txn(conn):
            conn.execute("UPDATE tasks SET created_by = ? WHERE id = ?", (f"loop:{root}", root))
        completed = kb.create_task(conn, title="Known result", created_by=f"loop:{root}")
        kb.complete_task(conn, completed, summary="Reusable result")
        waiting = kb.create_task(conn, title="Unfinished gate", created_by=f"loop:{root}")
        skeleton = kb.create_task(
            conn,
            title="Pending skeleton",
            created_by=f"loop:{root}",
            parents=[waiting],
            needs_specification=True,
        )
        revision = graph.graph_revision(conn, root)
        result = graph.apply_patch(
            conn,
            root,
            expected_revision=revision,
            mutation_id="rewire-pending-skeleton",
            operations=[{"op": "set_parents", "task_id": skeleton, "parents": [completed]}],
        )
        task = kb.get_task(conn, skeleton)
        assert result["ok"] is True
        assert kb.parent_ids(conn, skeleton) == [completed]
        assert task.status == "triage"
        assert task.needs_specification is True
    finally:
        conn.close()


def test_archiving_live_nodes_recomputes_children_and_root_in_same_patch(loop_env):
    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    conn = kb.connect()
    try:
        root = kb.create_task(
            conn,
            title="Foreground root",
            initial_status="scheduled",
            assignee="must-be-cleared",
        )
        with kb.write_txn(conn):
            conn.execute(
                "UPDATE tasks SET created_by = ? WHERE id = ?",
                (f"loop:{root}", root),
            )
        created = kb.create_loop_skeleton_graph(
            conn,
            root_task_id=root,
            nodes=[
                {"client_id": "parent", "title": "Pending parent"},
                {
                    "client_id": "child",
                    "title": "Blocked child",
                    "depends_on": ["parent"],
                },
            ],
        )
        items = {item["client_id"]: item["task_id"] for item in created["items"]}

        first = graph.apply_patch(
            conn,
            root,
            expected_revision=graph.graph_revision(conn, root),
            mutation_id="archive-parent-and-promote-child",
            operations=[{"op": "archive_node", "task_id": items["parent"]}],
        )
        child_after_parent_archive = kb.get_task(conn, items["child"])

        graph.apply_patch(
            conn,
            root,
            expected_revision=first["graph_revision"],
            mutation_id="archive-last-sink-and-promote-root",
            operations=[{"op": "archive_node", "task_id": items["child"]}],
        )
        root_after_sink_archive = kb.get_task(conn, root)

        assert child_after_parent_archive is not None
        assert child_after_parent_archive.status == "triage"
        assert child_after_parent_archive.needs_specification is True
        assert kb.parent_ids(conn, items["child"]) == []
        assert root_after_sink_archive is not None
        assert root_after_sink_archive.status == "ready"
        assert root_after_sink_archive.assignee is None
        assert kb.parent_ids(conn, root) == []
    finally:
        conn.close()


@pytest.mark.parametrize("op_name", ["update_node", "set_parents", "archive_node", "mark_node"])
def test_patch_rejects_canonical_root_mutation(loop_env, op_name):
    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    conn = kb.connect()
    try:
        root = kb.create_task(conn, title="Original root request", initial_status="scheduled")
        with kb.write_txn(conn):
            conn.execute(
                "UPDATE tasks SET created_by = ? WHERE id = ?",
                (f"loop:{root}", root),
            )
        revision = graph.graph_revision(conn, root)
    finally:
        conn.close()

    operation = {"op": op_name, "task_id": root}
    if op_name == "update_node":
        operation["title"] = "Overwritten root"
    elif op_name == "set_parents":
        operation["parents"] = []
    elif op_name == "mark_node":
        operation["active"] = True
    outcome = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": revision,
            "mutation_id": f"reject-root-{op_name}",
            "operations": [operation],
        }
    )

    assert outcome["ok"] is False
    assert outcome["error"] == "root_immutable"
    conn = kb.connect()
    try:
        task = kb.get_task(conn, root)
        assert task is not None
        assert task.title == "Original root request"
        assert task.status == "scheduled"
    finally:
        conn.close()


@pytest.mark.parametrize("op_name", ["update_node", "set_parents", "archive_node", "mark_node"])
def test_patch_rejects_compiled_shell_while_decomposition_child_is_active(
    loop_env, op_name
):
    from hermes_cli import kanban_db as kb
    from hermes_cli import loop_graph as graph

    conn = kb.connect()
    try:
        root = kb.create_task(conn, title="Live root", initial_status="scheduled")
        with kb.write_txn(conn):
            conn.execute(
                "UPDATE tasks SET created_by = ? WHERE id = ?",
                (f"loop:{root}", root),
            )
        created = kb.create_loop_skeleton_graph(
            conn,
            root_task_id=root,
            nodes=[{"client_id": "shell", "title": "Compiled shell"}],
        )
        shell_id = created["items"][0]["task_id"]
        [child_id] = kb.decompose_triage_task(
            conn,
            shell_id,
            root_assignee="orchestrator",
            children=[
                {
                    "title": "Generated child",
                    "body": "Do generated work",
                    "assignee": "worker-a",
                    "parents": [],
                }
            ],
            author="test-decomposer",
        )
        assert kb.claim_task(conn, child_id, claimer="worker-a:active") is not None
        revision = graph.graph_revision(conn, root)
    finally:
        conn.close()

    operation = {"op": op_name, "task_id": shell_id}
    if op_name == "update_node":
        operation["title"] = "Unsafe rewrite"
    elif op_name == "set_parents":
        operation["parents"] = []
    elif op_name == "mark_node":
        operation["active"] = True
    outcome = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": revision,
            "mutation_id": f"reject-active-shell-{op_name}",
            "operations": [operation],
        }
    )

    assert outcome["ok"] is False
    assert outcome["error"] == "unsafe_status"
    assert "decomposition children are still active" in outcome["message"]
    conn = kb.connect()
    try:
        shell = kb.get_task(conn, shell_id)
        assert shell is not None
        assert shell.status == "todo"
        assert kb.active_decomposition_child_ids(conn, shell_id) == [child_id]
    finally:
        conn.close()


def test_read_returns_revision_and_optional_dependency_derived_nodes(loop_env):
    root = loop_env
    patched = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": 0,
            "mutation_id": "m-read",
            "operations": [
                {"op": "add_node", "client_id": "a", "title": "A", "active": True},
                {"op": "add_node", "client_id": "b", "title": "B", "parents": ["a"], "frontier": True},
            ],
        }
    )
    read = _call({"action": "read", "root_task_id": root, "include_nodes": True})
    assert read["ok"] is True
    assert read["graph_revision"] == patched["graph_revision"]
    assert [node["depth"] for node in read["nodes"]] == [0, 1]
    assert read["nodes"][0]["active"] is True
    assert read["nodes"][1]["frontier"] is True


def _node_by_task(graph: dict, task_id: str) -> dict:
    for node in graph.get("nodes") or []:
        if node.get("task_id") == task_id:
            return node
    raise AssertionError(f"node {task_id} not found: {graph}")


def test_read_omits_foreground_handoff_after_removal(loop_env):
    root = loop_env

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        worker = kb.create_task(conn, title="Contract tests", assignee="worker", created_by=f"loop:{root}")
        with kb.write_txn(conn):
            kb._append_event(
                conn,
                worker,
                "loop_node_state",
                {"root_task_id": root, "client_id": "contract-tests", "active": True, "frontier": True},
            )
        assert kb.claim_task(conn, worker, claimer="worker-host:1") is not None
        assert kb.complete_task(conn, worker, summary="tests define handoff contract")
    finally:
        conn.close()

    read = _call({"action": "read", "root_task_id": root, "include_nodes": True})
    node = _node_by_task(read, worker)
    assert "attention" not in node
    assert "verification_state" not in node
    assert "handoff" not in node
    assert read["pending_handoffs"] == []


def test_resolve_handoff_rejects_without_pending_handoff(loop_env):
    root = loop_env

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        parent = kb.create_task(conn, title="Parent worker", assignee="worker", created_by=f"loop:{root}")
        child = kb.create_task(conn, title="Downstream worker", assignee="worker", created_by=f"loop:{root}", parents=[parent])
        with kb.write_txn(conn):
            kb._append_event(
                conn,
                parent,
                "loop_node_state",
                {"root_task_id": root, "client_id": "parent-worker", "active": True, "frontier": True},
            )
            kb._append_event(
                conn,
                child,
                "loop_node_state",
                {"root_task_id": root, "client_id": "downstream-worker", "active": False, "frontier": False},
            )
        assert kb.claim_task(conn, parent, claimer="worker-host:2") is not None
        assert kb.complete_task(conn, parent, summary="done but awaiting foreground")
    finally:
        conn.close()

    before = _call({"action": "read", "root_task_id": root, "include_nodes": True})
    patched = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": before["graph_revision"],
            "mutation_id": "resolve-parent-handoff",
            "operations": [
                {
                    "op": "resolve_handoff",
                    "task_id": parent,
                    "handoff_kind": "worker_completed",
                    "verification_state": "approved",
                    "attention": None,
                    "resolution_summary": "foreground accepted evidence",
                }
            ],
        }
    )
    assert patched["ok"] is False
    assert patched["error"] == "validation_failed"
    assert "no pending Loop handoff" in patched["message"]


def test_resolve_handoff_rejects_non_loop_target(loop_env):
    root = loop_env

    from hermes_cli import kanban_db as kb

    conn = kb.connect()
    try:
        plain = kb.create_task(conn, title="Plain task", assignee="worker")
    finally:
        conn.close()

    before = _call({"action": "read", "root_task_id": root, "include_nodes": True})
    out = _call(
        {
            "action": "patch",
            "root_task_id": root,
            "expected_revision": before["graph_revision"],
            "mutation_id": "reject-plain",
            "operations": [{"op": "resolve_handoff", "task_id": plain, "verification_state": "approved"}],
        }
    )
    assert out["ok"] is False
    assert out["error"] == "wrong_root"
