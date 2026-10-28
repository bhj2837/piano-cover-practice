"""손 분리 정확도 — 두 단 악보의 「높은음자리표 단 = 오른손, 낮은음자리표 단 = 왼손」 을 정답으로 본다.

사용: python eval_hands.py   (개발용. music21 이 필요하다: uv pip install music21)

단과 손이 항상 같지는 않다 (단을 넘나드는 음, 왼손이 높은 단에 적힌 경우). 그래서 절대 정확도가 아니라
  고정 분할과 비교하는 잣대로만 쓴다.
"""
import warnings

from music21 import corpus

import hands

warnings.filterwarnings("ignore")
SEC_PER_QUARTER = 0.6  # 4분음표 하나를 몇 초로 볼지 (빠르기 100)

PIECES = [
    "mozart/k545/movement1_exposition.mxl",
    "joplin/maple_leaf_rag.mxl",
    "cpebach/h186.mxl",
    "schumann_clara/polonaise_op1n1.mxl",
    "schumann_clara/polonaise_op1n2.mxl",
    "schumann_clara/polonaise_op1n3.mxl",
    "schumann_clara/polonaise_op1n4.mxl",
    "schoenberg/opus19/movement2.mxl",
    "schoenberg/opus19/movement6.mxl",
]


def load(path):
    """[(start, end, pitch)], [정답 손] — 위 단(0) = 오른손, 아래 단(1) = 왼손"""
    sc = corpus.parse(path)
    notes, truth = [], []
    for hand, part in enumerate(sc.parts[:2]):
        for el in part.stripTies().flatten().notes:
            s = float(el.getOffsetInHierarchy(sc)) * SEC_PER_QUARTER
            e = s + max(float(el.quarterLength), 0.05) * SEC_PER_QUARTER
            for p in el.pitches:
                notes.append((s, e, p.midi)); truth.append(hand)
    return notes, truth


def accuracy(pred, truth):
    return sum(p == t for p, t in zip(pred, truth)) / len(truth)


if __name__ == "__main__":
    rows, tot = [], {"fixed": [0, 0], "track": [0, 0]}
    for path in PIECES:
        notes, truth = load(path)
        fixed = [0 if p >= 60 else 1 for _, _, p in notes]
        track = hands.assign_hands(notes)
        for k, pred in (("fixed", fixed), ("track", track)):
            tot[k][0] += sum(a == b for a, b in zip(pred, truth)); tot[k][1] += len(truth)
        rows.append((path, len(notes), accuracy(fixed, truth), accuracy(track, truth)))
    print(f"{'곡':44} {'음':>5} {'고정':>7} {'추적':>7}")
    for path, n, f, t in rows:
        print(f"{path:44} {n:5d} {f:7.1%} {t:7.1%}")
    print(f"{'전체':44} {tot['fixed'][1]:5d} {tot['fixed'][0] / tot['fixed'][1]:7.1%} {tot['track'][0] / tot['track'][1]:7.1%}")
