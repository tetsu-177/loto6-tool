

/* ============================================================
   app.js - ロト6 予測ツール
   ============================================================ */
"use strict";

// ── 定数 ──────────────────────────────────────────────────
const CFG = {
  NUMBERS: Array.from({ length: 43 }, (_, i) => i + 1),
  ZONES: {
    "Zone1(1-9)":   [1,2,3,4,5,6,7,8,9],
    "Zone2(10-19)": [10,11,12,13,14,15,16,17,18,19],
    "Zone3(20-29)": [20,21,22,23,24,25,26,27,28,29],
    "Zone4(30-39)": [30,31,32,33,34,35,36,37,38,39],
    "Zone5(40-43)": [40,41,42,43],
  },
  RULE: { SUM_MIN: 100, SUM_MAX: 170, MAX_CONSEC: 2 },
  EVEN_ODD: [[2,4],[3,3],[4,2]],
  HOT_TH:  1.2,
  COLD_TH: 0.8,
  SCORE_W: { freq:0.30, sum:0.30, zone:0.20, consec:0.20 },
};

// ============================================================
// PredictionHistory - 予測スナップショット管理
// localStorage にJSONとして永続保存する
// ============================================================
const PredictionHistory = {

  STORAGE_KEY: "loto6_prediction_history",
  MAX_RECORDS: 100,

  // ── 全履歴を取得 ─────────────────────────────────────────
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || "[]");
    } catch(e) {
      console.warn("PredictionHistory.getAll エラー:", e.message);
      return [];
    }
  },

  // ── 特定の targetRound の予測を取得 ──────────────────────
  getByRound(round) {
    return this.getAll().find(h => h.targetRound === round) || null;
  },

  // ── スナップショット保存（同一 targetRound は上書き） ─────
  save(predictions, latestRound) {
    const targetRound = latestRound + 1;
    const all         = this.getAll();

    // 同一 targetRound を上書き
    const existIdx = all.findIndex(h => h.targetRound === targetRound);

    const snapshot = {
      targetRound,
      predictedAt: new Date().toISOString(),
      basedOnRound: latestRound,
      predictions: predictions.map(p => ({
        pattern: p.pattern,
        label:   p.label,
        method:  p.method,
        numbers: [...p.numbers],
        total:   p.total,
        evenCnt: p.evenCnt,
        oddCnt:  p.oddCnt,
        pairs:   p.pairs,
        score:   p.score,
        coveredZones: p.coveredZones,
      })),
    };

    if(existIdx >= 0) {
      all[existIdx] = snapshot;
      console.log(`PredictionHistory: 第${targetRound}回の予測を上書き保存`);
    } else {
      all.push(snapshot);
      console.log(`PredictionHistory: 第${targetRound}回の予測を新規保存`);
    }

    // 古いものから破棄（MAX_RECORDS 件を超えたら）
    if(all.length > this.MAX_RECORDS) {
      all.sort((a,b) => a.targetRound - b.targetRound);
      all.splice(0, all.length - this.MAX_RECORDS);
    }

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
      console.log(
        `PredictionHistory: 保存完了 (${all.length}件 / 最大${this.MAX_RECORDS}件) `,
        `対象: 第${targetRound}回`
      );
    } catch(e) {
      // localStorage 容量超過時は古い半分を破棄して再試行
      console.warn("localStorage 容量超過。古い記録を削除して再試行:", e.message);
      all.splice(0, Math.floor(all.length / 2));
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
      } catch(e2) {
        console.error("PredictionHistory: 再試行も失敗:", e2.message);
      }
    }

    return snapshot;
  },

  // ── デバッグ用：全履歴をコンソールに表示 ─────────────────
  printAll() {
    const all = this.getAll();
    console.group(`📋 予測履歴 (${all.length}件)`);
    [...all].sort((a,b)=>b.targetRound-a.targetRound).forEach(h => {
      console.log(
        `[第${h.targetRound}回向け]`,
        `予測日時: ${h.predictedAt.slice(0,19)}`,
        `基準回: 第${h.basedOnRound}回`,
        `パターン数: ${h.predictions.length}`
      );
    });
    console.groupEnd();
  },

  // ── デバッグ用：全履歴を削除 ─────────────────────────────
  clearAll() {
    localStorage.removeItem(this.STORAGE_KEY);
    console.log("PredictionHistory: 全履歴を削除しました");
  },
};

// ── 状態 ──────────────────────────────────────────────────
const STATE = {
  data:   [],
  sha:    null,
  charts: {},
};

// ────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────
function showToast(msg, type="info", ms=3000) {
  const c  = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function setLoading(btn, on) {
  if (on) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = `<span class="loading-spinner"></span> 処理中...`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
    btn.disabled  = false;
  }
}

function openModal(id)  { document.getElementById(id).classList.add("active"); }
function closeModal(id) { document.getElementById(id).classList.remove("active"); }

function getBallClass(n) {
  if (n <= 9)  return "zone1";
  if (n <= 19) return "zone2";
  if (n <= 29) return "zone3";
  if (n <= 39) return "zone4";
  return "zone5";
}

function getBallBg(n) {
  if (n <= 9)  return "linear-gradient(135deg,#fd79a8,#e84393)";
  if (n <= 19) return "linear-gradient(135deg,#fdcb6e,#e17055)";
  if (n <= 29) return "linear-gradient(135deg,#55efc4,#00b894)";
  if (n <= 39) return "linear-gradient(135deg,#74b9ff,#0984e3)";
  return "linear-gradient(135deg,#a29bfe,#6c5ce7)";
}

// ────────────────────────────────────────────────────────────
// GitHub API
// ────────────────────────────────────────────────────────────
async function apiGet() {
  const r = await fetch("/.netlify/functions/getData");
  if (!r.ok) throw new Error(`取得失敗: ${r.status}`);
  return await r.json();
}

async function apiSave(data, sha) {
  const r = await fetch("/.netlify/functions/saveData", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ data, sha }),
  });
  if (!r.ok) throw new Error(`保存失敗: ${r.status}`);
  return await r.json();
}

async function loadData() {
  try {
    const res  = await apiGet();
    STATE.sha  = res.sha;
    STATE.data = (res.data.data || []).sort((a,b) => a.round - b.round);
    updateUI();
  } catch(e) {
    console.error(e);
    showToast("読み込みエラー: " + e.message, "error");
    updateUI();
  }
}

async function saveData() {
  const sorted  = [...STATE.data].sort((a,b) => b.round - a.round);
  const payload = {
    lastUpdated: sorted[0]?.date || "",
    totalRounds: STATE.data.length,
    data: sorted,
  };
  const res  = await apiSave(payload, STATE.sha);
  STATE.sha  = res.sha;
}

//>>>>>>>>>>>>>>>ここからテスト用
// ────────────────────────────────────────────────────────────
// API・データ読み込み（ローカルJSON対応版）
// ────────────────────────────────────────────────────────────
// async function apiGet() {
//   // ① 取得先を Netlify Functions から ローカルの JSON ファイルに変更
//   const r = await fetch("data/loto6.json");
//   if (!r.ok) throw new Error(`JSON取得失敗: ${r.status} (data/loto6.jsonが見つかりません)`);
//   return await r.json();
// }

// async function apiSave(data, sha) {
//   // ローカル環境ではブラウザから直接ファイルを上書き保存できないため、
//   // エラーを返すようにするか、何もしないようにします。
//   throw new Error("ローカル環境のため保存機能は利用できません。");
// }

// async function loadData() {
//   try {
//     const res = await apiGet();
//     STATE.sha = null; // ローカルファイル読み込みなのでshaは不要

//     // ② JSONの構造に合わせて柔軟に配列を取り出す処理
//     // loto6.json の中身が [...] でも {"data": [...]} でも対応できるようにしています
//     let rawData = [];
//     if (Array.isArray(res)) {
//       rawData = res;
//     } else if (res.data && Array.isArray(res.data)) {
//       rawData = res.data;
//     } else if (res.data && res.data.data && Array.isArray(res.data.data)) {
//       rawData = res.data.data;
//     }

//     STATE.data = rawData.sort((a,b) => a.round - b.round);
//     updateUI();
//   } catch(e) {
//     console.error(e);
//     showToast("読み込みエラー: " + e.message, "error");
//     updateUI(); // エラー時は空データとしてUIを更新
//   }
// }

// async function saveData() {
//   // ③ ブラウザからローカルのJSONは書き換えられないため、アラートを出して終了します
//   showToast("ブラウザからのデータ保存はローカル環境ではできません。", "error");
//   console.warn("保存機能を使用するには、Netlifyなどのサーバー環境が必要です。");
// }
//>>>>>>>>>>>>>>>ここまでテスト用

// ────────────────────────────────────────────────────────────
// 分析
// ────────────────────────────────────────────────────────────
function analyzeFrequency(data) {
  const cm = {};
  CFG.NUMBERS.forEach(n => (cm[n] = 0));
  data.forEach(r => r.numbers.forEach(n => cm[n]++));
  const avg = (data.length * 6) / 43;
  return CFG.NUMBERS.map(num => {
    const count = cm[num];
    const rate  = data.length ? (count / data.length) * 100 : 0;
    const label = count >= avg * CFG.HOT_TH  ? "HOT"  :
                  count <= avg * CFG.COLD_TH ? "COLD" : "NORMAL";
    return { num, count, rate, label };
  });
}

function buildFreqMap(data) {
  const m = {};
  CFG.NUMBERS.forEach(n => (m[n] = 0));
  data.forEach(r => r.numbers.forEach(n => m[n]++));
  return m;
}

function analyzeSum(data) {
  if (!data.length) return { series:[], mean:0, median:0, std:0, min:0, max:0, histogram:{} };
  const tots = data.map(d => d.total);
  const mean = tots.reduce((s,v)=>s+v,0) / tots.length;
  const std  = Math.sqrt(tots.reduce((s,v)=>s+(v-mean)**2,0) / tots.length);
  const med  = [...tots].sort((a,b)=>a-b)[Math.floor(tots.length/2)];
  const hist = {};
  for (let v=50;v<=230;v+=10) hist[v]=0;
  tots.forEach(t => { const k=Math.floor(t/10)*10; if(hist[k]!==undefined) hist[k]++; else hist[k]=1; });
  return {
    series: data.map(d=>({round:d.round,total:d.total})),
    mean, median:med, std,
    min: Math.min(...tots), max: Math.max(...tots),
    histogram: hist,
  };
}

