/* ============================================================
   app.js - ロト6 予測ツール メインロジック
   ============================================================ */

"use strict";

// ────────────────────────────────────────────────────────────
// 定数
// ────────────────────────────────────────────────────────────
const CFG = {
  NUMBERS: Array.from({ length: 43 }, (_, i) => i + 1),
  ZONES: {
    "Zone1(1-9)":   [1,2,3,4,5,6,7,8,9],
    "Zone2(10-19)": [10,11,12,13,14,15,16,17,18,19],
    "Zone3(20-29)": [20,21,22,23,24,25,26,27,28,29],
    "Zone4(30-39)": [30,31,32,33,34,35,36,37,38,39],
    "Zone5(40-43)": [40,41,42,43],
  },
  RULE: { SUM_MIN: 100, SUM_MAX: 170, MAX_CONSEC_PAIRS: 2 },
  EVEN_ODD_PATTERNS: [[2,4],[3,3],[4,2]],
  HOT_THRESHOLD:  1.2,
  COLD_THRESHOLD: 0.8,
  SIMULATION_COUNT: 500,
  SCORE_W: { freq: 0.30, sum: 0.30, zone: 0.20, consec: 0.20 },
};

// ────────────────────────────────────────────────────────────
// グローバル状態
// ────────────────────────────────────────────────────────────
const STATE = {
  data: [],   // [{round, date, numbers:[...], total}]
  sha:  null, // GitHub file SHA
  charts: {}, // Chart.js インスタンス
};

// ────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────
function showToast(msg, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = `<span class="loading-spinner"></span> 処理中...`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    btn.disabled = false;
  }
}

function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

// ────────────────────────────────────────────────────────────
// GitHub API (Netlify Functions 経由)
// ────────────────────────────────────────────────────────────
async function apiGetData() {
  const res = await fetch("/.netlify/functions/getData");
  if (!res.ok) throw new Error(`データ取得失敗: ${res.status}`);
  return await res.json(); // { data: {...}, sha: "..." }
}

async function apiSaveData(data, sha) {
  const res = await fetch("/.netlify/functions/saveData", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ data, sha }),
  });
  if (!res.ok) throw new Error(`保存失敗: ${res.status}`);
  return await res.json(); // { success: true, sha: "..." }
}

// ────────────────────────────────────────────────────────────
// データ読み込み
// ────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const result = await apiGetData();
    STATE.sha  = result.sha;
    STATE.data = (result.data.data || []).sort((a, b) => a.round - b.round);
    updateUI();
  } catch (e) {
    console.error(e);
    showToast("データ読み込みエラー: " + e.message, "error");
    updateUI();
  }
}

// ────────────────────────────────────────────────────────────
// データ保存
// ────────────────────────────────────────────────────────────
async function saveData() {
  const sorted  = [...STATE.data].sort((a, b) => b.round - a.round);
  const latest  = sorted[0];
  const payload = {
    lastUpdated: latest ? latest.date : "",
    totalRounds: STATE.data.length,
    data: sorted,
  };
  const result = await apiSaveData(payload, STATE.sha);
  STATE.sha = result.sha;
}

// ────────────────────────────────────────────────────────────
// パーサー（コピペテキスト → データ配列）
// ────────────────────────────────────────────────────────────
function parseRawInput(text) {
  const lines   = text.trim().split("\n");
  const results = [];
  const errors  = [];

  lines.forEach((line, idx) => {
    const raw = line.trim();
    if (!raw) return;

    // 回号を抽出: "第NNNN回" or 先頭の数字
    const roundMatch = raw.match(/第?(\d+)回?/);
    if (!roundMatch) { errors.push(`行${idx+1}: 回号が見つかりません`); return; }
    const round = parseInt(roundMatch[1]);

    // 日付を抽出
    const dateMatch = raw.match(/(\d{4}\/\d{1,2}\/\d{1,2})/);
    const date = dateMatch ? dateMatch[1] : "";

    // 1〜43の数字を全て抽出（ゼロ埋め対応）
    const allNums = [];
    const parts   = raw.split(/[\t\s]+/);
    for (const p of parts) {
      const n = parseInt(p, 10);
      if (!isNaN(n) && n >= 1 && n <= 43) allNums.push(n);
    }

    // 回号自体の数字を除外、重複除去、先頭6個
    const filtered = [...new Set(allNums.filter(n => n !== round))];
    if (filtered.length < 6) {
      errors.push(`行${idx+1}: 有効な数字が6個未満です (${filtered})`);
      return;
    }

    const numbers = filtered.slice(0, 6).sort((a, b) => a - b);
    const total   = numbers.reduce((s, n) => s + n, 0);

    results.push({ round, date, numbers, total });
  });

  return { results, errors };
}

