"""Offline installer behavior for fork-aware desktop bootstrap pins."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"


def _run(
    *args: str,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        cwd=cwd,
        env=env,
        capture_output=True,
        check=False,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result


def _managed_checkout(tmp_path: Path) -> tuple[Path, Path, str]:
    seed = tmp_path / "seed"
    old_remote = tmp_path / "old.git"
    target_remote = tmp_path / "target.git"
    checkout = tmp_path / "checkout"

    _run("git", "init", "-b", "main", str(seed))
    _run("git", "config", "user.name", "Installer Test", cwd=seed)
    _run("git", "config", "user.email", "installer@example.invalid", cwd=seed)
    (seed / "version.txt").write_text("base\n", encoding="utf-8")
    (seed / "user-config.txt").write_text("base\n", encoding="utf-8")
    _run("git", "add", "version.txt", "user-config.txt", cwd=seed)
    _run("git", "commit", "-m", "base", cwd=seed)

    _run("git", "init", "--bare", str(old_remote))
    _run("git", "init", "--bare", str(target_remote))
    _run("git", "remote", "add", "old", str(old_remote), cwd=seed)
    _run("git", "remote", "add", "target", str(target_remote), cwd=seed)
    _run("git", "push", "old", "main", cwd=seed)
    _run("git", "push", "target", "main", cwd=seed)

    (seed / "version.txt").write_text("fork\n", encoding="utf-8")
    _run("git", "commit", "-am", "fork update", cwd=seed)
    target_commit = _run("git", "rev-parse", "HEAD", cwd=seed).stdout.strip()
    _run("git", "push", "target", "main", cwd=seed)

    _run("git", "clone", "--branch", "main", str(old_remote), str(checkout))
    (checkout / "user-config.txt").write_text("local customization\n", encoding="utf-8")
    (checkout / "local-note.txt").write_text("preserve me\n", encoding="utf-8")

    git_config = tmp_path / "gitconfig"
    _run(
        "git",
        "config",
        "--file",
        str(git_config),
        f"url.file://{target_remote}.insteadOf",
        "https://github.com/ytheesh96/hermes-loop.git",
    )
    return checkout, git_config, target_commit


def _assert_checkout_retargeted(checkout: Path, target_commit: str) -> None:
    origin = _run("git", "remote", "get-url", "origin", cwd=checkout).stdout.strip()
    assert origin == "https://github.com/ytheesh96/hermes-loop.git"
    assert _run("git", "rev-parse", "HEAD", cwd=checkout).stdout.strip() == target_commit
    assert (checkout / "user-config.txt").read_text(encoding="utf-8") == "local customization\n"
    assert (checkout / "local-note.txt").read_text(encoding="utf-8") == "preserve me\n"
    assert _run("git", "stash", "list", cwd=checkout).stdout.strip() == ""


def test_install_sh_accepts_repository_override() -> None:
    result = subprocess.run(
        [
            "bash",
            str(INSTALL_SH),
            "--repository",
            "ytheesh96/hermes-loop",
            "--help",
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "--repository OWNER/REPO" in result.stdout


def test_install_sh_retargets_existing_checkout_without_losing_local_work(tmp_path: Path) -> None:
    checkout, git_config, target_commit = _managed_checkout(tmp_path)
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": str(git_config),
        "HOME": str(tmp_path / "home"),
    }

    result = subprocess.run(
        [
            "bash",
            str(INSTALL_SH),
            "--stage",
            "repository",
            "--json",
            "--non-interactive",
            "--dir",
            str(checkout),
            "--hermes-home",
            str(tmp_path / "hermes-home"),
            "--branch",
            "main",
            "--repository",
            "ytheesh96/hermes-loop",
        ],
        env=env,
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    _assert_checkout_retargeted(checkout, target_commit)


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell installer behavior runs on Windows CI")
def test_install_ps1_retargets_existing_checkout_without_losing_local_work(tmp_path: Path) -> None:
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
    assert powershell is not None, "Windows CI must provide PowerShell"
    checkout, git_config, target_commit = _managed_checkout(tmp_path)
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": str(git_config),
        "HOME": str(tmp_path / "home"),
    }

    result = subprocess.run(
        [
            powershell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(INSTALL_PS1),
            "-Stage",
            "repository",
            "-NonInteractive",
            "-Json",
            "-InstallDir",
            str(checkout),
            "-HermesHome",
            str(tmp_path / "hermes-home"),
            "-Branch",
            "main",
            "-Repository",
            "ytheesh96/hermes-loop",
        ],
        env=env,
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    _assert_checkout_retargeted(checkout, target_commit)