function analyzeZone(data) {
  const zn = Object.keys(CFG.ZONES);
  const rows = data.map(d => {
    const row = { round: d.round };
    zn.forEach(z => { row[z] = d.numbers.filter(n=>CFG.ZONES[z].includes(n)).length; });
    return row;
  });
  const avg = {};
  zn.forEach(z => { avg[z] = rows.reduce((s,r)=>s+r[z],0) / rows.length; });
  return { rows, avg, zoneNames: zn };
}

function countConsec(nums) {
  const s = [...nums].sort((a,b)=>a-b);
  let pairs=0, maxLen=1, cur=1;
  for (let i=1;i<s.length;i++) {
    if (s[i]===s[i-1]+1) { pairs++; cur++; maxLen=Math.max(maxLen,cur); }
    else cur=1;
  }
  return { pairs, maxLen };
}

function analyzeConsecutive(data) {
  const rows = data.map(d => {
    const { pairs, maxLen } = countConsec(d.numbers);
    return { round:d.round, pairs, maxLen, hasConsec: pairs>0 };
  });
  const cc = rows.filter(r=>r.hasConsec).length;
  const pd = {};
  rows.forEach(r => { pd[r.pairs]=(pd[r.pairs]||0)+1; });
  return {
    rows, consecCount:cc,
    consecRate: rows.length ? cc/rows.length : 0,
    avgPairs: rows.reduce((s,r)=>s+r.pairs,0)/rows.length,
    pairDist: pd,
  };
}

// ────────────────────────────────────────────────────────────
// スコアリング & ルール
// ────────────────────────────────────────────────────────────
function passesRules(nums) {
  const s = [...nums].sort((a,b)=>a-b);
  const t = s.reduce((a,b)=>a+b,0);
  if (t<CFG.RULE.SUM_MIN||t>CFG.RULE.SUM_MAX) return false;
  const ev = s.filter(n=>n%2===0).length;
  if (!CFG.EVEN_ODD.some(([e,o])=>e===ev&&o===6-ev)) return false;
  const {pairs} = countConsec(s);
  if (pairs>CFG.RULE.MAX_CONSEC) return false;
  for (const zr of Object.values(CFG.ZONES)) {
    if (!s.some(n=>zr.includes(n))) return false;
  }
  return true;
}


// ============================================================
// 修正① scoreCombo
// 連番スコアを 0〜2組すべて高評価のフラット型に変更
// ============================================================
function scoreCombo(nums, freqMap, sumMean, sumStd) {
  const s   = [...nums].sort((a,b)=>a-b);
  const t   = s.reduce((a,b)=>a+b,0);
  const ev  = s.filter(n=>n%2===0).length;
  const {pairs} = countConsec(s);
  const cov = Object.values(CFG.ZONES)
    .filter(zr=>s.some(n=>zr.includes(n))).length;

  // ── 出現頻度スコア ───────────────────────────
  const avgF = Object.values(freqMap).reduce((a,b)=>a+b,0) / 43;
  const fs   = s.reduce((sum,n) =>
    sum + Math.max(0, 1 - Math.abs(freqMap[n]-avgF) / (avgF+1e-9))
  , 0) / 6;

  // ── プラトー型合計値スコア ────────────────────
  // 110〜150 は一律満点、範囲外は40点幅で線形減点
  const P_MIN = 110, P_MAX = 150;
  const ss =
    (t >= P_MIN && t <= P_MAX) ? 1.0 :
    t < P_MIN ? Math.max(0, 1 - (P_MIN - t) / 40) :
                Math.max(0, 1 - (t - P_MAX) / 40);

  // ── ゾーンスコア ─────────────────────────────
  const zs = cov / 5;

  // ── 連番スコア（実績に基づく自然分散型）──────────────────
  // 実績: 0組(約45%)、1組(約45%)は同等に評価、2組(約10%未満)は微減点
  // → 0組:1.00, 1組:1.00, 2組:0.90
  const cs =
    pairs === 0 ? 1.00 :
    pairs === 1 ? 1.00 :
    pairs === 2 ? 0.90 :
    Math.max(0, 1 - (pairs - 2) * 0.40);


  const score =
    CFG.SCORE_W.freq   * fs +
    CFG.SCORE_W.sum    * ss +
    CFG.SCORE_W.zone   * zs +
    CFG.SCORE_W.consec * cs;

  return {
    numbers: s, score, total: t,
    evenCnt: ev, oddCnt: 6-ev,
    pairs, coveredZones: cov,
  };
}

function weightedSample6(weights) {
  const pool=[...CFG.NUMBERS], w=[...weights], res=[];
  while(res.length<6) {
    const tot=w.reduce((a,b)=>a+b,0);
    let r=Math.random()*tot;
    for (let i=0;i<pool.length;i++) {
      r-=w[i];
      if(r<=0){res.push(pool[i]);pool.splice(i,1);w.splice(i,1);break;}
    }
  }
  return res;
}

// ============================================================
// LotoLearner - 動的学習・自己補正エンジン
// predictRuleBased から呼ばれる。データが渡されるたびに再学習。
// ============================================================
class LotoLearner {
  constructor() {
    this.model   = null;
    this.LOG_KEY = "loto6_learn_log";
  }

  // ──────────────────────────────────────────────────────────
  // メイン学習メソッド
  // data が更新されるたびに自動で再計算される
  // ──────────────────────────────────────────────────────────
learn(data) {
    const WINDOW = Math.min(200, data.length);
    const recent = data.slice(-WINDOW);

    const targetSum     = this._learnTargetSum(recent, data);
    const targetConsec  = this._learnTargetConsec(recent);
    const intervalHist  = this._learnIntervalHistogram(data);
    const currIntervals = this._calcCurrentIntervals(data);

    // ★修正: ロト6用に直近15回分の当選番号をまとめて記憶させる
    const recentDraws = data.slice(-15).map(d => d.numbers);

    const numberWeights = this._calcNumberWeights(data, intervalHist, currIntervals);

    this.model = {
      targetSum,
      targetConsec,
      intervalHist,
      currIntervals,
      numberWeights,
      recentDraws, // ★記憶
      learnedAt:  new Date().toISOString(),
      dataSize:   data.length,
      lastRound:  data[data.length-1]?.round,
    };

    this._saveLog();
    this._printLog();
    return this.model;
  }

  scoreComboByLoss(combo, alpha=1.2, beta=0.6) {
    const m      = this.model;
    if(!m) return 0;

    const sorted = [...combo].sort((a,b)=>a-b);
    const total  = sorted.reduce((a,b)=>a+b,0);
    const {pairs}= countConsec(sorted);

    const weightSum = sorted.reduce((s,n) => s+(m.numberWeights[n]||0), 0);

    const lossSum    = Math.abs(total  - m.targetSum.value)    / 50;
    const lossConsec = Math.abs(pairs  - m.targetConsec.value) / 3;

    // ★大改修: 過去15回の履歴をチェック。4個以上の丸被りは「マイナス100点」で一発退場！
    let historyPenalty = 0;
    if (m.recentDraws) {
      m.recentDraws.forEach((pastDraw) => {
        const matchCount = sorted.filter(n => pastDraw.includes(n)).length;
        if (matchCount >= 4) {
          historyPenalty += 100; // ロト6は6個中4個被りでアウト
        } else if (matchCount === 3) {
          historyPenalty += 5;   // 3個被りも少しだけ警戒して減点
        }
      });
    }

    return weightSum - alpha*lossSum - beta*lossConsec - historyPenalty;
  }

  // ──────────────────────────────────────────────────────────
  // ① Target Sum（目標合計値）の動的算出
  //    全体平均 × 0.4  +  直近20回移動平均 × 0.3  +  線形回帰予測 × 0.3
  // ──────────────────────────────────────────────────────────
  _learnTargetSum(recent, allData) {
    const sums      = recent.map(d => d.total);
    const n         = sums.length;
    const allSums   = allData.map(d => d.total);
    const globalMean= allSums.reduce((a,b)=>a+b,0) / allSums.length;

    // 直近20回の移動平均
    const last20    = sums.slice(-20);
    const movingAvg = last20.reduce((a,b)=>a+b,0) / last20.length;

    // 直近30回の線形回帰
    const reg  = sums.slice(-30);
    const rn   = reg.length;
    const xMu  = (rn-1)/2;
    const yMu  = reg.reduce((a,b)=>a+b,0)/rn;
    let   nm=0, dn=0;
    reg.forEach((y,x)=>{ nm+=(x-xMu)*(y-yMu); dn+=(x-xMu)**2; });
    const slope      = dn>0 ? nm/dn : 0;
    const regNext    = slope*rn + (yMu - slope*xMu);

    const value = globalMean*0.4 + movingAvg*0.3 + regNext*0.3;

    return {
      value:      Math.max(80, Math.min(200, value)),
      globalMean: Math.round(globalMean*10)/10,
      movingAvg:  Math.round(movingAvg*10)/10,
      regNext:    Math.round(regNext*10)/10,
      slope:      Math.round(slope*100)/100,
    };
  }

  // ──────────────────────────────────────────────────────────
  // ② Target Consec（目標連番ペア数）の動的算出
  //    直近の連番ペア分布から期待値を計算
  // ──────────────────────────────────────────────────────────
  _learnTargetConsec(recent) {
    const pairsArr = recent.map(d => countConsec(d.numbers).pairs);
    const avg      = pairsArr.reduce((a,b)=>a+b,0) / pairsArr.length;
    const dist     = {};
    pairsArr.forEach(p => { dist[p] = (dist[p]||0)+1; });

    // 確率分布
    const prob = {};
    Object.entries(dist).forEach(([k,v])=>{
      prob[k] = v/pairsArr.length;
    });

    return {
      value: avg,       // 0.88〜1.1付近が想定値
      distribution: dist,
      probability:  prob,
    };
  }

  // ──────────────────────────────────────────────────────────
  // ③ インターバルヒストグラムの学習
  //    「X回休んだ数字が当選した」の頻度分布を構築
  //    → どのインターバル帯が「当たりやすいか」を学習
  // ──────────────────────────────────────────────────────────
  _learnIntervalHistogram(data) {
    const raw     = {};
    for(let i=0;i<=60;i++) raw[i]=0;
    raw["60+"] = 0;

    const lastSeen = {};
    CFG.NUMBERS.forEach(n => { lastSeen[n] = -1; });

    data.forEach((draw, idx) => {
      draw.numbers.forEach(num => {
        if(lastSeen[num] >= 0){
          const gap = idx - lastSeen[num] - 1;
          if(gap <= 60) raw[gap]++;
          else raw["60+"]++;
        }
        lastSeen[num] = idx;
      });
    });

    const total = Object.values(raw).reduce((a,b)=>a+b,0);
    const prob  = {};
    Object.entries(raw).forEach(([k,v])=>{
      prob[k] = total>0 ? v/total : 0;
    });

    // ピーク（最も当たりやすいインターバル）を算出
    const peak = Object.entries(prob)
      .filter(([k])=>k!=="60+")
      .sort((a,b)=>b[1]-a[1])[0];

    return { raw, prob, total, peakInterval: parseInt(peak[0]) };
  }

