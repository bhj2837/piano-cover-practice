"""MIDI + 원음 → 떨어지는 막대 미리보기 페이지 (모델별 MIDI 를 바꿔 가며 원음과 귀로 대조).

사용: python preview.py data/곡.wav out/곡 transkun=data/곡_transkun.mid bytedance=data/곡_bytedance.mid
"""
import json
import subprocess
import sys
from pathlib import Path

from make_song import build_notes

RATES = ["1", "0.75", "0.5"]  # 느린 원음은 ffmpeg atempo 로 미리 만든다 (음높이 유지)

wav, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


models = {}
for arg in sys.argv[3:]:
    name, mid = arg.split("=", 1)
    models[name] = build_notes(mid)

for rate in RATES:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-filter:a", f"atempo={rate}",
                    "-b:a", "128k", str(out / f"original_{rate}.mp3")], check=True)

template = (Path(__file__).parent / "preview_template.html").read_text()
(out / "index.html").write_text(template.replace("/*NOTES*/{}", json.dumps(models)))
print(out / "index.html", {k: len(v) for k, v in models.items()})