// ────────────────────────────────────────────────────────────
// 分析モジュール
// ────────────────────────────────────────────────────────────

/** 出現頻度分析 */
function analyzeFrequency(data) {
  const countMap = {};
  CFG.NUMBERS.forEach(n => (countMap[n] = 0));
  data.forEach(row => row.numbers.forEach(n => countMap[n]++));

  const total     = data.length;
  const avgCount  = (total * 6) / 43;

  return CFG.NUMBERS.map(num => {
    const count = countMap[num];
    const rate  = total ? (count / total) * 100 : 0;
    let   label = "NORMAL";
    if (count >= avgCount * CFG.HOT_THRESHOLD)  label = "HOT";
    if (count <= avgCount * CFG.COLD_THRESHOLD) label = "COLD";
    return { num, count, rate, label };
  });
}

/** 合計値分析 */
function analyzeSum(data) {
  const totals = data.map(d => d.total);
  const mean   = totals.reduce((s, v) => s + v, 0) / totals.length;
  const variance = totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length;
  const std    = Math.sqrt(variance);
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // ヒストグラム（50区切り）
  const bins  = {};
  const step  = 10;
  for (let v = 50; v <= 230; v += step) bins[v] = 0;
  totals.forEach(t => {
    const key = Math.floor(t / step) * step;
    if (bins[key] !== undefined) bins[key]++;
    else bins[key] = 1;
  });

  return {
    series: data.map(d => ({ round: d.round, total: d.total })),
    mean, median, std,
    min: Math.min(...totals),
    max: Math.max(...totals),
    histogram: bins,
  };
}

/** ゾーン分析 */
function analyzeZone(data) {
  const zoneNames = Object.keys(CFG.ZONES);
  const rows = data.map(d => {
    const row = { round: d.round };
    zoneNames.forEach(z => {
      row[z] = d.numbers.filter(n => CFG.ZONES[z].includes(n)).length;
    });
    return row;
  });

  // 平均
  const avg = {};
  zoneNames.forEach(z => {
    avg[z] = rows.reduce((s, r) => s + r[z], 0) / rows.length;
  });

  return { rows, avg, zoneNames };
}

/** 連番分析 */
function analyzeConsecutive(data) {
  function countConsec(nums) {
    const s = [...nums].sort((a, b) => a - b);
    let pairs = 0, maxLen = 1, curLen = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === s[i-1] + 1) { pairs++; curLen++; maxLen = Math.max(maxLen, curLen); }
      else curLen = 1;
    }
    return { pairs, maxLen };
  }

  const rows = data.map(d => {
    const { pairs, maxLen } = countConsec(d.numbers);
    return { round: d.round, pairs, maxLen, hasConsec: pairs > 0 };
  });

  const consecCount = rows.filter(r => r.hasConsec).length;
  const pairDist    = {};
  rows.forEach(r => {
    pairDist[r.pairs] = (pairDist[r.pairs] || 0) + 1;
  });

  return {
    rows,
    consecCount,
    consecRate:  rows.length ? consecCount / rows.length : 0,
    avgPairs:    rows.reduce((s, r) => s + r.pairs, 0) / rows.length,
    pairDist,
  };
}