  // ──────────────────────────────────────────────────────────
  // 各数字の現在インターバル（最後に出てから何回経過したか）
  // ──────────────────────────────────────────────────────────
  _calcCurrentIntervals(data) {
    const n       = data.length;
    const result  = {};
    CFG.NUMBERS.forEach(num => {
      let last = -1;
      for(let i=n-1;i>=0;i--){
        if(data[i].numbers.includes(num)){ last=i; break; }
      }
      result[num] = last>=0 ? n-1-last : n;
    });
    return result;
  }

  // ──────────────────────────────────────────────────────────
  // ④ 各数字の基本ウェイト算出
  //    複数の特徴量から合成スコアを算出（ハードフィルタなし）
  // ──────────────────────────────────────────────────────────
  _calcNumberWeights(data, hist, intervals) {
    const n      = data.length;
    const fm     = buildFreqMap(data);
    const avgFreq= (n*6)/43;
    const prob   = hist.prob;
    const peak   = hist.peakInterval;
    const result = {};

    CFG.NUMBERS.forEach(num => {
      const gap = intervals[num];

      // (a) 学習済みインターバルスコア
      //     現在の gap が過去の「当たりやすい間隔」に近いほど高評価
      const gapKey       = gap<=60 ? gap : "60+";
      const intervalScore= (prob[gapKey]||0) * 8.0;

      // (b) ピーク近傍ボーナス
      //     ピークインターバルの±2以内なら追加加点
      const peakDist     = Math.abs(gap - peak);
      const peakBonus    = peakDist<=2 ? (1-(peakDist*0.15))*0.4 : 0;

      // (c) ショートバウンスボーナス（1〜3回休み）
      const shortBonus   = (gap>=1 && gap<=3) ? 0.35 : 0;

      // (d) ディープスリーパーボーナス（20回以上未出現）
      const deepBonus    = gap>=20 ? Math.min((gap-20)*0.015, 0.45) : 0;

      // (e) 出現頻度の均等性スコア
      //     過度に多い/少ないは減点（中程度が高評価）
      const freqDev  = Math.abs(fm[num]-avgFreq)/(avgFreq+1e-9);
      const freqScore= Math.max(0, 1-freqDev*0.6);

      // (f) 直近20回トレンドスコア（出現多→評価やや高め）
      const r20      = data.slice(-20);
      const r20cnt   = r20.reduce((s,d)=>s+(d.numbers.includes(num)?1:0),0);
      const trendScore= r20cnt/20;

      result[num] =
        intervalScore +
        peakBonus     +
        shortBonus    +
        deepBonus     +
        freqScore     +
        trendScore;
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // 組み合わせの最終スコア（ロス関数）
  //
  //   score = ウェイト合計
  //         - α × Loss_Sum   （合計値が目標からズレた分を減点）
  //         - β × Loss_Consec（連番が目標からズレた分を減点）
  //
  //   ハードフィルタ（if文での強制除外）は一切使わない
  //   ズレの大小をスコアに反映するだけ
  // ──────────────────────────────────────────────────────────
  scoreComboByLoss(combo, alpha=1.2, beta=0.6) {
    const m      = this.model;
    if(!m) return 0;

    const sorted = [...combo].sort((a,b)=>a-b);
    const total  = sorted.reduce((a,b)=>a+b,0);
    const {pairs}= countConsec(sorted);

    // 個別数字のウェイト合計
    const weightSum = sorted.reduce((s,n) => s+(m.numberWeights[n]||0), 0);

    // ロス：目標値との差を0〜1に正規化
    const lossSum    = Math.abs(total  - m.targetSum.value)    / 50;
    const lossConsec = Math.abs(pairs  - m.targetConsec.value) / 3;

    return weightSum - alpha*lossSum - beta*lossConsec;
  }

  // ──────────────────────────────────────────────────────────
  // 学習ログをlocalStorageに保存（最大50件）
  // ──────────────────────────────────────────────────────────
  _saveLog() {
    try {
      const m    = this.model;
      const logs = JSON.parse(localStorage.getItem(this.LOG_KEY)||"[]");

      logs.push({
        timestamp:   m.learnedAt,
        dataSize:    m.dataSize,
        lastRound:   m.lastRound,
        targetSum:   m.targetSum,
        targetConsec:Math.round(m.targetConsec.value*100)/100,
        peakInterval:m.intervalHist.peakInterval,
        topWeights:  Object.entries(m.numberWeights)
          .sort((a,b)=>b[1]-a[1])
          .slice(0,10)
          .map(([n,w])=>({ num:parseInt(n), w:Math.round(w*1000)/1000 })),
      });

      if(logs.length > 50) logs.splice(0, logs.length-50);
      localStorage.setItem(this.LOG_KEY, JSON.stringify(logs));
    } catch(e) {
      console.warn("ログ保存失敗:", e.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 学習結果をコンソールに出力
  // ──────────────────────────────────────────────────────────
  _printLog() {
    const m = this.model;
    console.group("📊 LotoLearner 学習結果");
    console.log(`📅 第${m.lastRound}回まで (${m.dataSize}件 / 直近200回を分析)`);
    console.log(
      `🎯 目標合計値: ${m.targetSum.value.toFixed(1)}`,
      `(全体平均:${m.targetSum.globalMean} / 移動平均:${m.targetSum.movingAvg} / 回帰予測:${m.targetSum.regNext} / 傾き:${m.targetSum.slope})`
    );
    console.log(
      `🔗 目標連番ペア: ${m.targetConsec.value.toFixed(2)}組`,
      "分布:", m.targetConsec.distribution
    );
    console.log(`⏱ ピークインターバル: ${m.intervalHist.peakInterval}回休み`);
    console.log(
      "🔢 ウェイト上位10数字:",
      Object.entries(m.numberWeights)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,10)
        .map(([n,w])=>`${n}番(${w.toFixed(2)})`)
        .join(" / ")
    );
    console.groupEnd();
  }

  // ──────────────────────────────────────────────────────────
// 次回合計値のトレンドメッセージを返す（Pattern A 専用）
// ──────────────────────────────────────────────────────────
getTrendMessage(data) {
  if(!this.model) return null;

  const slope      = this.model.targetSum.slope;
  const targetSum  = this.model.targetSum.value;
  const lastTotal  = data[data.length-1]?.total || 0;
  const last5avg   = data.slice(-5).reduce((s,d)=>s+d.total,0) / 5;
  const globalAvg  = this.model.targetSum.globalMean;
  const diff       = targetSum - last5avg;

  // 方向判定
  const dir =
    slope >  3 ? { icon:"📈", text:"急上昇傾向",  color:"#ff6b6b" } :
    slope >  1 ? { icon:"↗",  text:"上昇傾向",    color:"#fdcb6e" } :
    slope < -3 ? { icon:"📉", text:"急下降傾向",  color:"#74b9ff" } :
    slope < -1 ? { icon:"↘",  text:"下降傾向",    color:"#74b9ff" } :
                 { icon:"➡",  text:"横ばい傾向",  color:"#a0a8b8" };

  // 目標合計値との乖離メッセージ
  const diffMsg =
    diff >  20 ? `（平均より+${diff.toFixed(0)}高い水準が続いている）` :
    diff < -20 ? `（平均より${Math.abs(diff).toFixed(0)}低い水準が続いている）` :
                 `（平均付近で推移中）`;

  return {
    icon:      dir.icon,
    text:      dir.text,
    color:     dir.color,
    slope:     slope,
    targetSum: targetSum.toFixed(0),
    lastTotal,
    diffMsg,
    fullText:
      `${dir.icon} 次回合計値は【${dir.text}】 ` +
      `目標値: ${targetSum.toFixed(0)} / 直近5回平均: ${last5avg.toFixed(0)} ` +
      `${diffMsg}`,
  };
}

  // ── 外部から呼び出し可能なユーティリティ ──────────────────
  getLogs()   { try{ return JSON.parse(localStorage.getItem(this.LOG_KEY)||"[]"); }catch(e){ return []; } }
  clearLogs() { localStorage.removeItem(this.LOG_KEY); console.log("学習ログをクリアしました"); }
  printAllLogs() {
    const logs = this.getLogs();
    console.group(`📋 学習ログ一覧 (${logs.length}件)`);
    logs.forEach((l,i) => {
      console.log(
        `[${i+1}] ${l.timestamp.slice(0,19)}`,
        `第${l.lastRound}回`,
        `目標合計:${l.targetSum.value.toFixed(1)}`,
        `目標連番:${l.targetConsec}組`,
        `peak:${l.peakInterval}回休み`
      );
    });
    console.groupEnd();
  }
}

// グローバルインスタンス（データ更新のたびに自動再学習）
const LEARNER = new LotoLearner();

// ────────────────────────────────────────────────────────────
// 予測ロジック
// ────────────────────────────────────────────────────────────
// ============================================================
// predictRuleBased - Pattern A
// ============================================================
function predictRuleBased(data) {
  const model = LEARNER.learn(data);
  const weights = CFG.NUMBERS.map(n => Math.max((model.numberWeights[n] || 0) + 1.0, 0.1));

  const MAX_TRIALS  = 40000;
  const scoredCombos= [];

  for(let i=0; i<MAX_TRIALS; i++){
    const combo = weightedSample6(weights);
    if(new Set(combo).size < 6) continue;

    const finalScore = LEARNER.scoreComboByLoss(combo);
    scoredCombos.push({ combo, score: finalScore });
  }

  // スコア順に並び替え
  scoredCombos.sort((a,b) => b.score - a.score);

  // ★大改修: バラして集計するのをやめ、「厳しい審査を1位で通過した最高の1組」を採用
  const bestCombo = scoredCombos[0].combo;
  const resultScore = scoredCombos[0].score;

  const resultTotal    = bestCombo.reduce((a,b)=>a+b,0);
  const {pairs: resultPairs} = countConsec(bestCombo);
  const resultEv       = bestCombo.filter(n=>n%2===0).length;
  const resultCov      = Object.values(CFG.ZONES).filter(zr=>bestCombo.some(n=>zr.includes(n))).length;

  return {
    numbers:      bestCombo,
    total:        resultTotal,
    score:        Math.max(0, Math.min(1, (resultScore+2)/6)),
    evenCnt:      resultEv,
    oddCnt:       6-resultEv,
    pairs:        resultPairs,
    coveredZones: resultCov,
    pattern:      "A",
    label:        "動的学習予測（最高スコア抽出）",
    method:       `LossFunc | 目標合計:${model.targetSum.value.toFixed(0)} 目標連番:${model.targetConsec.value.toFixed(1)}組 (丸被り排除)`,
  };
}

// ============================================================
// Pattern B (predictUltimate): 黄金ゾーン ＆ ペア相性(共起性)特化
// 
// コンセプト: Pattern A をベースにしつつも、最強の「ペア相性」で脇を固める。
// 1. ゾーン固定: 1桁(1), 10番台(1〜2), 20番台(1〜2), 30番台(1〜2), 40番台(1)
// 2. 共起行列: 過去データから「一緒に来やすい数字」のペアスコアを計算。
// 3. 評価: Aの数字を引継ぎつつも、ペア相性が悪い場合はAを蹴って相性の良い数字を選ぶ。
// 4. 合計値固定: 黄金のボリュームゾーン「120〜159」を絶対厳守。
// ============================================================
function predictUltimate(data, pA = null) {
  if (!pA) pA = predictRuleBased(data); // 安全策：Aが渡されなかったら独自生成

  const fm = buildFreqMap(data);
  const n = data.length;

  // ── 1. 共起相関（一緒に来やすいペア）の計算 ──
  const coCounts = {};
  data.forEach(d => {
    const nums = d.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        // 昇順に並んでいる前提
        const key = `${nums[i]},${nums[j]}`;
        coCounts[key] = (coCounts[key] || 0) + 1;
      }
    }
  });

  // ── 2. 各ゾーンの候補プールを作成（高頻度 ＋ Pattern A） ──
  const zonePools = {};
  Object.keys(CFG.ZONES).forEach(zKey => {
    const nums = CFG.ZONES[zKey];
    // 出現頻度順にソートして精鋭を抽出
    const sortedNums = nums.map(num => ({ num, f: fm[num] || 0 })).sort((a,b) => b.f - a.f);
    const keepCount = zKey === "Zone5(40-43)" ? 4 : 7; 
    let pool = sortedNums.slice(0, keepCount).map(x => x.num);

    // Pattern A が選んだ数字を候補プールに混ぜ込む（特別扱いはここまで）
    const aNumsInZone = pA.numbers.filter(num => CFG.ZONES[zKey].includes(num));
    pool = Array.from(new Set([...pool, ...aNumsInZone])); 
    zonePools[zKey] = pool;
  });

  const zoneKeys = Object.keys(CFG.ZONES);
  // 条件に合致する「10〜30番台のいずれかが2個になる」フォーメーション3種
  const layouts = [
    [1, 2, 1, 1, 1], // 10番台が2個
    [1, 1, 2, 1, 1], // 20番台が2個
    [1, 1, 1, 2, 1]  // 30番台が2個
  ];

  let bestCombo = null;
  let maxScore = -Infinity;

  // ── 3. モンテカルロ探索（30,000回の組み合わせテスト） ──
  for (let i = 0; i < 30000; i++) {
    const layout = layouts[Math.floor(Math.random() * layouts.length)];
    let combo = [];

    // レイアウトに従ってプールからランダムに数字を引く
    zoneKeys.forEach((zKey, zIdx) => {
      const targetCount = layout[zIdx];
      const pool = zonePools[zKey];
      const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, targetCount);
      combo.push(...picked);
    });

    // 昇順ソート
    combo.sort((a, b) => a - b);

    // 安全処理＆連番制限（3連番以上は弾く）
    if (combo.length !== 6) continue;
    let seqCount = 0;
    for(let j = 1; j < 6; j++) { if(combo[j] === combo[j-1]+1) seqCount++; }
    if (seqCount > 2) continue;

    // 黄金のボリュームゾーン厳守
    const total = combo.reduce((a, b) => a + b, 0);
    if (total < 120 || total > 159) continue;

    // ── 4. 組み合わせの【最強スコアリング】 ──
    let score = combo.reduce((acc, num) => acc + (fm[num] || 0), 0); // ① 基本の出現頻度

    // ② ペア（共起性）スコアを強力に加算！
    let pairScore = 0;
    for (let j = 0; j < combo.length; j++) {
      for (let k = j + 1; k < combo.length; k++) {
        const key = `${combo[j]},${combo[k]}`;
        pairScore += (coCounts[key] || 0);
      }
    }
    score += pairScore * 5; // 相性の良さをかなり重視（倍率5）

    // ③ Pattern Aからの引継ぎボーナス
    // ※ 絶対にAを引継ぐわけではなく、ペア相性とのバランスで競わせる
    const keptCount = combo.filter(num => pA.numbers.includes(num)).length;
    score += keptCount * 50; 

    // 最高スコアを更新したらキープ
    if (score > maxScore) {
      maxScore = score;
      bestCombo = combo;
    }
  }

  // 万が一見つからなかった場合のフォールバック
  if (!bestCombo) {
    bestCombo = [5, 12, 26, 35, 38, 42]; 
  }

  const total = bestCombo.reduce((a, b) => a + b, 0);
  const evCnt = bestCombo.filter(n => n % 2 === 0).length;
  const cov = Object.values(CFG.ZONES).filter(zr => bestCombo.some(n => zr.includes(n))).length;
  const { pairs } = countConsec(bestCombo);

  return {
    numbers: bestCombo,
    total: total,
    score: 1.0,
    evenCnt: evCnt,
    oddCnt: 6 - evCnt,
    pairs: pairs,
    coveredZones: cov,
    pattern: "ULTIMATE",
    label: "黄金ゾーン ＆ ペア相性(共起性)特化",
    method: "Aを参考にしつつ、過去の『最強ペアの組み合わせ』を優先して構築"
  };
}

// ============================================================
// Pattern C (predictPatternC): 状況対応型・精密揺らぎ補正
// ============================================================
function predictPatternC(data, pA = null, pB = null) {
  if (!pA) pA = predictRuleBased(data); 
  if (!pB) pB = predictUltimate(data, pA); 

  let bestBase = [];
  let appliedMethod = "";

  const isBiasedA = [
    [1, 9], [10, 19], [20, 29], [30, 39], [40, 43]
  ].some(range => pA.numbers.filter(n => n >= range[0] && n <= range[1]).length >= 3);

  if (isBiasedA) {
    bestBase = [...pA.numbers];
    appliedMethod = "A大偏り検知(Ultimate無視) ＋ 全揺らし精密補正";
  } else {
    appliedMethod = "A番台トレンド優先 ＋ Ultimate型ハメ補正";
    const model = LEARNER.model || LEARNER.learn(data);
    const aWeights = pA.numbers.map(n => ({ num: n, weight: model.numberWeights[n] || 0 }));
    aWeights.sort((a, b) => b.weight - a.weight);
    const strongANums = [aWeights[0].num, aWeights[1].num]; 

    let forcedA = [...strongANums];
    let forbiddenB_zones = [];

    const tensRanges = [[10, 19], [20, 29], [30, 39]];
    tensRanges.forEach(range => {
      const aInZone = pA.numbers.filter(n => n >= range[0] && n <= range[1]);
      if (aInZone.length >= 2) {
        forcedA.push(...aInZone);
        forbiddenB_zones.push(range); 
      }
    });

    let fixedBase = Array.from(new Set(forcedA));

    let remainingB = pB.numbers.filter(n => {
      if (fixedBase.includes(n)) return false;
      for (let range of forbiddenB_zones) {
        if (n >= range[0] && n <= range[1]) return false;
      }
      return true;
    });

    let needed = 6 - fixedBase.length;

    if (remainingB.length < needed) {
      let extraA = pA.numbers.filter(n => !fixedBase.includes(n));
      fixedBase.push(...extraA.slice(0, needed - remainingB.length));
      needed = 6 - fixedBase.length;
    }

    const getCombinations = (arr, k) => {
      if (k === 0) return [[]];
      if (arr.length === 0) return [];
      const [first, ...rest] = arr;
      const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
      const withoutFirst = getCombinations(rest, k);
      return [...withFirst, ...withoutFirst];
    };

    const combos = getCombinations(remainingB, needed);
    let maxScore = -Infinity;

    if (combos.length > 0) {
      combos.forEach(c => {
        const testNums = [...fixedBase, ...c];
        let score = 0;
        const total = testNums.reduce((sum, n) => sum + n, 0);
        
        const z40 = testNums.filter(n => n >= 40).length;
        const z30 = testNums.filter(n => n >= 30 && n <= 39).length;

        if (z40 === 1) score += 1000; 
        if (z30 >= 1 && z30 <= 2) score += 500; 

        if (total >= 120 && total <= 159) score += 800;
        else if (total > 159) score -= (total - 159) * 10;
        else if (total < 120) score -= (120 - total) * 10;

        if (score > maxScore) {
          maxScore = score;
          bestBase = testNums;
        }
      });
    } else {
      bestBase = [...fixedBase, ...remainingB.slice(0, needed)];
    }

    const has40 = bestBase.some(n => n >= 40);
    if (!has40) {
      let bSourcedNums = bestBase.filter(n => !fixedBase.includes(n)).sort((a,b) => a - b);
      if (bSourcedNums.length > 0) {
        const toRemove = bSourcedNums[0];
        bestBase = bestBase.filter(n => n !== toRemove);
        
        const fm = buildFreqMap(data);
        const z5 = [40, 41, 42, 43].sort((a,b) => (fm[b]||0) - (fm[a]||0));
        bestBase.push(z5[0]);
      }
    }
  }

  bestBase.sort((a, b) => a - b);
  const finalNums = [];

  // ── ★修正: ロト6用に最大±3で「無条件に」ランダム揺らし（0を含む） ──
  bestBase.forEach(num => {
    let isZone1 = false;
    let isZone5 = false;
    let offsets = [-3, -2, -1, 0, 1, 2, 3]; // ロト6は43個あるので揺らぎを±3に

    if (num <= 9) {
      isZone1 = true;
      offsets = offsets.filter(off => num + off <= 10);
    } 
    else if (num >= 40) {
      isZone5 = true;
      offsets = offsets.filter(off => num + off >= 40);
    }

    let offset = offsets[Math.floor(Math.random() * offsets.length)];
    let safeNum = num + offset;

    // 範囲ガード
    if (safeNum < 1) safeNum = 1;
    if (safeNum > 43) safeNum = 43;
    
    if (isZone1 && safeNum > 10) safeNum = 10;
    if (isZone5 && safeNum < 40) safeNum = 40;

    let step = (offset < 0) ? -1 : 1; 
    if (offset === 0) step = 1; 

    while (finalNums.includes(safeNum)) {
      safeNum += step;
      if (isZone1) {
        if (safeNum > 10) safeNum = 1;
        if (safeNum < 1) safeNum = 10;
      } 
      else if (isZone5) {
        if (safeNum > 43) safeNum = 40;
        if (safeNum < 40) safeNum = 43;
      } 
      else {
        if (safeNum > 43) safeNum = 1;
        if (safeNum < 1) safeNum = 43;
      }
    }

    finalNums.push(safeNum);
  });

  finalNums.sort((a, b) => a - b);

  const total = finalNums.reduce((a, b) => a + b, 0);
  const evCnt = finalNums.filter(n => n % 2 === 0).length;
  const cov = Object.values(CFG.ZONES).filter(zr => finalNums.some(n => zr.includes(n))).length;
  const { pairs } = countConsec(finalNums);

  return {
    numbers: finalNums,
    total: total,
    score: 1.0,
    evenCnt: evCnt,
    oddCnt: 6 - evCnt,
    pairs: pairs,
    coveredZones: cov,
    pattern: "C",
    label: "状況対応型・ハイブリッド揺らぎ補正",
    method: appliedMethod
  };
}

// ============================================================
// Pattern C2 (predictPatternC2): 合計推移・連番収束 (ランダム補正版)
// ============================================================
function predictPatternC2(data, pA = null, pB = null) {
  if (!pA) pA = predictRuleBased(data);
  if (!pB) pB = predictUltimate(data, pA);

  let baseNums = [...pA.numbers]; 
  
  const recent = data.slice(-5).map(d => d.total);
  let trend = 0;
  for(let i=1; i<recent.length; i++) {
    trend += (recent[i] - recent[i-1]);
  }
  const avgDiff = trend / (recent.length - 1); 
  
  let predictedTotal = recent[recent.length - 1] + avgDiff;
  predictedTotal = Math.round((predictedTotal * 0.7) + (129 * 0.3));
  predictedTotal = Math.max(90, Math.min(180, predictedTotal));

  const getPairs = (arr) => {
    let p = 0;
    for(let i=1; i<arr.length; i++) {
      if (arr[i] === arr[i-1] + 1) p++;
    }
    return p;
  };

  let bestNums = [...baseNums];
  let maxScore = -Infinity;

  for (let i = 0; i < 5000; i++) {
    let cand = [];
    
    for (let j = 0; j < 6; j++) {
      let num = baseNums[j];
      
      // ★修正: 忖度なし！すべての数字を無条件で [-3 から 3] で選ぶ
      const offsets = [-3, -2, -1, 0, 1, 2, 3];
      let offset = offsets[Math.floor(Math.random() * offsets.length)];
      
      cand.push(num + offset);
    }
    
    let isValid = true;
    for(let j=0; j<6; j++){
      if(cand[j] < 1 || cand[j] > 43) isValid = false;
    }
    if (!isValid) continue;
    
    const uniqueCand = Array.from(new Set(cand));
    if (uniqueCand.length !== 6) continue;
    cand.sort((a, b) => a - b);

    const currentTotal = cand.reduce((a, b) => a + b, 0);
    const diff = Math.abs(predictedTotal - currentTotal);
    
    const sumScore = Math.max(0, 100 - (diff * 3)); 

    const pairs = getPairs(cand);
    let pairMult = 1.0;
    if (pairs === 0) pairMult = 0.88;
    else if (pairs === 1) pairMult = 1.0; 
    else if (pairs === 2) pairMult = 0.92;
    else pairMult = 0.5;

    // ★追加: Aと全く同じ数字（4個以上一致）になったら大減点する差別化スコア
    const matchWithA = cand.filter(n => baseNums.includes(n)).length;
    const diffPenalty = matchWithA >= 4 ? 50 : 0; 

    const totalScore = (sumScore * pairMult) - diffPenalty;

    if (totalScore >= maxScore) {
      maxScore = totalScore;
      bestNums = cand;
    }
  }

  const finalTotal = bestNums.reduce((a, b) => a + b, 0);
  const evCnt = bestNums.filter(n => n % 2 === 0).length;
  const cov = Object.values(CFG.ZONES).filter(zr => bestNums.some(n => zr.includes(n))).length;
  const finalPairs = getPairs(bestNums);

  return {
    numbers: bestNums,
    total: finalTotal,
    score: 1.0,
    evenCnt: evCnt,
    oddCnt: 6 - evCnt,
    pairs: finalPairs,
    coveredZones: cov,
    pattern: "C2",
    label: "パターン C2 (合計推移・ランダム補正)",
    method: `A基準(±3)のランダム補正から目標[${predictedTotal}]と連番期待値に合致するものを抽出 (A差別化済)`
  };
}


// ============================================================
// Pattern C3 (predictPatternC3): C2ベース・二次ランダム補正
// 
// コンセプト: 
// 1. パターンC2の出力結果をベースにする。
// 2. 各数字を独立して「±2」の範囲でランダムに揺らす。
// 3. 重複や範囲外(1-43)を自動修正し、C2から派生した「一歩隣」の出目を作る。
// ============================================================
function predictPatternC3(data, pC2) {
  let baseNums = [...pC2.numbers];
  let finalNums = [];

  // ── 1. 各数字に±2のランダム揺らぎを適用 ──
  baseNums.forEach(num => {
    const offsets = [-2, -1, 0, 1, 2];
    const offset = offsets[Math.floor(Math.random() * offsets.length)];
    let target = num + offset;

    // 1〜43の範囲ガード
    if (target < 1) target = 1;
    if (target > 43) target = 43;

    // 重複回避（被った場合は空いている隣の数字へ）
    let step = (offset >= 0) ? 1 : -1;
    while (finalNums.includes(target)) {
      target += step;
      if (target > 43) target = 1;
      if (target < 1) target = 43;
    }
    finalNums.push(target);
  });

  // 昇順にソート
  finalNums.sort((a, b) => a - b);

  const total = finalNums.reduce((a, b) => a + b, 0);
  const evCnt = finalNums.filter(n => n % 2 === 0).length;
  const cov = Object.values(CFG.ZONES).filter(zr => finalNums.some(n => zr.includes(n))).length;
  
  // 連番組数のカウント
  let pairs = 0;
  for(let i=1; i<finalNums.length; i++) {
    if (finalNums[i] === finalNums[i-1] + 1) pairs++;
  }

  return {
    numbers: finalNums,
    total: total,
    score: 1.0,
    evenCnt: evCnt,
    oddCnt: 6 - evCnt,
    pairs: pairs,
    coveredZones: cov,
    pattern: "C3",
    label: "パターン C3 (C2派生・二次補正)",
    method: "C2の予測値をベースに、さらに各数字を±2の範囲でランダムに揺らして生成"
  };
}


// ────────────────────────────────────────────────────────────
// ガラポン演出
// ────────────────────────────────────────────────────────────
function runGarapon(predictions, callback) {
  const overlay     = document.getElementById("garapon-overlay");
  const ring        = document.getElementById("drum-ring");
  const ejected     = document.getElementById("ejected-balls");
  const titleEl     = document.getElementById("garapon-title");
  const subEl       = document.getElementById("garapon-sub");
  const closeBtn    = document.getElementById("garapon-close-btn");

  // 初期化
  ejected.innerHTML  = "";
  subEl.textContent  = "";
  closeBtn.style.display = "none";
  titleEl.textContent    = "🎰 抽選中...";
  ring.className         = "drum-ring spinning";
  overlay.classList.add("active");

  // Phase1: 回転 (1.8s)
  setTimeout(() => {
    ring.className    = "drum-ring slowing";
    titleEl.textContent = "✨ 当選番号発表！";

    // 代表としてPattern Aの番号をガラポンで排出
    const nums = predictions[0].numbers;

    nums.forEach((num, idx) => {
      setTimeout(() => {
        const ball = document.createElement("div");
        ball.className = "ejected-ball";
        ball.style.background = getBallBg(num);
        ball.style.color = (num>=20&&num<=29) ? "#1a1d27" : "white";
        ball.textContent = num;
        ejected.appendChild(ball);
        // 1フレーム後にアニメーション付与
        requestAnimationFrame(() => {
          requestAnimationFrame(() => ball.classList.add("pop"));
        });

        // 最後のボール
        if (idx === nums.length - 1) {
          setTimeout(() => {
            // ★ ここを「3パターンの予測結果を〜」に変更
            subEl.textContent = "3パターンの予測結果を確認しましょう！";
            closeBtn.style.display = "block";
          }, 600);
        }
      }, 600 + idx * 380);
    });
  }, 1800);

  closeBtn.onclick = () => {
    overlay.classList.remove("active");
    ring.className = "drum-ring";
    callback();
  };
}

// ────────────────────────────────────────────────────────────
// チャート描画
// ────────────────────────────────────────────────────────────
Chart.defaults.color       = "#9099b0";
Chart.defaults.borderColor = "#2e3148";
Chart.defaults.font.family = "'Segoe UI', sans-serif";

function dc(key) {
  if(STATE.charts[key]){ STATE.charts[key].destroy(); delete STATE.charts[key]; }
}

function renderFreqChart(fd) {
  dc("freq");
  const ctx = document.getElementById("chart-freq").getContext("2d");
  STATE.charts.freq = new Chart(ctx, {
    type: "bar",
    data: {
      labels: fd.map(f=>f.num),
      datasets: [{
        label: "出現回数",
        data:  fd.map(f=>f.count),
        backgroundColor: fd.map(f=>
          f.label==="HOT"  ? "rgba(255,107,107,0.8)" :
          f.label==="COLD" ? "rgba(116,185,255,0.8)" :
          "rgba(108,99,255,0.75)"
        ),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{
        label: ctx=>`出現: ${ctx.raw}回 | ${fd[ctx.dataIndex].label}`,
      }}},
      scales:{
        x:{grid:{color:"rgba(46,49,72,0.5)"}},
        y:{grid:{color:"rgba(46,49,72,0.5)"},beginAtZero:true},
      },
    },
  });
}

function renderSumCharts(sd) {
  dc("sum");
  const recent = sd.series.slice(-100);
  const ctx    = document.getElementById("chart-sum").getContext("2d");
  STATE.charts.sum = new Chart(ctx, {
    type: "line",
    data: {
      labels: recent.map(d=>`第${d.round}回`),
      datasets: [
        { label:"合計値", data:recent.map(d=>d.total),
          borderColor:"rgba(108,99,255,0.9)", backgroundColor:"rgba(108,99,255,0.15)",
          borderWidth:1.5, pointRadius:2, fill:true, tension:0.3 },
        { label:`平均(${sd.mean.toFixed(1)})`, data:new Array(recent.length).fill(sd.mean),
          borderColor:"rgba(255,107,107,0.7)", borderWidth:1.5,
          borderDash:[6,3], pointRadius:0 },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{position:"top",labels:{boxWidth:12}}},
      scales:{
        x:{grid:{display:false},ticks:{maxTicksLimit:10}},
        y:{grid:{color:"rgba(46,49,72,0.5)"}},
      },
    },
  });

  dc("sumHist");
  const hCtx = document.getElementById("chart-sum-hist").getContext("2d");
  const bk   = Object.keys(sd.histogram).sort((a,b)=>a-b);
  STATE.charts.sumHist = new Chart(hCtx, {
    type:"bar",
    data:{
      labels: bk.map(k=>`${k}〜`),
      datasets:[{label:"件数",data:bk.map(k=>sd.histogram[k]),
        backgroundColor:"rgba(0,212,170,0.75)",borderRadius:3}],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false}},
        y:{beginAtZero:true,grid:{color:"rgba(46,49,72,0.5)"}},
      },
    },
  });
}

