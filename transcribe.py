"""오디오(wav) → 손 분리된 MIDI (트랙 0 = 오른손, 트랙 1 = 왼손).

사용: python transcribe.py data/곡.wav data/곡.mid [--model transkun|bytedance]

모델 비교 (2026-10-27, 「루프 더 룸」 커버 2분 23초, 맥북)
- transkun : 약 20초. 같은 음이 잘게 끊기는 일 없음, G6 이상 4개
- bytedance: 약 7분. 같은 음 867곳이 30ms 안쪽으로 끊김, G6 이상 304개(신스 배음으로 추정)
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

import pretty_midi

import hands

MIN_DUR = 0.03    # 이보다 짧은 음은 인식 잡음으로 보고 버린다


def transcribe_transkun(wav_path, raw_midi_path):
    # 실행 파일 경로가 윈도우(Scripts\transkun.exe)와 맥(bin/transkun)에서 달라 모듈로 부른다
    subprocess.run([sys.executable, "-m", "transkun.transcribe", str(wav_path), str(raw_midi_path)],
                   check=True, stderr=subprocess.DEVNULL)


def transcribe_bytedance(wav_path, raw_midi_path):
    import librosa
    import torch
    from piano_transcription_inference import PianoTranscription, sample_rate

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    # 패키지의 load_audio 는 librosa 0.10+ 에서 깨져 librosa 로 직접 읽는다
    audio, _ = librosa.load(wav_path, sr=sample_rate, mono=True)
    try:
        PianoTranscription(device=device).transcribe(audio, str(raw_midi_path))
    except Exception as e:  # MPS 미지원 연산이 있으면 CPU 로
        print(f"{device} 실패({e.__class__.__name__}), cpu 로 재시도")
        PianoTranscription(device="cpu").transcribe(audio, str(raw_midi_path))


MODELS = {"transkun": transcribe_transkun, "bytedance": transcribe_bytedance}


def split_hands(raw_midi_path, out_path, method="track"):
    """method: track = 손 위치 추적(hands.py), fixed = 가운데 도 고정 분할(첫 판, 비교용)"""
    src = pretty_midi.PrettyMIDI(str(raw_midi_path))
    notes = [n for inst in src.instruments for n in inst.notes]
    kept = [n for n in notes if n.end - n.start >= MIN_DUR]
    if method == "fixed":
        which = [0 if n.pitch >= 60 else 1 for n in kept]
    else:
        which = hands.assign_hands([(n.start, n.end, n.pitch) for n in kept])
    out = pretty_midi.PrettyMIDI()
    right = pretty_midi.Instrument(program=0, name="Right Hand")
    left = pretty_midi.Instrument(program=0, name="Left Hand")
    for n, h in zip(kept, which):
        (left if h else right).notes.append(n)
    # 서스테인 페달은 오른손 트랙에 둔다
    right.control_changes = [cc for inst in src.instruments for cc in inst.control_changes]
    out.instruments += [right, left]
    out.write(str(out_path))
    print(f"음 {len(notes)}개 → 짧은 음 {len(notes) - len(kept)}개 제거 → "
          f"오른손 {len(right.notes)} / 왼손 {len(left.notes)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("wav", type=Path)
    ap.add_argument("mid", type=Path)
    ap.add_argument("--model", choices=MODELS, default="transkun")
    a = ap.parse_args()
    raw = a.mid.with_name(a.mid.stem + "_raw.mid")
    t = time.time()
    MODELS[a.model](a.wav, raw)
    print(f"{a.model} 인식 {time.time() - t:.0f}초")
    split_hands(raw, a.mid)