// ────────────────────────────────────────────────────────────
// スコアリング
// ────────────────────────────────────────────────────────────
function scoreCombo(nums, freqMap, sumMean, sumStd) {
  const sorted = [...nums].sort((a, b) => a - b);
  const total  = sorted.reduce((s, n) => s + n, 0);

  // 偶奇
  const evenCnt = sorted.filter(n => n % 2 === 0).length;
  const oddCnt  = 6 - evenCnt;

  // 連番
  let pairs = 0, maxLen = 1, curLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i-1] + 1) { pairs++; curLen++; maxLen = Math.max(maxLen, curLen); }
    else curLen = 1;
  }

  // ゾーンカバレッジ
  const coveredZones = Object.values(CFG.ZONES)
    .filter(zr => sorted.some(n => zr.includes(n))).length;

  // ① 出現頻度スコア
  const avgFreq = Object.values(freqMap).reduce((s, v) => s + v, 0) / 43;
  const freqScore = sorted.reduce((s, n) => {
    const dev = Math.abs(freqMap[n] - avgFreq) / (avgFreq + 1e-9);
    return s + Math.max(0, 1 - dev);
  }, 0) / 6;

  // ② 合計値スコア
  const sumScore = Math.max(0, 1 - Math.abs(total - sumMean) / (sumStd * 2 + 1e-9));

  // ③ ゾーンスコア
  const zoneScore = coveredZones / 5;

  // ④ 連番スコア
  const consecScore = pairs === 0 ? 0.8 : pairs === 1 ? 1.0 : Math.max(0, 1 - (pairs - 1) * 0.3);

  const score =
    CFG.SCORE_W.freq   * freqScore   +
    CFG.SCORE_W.sum    * sumScore    +
    CFG.SCORE_W.zone   * zoneScore   +
    CFG.SCORE_W.consec * consecScore;

  return { numbers: sorted, score, total, evenCnt, oddCnt, pairs, coveredZones };
}

function passesRules(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const total  = sorted.reduce((s, n) => s + n, 0);
  if (total < CFG.RULE.SUM_MIN || total > CFG.RULE.SUM_MAX) return false;

  const evenCnt = sorted.filter(n => n % 2 === 0).length;
  const oddCnt  = 6 - evenCnt;
  const eoOK    = CFG.EVEN_ODD_PATTERNS.some(([e, o]) => e === evenCnt && o === oddCnt);
  if (!eoOK) return false;

  let pairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i-1] + 1) pairs++;
  }
  if (pairs > CFG.RULE.MAX_CONSEC_PAIRS) return false;

  for (const zr of Object.values(CFG.ZONES)) {
    if (!sorted.some(n => zr.includes(n))) return false;
  }

  return true;
}

// ────────────────────────────────────────────────────────────
// 予測ロジック
// ────────────────────────────────────────────────────────────
function buildFreqMap(data) {
  const map = {};
  CFG.NUMBERS.forEach(n => (map[n] = 0));
  data.forEach(row => row.numbers.forEach(n => map[n]++));
  return map;
}

function weightedSample6(weights) {
  const pool   = [...CFG.NUMBERS];
  const w      = [...weights];
  const result = [];
  while (result.length < 6) {
    const total = w.reduce((s, v) => s + v, 0);
    let   rand  = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      rand -= w[i];
      if (rand <= 0) {
        result.push(pool[i]);
        pool.splice(i, 1);
        w.splice(i, 1);
        break;
      }
    }
  }
  return result;
}