function renderZoneCharts(zd) {
  dc("zone");
  const r50 = zd.rows.slice(-50);
  const ctx  = document.getElementById("chart-zone").getContext("2d");
  const zc   = ["rgba(253,121,168,0.8)","rgba(253,203,110,0.8)","rgba(85,239,196,0.8)","rgba(116,185,255,0.8)","rgba(162,155,254,0.8)"];
  STATE.charts.zone = new Chart(ctx, {
    type:"bar",
    data:{
      labels: r50.map(r=>`${r.round}`),
      datasets: zd.zoneNames.map((z,i)=>({
        label:z, data:r50.map(r=>r[z]),
        backgroundColor:zc[i], borderRadius:2,
      })),
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      scales:{
        x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:15}},
        y:{stacked:true,grid:{color:"rgba(46,49,72,0.5)"}},
      },
      plugins:{legend:{position:"bottom",labels:{boxWidth:10,padding:12}}},
    },
  });

  dc("zoneAvg");
  const dCtx = document.getElementById("chart-zone-avg").getContext("2d");
  STATE.charts.zoneAvg = new Chart(dCtx, {
    type:"doughnut",
    data:{
      labels: zd.zoneNames,
      datasets:[{ data:zd.zoneNames.map(z=>parseFloat(zd.avg[z].toFixed(2))),
        backgroundColor:zc, borderWidth:2, borderColor:"#1a1d27" }],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:"bottom",labels:{boxWidth:10,padding:10}},
        tooltip:{callbacks:{label:ctx=>` ${ctx.label}: 平均 ${ctx.raw}個`}},
      },
    },
  });
}

