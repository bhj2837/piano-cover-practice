"""유튜브 링크 → 연습 앱용 곡 파일(.pcsong) 하나.

사용: python make_song.py <유튜브 링크> [--out songs]

.pcsong 구조: b"PCS1" + JSON 길이(4바이트, little endian) + JSON + 오디오 바이트
  JSON = {title, source, duration, notes, audio: {"1": [offset, length], "0.75": ..., "0.5": ...}}
  offset 은 JSON 이 끝난 지점부터 센다
  notes = [[start, 누른 끝, pitch, velocity, hand(0=오른손,1=왼손), 페달 포함 끝], ...] start 순
"""
import argparse
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

import pretty_midi

import transcribe

RATES = ["1", "0.75", "0.5"]  # 느린 원음은 ffmpeg atempo 로 미리 만든다 (음높이 유지)
WORK = Path(__file__).parent / "data"


def pedal_spans(m):
    """서스테인 페달(CC64)이 밟혀 있는 구간 [(down, up), ...]"""
    spans, down = [], None
    ccs = sorted((c for i in m.instruments for c in i.control_changes if c.number == 64), key=lambda c: c.time)
    for c in ccs:
        if c.value >= 64 and down is None:
            down = c.time
        elif c.value < 64 and down is not None:
            spans.append((down, c.time)); down = None
    return spans


def sounding_end(n, spans, next_onset):
    """건반을 뗄 때 페달이 밟혀 있으면 페달을 뗄 때까지 울린다. 같은 음을 다시 치면 거기서 끊는다"""
    end = n.end
    for down, up in spans:
        if down <= n.end < up:
            end = up
            break
    return min(end, next_onset)


def build_notes(mid_path):
    m = pretty_midi.PrettyMIDI(str(mid_path))
    spans = pedal_spans(m)
    rows = sorted(((n, hand) for hand, inst in enumerate(m.instruments)  # 0 = 오른손, 1 = 왼손
                   for n in inst.notes), key=lambda x: x[0].start)
    next_onset, out = {}, []
    for n, hand in reversed(rows):
        out.append([round(n.start, 3), round(n.end, 3), n.pitch, n.velocity, hand,
                    round(sounding_end(n, spans, next_onset.get(n.pitch, 1e9)), 3)])
        next_onset[n.pitch] = n.start
    return out[::-1]


def encode_mp3(wav, rate):
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(wav), "-filter:a", f"atempo={rate}",
                           "-b:a", "128k", "-f", "mp3", "-"], check=True, capture_output=True).stdout


def download(url):
    ytdlp = [sys.executable, "-m", "yt_dlp", "-q", "--no-warnings"]
    info = json.loads(subprocess.run(ytdlp + ["-J", url], check=True, capture_output=True).stdout)
    wav = WORK / f"{info['id']}.wav"
    if not wav.exists():
        subprocess.run(ytdlp + ["-f", "bestaudio", "-x", "--audio-format", "wav",
                                "-o", str(WORK / f"{info['id']}.%(ext)s"), url], check=True)
    return info, wav


def write_song(path, meta, audio):
    offset, blobs = 0, []
    meta["audio"] = {}
    for rate, data in audio.items():
        meta["audio"][rate] = [offset, len(data)]
        offset += len(data); blobs.append(data)
    head = json.dumps(meta, ensure_ascii=False).encode()
    with open(path, "wb") as f:
        f.write(b"PCS1" + struct.pack("<I", len(head)) + head)
        for b in blobs:
            f.write(b)


def make_song(url, out_dir, name=None, log=print):
    """링크 하나를 곡 파일로 만든다. name 이 없으면 영상 제목을 파일 이름으로 쓴다"""
    WORK.mkdir(exist_ok=True); out_dir.mkdir(parents=True, exist_ok=True)
    log("1/4 음원 받는 중")
    info, wav = download(url)
    log("2/4 음표 인식 중 (transkun)")
    mid = WORK / f"{info['id']}_transkun.mid"
    raw = WORK / f"{info['id']}_transkun_raw.mid"
    if not raw.exists():
        transcribe.transcribe_transkun(wav, raw)
    transcribe.split_hands(raw, mid)
    log("3/4 원음 속도별로 만드는 중")
    audio = {r: encode_mp3(wav, r) for r in RATES}
    log("4/4 곡 파일 쓰는 중")
    meta = {"title": info["title"], "source": info.get("webpage_url", url),
            "duration": info.get("duration"), "notes": build_notes(mid)}
    if name is None:
        name = re.sub(r'[\\/:*?"<>|]', "_", info["title"]).strip()[:80]
    path = out_dir / f"{name}.pcsong"
    write_song(path, meta, audio)
    log(f"완료: {path}  ({path.stat().st_size / 1e6:.1f}MB, 음 {len(meta['notes'])}개)")
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "songs")
    a = ap.parse_args()
    make_song(a.url, a.out)