/** Pattern A: ルールベース予測 */
function predictRuleBased(data) {
  const freqMap = buildFreqMap(data);
  const sumData = analyzeSum(data);
  const weights = CFG.NUMBERS.map(n => Math.max(freqMap[n], 1));
  const candidates = [];

  for (let i = 0; i < 80000 && candidates.length < 200; i++) {
    const combo = weightedSample6(weights);
    if (new Set(combo).size < 6) continue;
    if (passesRules(combo)) {
      const s = scoreCombo(combo, freqMap, sumData.mean, sumData.std);
      candidates.push(s);
    }
  }

  if (candidates.length === 0) {
    // フォールバック
    for (let i = 0; i < 5000; i++) {
      const combo = weightedSample6(weights);
      if (new Set(combo).size < 6) continue;
      candidates.push(scoreCombo(combo, freqMap, sumData.mean, sumData.std));
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { ...candidates[0], pattern: "A", label: "ルールベース予測", method: "RuleBase + Scoring" };
}

/** Pattern B: 統計スコアリング予測 */
function predictStatistical(data) {
  const freqMap  = buildFreqMap(data);
  const sumData  = analyzeSum(data);
  const n        = data.length;

  // 各数字のスコアを計算
  const numScores = CFG.NUMBERS.map(num => {
    // 出現頻度スコア（中程度が高い）
    const avgFreq  = (n * 6) / 43;
    const freqDev  = Math.abs(freqMap[num] - avgFreq) / (avgFreq + 1e-9);
    const freqScore = Math.max(0, 1 - freqDev * 0.5);

    // 最後の出現からの間隔スコア（間隔が長いほど高い）
    let interval = n;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].numbers.includes(num)) { interval = data.length - 1 - i; break; }
    }
    const intervalScore = Math.min(interval / 20, 1.0);

    // 直近30回の出現率
    const recent30 = data.slice(-30);
    const recentCount = recent30.reduce((s, r) => s + (r.numbers.includes(num) ? 1 : 0), 0);
    const recentScore = recentCount / 30;

    const total = freqScore * 0.4 + intervalScore * 0.4 + recentScore * 0.2;
    return { num, score: total };
  });

  numScores.sort((a, b) => b.score - a.score);

  // 上位から条件を満たす組み合わせを探索
  const top20  = numScores.slice(0, 20).map(x => x.num);
  const freqW  = CFG.NUMBERS.map(n => Math.max(freqMap[n], 1));
  let   best   = null;

  for (let i = 0; i < 50000; i++) {
    // 上位数字を優先しつつランダム選択
    const useTop = Math.random() < 0.7;
    let combo;
    if (useTop) {
      const shuffled = [...top20].sort(() => Math.random() - 0.5);
      combo = shuffled.slice(0, 6);
    } else {
      combo = weightedSample6(freqW);
    }
    if (new Set(combo).size < 6) continue;
    if (passesRules(combo)) {
      const s = scoreCombo(combo, freqMap, sumData.mean, sumData.std);
      if (!best || s.score > best.score) best = s;
    }
  }

  if (!best) {
    const combo = numScores.slice(0, 6).map(x => x.num);
    best = scoreCombo(combo, freqMap, sumData.mean, sumData.std);
  }

  return { ...best, pattern: "B", label: "統計スコアリング予測", method: "StatisticalScoring" };
}

/** Pattern C: 仮想抽選マシン（500回シミュレーション）*/
function predictSimulation(data) {
  const freqMap  = buildFreqMap(data);
  const sumData  = analyzeSum(data);
  const weights  = CFG.NUMBERS.map(n => Math.max(freqMap[n], 1));
  const counter  = {};
  CFG.NUMBERS.forEach(n => (counter[n] = 0));

  for (let i = 0; i < CFG.SIMULATION_COUNT; i++) {
    const drawn = weightedSample6(weights);
    drawn.forEach(n => counter[n]++);
  }

  const sorted = Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => parseInt(n));
  const top6 = sorted.slice(0, 6);
  const result = scoreCombo(top6, freqMap, sumData.mean, sumData.std);

  return {
    ...result,
    pattern: "C",
    label: `仮想抽選マシン（${CFG.SIMULATION_COUNT}回）`,
    method: "WeightedSimulation",
  };
}

// ────────────────────────────────────────────────────────────
// チャート描画
// ────────────────────────────────────────────────────────────
const CHART_COLORS = {
  accent:  "rgba(108,99,255,0.8)",
  accentB: "rgba(108,99,255,0.2)",
  green:   "rgba(0,212,170,0.8)",
  greenB:  "rgba(0,212,170,0.2)",
  hot:     "rgba(255,107,107,0.8)",
  cold:    "rgba(116,185,255,0.8)",
  yellow:  "rgba(255,217,61,0.8)",
  zones: [
    "rgba(253,121,168,0.8)",
    "rgba(253,203,110,0.8)",
    "rgba(85,239,196,0.8)",
    "rgba(116,185,255,0.8)",
    "rgba(162,155,254,0.8)",
  ],
};

Chart.defaults.color = "#9099b0";
Chart.defaults.borderColor = "#2e3148";
Chart.defaults.font.family = "'Segoe UI', sans-serif";

function destroyChart(key) {
  if (STATE.charts[key]) { STATE.charts[key].destroy(); delete STATE.charts[key]; }
}

