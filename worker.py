"""비공개 곡 저장소의 대기열을 처리한다. PC 가 켜질 때 돌려 둔다.

사용: python worker.py [--repo bhj2837/piano-cover-songs] [--watch 60]
  --watch 없이: 쌓인 것만 처리하고 끝난다
  --watch N  : N초마다 다시 본다 (PC 가 켜져 있는 동안 계속)

저장소 구조 — 폰 앱(app/app.js)과의 약속
  queue/<영상ID>.json    {"url": ..., "requested": ...}   앱이 넣는다
  songs/<영상ID>.pcsong                                   worker 가 넣는다
  failed/<영상ID>.json   {"url": ..., "error": ...}       worker 가 넣는다 (앱에서 지울 수 있다)
"""
import argparse
import json
import subprocess
import time
import traceback
from datetime import datetime
from pathlib import Path

from make_song import make_song

HERE = Path(__file__).parent
LOG = HERE / "worker.log"


def log(msg):
    line = f"{datetime.now():%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def git(repo_dir, *args):
    return subprocess.run(["git", "-C", str(repo_dir), *args], check=True, capture_output=True, text=True).stdout


def sync(repo_dir, repo):
    if not (repo_dir / ".git").exists():
        subprocess.run(["git", "clone", "-q", f"https://github.com/{repo}.git", str(repo_dir)], check=True)
    git(repo_dir, "pull", "-q", "--rebase")


def push(repo_dir, message):
    git(repo_dir, "add", "-A")
    git(repo_dir, "commit", "-q", "-m", message)
    for _ in range(3):  # 그 사이 폰이 대기열에 넣었으면 받아서 다시 민다
        try:
            git(repo_dir, "push", "-q")
            return
        except subprocess.CalledProcessError:
            git(repo_dir, "pull", "-q", "--rebase")
    git(repo_dir, "push", "-q")


def process(repo_dir):
    jobs = sorted((repo_dir / "queue").glob("*.json"))
    for job in jobs:
        vid, req = job.stem, json.loads(job.read_text(encoding="utf-8"))
        log(f"변환 시작 {vid} {req['url']}")
        try:
            make_song(req["url"], repo_dir / "songs", name=vid, log=lambda m: log(f"  {m}"))
            message = f"변환 {vid}"
        except Exception as e:
            err = getattr(e, "stderr", None)  # 명령 실패면 그 출력이 원인이다
            if isinstance(err, bytes):
                err = err.decode("utf-8", "replace")
            detail = err.strip()[-400:] if err else str(e)
            log(f"  실패: {detail}\n{traceback.format_exc()}")
            (repo_dir / "failed").mkdir(exist_ok=True)
            (repo_dir / "failed" / f"{vid}.json").write_text(json.dumps(
                {"url": req["url"], "error": detail or e.__class__.__name__, "at": datetime.now().isoformat()},
                ensure_ascii=False), encoding="utf-8")
            message = f"실패 {vid}"
        job.unlink()
        push(repo_dir, message)
    return len(jobs)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="bhj2837/piano-cover-songs")
    ap.add_argument("--dir", type=Path, default=HERE / "songs-repo")
    ap.add_argument("--watch", type=int, default=0, help="초. 0 이면 한 번만")
    a = ap.parse_args()
    while True:
        try:
            sync(a.dir, a.repo)
            n = process(a.dir)
            if n:
                log(f"대기열 {n}곡 처리 끝")
        except Exception as e:  # 네트워크가 끊겨도 --watch 는 계속 돈다
            log(f"동기화 실패: {e}")
        if not a.watch:
            break
        time.sleep(a.watch)
