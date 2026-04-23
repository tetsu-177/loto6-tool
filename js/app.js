

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
    const numberWeights = this._calcNumberWeights(
      data, intervalHist, currIntervals
    );

    this.model = {
      targetSum,
      targetConsec,
      intervalHist,
      currIntervals,
      numberWeights,
      learnedAt:  new Date().toISOString(),
      dataSize:   data.length,
      lastRound:  data[data.length-1]?.round,
    };

    this._saveLog();
    this._printLog();
    return this.model;
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
// 動的学習モデルを使用したロス関数ベース予測
//
// フロー:
//   1. LEARNER.learn(data) で自己学習・自己補正
//   2. 重み付きサンプリングで 30,000 通りの組み合わせを生成
//   3. 全組み合わせをロス関数でスコアリング（ハードフィルタなし）
//   4. スコア上位 500 組を抽出
//   5. 上位 500 組での各数字の出現回数を集計
//   6. 最頻出 6 数字を最終予測として出力
// ============================================================
function predictRuleBased(data) {
  // ── Step1: 学習（新データが渡されるたびに自動補正） ──────
  const model = LEARNER.learn(data);

  // ── Step2: サンプリング用ウェイト設定 ────────────────────
  // 学習済みウェイトをサンプリングに使用
  const weights = CFG.NUMBERS.map(n => {
    const w = model.numberWeights[n] || 0;
    return Math.max(w + 1.0, 0.1); // 最低ウェイトを保証
  });

  // ── Step3: 組み合わせ生成 & ロス関数スコアリング ─────────
  const MAX_TRIALS  = 40000;  // UIフリーズ防止のキャップ
  const TOP_K       = 500;    // スコア上位K件を抽出
  const scoredCombos= [];

  for(let i=0; i<MAX_TRIALS; i++){
    const combo = weightedSample6(weights);
    if(new Set(combo).size < 6) continue;

    // ロス関数によるスコアリング（ハードフィルタなし）
    const finalScore = LEARNER.scoreComboByLoss(combo);
    scoredCombos.push({ combo, score: finalScore });
  }

  // ── Step4: スコア上位 TOP_K を抽出 ──────────────────────
  scoredCombos.sort((a,b) => b.score - a.score);
  const topCombos = scoredCombos.slice(0, TOP_K);

  // ── Step5: 上位 TOP_K での各数字の出現回数を集計 ─────────
  const counter = {};
  CFG.NUMBERS.forEach(n => (counter[n] = 0));
  topCombos.forEach(({combo}) => {
    combo.forEach(n => counter[n]++);
  });

  // ── Step6: 最頻出 6 数字を選出 ───────────────────────────
  const top6 = Object.entries(counter)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 6)
    .map(([n]) => parseInt(n))
    .sort((a,b) => a-b);

  // ── 結果の評価値を計算（表示用） ─────────────────────────
  const resultTotal    = top6.reduce((a,b)=>a+b,0);
  const {pairs: resultPairs} = countConsec(top6);
  const resultEv       = top6.filter(n=>n%2===0).length;
  const resultCov      = Object.values(CFG.ZONES)
    .filter(zr=>top6.some(n=>zr.includes(n))).length;
  const resultScore    = LEARNER.scoreComboByLoss(top6);

  // ── コンソールに詳細サマリーを出力 ───────────────────────
  console.group("🎯 Pattern A 予測サマリー");
  console.log(`試行: ${scoredCombos.length}回 / 上位${TOP_K}組から集計`);
  console.log(
    `目標合計値: ${model.targetSum.value.toFixed(1)} →`,
    `結果: ${resultTotal}`,
    `(差: ${Math.abs(resultTotal - model.targetSum.value).toFixed(1)})`
  );
  console.log(
    `目標連番ペア: ${model.targetConsec.value.toFixed(2)}組 →`,
    `結果: ${resultPairs}組`
  );
  console.log(
    "出現頻度 TOP10:",
    Object.entries(counter)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10)
      .map(([n,c])=>`${n}番:${c}回`)
      .join(" / ")
  );
  console.log(`予測: [${top6.join(", ")}]  ロススコア: ${resultScore.toFixed(4)}`);
  console.groupEnd();

  return {
    numbers:      top6,
    total:        resultTotal,
    score:        Math.max(0, Math.min(1, (resultScore+2)/6)),
    evenCnt:      resultEv,
    oddCnt:       6-resultEv,
    pairs:        resultPairs,
    coveredZones: resultCov,
    pattern:      "A",
    label:        "動的学習予測（ML）",
    method:
      `LossFunc | 目標合計:${model.targetSum.value.toFixed(0)} ` +
      `目標連番:${model.targetConsec.value.toFixed(1)}組 ` +
      `peakInterval:${model.intervalHist.peakInterval}回休み`,
  };
}