function renderFrequencyChart(freqData) {
  destroyChart("freq");
  const ctx = document.getElementById("chart-freq").getContext("2d");
  const colors = freqData.map(f =>
    f.label === "HOT" ? CHART_COLORS.hot :
    f.label === "COLD" ? CHART_COLORS.cold :
    CHART_COLORS.accent
  );

  STATE.charts.freq = new Chart(ctx, {
    type: "bar",
    data: {
      labels: freqData.map(f => f.num),
      datasets: [{
        label: "出現回数",
        data:   freqData.map(f => f.count),
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `出現: ${ctx.raw}回 | ${freqData[ctx.dataIndex].label}`,
          },
        },
      },
      scales: {
        x: { grid: { color: "rgba(46,49,72,0.5)" } },
        y: { grid: { color: "rgba(46,49,72,0.5)" }, beginAtZero: true },
      },
    },
  });
}

function renderSumChart(sumData) {
  destroyChart("sum");
  const recent = sumData.series.slice(-100);
  const ctx    = document.getElementById("chart-sum").getContext("2d");

  STATE.charts.sum = new Chart(ctx, {
    type: "line",
    data: {
      labels: recent.map(d => `第${d.round}回`),
      datasets: [{
        label: "合計値",
        data:  recent.map(d => d.total),
        borderColor: CHART_COLORS.accent,
        backgroundColor: CHART_COLORS.accentB,
        borderWidth: 1.5,
        pointRadius: 2,
        fill: true,
        tension: 0.3,
      }, {
        label: `平均 (${sumData.mean.toFixed(1)})`,
        data:  new Array(recent.length).fill(sumData.mean),
        borderColor: CHART_COLORS.hot,
        borderWidth: 1,
        borderDash: [6,3],
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: "rgba(46,49,72,0.5)" } },
      },
    },
  });

  // ヒストグラム
  destroyChart("sumHist");
  const hCtx = document.getElementById("chart-sum-hist").getContext("2d");
  const bins  = sumData.histogram;
  const bKeys = Object.keys(bins).sort((a, b) => a - b);

  STATE.charts.sumHist = new Chart(hCtx, {
    type: "bar",
    data: {
      labels: bKeys.map(k => `${k}〜`),
      datasets: [{
        label: "件数",
        data:   bKeys.map(k => bins[k]),
        backgroundColor: CHART_COLORS.green,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(46,49,72,0.5)" } },
      },
    },
  });
}

