"""D-01 最長共通部分列 (LCS) と diff の検算。

記事に書いた数値とクイズの正答を、標準ライブラリだけで計算し直して確かめる。
通れば短いまとめを出し、1 つでも違えば終了コード 1 で止まる。
"""

import itertools
import sys

A = "ABCABBA"
B = "CBABAC"
N, M = len(A), len(B)

# 記事に書いた値 ------------------------------------------------------------

# 表 L(i, j)。記事と同じく、行が j (B の長さ)、列が i (A の長さ)
TABLE_BY_J = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1],
    [0, 0, 1, 1, 1, 2, 2, 2],
    [0, 1, 1, 1, 2, 2, 2, 3],
    [0, 1, 2, 2, 2, 3, 3, 3],
    [0, 1, 2, 2, 3, 3, 3, 4],
    [0, 1, 2, 3, 3, 3, 3, 4],
]
LCS_LEN = 4
SES_LEN = 5
DELETES, INSERTS = 3, 2
EDGES = 9  # 経路の辺の数 N + M - L
ALL_LCS = {"BABA", "CABA", "CBBA"}
IF_COUNT = 42  # 漸化式の判定の回数 N * M

# 戻り方 (削除を先にする規則) の経路と、斜めに進んだマス
TRACE_PATH = [(7, 6), (7, 5), (6, 4), (5, 3), (4, 3), (3, 2), (2, 2), (1, 1), (0, 1), (0, 0)]
TRACE_DIAG = [(2, 2), (4, 3), (6, 4), (7, 5)]
TRACE_STEPS = 9
TRACE_LCS = "BABA"
DIFF_LINES = ["-A", "+C", " B", "-C", " A", "-B", " B", " A", "+C"]
MYERS_SCRIPT_BABA = ["0IC", "1D", "3D", "5D", "7IC"]

# Myers の貪欲法
GREEDY_D = 5
GREEDY_K = 1  # N - M
GREEDY_ENDPOINTS = {
    0: {0: (0, 0)},
    1: {-1: (0, 1), 1: (1, 0)},
    2: {-2: (2, 4), 0: (2, 2), 2: (3, 1)},
    3: {-3: (3, 6), -1: (4, 5), 1: (5, 4), 3: (5, 2)},
    4: {-2: (4, 6), 0: (5, 5), 2: (7, 5), 4: (7, 3)},
    5: {-1: (5, 6), 1: (7, 6)},
}
GREEDY_PATH = [(0, 0), (1, 0), (2, 0), (3, 1), (3, 2), (4, 3), (5, 4), (6, 4), (7, 5), (7, 6)]
GREEDY_TRACE = [(3, 1), (4, 3), (5, 4), (7, 5)]
GREEDY_LCS = "CABA"
MYERS_SCRIPT_CABA = ["1D", "2D", "3IB", "6D", "7IC"]

# Hirschberg の分け方
SPLIT_I = 3
FWD_ROW = [0, 1, 1, 1, 2, 2, 3]
BWD_ROW = [3, 3, 3, 2, 1, 0, 0]
SUM_ROW = [3, 4, 4, 3, 3, 2, 3]
SPLIT_J = 1  # B を分ける位置 (和が最大になる最小の j)

# クイズ: (選択肢, 正答)
QUIZ1 = ([3, 5, 9], 5)
QUIZ2 = ([0, 2, 3], 3)

# 計算 ----------------------------------------------------------------------

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: 計算 {got!r} / 記事 {want!r}")


def lcs_table(a, b):
    t = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                t[i][j] = t[i - 1][j - 1] + 1
            else:
                t[i][j] = max(t[i - 1][j], t[i][j - 1])
    return t


L = lcs_table(A, B)
check("表", [[L[i][j] for i in range(N + 1)] for j in range(M + 1)], TABLE_BY_J)
check("L", L[N][M], LCS_LEN)
check("D = N+M-2L", N + M - 2 * L[N][M], SES_LEN)
check("削除の数 N-L", N - L[N][M], DELETES)
check("挿入の数 M-L", M - L[N][M], INSERTS)
check("辺の数 N+M-L", N + M - L[N][M], EDGES)
check("判定の回数", sum(1 for _ in itertools.product(range(N), range(M))), IF_COUNT)

# 総当たりで L と、異なる LCS の全部
brute = set()
for k in range(min(N, M), -1, -1):
    sa = {"".join(c) for c in itertools.combinations(A, k)}
    sb = {"".join(c) for c in itertools.combinations(B, k)}
    if sa & sb:
        check("総当たりの L", k, LCS_LEN)
        brute = sa & sb
        break