// ============================================================
// 修正③ predictStatistical - Pattern B
// 統計ベースで多数試行し、最もスコアの高い「組み合わせ」を選出
// ============================================================
function predictStatistical(data) {
  const fm  = buildFreqMap(data);
  const sd  = analyzeSum(data);
  const n   = data.length;

  // ── 各数字の統計スコアを計算 ────────
  const ns = CFG.NUMBERS.map(num => {
    const avg  = (n * 6) / 43;
    const fdev = Math.abs(fm[num] - avg) / (avg + 1e-9);
    const fs   = Math.max(0, 1 - fdev * 0.5);

    let intv = n;
    for(let i=data.length-1; i>=0; i--){
      if(data[i].numbers.includes(num)){ intv = data.length-1-i; break; }
    }
    const is = Math.min(intv / 20, 1.0);

    const r30 = data.slice(-30);
    const rs  = r30.reduce((s,r) => s + (r.numbers.includes(num) ? 1 : 0), 0) / 30;

    return { num, score: fs*0.4 + is*0.4 + rs*0.2 };
  });
  ns.sort((a,b) => b.score - a.score);

  const top20 = ns.slice(0, 20).map(x => x.num);
  const wts   = CFG.NUMBERS.map(n => Math.max(fm[n], 1));

  let bestCombo = null;
  let collected = 0;
  let attempts  = 0;
  const SIMULATION = 500;

  // ── フェーズ1: ルール適合の組み合わせを収集し、最高スコアを記録 ──
  while(collected < SIMULATION && attempts < 600000) {
    attempts++;
    const useTop = Math.random() < 0.7;
    const combo  = useTop
      ? [...top20].sort(() => Math.random()-0.5).slice(0, 6)
      : weightedSample6(wts);

    if(new Set(combo).size < 6) continue;
    if(!passesRules(combo)) continue; // ここでルールを保証

    const r = scoreCombo(combo, fm, sd.mean, sd.std);
    if(!bestCombo || r.score > bestCombo.score) {
      bestCombo = r;
    }
    collected++;
  }

  // ── フェーズ2: 見つからなかった場合のフォールバック ──
  if(!bestCombo) {
    for(let i = 0; i < 5000; i++) {
      const combo = [...top20].sort(() => Math.random()-0.5).slice(0, 6);
      if(new Set(combo).size < 6) continue;
      const r = scoreCombo(combo, fm, sd.mean, sd.std);
      if(!bestCombo || r.score > bestCombo.score) bestCombo = r;
    }
  }

  return {
    ...bestCombo,
    pattern: "B",
    label:   "統計スコアリング予測",
    method:  `Statistical ${collected}個の有効セットから最高スコアを選出`,
  };
}