function renderZoneChart(zoneData) {
  destroyChart("zone");
  const recent50 = zoneData.rows.slice(-50);
  const ctx = document.getElementById("chart-zone").getContext("2d");

  STATE.charts.zone = new Chart(ctx, {
    type: "bar",
    data: {
      labels: recent50.map(r => `${r.round}`),
      datasets: zoneData.zoneNames.map((z, i) => ({
        label: z,
        data:  recent50.map(r => r[z]),
        backgroundColor: CHART_COLORS.zones[i],
        borderRadius: 2,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 15 } },
        y: { stacked: true, grid: { color: "rgba(46,49,72,0.5)" } },
      },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, padding: 12 } },
      },
    },
  });

  // 平均ゾーン分布（ドーナツ）
  destroyChart("zoneAvg");
  const dCtx = document.getElementById("chart-zone-avg").getContext("2d");
  STATE.charts.zoneAvg = new Chart(dCtx, {
    type: "doughnut",
    data: {
      labels: zoneData.zoneNames,
      datasets: [{
        data:            zoneData.zoneNames.map(z => parseFloat(zoneData.avg[z].toFixed(2))),
        backgroundColor: CHART_COLORS.zones,
        borderWidth: 2,
        borderColor: "#1a1d27",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, padding: 10 } },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: 平均 ${ctx.raw}個` },
        },
      },
    },
  });
}

function renderConsecChart(consecData) {
  destroyChart("consec");
  const ctx  = document.getElementById("chart-consec").getContext("2d");
  const dist = consecData.pairDist;
  const keys = Object.keys(dist).sort((a, b) => a - b);

  STATE.charts.consec = new Chart(ctx, {
    type: "bar",
    data: {
      labels: keys.map(k => `${k}ペア`),
      datasets: [{
        label: "回数",
        data:   keys.map(k => dist[k]),
        backgroundColor: CHART_COLORS.yellow,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(46,49,72,0.5)" } },
      },
    },
  });

  // 円グラフ
  destroyChart("consecPie");
  const pCtx = document.getElementById("chart-consec-pie").getContext("2d");
  STATE.charts.consecPie = new Chart(pCtx, {
    type: "pie",
    data: {
      labels: ["連番あり", "連番なし"],
      datasets: [{
        data: [
          consecData.consecCount,
          consecData.rows.length - consecData.consecCount,
        ],
        backgroundColor: [CHART_COLORS.hot, CHART_COLORS.cold],
        borderWidth: 2,
        borderColor: "#1a1d27",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

// ────────────────────────────────────────────────────────────
// UI 描画
// ────────────────────────────────────────────────────────────
function getBallClass(num) {
  if (num <= 9)  return "zone1";
  if (num <= 19) return "zone2";
  if (num <= 29) return "zone3";
  if (num <= 39) return "zone4";
  return "zone5";
}

function renderStats(data) {
  const sumData    = analyzeSum(data);
  const consecData = analyzeConsecutive(data);
  const el = document.getElementById("stats-grid");

  el.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${data.length}</div>
      <div class="stat-label">総データ件数</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${data[0]?.round || '-'}</div>
      <div class="stat-label">最古回号</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${data[data.length-1]?.round || '-'}</div>
      <div class="stat-label">最新回号</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${sumData.mean.toFixed(1)}</div>
      <div class="stat-label">合計値 平均</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${sumData.std.toFixed(1)}</div>
      <div class="stat-label">合計値 標準偏差</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${(consecData.consecRate * 100).toFixed(0)}%</div>
      <div class="stat-label">連番出現率</div>
    </div>
  `;
}

function renderFreqGrid(freqData) {
  const el = document.getElementById("freq-grid");
  el.innerHTML = freqData.map(f => `
    <div class="freq-cell ${f.label.toLowerCase()}">
      <div class="num">${f.num}</div>
      <div class="cnt">${f.count}回</div>
      <div class="badge">${f.label}</div>
    </div>
  `).join("");
}

function renderSumStats(sumData) {
  const el = document.getElementById("sum-stats");
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[
        ["平均値",    sumData.mean.toFixed(1)],
        ["中央値",    sumData.median],
        ["標準偏差",  sumData.std.toFixed(1)],
        ["最小値",    sumData.min],
        ["最大値",    sumData.max],
      ].map(([label, val]) => `
        <div style="display:flex;justify-content:space-between;
          padding:8px 12px;background:var(--bg2);border-radius:6px">
          <span style="color:var(--text2);font-size:0.85rem">${label}</span>
          <span style="font-weight:600">${val}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderZoneStats(zoneData) {
  const el = document.getElementById("zone-stats");
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${zoneData.zoneNames.map((z, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:8px 12px;background:var(--bg2);border-radius:6px">
          <span style="color:${['#fd79a8','#fdcb6e','#55efc4','#74b9ff','#a29bfe'][i]};
            font-size:0.85rem">${z}</span>
          <span style="font-weight:600">平均 ${zoneData.avg[z].toFixed(2)}個</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderConsecStats(consecData) {
  const el = document.getElementById("consec-stats");
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
      ${[
        ["連番あり回数",    `${consecData.consecCount}回`],
        ["連番出現率",      `${(consecData.consecRate*100).toFixed(1)}%`],
        ["平均連番ペア数",  consecData.avgPairs.toFixed(2)],
      ].map(([label, val]) => `
        <div class="stat-item">
          <div class="stat-value" style="font-size:1.3rem">${val}</div>
          <div class="stat-label">${label}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPredictions(predictions) {
  const el = document.getElementById("prediction-grid");
  const patternClass = { A: "pattern-a", B: "pattern-b", C: "pattern-c" };

  el.innerHTML = predictions.map(p => `
    <div class="prediction-card ${patternClass[p.pattern]}">
      <div class="pattern-label">Pattern ${p.pattern} ｜ ${p.method}</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:4px">${p.label}</div>
      <div class="number-balls">
        ${p.numbers.map(n => `
          <div class="ball ${getBallClass(n)}">${n}</div>
        `).join("")}
      </div>
      <div class="prediction-meta">
        <div class="meta-item">
          <div class="label">合計値</div>
          <div class="value">${p.total}</div>
        </div>
        <div class="meta-item">
          <div class="label">偶数 / 奇数</div>
          <div class="value">${p.evenCnt} / ${p.oddCnt}</div>
        </div>
        <div class="meta-item">
          <div class="label">ゾーンカバー</div>
          <div class="value">${p.coveredZones} / 5</div>
        </div>
        <div class="meta-item">
          <div class="label">連番ペア</div>
          <div class="value">${p.pairs}組</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:0.75rem;color:var(--text2)">
        スコア: ${(p.score * 100).toFixed(1)}点
      </div>
      <div class="score-bar">
        <div class="score-fill" style="width:${p.score * 100}%"></div>
      </div>
    </div>
  `).join("");
}

// ────────────────────────────────────────────────────────────
// メイン UI 更新
// ────────────────────────────────────────────────────────────
function updateUI() {
  const data = STATE.data;
  const count = document.getElementById("data-count");

  if (data.length === 0) {
    count.textContent = "データなし";
    document.getElementById("empty-state").style.display = "block";
    document.getElementById("stats-section").style.display = "none";
    document.getElementById("analysis-section").style.display = "none";
    document.getElementById("predict-section").style.display = "none";
    return;
  }

  count.textContent = `${data.length}件 (第${data[0].round}〜第${data[data.length-1].round}回)`;
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("stats-section").style.display = "block";
  document.getElementById("analysis-section").style.display = "block";

  // 各分析実行
  const freqData   = analyzeFrequency(data);
  const sumData    = analyzeSum(data);
  const zoneData   = analyzeZone(data);
  const consecData = analyzeConsecutive(data);

  // 描画
  renderStats(data);
  renderFreqGrid(freqData);
  renderFrequencyChart(freqData);
  renderSumChart(sumData);
  renderSumStats(sumData);
  renderZoneChart(zoneData);
  renderZoneStats(zoneData);
  renderConsecChart(consecData);
  renderConsecStats(consecData);
}

// ────────────────────────────────────────────────────────────
// イベントハンドラ
// ────────────────────────────────────────────────────────────

// タブ切り替え
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(target).classList.add("active");
  });
});