function renderConsecCharts(cd) {
  dc("consec");
  const ctx  = document.getElementById("chart-consec").getContext("2d");
  const keys = Object.keys(cd.pairDist).sort((a,b)=>a-b);
  STATE.charts.consec = new Chart(ctx, {
    type:"bar",
    data:{
      labels: keys.map(k=>`${k}ペア`),
      datasets:[{label:"回数",data:keys.map(k=>cd.pairDist[k]),
        backgroundColor:"rgba(255,217,61,0.8)",borderRadius:4}],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false}},
        y:{beginAtZero:true,grid:{color:"rgba(46,49,72,0.5)"}},
      },
    },
  });

  dc("consecPie");
  const pCtx = document.getElementById("chart-consec-pie").getContext("2d");
  STATE.charts.consecPie = new Chart(pCtx, {
    type:"pie",
    data:{
      labels:["連番あり","連番なし"],
      datasets:[{
        data:[cd.consecCount, cd.rows.length-cd.consecCount],
        backgroundColor:["rgba(255,107,107,0.8)","rgba(116,185,255,0.8)"],
        borderWidth:2, borderColor:"#1a1d27",
      }],
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"bottom"}},
    },
  });
}

// ────────────────────────────────────────────────────────────
// UI 描画
// ────────────────────────────────────────────────────────────
function renderStats(data) {
  const sd = analyzeSum(data);
  const cc = analyzeConsecutive(data);
  document.getElementById("stats-grid").innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${data.length}</div>
      <div class="stat-label">総データ件数</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${data[0]?.round||'-'}</div>
      <div class="stat-label">最古回号</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${data[data.length-1]?.round||'-'}</div>
      <div class="stat-label">最新回号</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${sd.mean.toFixed(1)}</div>
      <div class="stat-label">合計値 平均</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${sd.std.toFixed(1)}</div>
      <div class="stat-label">合計値 標準偏差</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${(cc.consecRate*100).toFixed(0)}%</div>
      <div class="stat-label">連番出現率</div>
    </div>
  `;
}

function renderFreqGrid(fd) {
  document.getElementById("freq-grid").innerHTML =
    fd.map(f=>`
      <div class="freq-cell ${f.label.toLowerCase()}">
        <div class="num">${f.num}</div>
        <div class="cnt">${f.count}回</div>
        <div class="badge">${f.label}</div>
      </div>
    `).join("");
}

function renderSumStats(sd) {
  document.getElementById("sum-stats").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${[["平均値",sd.mean.toFixed(1)],["中央値",sd.median],
         ["標準偏差",sd.std.toFixed(1)],["最小値",sd.min],["最大値",sd.max]]
        .map(([l,v])=>`
          <div style="display:flex;justify-content:space-between;
            padding:8px 12px;background:var(--bg2);border-radius:6px">
            <span style="color:var(--text2);font-size:0.85rem">${l}</span>
            <span style="font-weight:600">${v}</span>
          </div>
        `).join("")}
    </div>
  `;
}