// ============================================================
// 修正④ predictTransition - Pattern C
//
// 変更点:
//   ・条件③（pairs===1固定）を完全廃止
//   ・代わりに連番ソフトスコアをtScoreに乗算
//     → 0組:0.88, 1組:1.0, 2組:0.92 で自然分散
//   ・平均値に固定するロジックをすべて廃止
//   ・遷移確率スコアが高い数字を最優先で選択
//   ・最終的に合計値・連番が期待値付近に収束
// ============================================================
function predictTransition(data) {
  if(data.length < 5) return predictRuleBased(data);

  const SUM_MIN_C = 80;
  const SUM_MAX_C = 180;

  // ── 数字の推移行列を構築 ──────────────────────
  const tc = {};
  for(let i=1;i<=43;i++) tc[i]={};
  for(let i=0;i<data.length-1;i++){
    const curr = data[i].numbers;
    const next = data[i+1].numbers;
    curr.forEach(c => next.forEach(nx => {
      tc[c][nx] = (tc[c][nx]||0) + 1;
    }));
  }
  const tp = {};
  for(let i=1;i<=43;i++){
    const tot = Object.values(tc[i]).reduce((s,v)=>s+v,0);
    tp[i] = {};
    for(let j=1;j<=43;j++){
      tp[i][j] = tot > 0 ? (tc[i][j]||0)/tot : 0;
    }
  }

  // ── 合計値バケット遷移分析 ───────────────────
  const BUCKETS = [
    { label:"80〜99",   min:80,  max:99  },
    { label:"100〜119", min:100, max:119 },
    { label:"120〜139", min:120, max:139 },
    { label:"140〜159", min:140, max:159 },
    { label:"160〜180", min:160, max:180 },
  ];

  function getBucket(total) {
    const idx = BUCKETS.findIndex(b => total >= b.min && total <= b.max);
    if(idx >= 0) return idx;
    return total < 80 ? 0 : 4;
  }

  const stc = Array.from({length:5}, () => new Array(5).fill(0));
  for(let i=0;i<data.length-1;i++){
    stc[getBucket(data[i].total)][getBucket(data[i+1].total)]++;
  }
  const stp = stc.map(row => {
    const tot = row.reduce((a,b)=>a+b,0);
    return tot > 0 ? row.map(v=>v/tot) : new Array(5).fill(0.2);
  });

  // ── 直近10回の線形回帰（傾き算出） ───────────
  const WAVE_N     = 10;
  const recentSums = data.slice(-WAVE_N).map(d => d.total);
  const wn         = recentSums.length;
  const xMean      = (wn-1) / 2;
  const yMean      = recentSums.reduce((a,b)=>a+b,0) / wn;
  let numR=0, denR=0;
  recentSums.forEach((y,x)=>{
    numR += (x-xMean)*(y-yMean);
    denR += (x-xMean)**2;
  });
  const slope = denR > 0 ? numR/denR : 0;

  // ── 次の予測バケットを決定 ──────────────────
  const lastTotal       = data[data.length-1].total;
  const currentBucket   = getBucket(lastTotal);
  const nextBucketProbs = stp[currentBucket];

  const topNextBucket = nextBucketProbs
    .map((p,i) => ({...BUCKETS[i], p, i}))
    .sort((a,b) => b.p-a.p)[0];

  const expectedSum = nextBucketProbs.reduce((s,p,i) =>
    s + p * ((BUCKETS[i].min+BUCKETS[i].max)/2), 0);

  // ── 各数字の遷移スコアを計算 ─────────────────
  const lastDraw   = data[data.length-1];
  const candScores = {};
  for(let n=1;n<=43;n++){
    const tScore    = lastDraw.numbers.reduce((sum,prev) =>
      sum + (tp[prev][n]||0), 0);
    const normTgt   = (expectedSum - 130) / 50;
    const waveBonus = normTgt * ((n/43) - 0.5) * 0.35;
    candScores[n]   = tScore + waveBonus;
  }

  const ranked = Object.entries(candScores)
    .sort((a,b) => b[1]-a[1])
    .map(([n,s]) => ({num:parseInt(n), tScore:s}));

  // ── 連番ソフトスコア（実績に基づく自然分散型） ──
  // 0組:1.00, 1組:1.00, 2組:0.90 → 実績の確率(約52%)に自然収束させる
  // 3組以上のみ大きく減点
  function pairsSoftScore(pairs) {
    if(pairs === 0) return 1.00;
    if(pairs === 1) return 1.00;
    if(pairs === 2) return 0.90;
    return Math.max(0, 1 - (pairs - 2) * 0.40);
  }


  // ── 2条件のみのハードフィルター ─────────────
  // ①合計値が予測バケット内
  // ②前回番号から1〜2個のキャリーオーバー
  // ③連番→ソフトスコアで自然収束（固定廃止）
  // ④偶奇バランス
  function passesHardConditions(nums, targetBucket) {
    const s     = [...nums].sort((a,b)=>a-b);
    const total = s.reduce((a,b)=>a+b,0);

    // ①合計値フィルター
    if(total < targetBucket.min || total > targetBucket.max) return false;

    // ②キャリーオーバー（1〜2個）
    const carry = s.filter(n => lastDraw.numbers.includes(n)).length;
    if(carry < 1 || carry > 2) return false;

    // ④偶奇バランス
    const ev   = s.filter(n=>n%2===0).length;
    const eoOK = [[2,4],[3,3],[4,2]].some(([e,o])=>e===ev && o===6-ev);
    if(!eoOK) return false;

    return true;
  }

  // ── メイン探索 ───────────────────────────────
  // 遷移確率スコア × 連番ソフトスコア の積が最大の組み合わせを選出
  const top30      = ranked.slice(0,30).map(x=>x.num);
  let   best       = null;
  let   bestFinal  = -Infinity;

  for(let i=0; i<120000; i++){
    // キャリーオーバーを先に確保（条件②を保証）
    const carryCount = Math.random() < 0.5 ? 1 : 2;
    const shuffLast  = [...lastDraw.numbers].sort(()=>Math.random()-0.5);
    const carry      = shuffLast.slice(0, carryCount);

    // 残りをtop30から補充
    const pool       = top30.filter(n => !carry.includes(n));
    const shuffPool  = [...pool].sort(()=>Math.random()-0.5);
    const fill       = shuffPool.slice(0, 6-carryCount);
    if(fill.length < 6-carryCount) continue;

    const combo = [...carry, ...fill];
    if(new Set(combo).size < 6) continue;
    if(!passesHardConditions(combo, topNextBucket)) continue;

    const sorted     = [...combo].sort((a,b)=>a-b);
    const {pairs}    = countConsec(sorted);

    // 遷移スコア × 連番ソフトスコア で最終評価
    const tScore     = combo.reduce((s,n) => s+(candScores[n]||0), 0);
    const finalScore = tScore * pairsSoftScore(pairs);

    if(finalScore > bestFinal){
      bestFinal       = finalScore;
      const total     = sorted.reduce((a,b)=>a+b,0);
      const ev        = sorted.filter(n=>n%2===0).length;
      const cov       = Object.values(CFG.ZONES)
        .filter(zr=>sorted.some(n=>zr.includes(n))).length;
      best = {
        numbers: sorted, total,
        score:   finalScore / 6,
        evenCnt: ev, oddCnt: 6-ev,
        pairs,   coveredZones: cov,
      };
    }
  }

  // ── フォールバック①: ①④のみ（キャリー条件を緩和） ──
  if(!best){
    for(let i=0; i<50000; i++){
      const combo  = weightedSample6(CFG.NUMBERS.map(n=>Math.max(candScores[n]||0, 0.01)));
      if(new Set(combo).size < 6) continue;
      const sorted = [...combo].sort((a,b)=>a-b);
      const total  = sorted.reduce((a,b)=>a+b,0);
      if(total < topNextBucket.min || total > topNextBucket.max) continue;
      const ev     = sorted.filter(n=>n%2===0).length;
      const eoOK   = [[2,4],[3,3],[4,2]].some(([e,o])=>e===ev && o===6-ev);
      if(!eoOK) continue;
      const {pairs}= countConsec(sorted);
      const cov    = Object.values(CFG.ZONES)
        .filter(zr=>sorted.some(n=>zr.includes(n))).length;
      const tScore = combo.reduce((s,n)=>s+(candScores[n]||0),0);
      const fs     = tScore * pairsSoftScore(pairs);
      if(!best || fs > bestFinal){
        bestFinal = fs;
        best = { numbers:sorted, total, score:fs/6, evenCnt:ev, oddCnt:6-ev, pairs, coveredZones:cov };
      }
      if(best) break;
    }
  }

  // ── フォールバック②: 合計値範囲のみ保証 ─────────
  if(!best){
    const fm  = buildFreqMap(data);
    const wts = CFG.NUMBERS.map(n => Math.max(fm[n],1));
    for(let i=0; i<20000; i++){
      const combo  = weightedSample6(wts);
      if(new Set(combo).size < 6) continue;
      const sorted = [...combo].sort((a,b)=>a-b);
      const total  = sorted.reduce((a,b)=>a+b,0);
      if(total < SUM_MIN_C || total > SUM_MAX_C) continue;
      const ev     = sorted.filter(n=>n%2===0).length;
      const {pairs}= countConsec(sorted);
      const cov    = Object.values(CFG.ZONES)
        .filter(zr=>sorted.some(n=>zr.includes(n))).length;
      best = { numbers:sorted, total, score:0, evenCnt:ev, oddCnt:6-ev, pairs, coveredZones:cov };
      break;
    }
  }

  // ── フォールバック③: 最終手段 ─────────────────
  if(!best){
    const combo  = ranked.slice(0,6).map(x=>x.num).sort((a,b)=>a-b);
    const total  = combo.reduce((a,b)=>a+b,0);
    const ev     = combo.filter(n=>n%2===0).length;
    const {pairs}= countConsec(combo);
    const cov    = Object.values(CFG.ZONES)
      .filter(zr=>combo.some(n=>zr.includes(n))).length;
    best = { numbers:combo, total, score:0, evenCnt:ev, oddCnt:6-ev, pairs, coveredZones:cov };
  }

  // ── 表示テキスト ──────────────────────────────
  const waveDir =
    slope < -3 ? "📉 急下降→上昇予測" :
    slope < -1 ? "↘ 下降中→上昇傾向" :
    slope >  3 ? "📈 急上昇→下降予測" :
    slope >  1 ? "↗ 上昇中→下降傾向" : "➡ 横ばい";

  const methodTxt =
    `${waveDir} | ` +
    `現在帯:${BUCKETS[currentBucket].label} → ` +
    `次の予測帯:${topNextBucket.label}(${(topNextBucket.p*100).toFixed(0)}%) | ` +
    `期待合計値:${expectedSum.toFixed(0)}`;

  return {
    ...best,
    pattern: "C",
    label:   "推移確率予測",
    method:  methodTxt,
  };
}