check("異なる LCS", brute, ALL_LCS)

# 戻り方: a_i = b_j なら斜め、そうでなく L(i-1,j) >= L(i,j-1) なら i を減らす (削除)、残りは j を減らす (挿入)
i, j = N, M
path, diag, ops = [(i, j)], [], []
while i > 0 or j > 0:
    if i > 0 and j > 0 and A[i - 1] == B[j - 1]:
        diag.append((i, j))
        ops.append(" " + A[i - 1])
        i, j = i - 1, j - 1
    elif j == 0 or (i > 0 and L[i - 1][j] >= L[i][j - 1]):
        ops.append("-" + A[i - 1])
        i -= 1
    else:
        ops.append("+" + B[j - 1])
        j -= 1
    path.append((i, j))
ops.reverse()
check("戻る経路", path, TRACE_PATH)
check("斜めのマス", sorted(diag), TRACE_DIAG)
check("戻り方の LCS", "".join(A[i - 1] for i, _ in sorted(diag)), TRACE_LCS)
check("戻る歩数", len(path) - 1, TRACE_STEPS)
check("戻りの歩数は N+M 以下", len(path) - 1 <= N + M, True)

# 差分の行: 一致しない連なりの中では、削除を先に並べる
diff, pend_del, pend_ins = [], [], []
for op in ops:
    if op[0] == " ":
        diff += pend_del + pend_ins + [op]
        pend_del, pend_ins = [], []
    elif op[0] == "-":
        pend_del.append(op)
    else:
        pend_ins.append(op)
diff += pend_del + pend_ins
check("差分の行", diff, DIFF_LINES)
check("差分の - の数", sum(d[0] == "-" for d in diff), DELETES)
check("差分の + の数", sum(d[0] == "+" for d in diff), INSERTS)


def myers_script(trace):
    """Myers 1986 §2 の決まりで、trace から編集の命令を作る。Fig. 1 と同じく x の小さい順に並べる"""
    xs = {x for x, _ in trace}
    dels = [(x, f"{x}D") for x in range(1, N + 1) if x not in xs]
    ins = []
    pts = [(0, 0)] + list(trace) + [(N + 1, M + 1)]
    for (x0, y0), (_, y1) in zip(pts, pts[1:]):
        if y0 + 1 < y1:
            ins.append((x0, f"{x0}I" + B[y0 : y1 - 1]))
    # 同じ x では削除を先に置く (x の削除の後に、a_x の後ろへ挿入する)
    return [c for _, c in sorted(dels + ins, key=lambda t: (t[0], "I" in t[1]))]


def is_trace(trace):
    return all(A[x - 1] == B[y - 1] for x, y in trace) and all(
        x0 < x1 and y0 < y1 for (x0, y0), (x1, y1) in zip(trace, trace[1:])
    )


check("BABA は trace", is_trace(sorted(diag)), True)
check("BABA の命令", myers_script(sorted(diag)), MYERS_SCRIPT_BABA)

# Myers の貪欲法 (Myers 1986 Fig. 2)。各 D の V を写して残し、後で経路を戻る
V = {1: 0}
history = []
found = None
for D in range(N + M + 1):
    ends = {}
    for k in range(-D, D + 1, 2):
        if k == -D or (k != D and V[k - 1] < V[k + 1]):
            x = V[k + 1]
        else:
            x = V[k - 1] + 1
        y = x - k
        while x < N and y < M and A[x] == B[y]:
            x, y = x + 1, y + 1
        V[k] = x
        if 0 <= x <= N and 0 <= y <= M:
            ends[k] = (x, y)
        if x >= N and y >= M:
            found = (D, k)
            break
    history.append((dict(V), ends))
    if found:
        break
check("貪欲法の D", found[0], GREEDY_D)
check("貪欲法の対角線", found[1], GREEDY_K)
check("N-M", N - M, GREEDY_K)
check("貪欲法の終点", {d: e for d, (_, e) in enumerate(history)}, GREEDY_ENDPOINTS)
for d, (_, ends) in enumerate(history):
    for k in ends:
        check(f"補題 1 (D={d}, k={k})", (k - d) % 2 == 0 and -d <= k <= d, True)