function renderZoneStats(zd) {
  const zc=["#fd79a8","#fdcb6e","#55efc4","#74b9ff","#a29bfe"];
  document.getElementById("zone-stats").innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${zd.zoneNames.map((z,i)=>`
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:8px 12px;background:var(--bg2);border-radius:6px">
          <span style="color:${zc[i]};font-size:0.85rem">${z}</span>
          <span style="font-weight:600">平均 ${zd.avg[z].toFixed(2)}個</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderConsecStats(cd) {
  document.getElementById("consec-stats").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
      ${[["連番あり回数",`${cd.consecCount}回`],
         ["連番出現率",`${(cd.consecRate*100).toFixed(1)}%`],
         ["平均連番ペア数",cd.avgPairs.toFixed(2)]]
        .map(([l,v])=>`
          <div class="stat-item">
            <div class="stat-value" style="font-size:1.3rem">${v}</div>
            <div class="stat-label">${l}</div>
          </div>
        `).join("")}
    </div>
  `;
}

function renderPredictions(preds) {
  const pClass = {
  A:"pattern-a", B:"pattern-b", C:"pattern-c",
  D:"pattern-d", E:"pattern-e"
};
  document.getElementById("prediction-grid").innerHTML = preds.map(p=>`
    <div class="prediction-card ${pClass[p.pattern]}">
      <div class="pattern-label">Pattern ${p.pattern} ｜ ${p.method}</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:4px">${p.label}</div>
      <div class="number-balls">
        ${p.numbers.map(n=>`<div class="ball ${getBallClass(n)}">${n}</div>`).join("")}
      </div>
      <div class="prediction-meta">
        <div class="meta-item"><div class="label">合計値</div><div class="value">${p.total}</div></div>
        <div class="meta-item"><div class="label">偶数/奇数</div><div class="value">${p.evenCnt}/${p.oddCnt}</div></div>
        <div class="meta-item"><div class="label">ゾーンカバー</div><div class="value">${p.coveredZones}/5</div></div>
        <div class="meta-item"><div class="label">連番ペア</div><div class="value">${p.pairs}組</div></div>
      </div>
      <div style="margin-top:10px;font-size:0.75rem;color:var(--text2)">
        スコア: ${(p.score*100).toFixed(1)}点
      </div>
      <div class="score-bar">
        <div class="score-fill" style="width:${Math.min(p.score,1)*100}%"></div>
      </div>
    </div>
  `).join("");
}

// ────────────────────────────────────────────────────────────
// 過去データ一覧
// ────────────────────────────────────────────────────────────
function renderListTable(filter="") {
  const data   = [...STATE.data].sort((a,b)=>b.round-a.round);
  const lower  = filter.toLowerCase();
  const filtered = filter
    ? data.filter(d => String(d.round).includes(lower) || d.date.includes(lower))
    : data;

  document.getElementById("list-table-wrap").innerHTML = `
    <table class="list-table">
      <thead>
        <tr>
          <th>回号</th>
          <th>日付</th>
          <th>当選番号</th>
          <th>合計値</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(d=>`
          <tr data-round="${d.round}">
            <td><strong>第${d.round}回</strong></td>
            <td style="color:var(--text2)">${d.date}</td>
            <td>
              <div class="mini-balls">
                ${d.numbers.map(n=>`
                  <div class="mini-ball ${getBallClass(n)}"
                    style="background:${getBallBg(n)};color:${n>=20&&n<=29?'#1a1d27':'white'}">
                    ${n}
                  </div>
                `).join("")}
              </div>
            </td>
            <td style="font-weight:600">${d.total}</td>
          </tr>
        `).join("")}
        ${filtered.length===0?`<tr><td colspan="4" style="text-align:center;color:var(--text2);padding:24px">該当なし</td></tr>`:""}
      </tbody>
    </table>
  `;

  // 行クリックで詳細
  document.querySelectorAll(".list-table tbody tr[data-round]").forEach(tr => {
    tr.addEventListener("click", () => {
      const r = parseInt(tr.dataset.round);
      openDetail(r);
    });
  });
}

function openDetail(round) {
  const d = STATE.data.find(x => x.round === round);
  if(!d) return;

  const fd    = analyzeFrequency(STATE.data);
  const fMap  = Object.fromEntries(fd.map(f => [f.num, f]));
  const maxCnt= Math.max(...fd.map(f => f.count));

  const zoneDist = Object.entries(CFG.ZONES).map(([zName, zRange]) => ({
    zName,
    cnt: d.numbers.filter(n => zRange.includes(n)).length,
  }));

  const {pairs, maxLen} = countConsec(d.numbers);
  const even = d.numbers.filter(n => n % 2 === 0).length;

  // ── スナップショット照合（⚠ 予測関数は再実行しない） ──────
  const snapshot = PredictionHistory.getByRound(round);

  const PATTERN_COLOR = {
    A:'#6c63ff', B:'#00d4aa', C:'#ffd93d', D:'#a855f7', E:'#f59e0b',
  };

  // ── 予測比較 HTML 生成 ─────────────────────────────────────
  let predHTML = '';

  if(snapshot) {
    const predDate = new Date(snapshot.predictedAt);
    const dateStr  = `${predDate.getFullYear()}/${predDate.getMonth()+1}/${predDate.getDate()} ${String(predDate.getHours()).padStart(2,'0')}:${String(predDate.getMinutes()).padStart(2,'0')}`;

    // Pattern A のトレンドメッセージ
    let trendHTML = '';
    if(LEARNER && LEARNER.model) {
      const trend = LEARNER.getTrendMessage(STATE.data);
      if(trend) {
        trendHTML = `
          <div class="trend-message-box" style="border-left:3px solid ${trend.color}">
            <div class="trend-message-title">🧠 Pattern A 学習モデル：次回の合計値予測</div>
            <div class="trend-message-body" style="color:${trend.color}">
              ${trend.icon} 次回合計値は<strong>【${trend.text}】</strong>
            </div>
            <div class="trend-message-detail">
              目標値: <strong>${trend.targetSum}</strong>
              &nbsp;/&nbsp;
              直近5回平均: <strong>${(STATE.data.slice(-5).reduce((s,dd)=>s+dd.total,0)/5)|0}</strong>
              &nbsp;/&nbsp;
              前回合計値: <strong>${trend.lastTotal}</strong>
            </div>
            <div class="trend-message-sub">${trend.diffMsg}</div>
          </div>
        `;
      }
    }

    // サマリーバー（全パターン的中数の概要）
    const allHits = snapshot.predictions.map(pred =>
      pred.numbers.filter(n => d.numbers.includes(n)).length
    );
    const maxHit     = Math.max(...allHits);
    const bestPattern= snapshot.predictions[allHits.indexOf(maxHit)];

    const summaryHTML = `
      <div class="snapshot-summary">
        <div class="snapshot-summary-left">
          <div class="snapshot-info-row">
            <span class="snapshot-badge">📸 スナップショット</span>
            <span class="snapshot-date">予測日時: ${dateStr}</span>
          </div>
          <div class="snapshot-info-row" style="margin-top:4px">
            <span style="font-size:0.78rem;color:var(--text2)">
              第${snapshot.basedOnRound}回データ時点の予測
              &nbsp;→&nbsp;
              第${snapshot.targetRound}回向け
            </span>
          </div>
        </div>
        <div class="snapshot-best">
          <div class="snapshot-best-label">最高的中</div>
          <div class="snapshot-best-val" style="color:${PATTERN_COLOR[bestPattern.pattern]}">
            Pattern ${bestPattern.pattern}: ${maxHit}個
          </div>
        </div>
      </div>
    `;

    // 比較カード（保存された静的データを使用）
    const compareCards = snapshot.predictions.map((pred, idx) => {
      const color     = PATTERN_COLOR[pred.pattern] || '#6c63ff';
      const hitNums   = pred.numbers.filter(n => d.numbers.includes(n));
      const hitCount  = hitNums.length;
      const totalDiff = pred.total - d.total;

      const hitClass  =
        hitCount >= 4 ? 'hit-excellent' :
        hitCount >= 3 ? 'hit-good'      :
        hitCount >= 1 ? 'hit-ok'        : 'hit-miss';
      const hitLabel  =
        hitCount >= 4 ? `🏆 ${hitCount}個` :
        hitCount >= 3 ? `🎯 ${hitCount}個` :
        hitCount >= 1 ? `△ ${hitCount}個`  : '✗ 0個';
      const diffColor =
        Math.abs(totalDiff) <= 10 ? 'var(--green)'  :
        Math.abs(totalDiff) <= 25 ? 'var(--yellow)' : 'var(--hot)';

      return `
        <div class="pred-compare-card" style="border-left:3px solid ${color}">

          <div class="pred-compare-header">
            <span class="pred-pattern-badge"
              style="background:${color}20;color:${color};border:1px solid ${color}">
              Pattern ${pred.pattern}
            </span>
            <span class="pred-label-text">${pred.label}</span>
            <span class="pred-hit-badge ${hitClass}">${hitLabel}</span>
          </div>

          <div style="font-size:0.7rem;color:var(--text2);margin:2px 0 10px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
            title="${pred.method}">
            ${pred.method}
          </div>

          <!-- 予測番号 -->
          <div style="margin-bottom:8px">
            <div class="balls-row-label">予測番号</div>
            <div class="number-balls" style="gap:5px">
              ${pred.numbers.map(n => {
                const isHit = d.numbers.includes(n);
                return `
                  <div class="ball ${getBallClass(n)}"
                    style="width:34px;height:34px;font-size:0.78rem;
                      ${isHit
                        ? 'box-shadow:0 0 10px 3px rgba(255,215,0,0.8);outline:2px solid gold;'
                        : 'opacity:0.35;filter:grayscale(0.6);'
                      }">
                    ${n}
                  </div>`;
              }).join('')}
            </div>
          </div>

          <!-- 実際の当選番号 -->
          <div style="margin-bottom:12px">
            <div class="balls-row-label">実際の当選番号</div>
            <div class="number-balls" style="gap:5px">
              ${d.numbers.map(n => {
                const isHit = pred.numbers.includes(n);
                return `
                  <div class="ball ${getBallClass(n)}"
                    style="width:34px;height:34px;font-size:0.78rem;
                      ${isHit
                        ? 'box-shadow:0 0 10px 3px rgba(255,215,0,0.8);outline:2px solid gold;'
                        : 'opacity:0.35;filter:grayscale(0.6);'
                      }">
                    ${n}
                  </div>`;
              }).join('')}
            </div>
          </div>

          <!-- 数値比較 -->
          <div class="pred-compare-meta">
            <div class="pred-meta-item">
              <div class="label">予測合計</div>
              <div class="value">${pred.total}</div>
            </div>
            <div class="pred-meta-item">
              <div class="label">実際合計</div>
              <div class="value">${d.total}</div>
            </div>
            <div class="pred-meta-item">
              <div class="label">合計差</div>
              <div class="value" style="color:${diffColor}">
                ${totalDiff >= 0 ? '+' : ''}${totalDiff}
              </div>
            </div>
            <div class="pred-meta-item">
              <div class="label">的中数字</div>
              <div class="value"
                style="color:${color};font-size:${hitNums.length>0?'0.82rem':'0.85rem'}">
                ${hitNums.length > 0 ? hitNums.join(' / ') : 'なし'}
              </div>
            </div>
          </div>

          <!-- 的中率バー -->
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;
              font-size:0.68rem;color:var(--text2);margin-bottom:3px">
              <span>的中率</span>
              <span>${hitCount} / 6</span>
            </div>
            <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${(hitCount/6)*100}%;
                background:${color};border-radius:3px;
                transition:width 0.8s ease"></div>
            </div>
          </div>

        </div>
      `;
    }).join('');

    predHTML = `
      <div class="detail-section">
        <h3>🔮 予測との答え合わせ</h3>
        ${summaryHTML}
        ${trendHTML}
        <div class="pred-compare-grid">
          ${compareCards}
        </div>
      </div>
    `;

  } else {
    // スナップショットなし
    predHTML = `
      <div class="detail-section">
        <h3>🔮 予測との答え合わせ</h3>
        <div class="no-snapshot-box">
          <div class="no-snapshot-icon">📭</div>
          <div class="no-snapshot-text">
            第${round}回向けの事前予測記録がありません
          </div>
          <div class="no-snapshot-sub">
            「🔮 予測する」ボタンを押すと、次回向けの予測がスナップショットとして保存され、
            結果発表後にここで答え合わせができます
          </div>
        </div>
      </div>
    `;
  }

  // ── HTML 組み立て ──────────────────────────────────────────
  document.getElementById("detail-title").textContent =
    `第 ${d.round} 回  ${d.date}`;

  document.getElementById("detail-content").innerHTML = `

    <div class="detail-section">
      <h3>当選番号</h3>
      <div class="number-balls" style="justify-content:center;gap:10px">
        ${d.numbers.map(n=>`
          <div class="ball ${getBallClass(n)}"
            style="width:48px;height:48px;font-size:1rem">${n}
          </div>`).join('')}
      </div>
    </div>

    <div class="detail-section">
      <h3>この回の統計</h3>
      <div class="detail-meta-grid">
        <div class="detail-meta-item">
          <div class="label">合計値</div>
          <div class="value">${d.total}</div>
        </div>
        <div class="detail-meta-item">
          <div class="label">偶数 / 奇数</div>
          <div class="value">${even} / ${6-even}</div>
        </div>
        <div class="detail-meta-item">
          <div class="label">連番ペア</div>
          <div class="value">${pairs}組</div>
        </div>
        <div class="detail-meta-item">
          <div class="label">最大連番長</div>
          <div class="value">${maxLen}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>ゾーン分布</h3>
      <div class="zone-dist-row">
        ${zoneDist.map((z,i)=>{
          const colors=["#fd79a8","#fdcb6e","#55efc4","#74b9ff","#a29bfe"];
          return `
            <div class="zone-dist-item">
              <div class="z-name" style="color:${colors[i]}">${z.zName.replace("Zone","Z")}</div>
              <div class="z-val" style="color:${colors[i]}">${z.cnt}</div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="detail-section">
      <h3>各数字の全期間出現頻度</h3>
      ${d.numbers.map(n=>{
        const f   = fMap[n];
        const pct = maxCnt>0 ? (f.count/maxCnt)*100 : 0;
        const clr = f.label==="HOT"?"#ff6b6b":f.label==="COLD"?"#74b9ff":"#6c63ff";
        return `
          <div class="detail-freq-row">
            <div class="ball ${getBallClass(n)}"
              style="width:34px;height:34px;font-size:0.8rem;flex-shrink:0">${n}</div>
            <div class="detail-freq-bar-wrap">
              <div class="detail-freq-bar"
                style="width:${pct}%;background:${clr}"></div>
            </div>
            <div style="min-width:80px;text-align:right;font-size:0.85rem">
              ${f.count}回
              <span style="font-size:0.7rem;color:${clr};margin-left:4px">${f.label}</span>
            </div>
          </div>`;
      }).join('')}
    </div>

    ${predHTML}
  `;

  closeModal("modal-list");
  openModal("modal-detail");
}

// ────────────────────────────────────────────────────────────
// メイン UI 更新
// ────────────────────────────────────────────────────────────
function updateUI() {
  const data  = STATE.data;
  const count = document.getElementById("data-count");

  if (!data.length) {
    count.textContent = "データなし";
    document.getElementById("empty-state").style.display    = "block";
    document.getElementById("stats-section").style.display  = "none";
    document.getElementById("analysis-section").style.display = "none";
    document.getElementById("predict-section").style.display  = "none";
    return;
  }

  count.textContent = `${data.length}件 (第${data[0].round}〜第${data[data.length-1].round}回)`;
  document.getElementById("empty-state").style.display     = "none";
  document.getElementById("stats-section").style.display   = "block";
  document.getElementById("analysis-section").style.display= "block";

  const fd = analyzeFrequency(data);
  const sd = analyzeSum(data);
  const zd = analyzeZone(data);
  const cd = analyzeConsecutive(data);

  renderStats(data);
  renderFreqGrid(fd);
  renderFreqChart(fd);
  renderSumCharts(sd);
  renderSumStats(sd);
  renderZoneCharts(zd);
  renderZoneStats(zd);
  renderConsecCharts(cd);
  renderConsecStats(cd);
}

// ────────────────────────────────────────────────────────────
// イベント
// ────────────────────────────────────────────────────────────

// タブ
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(t).classList.add("active");
  });
});

// 過去データ一覧
document.getElementById("btn-list").addEventListener("click", () => {
  document.getElementById("list-search").value = "";
  renderListTable();
  openModal("modal-list");
});

document.getElementById("btn-list-close").addEventListener("click", () => closeModal("modal-list"));

document.getElementById("list-search").addEventListener("input", e => {
  renderListTable(e.target.value);
});

// 詳細モーダル
document.getElementById("btn-detail-close").addEventListener("click", () => closeModal("modal-detail"));
document.getElementById("btn-detail-back").addEventListener("click", () => {
  closeModal("modal-detail");
  renderListTable(document.getElementById("list-search").value);
  openModal("modal-list");
});

// 1件追加
document.getElementById("btn-add-one").addEventListener("click", () => {
  ["add-round","add-date","add-n1","add-n2","add-n3","add-n4","add-n5","add-n6"]
    .forEach(id => { document.getElementById(id).value=""; });
  document.getElementById("add-error").textContent="";
  openModal("modal-add");
});

document.getElementById("btn-add-cancel").addEventListener("click", ()=>closeModal("modal-add"));

document.getElementById("btn-add-save").addEventListener("click", async () => {
  const btn   = document.getElementById("btn-add-save");
  const errEl = document.getElementById("add-error");
  errEl.textContent = "";

  const round = parseInt(document.getElementById("add-round").value);
  const date  = document.getElementById("add-date").value.trim();
  const nums  = [1,2,3,4,5,6].map(i=>parseInt(document.getElementById(`add-n${i}`).value));

  if (!round||round<1)              { errEl.textContent="回号を入力してください"; return; }
  if (!date)                         { errEl.textContent="日付を入力してください"; return; }
  if (nums.some(n=>isNaN(n)||n<1||n>43)) { errEl.textContent="数字は1〜43の範囲で入力してください"; return; }
  if (new Set(nums).size<6)          { errEl.textContent="6つの数字に重複があります"; return; }
  if (STATE.data.find(d=>d.round===round)) { errEl.textContent=`第${round}回はすでに登録済みです`; return; }

  setLoading(btn, true);
  try {
    const sorted = nums.sort((a,b)=>a-b);
    STATE.data   = [...STATE.data, { round, date, numbers:sorted, total:sorted.reduce((a,b)=>a+b,0) }]
                   .sort((a,b)=>a.round-b.round);
    await saveData();
    closeModal("modal-add");
    updateUI();
    showToast(`第${round}回 追加しました`, "success");
  } catch(e) {
    errEl.textContent = "保存エラー: " + e.message;
  } finally {
    setLoading(btn, false);
  }
});

// // 予測
// document.getElementById("btn-predict").addEventListener("click", () => {
//   if(STATE.data.length < 10){ showToast("データが10件以上必要です","error"); return; }
//   const btn = document.getElementById("btn-predict");
//   setLoading(btn, true);

//   setTimeout(() => {
//     try {
//       // ★ 存在する3つの関数だけを呼び出す！
//       const pA = predictRuleBased(STATE.data);
//       const pB = predictUltimate(STATE.data);
//       const pC = predictPatternC(STATE.data); // 引数は data だけでOK

//       // UIのCSSが崩れないようにパターン名（A, B, C）を割り当て
//       pA.pattern = "A";
//       pB.pattern = "B";
//       pC.pattern = "C";

//       const allPreds = [pA, pB, pC];

//       // ── スナップショット保存（予測実行時点で固定） ────────
//       const latestRound = STATE.data[STATE.data.length-1]?.round || 0;
//       const snapshot    = PredictionHistory.save(allPreds, latestRound);
//       showToast(
//         `第${snapshot.targetRound}回向け予測をスナップショット保存しました`,
//         "success",
//         4000
//       );

//       runGarapon(allPreds, () => {
//         renderPredictions(allPreds);
//         document.getElementById("predict-section").style.display = "block";
//         document.getElementById("predict-section").scrollIntoView({behavior:"smooth"});
//         showToast("予測完了！ 3パターン出力", "success");
//       });

//     } catch(e) {
//       showToast("予測エラー: " + e.message, "error");
//       console.error(e);
//     } finally {
//       setLoading(btn, false);
//     }
//   }, 50);
// });

// // 予測　パターンC,C2,C3を表示
// document.getElementById("btn-predict").addEventListener("click", () => {
//   if(STATE.data.length < 10){ showToast("データが10件以上必要です","error"); return; }
//   const btn = document.getElementById("btn-predict");
//   setLoading(btn, true);

//   setTimeout(() => {
//     try {
//       // ── 1. AとBを「裏方(ベース)」として計算（画面には出さない） ──
//       const baseA = predictRuleBased(STATE.data);
//       const baseB = predictUltimate(STATE.data, baseA);

//       // ── 2. Cシリーズの生成 ──
//       // ① パターン C (基本の状況対応型)
//       const pC = predictPatternC(STATE.data, baseA, baseB);
//       pC.label = "パターン C (状況対応ハイブリッド)"; // ラベル上書き
      
//       // ② パターン C2 (合計値推移合致)
//       const pC2 = predictPatternC2(STATE.data, pC);

//       // ③ パターン C3 (1000回試行・最高確率)
//       const pC3 = predictPatternC3(STATE.data, pC2);

//       // ── 3. UI表示用のID割り当て ──
//       // ※画面レイアウトを崩さないため、内部の枠IDはA, B, Cを再利用します
//       pC.pattern = "A";   // 画面左枠に表示
//       pC2.pattern = "B";  // 画面中央枠に表示
//       pC3.pattern = "C";  // 画面右枠に表示

//       const allPreds = [pC, pC2, pC3];

//       // ── スナップショット保存 ────────
//       const latestRound = STATE.data[STATE.data.length-1]?.round || 0;
//       const snapshot    = PredictionHistory.save(allPreds, latestRound);
//       showToast(
//         `第${snapshot.targetRound}回向け予測をスナップショット保存しました`,
//         "success",
//         4000
//       );

//       runGarapon(allPreds, () => {
//         renderPredictions(allPreds);
//         document.getElementById("predict-section").style.display = "block";
//         document.getElementById("predict-section").scrollIntoView({behavior:"smooth"});
//         showToast("究極のCシリーズ 3パターン出力完了！", "success");
//       });

//     } catch(e) {
//       showToast("予測エラー: " + e.message, "error");
//       console.error(e);
//     } finally {
//       setLoading(btn, false);
//     }
//   }, 50);
// });

// 予測　パターンA,C,C2を表示
document.getElementById("btn-predict").addEventListener("click", () => {
  if(STATE.data.length < 10){ showToast("データが10件以上必要です","error"); return; }
  const btn = document.getElementById("btn-predict");
  setLoading(btn, true);

  setTimeout(() => {
    try {
      // ── 1. Aを生成し、Bは「裏方」として計算のみ実行 ──
      const baseA = predictRuleBased(STATE.data);
      const baseB = predictUltimate(STATE.data, baseA);

      // ── 2. Cシリーズの生成 ──
      // ① パターン C (基本の状況対応型)
      const pC = predictPatternC(STATE.data, baseA, baseB);
      pC.label = "パターン C (状況対応ハイブリッド)";
      
      // ② パターン C2 (合計値推移合致)
      // ★先ほどの指摘通り、Aをベースにするように引数を修正済みです
      const pC2 = predictPatternC2(STATE.data, baseA, baseB);

      // C3 は生成しない

      // ── 3. UI表示用のID割り当て ──
      // ミニロトと同様に、画面左から「A」「C」「C2」の順で並べる
      baseA.pattern = "A";  // 画面左枠に表示
      pC.pattern = "B";     // 画面中央枠に表示
      pC2.pattern = "C";    // 画面右枠に表示

      const allPreds = [baseA, pC, pC2];

      // ── スナップショット保存 ────────
      const latestRound = STATE.data[STATE.data.length-1]?.round || 0;
      const snapshot    = PredictionHistory.save(allPreds, latestRound);
      showToast(
        `第${snapshot.targetRound}回向け予測をスナップショット保存しました`,
        "success",
        4000
      );

      runGarapon(allPreds, () => {
        renderPredictions(allPreds);
        document.getElementById("predict-section").style.display = "block";
        document.getElementById("predict-section").scrollIntoView({behavior:"smooth"});
        showToast("ロト6 3パターン出力完了！", "success");
      });

    } catch(e) {
      showToast("予測エラー: " + e.message, "error");
      console.error(e);
    } finally {
      setLoading(btn, false);
    }
  }, 50);
});


// モーダル外クリックで閉じる
document.querySelectorAll(".modal-overlay").forEach(ol => {
  ol.addEventListener("click", e => {
    if (e.target===ol) ol.classList.remove("active");
  });
});

// ────────────────────────────────────────────────────────────
// 初期化
// ────────────────────────────────────────────────────────────
(async function init() {
  showToast("データ読み込み中...", "info", 2000);
  await loadData();
})();