// ============================================================
// Pattern D: バランス＆逆張り理論特化予測
// 偶奇/高低のバランス、合計値のトレンド逆張り、位の偏り排除を厳密に適用
// ============================================================
function predictOccult(data) {
  if (data.length < 5) return predictRuleBased(data);

  // ── 1. 過去データのトレンド分析 ──
  // ① 過去5回の偶奇カウント（逆張り用）
  const last5 = data.slice(-5);
  let oddCount = 0, evenCount = 0;
  last5.forEach(d => d.numbers.forEach(n => {
    if (n % 2 !== 0) oddCount++;
    else evenCount++;
  }));

  // ② 過去3回の合計値トレンド（2回連続増減の逆張り用）
  const last3 = data.slice(-3);
  let trendTarget = "none";
  if (last3.length >= 3) {
    const t1 = last3[0].total;
    const t2 = last3[1].total;
    const t3 = last3[2].total; // 前回
    if (t1 < t2 && t2 < t3) trendTarget = "down"; // 増加続きなら下げる
    if (t1 > t2 && t2 > t3) trendTarget = "up";   // 減少続きなら上げる
  }

  const prevTotal = data[data.length - 1].total;

  // ③ 当選間隔（インターバル）の取得
  const intervals = {};
  CFG.NUMBERS.forEach(num => {
    let interval = 40;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].numbers.includes(num)) { interval = data.length - 1 - i; break; }
    }
    intervals[num] = interval;
  });

  // ── 2. 厳格なバランスフィルター ──
  function passesPatternDRules(nums, strict = true) {
    const s = [...nums].sort((a, b) => a - b);
    const total = s.reduce((a, b) => a + b, 0);

    // 【1】 合計値ルール
    if (total < 95 || total > 170) return false; // 95〜170のゾーンに収める
    if (Math.abs(total - prevTotal) > 60) return false; // 前回からの上下は60以下

    if (strict) {
      // 合計値トレンドの逆張り
      if (trendTarget === "down" && total >= prevTotal) return false;
      if (trendTarget === "up" && total <= prevTotal) return false;
    }

    // 【2】 低い数字(1-22)と高い数字(23-43)のバランス
    const lowCnt = s.filter(n => n <= 22).length;
    if (lowCnt < 2 || lowCnt > 4) return false; // 最低2つは入れる (2:4, 3:3, 4:2)

    // 【3】 偶奇のバランスと逆張り
    const evCnt = s.filter(n => n % 2 === 0).length;
    if (evCnt < 2 || evCnt > 4) return false; // 全部奇数・偶数はNG

    if (strict) {
      // 過去5回で倍以上偏っていたら逆張りする
      if (oddCount >= evenCount * 2 && evCnt < 3) return false; // 奇数過多なら偶数狙い(3〜4個)
      if (evenCount >= oddCount * 2 && evCnt > 3) return false; // 偶数過多なら奇数狙い(偶数は2〜3個)
    }

    // 【4】 連続数字の制限
    let maxConsec = 1, curConsec = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === s[i - 1] + 1) { curConsec++; maxConsec = Math.max(maxConsec, curConsec); }
      else curConsec = 1;
    }
    if (maxConsec >= 4) return false; // 4つ以上の連続はバランスが悪い

    // 【5】 十の位と一の位の配慮
    const tensCount = [0, 0, 0, 0, 0];
    s.forEach(n => tensCount[Math.floor(n / 10)]++);
    if (Math.max(...tensCount) >= 4) return false; // 同じ十の位に4つ以上固まるのはNG

    if (strict) {
      const tensTypes = tensCount.filter(c => c > 0).length;
      if (tensTypes === 5) return false; // 全ての十の位が出る確率は10%未満なので排除
    }

    const ones = new Set(s.map(n => n % 10));
    if (ones.size < 5) return false; // 一の位は5種類か6種類にする

    // 【6】 当選間隔のバランス
    const coldCnt = s.filter(n => intervals[n] >= 10).length;
    if (coldCnt < 1 || coldCnt > 2) return false; // なかなか出ない数字を1〜2つだけ混ぜる

    return true; // 全ての厳しい掟をクリア！
  }

  // ── 3. シミュレーション実行 ──
  // 短期出現(ホット)を少し優先しつつランダム生成
  const weights = CFG.NUMBERS.map(n => (intervals[n] < 10 ? 10 : 3));
  let validCombos = [];
  let attempts = 0;

  // 厳格モードで探索
  while (validCombos.length < 30 && attempts < 200000) {
    attempts++;
    const c = weightedSample6(weights);
    if (new Set(c).size < 6) continue;
    if (passesPatternDRules(c, true)) {
      validCombos.push([...c].sort((a, b) => a - b));
    }
  }

  // 条件が厳しすぎて見つからない場合は、トレンド逆張り等の条件を少し緩めて再探索
  if (validCombos.length === 0) {
    attempts = 0;
    while (validCombos.length < 30 && attempts < 100000) {
      attempts++;
      const c = weightedSample6(weights);
      if (new Set(c).size < 6) continue;
      if (passesPatternDRules(c, false)) {
        validCombos.push([...c].sort((a, b) => a - b));
      }
    }
  }

  // 1つ選出
  const bestCombo = validCombos.length > 0 
    ? validCombos[Math.floor(Math.random() * validCombos.length)]
    : weightedSample6(weights).sort((a, b) => a - b); // 最終フォールバック

  // ── 4. UI用パラメータの計算 ──
  const total = bestCombo.reduce((a, b) => a + b, 0);
  const evCnt = bestCombo.filter(n => n % 2 === 0).length;
  const cov = Object.values(CFG.ZONES).filter(zr => bestCombo.some(n => zr.includes(n))).length;
  let pairs = 0;
  for (let i = 1; i < bestCombo.length; i++) {
    if (bestCombo[i] === bestCombo[i - 1] + 1) pairs++;
  }

  return {
    numbers: bestCombo,
    score: 1.0, 
    total: total,
    evenCnt: evCnt,
    oddCnt: 6 - evCnt,
    pairs: pairs,
    coveredZones: cov,
    pattern: "D",
    label: "バランス＆逆張り理論特化",
    method: "高低/偶奇逆張り＋合計値トレンド＋十の位制限"
  };
}