// ── 一括登録モーダル ──
document.getElementById("btn-bulk").addEventListener("click", () => {
  document.getElementById("bulk-input").value = "";
  document.getElementById("bulk-preview").innerHTML = "";
  document.getElementById("btn-bulk-save").disabled = true;
  openModal("modal-bulk");
});

document.getElementById("btn-bulk-cancel").addEventListener("click", () => closeModal("modal-bulk"));

let parsedBulkData = [];

document.getElementById("btn-bulk-parse").addEventListener("click", () => {
  const text = document.getElementById("bulk-input").value;
  if (!text.trim()) { showToast("テキストを入力してください", "error"); return; }

  const { results, errors } = parseRawInput(text);
  parsedBulkData = results;

  const previewEl = document.getElementById("bulk-preview");

  if (errors.length) {
    previewEl.innerHTML = `
      <div style="color:var(--hot);font-size:0.8rem;margin-bottom:8px">
        ⚠ ${errors.length}行 スキップ: ${errors.slice(0,3).join(" / ")}
      </div>
    `;
  }

  if (results.length === 0) {
    previewEl.innerHTML += `<div style="color:var(--hot)">有効なデータが見つかりませんでした</div>`;
    document.getElementById("btn-bulk-save").disabled = true;
    return;
  }

  previewEl.innerHTML += `
    <div style="font-size:0.85rem;color:var(--green);margin-bottom:8px">
      ✅ ${results.length}件 読み込み成功
    </div>
    <table class="preview-table">
      <thead>
        <tr><th>回号</th><th>日付</th><th>数字</th><th>合計</th></tr>
      </thead>
      <tbody>
        ${results.slice(0, 10).map(r => `
          <tr>
            <td>${r.round}</td>
            <td>${r.date}</td>
            <td>${r.numbers.join(", ")}</td>
            <td>${r.total}</td>
          </tr>
        `).join("")}
        ${results.length > 10 ? `<tr><td colspan="4" style="color:var(--text2)">...他${results.length-10}件</td></tr>` : ""}
      </tbody>
    </table>
  `;
  document.getElementById("btn-bulk-save").disabled = false;
});