# 経路を戻る (Myers 1986 §3 の、V の写しを使う方法)
x, y = N, M
rev, trace = [(x, y)], []
for d in range(found[0], 0, -1):
    vp = history[d - 1][0]
    k = x - y
    if k == -d or (k != d and vp[k - 1] < vp[k + 1]):
        pk = k + 1
        sx = vp[pk]
    else:
        pk = k - 1
        sx = vp[pk] + 1
    while x > sx:
        trace.append((x, y))
        x, y = x - 1, y - 1
        rev.append((x, y))
    x, y = vp[pk], vp[pk] - pk
    rev.append((x, y))
while x > 0:
    trace.append((x, y))
    x, y = x - 1, y - 1
    rev.append((x, y))
gpath = rev[::-1]
check("貪欲法の経路", gpath, GREEDY_PATH)
check("貪欲法の trace", sorted(trace), GREEDY_TRACE)
check("貪欲法の LCS", "".join(A[x - 1] for x, _ in sorted(trace)), GREEDY_LCS)
check("CABA の命令", myers_script(GREEDY_TRACE), MYERS_SCRIPT_CABA)
steps = list(zip(gpath, gpath[1:]))
check("横の辺", sum(1 for (a, b), (c, d) in steps if c == a + 1 and d == b), DELETES)
check("縦の辺", sum(1 for (a, b), (c, d) in steps if c == a and d == b + 1), INSERTS)
check("斜めの辺", sum(1 for (a, b), (c, d) in steps if c == a + 1 and d == b + 1), LCS_LEN)
check("経路の辺の数", len(steps), EDGES)


# Hirschberg: 前の行だけで最後の行を出す (Algorithm B)
def last_row(a, b):
    prev = [0] * (len(b) + 1)
    for ch in a:
        cur = [0]
        for jj, cb in enumerate(b, 1):
            cur.append(prev[jj - 1] + 1 if ch == cb else max(prev[jj], cur[jj - 1]))
        prev = cur
    return prev


check("分ける位置", N // 2, SPLIT_I)
fwd = last_row(A[:SPLIT_I], B)
bwd_rev = last_row(A[SPLIT_I:][::-1], B[::-1])
bwd = [bwd_rev[M - jj] for jj in range(M + 1)]
sums = [f + b for f, b in zip(fwd, bwd)]
check("L(3, j)", fwd, FWD_ROW)
check("L*(3, j)", bwd, BWD_ROW)
check("和", sums, SUM_ROW)
check("和の最大 = L(N, M)", max(sums), LCS_LEN)
check("最大をとる最小の j", sums.index(max(sums)), SPLIT_J)
for ii in range(N + 1):
    f = last_row(A[:ii], B)
    br = last_row(A[ii:][::-1], B[::-1])
    check(f"定理 (i={ii})", max(f[jj] + br[M - jj] for jj in range(M + 1)), L[N][M])


def hirschberg(a, b):
    if not b:
        return ""
    if len(a) == 1:
        return a if a in b else ""
    i = len(a) // 2
    f = last_row(a[:i], b)
    br = last_row(a[i:][::-1], b[::-1])
    s = [f[jj] + br[len(b) - jj] for jj in range(len(b) + 1)]
    jj = s.index(max(s))
    return hirschberg(a[:i], b[:jj]) + hirschberg(a[i:], b[jj:])


h = hirschberg(A, B)
check("Hirschberg の長さ", len(h), LCS_LEN)
check("Hirschberg の答えは LCS の 1 つ", h in ALL_LCS, True)

# クイズ
check("問1 の正答", N + M - 2 * LCS_LEN, QUIZ1[1])
check("問1 の誤答 N-L", N - LCS_LEN, 3)
check("問1 の誤答 N+M-L", N + M - LCS_LEN, 9)
check("問1 の正答は 1 つ", [c for c in QUIZ1[0] if c == N + M - 2 * LCS_LEN], [QUIZ1[1]])
allowed3 = set(range(-3, 4, 2))
check("問2 の正答は 1 つ", [k for k in QUIZ2[0] if k in allowed3], [QUIZ2[1]])
check("D=3 の終点の対角線", sorted(GREEDY_ENDPOINTS[3]), sorted(allowed3))

if failures:
    print("D-01 の検算に通らない:")
    for f in failures:
        print("- " + f)
    sys.exit(1)
print(f"D-01 OK: L = {LCS_LEN}, D = {SES_LEN}, LCS は {len(ALL_LCS)} 通り, 貪欲法は D = {GREEDY_D} で k = {GREEDY_K}, 分ける位置は j = {SPLIT_J}")