// ============================================================
// Pattern E: 共鳴場アンサンブル予測（オリジナル最高傑作）
//
// コンセプト:
//   5つの独立したサブモデルが「投票」し、
//   最も多くのモデルに支持された数字を選出する。
//   どれか1つのロジックに依存しない「集合知」アプローチ。
//
// サブモデル:
//   #1 周期共鳴モデル    - インターバル分布の「共鳴点」を算出
//   #2 ゾーン運動量モデル - 直近の偏りから「次に来るゾーン」を予測
//   #3 共起相関モデル    - よく一緒に出る数字ペアの強さを評価
//   #4 エントロピー最大化 - 予測不可能性を最大化する組み合わせを探索
//   #5 逆バイアスモデル  - 長期データの統計から「割安な数字」を特定
// ============================================================
function predictEnsemble(data) {
  if(data.length < 10) return predictRuleBased(data);

  const fm    = buildFreqMap(data);
  const n     = data.length;
  const votes = {};
  CFG.NUMBERS.forEach(num => (votes[num] = 0));

  // ─────────────────────────────────────────────────────────
  // サブモデル #1: 周期共鳴モデル
  // 「過去に X 回休んだ数字が当たった」頻度分布を構築し、
  // 現在のインターバルが「共鳴点」に近い数字を高評価
  // ─────────────────────────────────────────────────────────
  (function submodel1_periodResonance() {
    const gapHist = {};
    const lastSeen = {};
    CFG.NUMBERS.forEach(num => (lastSeen[num] = -1));

    data.forEach((draw, idx) => {
      draw.numbers.forEach(num => {
        if(lastSeen[num] >= 0){
          const gap = idx - lastSeen[num] - 1;
          gapHist[gap] = (gapHist[gap]||0) + 1;
        }
        lastSeen[num] = idx;
      });
    });

    const totalGap = Object.values(gapHist).reduce((a,b)=>a+b,0);
    const gapProb  = {};
    Object.entries(gapHist).forEach(([k,v])=>{
      gapProb[parseInt(k)] = v / totalGap;
    });

    // 各数字の現在インターバルと共鳴点スコアを算出
    const resonScores = {};
    CFG.NUMBERS.forEach(num => {
      let last = -1;
      for(let i=n-1;i>=0;i--){
        if(data[i].numbers.includes(num)){ last=i; break; }
      }
      const gap    = last>=0 ? n-1-last : n;
      const prob   = gapProb[gap] || 0;
      const prob1  = gapProb[gap-1] || 0;
      const prob2  = gapProb[gap+1] || 0;
      resonScores[num] = prob*0.6 + prob1*0.2 + prob2*0.2;
    });

    // 上位20数字に投票（重み付き）
    const sorted = Object.entries(resonScores)
      .sort((a,b)=>b[1]-a[1]).slice(0,20);
    sorted.forEach(([num,s],i) => {
      votes[parseInt(num)] += Math.max(0, (20-i)) * s * 5;
    });
  })();

  // ─────────────────────────────────────────────────────────
  // サブモデル #2: ゾーン運動量モデル
  // 直近10回のゾーン出現数を記録し、
  // 「少ないゾーン（不足ゾーン）」の数字を優遇
  // ─────────────────────────────────────────────────────────
  (function submodel2_zoneMomentum() {
    const recent10 = data.slice(-10);
    const zoneNames = Object.keys(CFG.ZONES);

    // 各ゾーンの直近10回平均出現数
    const zoneAvg = {};
    zoneNames.forEach(z => {
      const cnt = recent10.reduce((s,d) =>
        s + d.numbers.filter(num=>CFG.ZONES[z].includes(num)).length, 0);
      zoneAvg[z] = cnt / 10;
    });

    // 全期間の各ゾーン平均（ベースライン）
    const zoneBase = {};
    zoneNames.forEach(z => {
      const cnt = data.reduce((s,d) =>
        s + d.numbers.filter(num=>CFG.ZONES[z].includes(num)).length, 0);
      zoneBase[z] = cnt / n;
    });

    // ベースライン比で不足しているゾーンほどボーナス
    const zoneBonus = {};
    zoneNames.forEach(z => {
      const deficit = zoneBase[z] - zoneAvg[z];
      zoneBonus[z]  = Math.max(0, deficit) * 15;
    });

    CFG.NUMBERS.forEach(num => {
      zoneNames.forEach(z => {
        if(CFG.ZONES[z].includes(num)){
          votes[num] += zoneBonus[z];
        }
      });
    });
  })();

  // ─────────────────────────────────────────────────────────
  // サブモデル #3: 共起相関モデル
  // 直近100回の「同時出現行列」を構築し、
  // 前回の当選番号と「共起スコアが高い」数字を優遇
  // ─────────────────────────────────────────────────────────
  (function submodel3_coOccurrence() {
    const WINDOW = Math.min(100, n);
    const recent = data.slice(-WINDOW);
    const coMatrix = {};
    CFG.NUMBERS.forEach(i => {
      coMatrix[i] = {};
      CFG.NUMBERS.forEach(j => (coMatrix[i][j] = 0));
    });

    recent.forEach(d => {
      const nums = d.numbers;
      for(let i=0;i<nums.length;i++){
        for(let j=i+1;j<nums.length;j++){
          coMatrix[nums[i]][nums[j]]++;
          coMatrix[nums[j]][nums[i]]++;
        }
      }
    });

    const lastDraw = data[n-1].numbers;
    CFG.NUMBERS.forEach(num => {
      if(lastDraw.includes(num)) return;
      const coScore = lastDraw.reduce((s,prev) =>
        s + (coMatrix[prev][num]||0), 0);
      votes[num] += coScore * 0.8;
    });
  })();

  // ─────────────────────────────────────────────────────────
  // サブモデル #4: エントロピー最大化
  // 組み合わせとして「情報量が最大」になるものを探索
  // 数字間の距離が均等に分布しているほど高評価
  // ─────────────────────────────────────────────────────────
  (function submodel4_entropyMax() {
    const wts  = CFG.NUMBERS.map(num => Math.max(fm[num], 1));
    let   best = null;
    let   bestEntropy = -Infinity;

    for(let i=0;i<8000;i++){
      const combo  = weightedSample6(wts);
      if(new Set(combo).size<6) continue;
      const sorted = [...combo].sort((a,b)=>a-b);

      // 数字間の差分の分散を計算（均等に分布=高エントロピー）
      const diffs = [];
      for(let j=1;j<sorted.length;j++){
        diffs.push(sorted[j]-sorted[j-1]);
      }
      const diffMean = diffs.reduce((a,b)=>a+b,0)/diffs.length;
      const diffVar  = diffs.reduce((s,d)=>s+(d-diffMean)**2,0)/diffs.length;
      // 分散が小さい=均等分布=高エントロピー（逆数でスコア化）
      const entropy  = 1 / (diffVar + 1);

      if(entropy > bestEntropy){
        bestEntropy = entropy;
        best = sorted;
      }
    }

    if(best) best.forEach(num => { votes[num] += bestEntropy * 30; });
  })();

  // ─────────────────────────────────────────────────────────
  // サブモデル #5: 逆バイアスモデル
  // 全体の出現率 vs 直近20回の出現率を比較し、
  // 「全体では多いのに直近は少ない」＝割安な数字を発掘
  // ─────────────────────────────────────────────────────────
  (function submodel5_antiRecency() {
    const r20 = data.slice(-20);
    const r20freq = {};
    CFG.NUMBERS.forEach(num => (r20freq[num] = 0));
    r20.forEach(d => d.numbers.forEach(num => r20freq[num]++));

    const globalAvg = (n * 6) / 43;
    const r20Avg    = (20 * 6) / 43;

    CFG.NUMBERS.forEach(num => {
      const globalRate  = fm[num]    / globalAvg;
      const recentRate  = r20freq[num] / r20Avg;
      // 全体では多いのに直近は少ない = 割安（リバウンド期待）
      const underVal    = globalRate - recentRate;
      votes[num] += Math.max(0, underVal) * 12;
    });
  })();

  // ─────────────────────────────────────────────────────────
  // アンサンブル投票集計: 上位30数字から最適な6つを選出
  // ─────────────────────────────────────────────────────────
  const sortedByVotes = Object.entries(votes)
    .sort((a,b) => b[1]-a[1])
    .map(([num]) => parseInt(num));

  const top30 = sortedByVotes.slice(0, 30);
  const wts   = top30.map(n => Math.max(votes[n], 0.1));

  const SIMULATION = 500;
  const counter    = {};
  CFG.NUMBERS.forEach(num => (counter[num] = 0));
  let collected = 0;

  // 500回サンプリング → 最頻出6数字を選出
  for(let i=0; i<200000 && collected<SIMULATION; i++){
    const pool    = [...top30];
    const poolWts = [...wts];
    const combo   = [];

    while(combo.length < 6) {
      const total = poolWts.reduce((a,b)=>a+b,0);
      let   r     = Math.random() * total;
      for(let j=0;j<pool.length;j++){
        r -= poolWts[j];
        if(r <= 0){
          combo.push(pool[j]);
          pool.splice(j,1);
          poolWts.splice(j,1);
          break;
        }
      }
    }

    if(new Set(combo).size < 6) continue;

    const sorted = [...combo].sort((a,b)=>a-b);
    const total  = sorted.reduce((a,b)=>a+b,0);
    if(total < 80 || total > 180) continue;

    combo.forEach(num => counter[num]++);
    collected++;
  }

  // 最頻出6数字
  const top6 = Object.entries(counter)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 6)
    .map(([n]) => parseInt(n))
    .sort((a,b) => a-b);

  const total     = top6.reduce((a,b)=>a+b,0);
  const evenCnt   = top6.filter(n=>n%2===0).length;
  const {pairs}   = countConsec(top6);
  const cov       = Object.values(CFG.ZONES)
    .filter(zr=>top6.some(n=>zr.includes(n))).length;

  // コンソールログ
  console.group("⚡ Pattern E アンサンブル結果");
  console.log("投票TOP10:",
    Object.entries(votes).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([n,v])=>`${n}番(${v.toFixed(1)})`).join(" / "));
  console.log("出現TOP10:",
    Object.entries(counter).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([n,c])=>`${n}番:${c}回`).join(" / "));
  console.log(`予測: [${top6.join(", ")}]  合計:${total}  連番:${pairs}組`);
  console.groupEnd();

  const maxVote    = Object.values(votes).reduce((a,b)=>Math.max(a,b),0);
  const scoreNorm  = top6.reduce((s,n)=>(s+votes[n]),0)/(6*maxVote+1e-9);

  return {
    numbers:      top6,
    total,
    score:        Math.max(0, Math.min(1, scoreNorm)),
    evenCnt,
    oddCnt:       6-evenCnt,
    pairs,
    coveredZones: cov,
    pattern:      "E",
    label:        "共鳴場アンサンブル",
    method:       "5サブモデル投票 | 周期共鳴・ゾーン運動量・共起相関・エントロピー・逆バイアス",
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
            subEl.textContent = "5パターンの予測結果を確認しましょう！";
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

// 予測
document.getElementById("btn-predict").addEventListener("click", () => {
  if(STATE.data.length < 10){ showToast("データが10件以上必要です","error"); return; }
  const btn = document.getElementById("btn-predict");
  setLoading(btn, true);

  setTimeout(() => {
    try {
      const pA = predictRuleBased(STATE.data);
      const pB = predictStatistical(STATE.data);
      const pC = predictTransition(STATE.data);
      const pD = predictOccult(STATE.data);
      const pE = predictEnsemble(STATE.data);

      const allPreds = [pA, pB, pC, pD, pE];

      // ── スナップショット保存（予測実行時点で固定） ────────
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
        showToast("予測完了！ 5パターン出力", "success");
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