"""음표마다 왼손/오른손을 정한다.

고정 분할(가운데 도)은 왼손이 도 위로 올라가거나 손이 겹치면 틀린다.
여기서는 시간을 따라가며 두 손의 위치를 추적한다.

- 거의 같이 시작한 음(CHORD_GAP 안)은 한 덩어리로 보고, 높이 순으로 늘어놓아 「어디서 자를지」만 고른다
- 자르는 자리마다 비용을 매긴다
    한 손이 닿는 폭(지금 누르고 있는 음 포함)을 넘으면 크게
    한 손에 손가락보다 많은 음이면 크게
    두 손이 엇갈리면(왼손 음이 오른손 음보다 높으면) 크게
    직전 손 위치에서 멀리 움직일수록 조금
    왼손이 너무 높거나 오른손이 너무 낮으면 조금
- 덩어리마다 비용이 낮은 후보 BEAM 개를 들고 가서 끝에서 가장 싼 길을 고른다
"""
import math

CHORD_GAP = 0.035   # 초. 이 안에 시작한 음은 같이 누른 것으로 본다
SPAN = 14           # 반음. 한 손이 무리 없이 닿는 폭 (도~레, 9도)
FINGERS = 5
BEAM = 16

W_SPAN = 4.0        # 폭을 1반음 넘길 때마다
W_FINGERS = 20.0    # 손가락이 1개 모자랄 때마다
W_CROSS = 4.0       # 엇갈림 1반음마다
W_MOVE = 0.15       # 손 위치 이동 1반음마다
W_PRIOR = 0.3       # 기준 음역을 1반음 벗어날 때마다
LEFT_TOP, RIGHT_BOTTOM = 67, 53   # 왼손은 솔4, 오른손은 파3 아래로 잘 안 간다
RECENTER = 2.0      # 초. 이만큼 쉬면 손 위치 기억이 흐려져 이동 비용이 줄어든다


def _clusters(notes):
    order = sorted(range(len(notes)), key=lambda i: (notes[i][0], notes[i][2]))
    out, cur = [], []
    for i in order:
        if cur and notes[i][0] - notes[cur[0]][0] > CHORD_GAP:
            out.append(cur); cur = []
        cur.append(i)
    if cur:
        out.append(cur)
    return [sorted(c, key=lambda i: notes[i][2]) for c in out]


def _hand_cost(new, held, center, idle, side):
    """한 손에 new(음높이들)를 줄 때의 비용. held = 그 손이 아직 누르고 있는 음"""
    if not new:
        return 0.0
    allp = new + held
    cost = W_SPAN * max(0, max(allp) - min(allp) - SPAN)
    cost += W_FINGERS * max(0, len(set(allp)) - FINGERS)
    if center is not None:
        fade = math.exp(-idle / RECENTER)
        cost += W_MOVE * fade * abs(sum(new) / len(new) - center)
    if side == 0:
        cost += W_PRIOR * sum(max(0, p - LEFT_TOP) for p in new)
    else:
        cost += W_PRIOR * sum(max(0, RIGHT_BOTTOM - p) for p in new)
    return cost


def assign_hands(notes):
    """notes = [(start, end, pitch), ...] → 같은 순서의 손 목록 (0 = 오른손, 1 = 왼손)"""
    if not notes:
        return []
    # 상태: (비용, 왼손 위치, 오른손 위치, 왼손 마지막 시각, 오른손 마지막 시각, 왼손 누른 음, 오른손 누른 음, 손 배정)
    beam = [(0.0, None, None, -1e9, -1e9, (), (), {})]
    for cl in _clusters(notes):
        t = notes[cl[0]][0]
        ps = [notes[i][2] for i in cl]
        nxt = []
        for cost, lc, rc, lt, rt, lh, rh, asg in beam:
            lh = tuple(x for x in lh if x[0] > t + CHORD_GAP)  # (끝 시각, 음높이) — 아직 누르고 있는 것만
            rh = tuple(x for x in rh if x[0] > t + CHORD_GAP)
            lheld, rheld = [p for _, p in lh], [p for _, p in rh]
            for k in range(len(cl) + 1):   # 아래 k개는 왼손, 나머지는 오른손
                left, right = ps[:k], ps[k:]
                c = cost + _hand_cost(left, lheld, lc, t - lt, 0) + _hand_cost(right, rheld, rc, t - rt, 1)
                lo_r = min(right + rheld, default=None)
                hi_l = max(left + lheld, default=None)
                if lo_r is not None and hi_l is not None and hi_l > lo_r:
                    c += W_CROSS * (hi_l - lo_r)
                a = dict(asg)
                for j, i in enumerate(cl):
                    a[i] = 1 if j < k else 0
                nlc = (sum(left) / len(left) if lc is None else 0.5 * lc + 0.5 * sum(left) / len(left)) if left else lc
                nrc = (sum(right) / len(right) if rc is None else 0.5 * rc + 0.5 * sum(right) / len(right)) if right else rc
                nxt.append((c, nlc, nrc, t if left else lt, t if right else rt,
                            lh + tuple((notes[i][1], notes[i][2]) for i in cl[:k]),
                            rh + tuple((notes[i][1], notes[i][2]) for i in cl[k:]), a))
        nxt.sort(key=lambda s: s[0])
        # 같은 손 위치로 모이는 후보는 하나만 남겨 다양성을 지킨다
        seen, beam = set(), []
        for s in nxt:
            key = (None if s[1] is None else round(s[1]), None if s[2] is None else round(s[2]))
            if key in seen:
                continue
            seen.add(key); beam.append(s)
            if len(beam) == BEAM:
                break
    best = beam[0][7]
    return [best[i] for i in range(len(notes))]