document.getElementById("btn-bulk-save").addEventListener("click", async () => {
  const btn = document.getElementById("btn-bulk-save");
  setLoading(btn, true);

  try {
    // 既存データとマージ（重複は上書き）
    const existingMap = {};
    STATE.data.forEach(d => (existingMap[d.round] = d));
    parsedBulkData.forEach(d => (existingMap[d.round] = d));
    STATE.data = Object.values(existingMap).sort((a, b) => a.round - b.round);

    await saveData();
    closeModal("modal-bulk");
    updateUI();
    showToast(`${parsedBulkData.length}件 保存しました`, "success");
    parsedBulkData = [];
  } catch (e) {
    showToast("保存エラー: " + e.message, "error");
  } finally {
    setLoading(btn, false);
  }
});

// ── 1件追加モーダル ──
document.getElementById("btn-add-one").addEventListener("click", () => {
  ["add-round","add-date","add-n1","add-n2","add-n3","add-n4","add-n5","add-n6"]
    .forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("add-error").textContent = "";
  openModal("modal-add");
});

document.getElementById("btn-add-cancel").addEventListener("click", () => closeModal("modal-add"));

document.getElementById("btn-add-save").addEventListener("click", async () => {
  const btn   = document.getElementById("btn-add-save");
  const errEl = document.getElementById("add-error");
  errEl.textContent = "";

  const round = parseInt(document.getElementById("add-round").value);
  const date  = document.getElementById("add-date").value.trim();
  const nums  = [1,2,3,4,5,6].map(i =>
    parseInt(document.getElementById(`add-n${i}`).value)
  );

  // バリデーション
  if (!round || round < 1) { errEl.textContent = "回号を入力してください"; return; }
  if (!date)               { errEl.textContent = "日付を入力してください"; return; }
  if (nums.some(n => isNaN(n) || n < 1 || n > 43)) {
    errEl.textContent = "数字は1〜43の範囲で入力してください"; return;
  }
  if (new Set(nums).size < 6) { errEl.textContent = "6つの数字に重複があります"; return; }
  if (STATE.data.find(d => d.round === round)) {
    errEl.textContent = `第${round}回はすでに登録済みです`; return;
  }

  setLoading(btn, true);
  try {
    const sorted  = nums.sort((a, b) => a - b);
    const newRow  = { round, date, numbers: sorted, total: sorted.reduce((s,n)=>s+n,0) };
    STATE.data    = [...STATE.data, newRow].sort((a, b) => a.round - b.round);

    await saveData();
    closeModal("modal-add");
    updateUI();
    showToast(`第${round}回 追加しました`, "success");
  } catch (e) {
    errEl.textContent = "保存エラー: " + e.message;
  } finally {
    setLoading(btn, false);
  }
});

// ── 予測ボタン ──
document.getElementById("btn-predict").addEventListener("click", () => {
  if (STATE.data.length < 10) {
    showToast("データが10件以上必要です", "error"); return;
  }

  const btn = document.getElementById("btn-predict");
  setLoading(btn, true);

  // 非同期で実行（UIブロック防止）
  setTimeout(() => {
    try {
      const predA = predictRuleBased(STATE.data);
      const predB = predictStatistical(STATE.data);
      const predC = predictSimulation(STATE.data);

      renderPredictions([predA, predB, predC]);
      document.getElementById("predict-section").style.display = "block";
      document.getElementById("predict-section").scrollIntoView({ behavior: "smooth" });
      showToast("予測完了！", "success");
    } catch (e) {
      showToast("予測エラー: " + e.message, "error");
      console.error(e);
    } finally {
      setLoading(btn, false);
    }
  }, 50);
});

// モーダル外クリックで閉じる
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.classList.remove("active");
  });
});

// ────────────────────────────────────────────────────────────
// 初期化
// ────────────────────────────────────────────────────────────
(async function init() {
  showToast("データ読み込み中...", "info", 2000);
  await loadData();
})();