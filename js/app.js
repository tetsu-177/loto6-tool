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

// ── 状態 ──────────────────────────────────────────────────
const STATE = {
  data:    [],
  sha:     null,
  charts:  {},
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

function scoreCombo(nums, freqMap, sumMean, sumStd) {
  const s  = [...nums].sort((a,b)=>a-b);
  const t  = s.reduce((a,b)=>a+b,0);
  const ev = s.filter(n=>n%2===0).length;
  const {pairs} = countConsec(s);
  const cov = Object.values(CFG.ZONES).filter(zr=>s.some(n=>zr.includes(n))).length;
  const avgF = Object.values(freqMap).reduce((a,b)=>a+b,0)/43;
  const fs   = s.reduce((sum,n)=>sum+Math.max(0,1-Math.abs(freqMap[n]-avgF)/(avgF+1e-9)),0)/6;
  const ss   = Math.max(0,1-Math.abs(t-sumMean)/(sumStd*2+1e-9));
  const zs   = cov/5;
  const cs   = pairs===0?0.8:pairs===1?1.0:Math.max(0,1-(pairs-1)*0.3);
  const score= CFG.SCORE_W.freq*fs+CFG.SCORE_W.sum*ss+CFG.SCORE_W.zone*zs+CFG.SCORE_W.consec*cs;
  return { numbers:s, score, total:t, evenCnt:ev, oddCnt:6-ev, pairs, coveredZones:cov };
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

// ────────────────────────────────────────────────────────────
// 予測ロジック
// ────────────────────────────────────────────────────────────

/** Pattern A: ルールベース */
function predictRuleBased(data) {
  const fm   = buildFreqMap(data);
  const sd   = analyzeSum(data);
  const wts  = CFG.NUMBERS.map(n=>Math.max(fm[n],1));
  const cands= [];
  for(let i=0;i<80000&&cands.length<200;i++){
    const c=weightedSample6(wts);
    if(new Set(c).size<6) continue;
    if(passesRules(c)) cands.push(scoreCombo(c,fm,sd.mean,sd.std));
  }
  if(!cands.length) {
    for(let i=0;i<5000;i++){
      const c=weightedSample6(wts);
      if(new Set(c).size<6) continue;
      cands.push(scoreCombo(c,fm,sd.mean,sd.std));
    }
  }
  cands.sort((a,b)=>b.score-a.score);
  return {...cands[0], pattern:"A", label:"ルールベース予測", method:"RuleBase + Scoring"};
}

/** Pattern B: 統計スコアリング */
function predictStatistical(data) {
  const fm   = buildFreqMap(data);
  const sd   = analyzeSum(data);
  const n    = data.length;
  const ns   = CFG.NUMBERS.map(num => {
    const avg  = (n*6)/43;
    const fdev = Math.abs(fm[num]-avg)/(avg+1e-9);
    const fs   = Math.max(0,1-fdev*0.5);
    let intv   = n;
    for(let i=data.length-1;i>=0;i--){
      if(data[i].numbers.includes(num)){intv=data.length-1-i;break;}
    }
    const is   = Math.min(intv/20,1.0);
    const r30  = data.slice(-30);
    const rs   = r30.reduce((s,r)=>s+(r.numbers.includes(num)?1:0),0)/30;
    return {num, score: fs*0.4+is*0.4+rs*0.2};
  });
  ns.sort((a,b)=>b.score-a.score);
  const top20= ns.slice(0,20).map(x=>x.num);
  const wts  = CFG.NUMBERS.map(n=>Math.max(fm[n],1));
  let best   = null;
  for(let i=0;i<50000;i++){
    const useTop = Math.random()<0.7;
    const combo  = useTop
      ? [...top20].sort(()=>Math.random()-0.5).slice(0,6)
      : weightedSample6(wts);
    if(new Set(combo).size<6) continue;
    if(!passesRules(combo)) continue;
    const r = scoreCombo(combo,fm,sd.mean,sd.std);
    if(!best||r.score>best.score) best=r;
  }
  if(!best){
    const combo=ns.slice(0,6).map(x=>x.num);
    best=scoreCombo(combo,fm,sd.mean,sd.std);
  }
  return {...best, pattern:"B", label:"統計スコアリング予測", method:"StatisticalScoring"};
}

/** Pattern C: 推移確率予測 */
function predictTransition(data) {
  if(data.length < 5) return predictRuleBased(data);

  // 推移カウント行列を構築
  // transCount[前の回の数字][次の回の数字] = 出現回数
  const tc = {};
  for(let i=1;i<=43;i++) { tc[i]={}; }

  for(let i=0;i<data.length-1;i++){
    const curr = data[i].numbers;
    const next = data[i+1].numbers;
    curr.forEach(c => {
      next.forEach(nx => {
        tc[c][nx] = (tc[c][nx]||0) + 1;
      });
    });
  }

  // 推移確率を計算 (正規化)
  const tp = {};
  for(let i=1;i<=43;i++){
    const tot = Object.values(tc[i]).reduce((s,v)=>s+v,0);
    tp[i] = {};
    for(let j=1;j<=43;j++){
      tp[i][j] = tot > 0 ? (tc[i][j]||0)/tot : 0;
    }
  }

  // 直近の回のデータから候補スコアを算出
  const lastDraw = data[data.length-1];

  // 各数字の「次に来る確率」スコアを集計
  const candScores = {};
  for(let n=1;n<=43;n++){
    candScores[n] = lastDraw.numbers.reduce((sum, prev) => {
      return sum + (tp[prev][n] || 0);
    }, 0);
  }

  // スコア上位表示（デバッグ用）
  const ranked = Object.entries(candScores)
    .sort((a,b)=>b[1]-a[1])
    .map(([n,s])=>({num:parseInt(n),tScore:s}));

  const fm   = buildFreqMap(data);
  const sd   = analyzeSum(data);
  const top15= ranked.slice(0,15).map(x=>x.num);

  let best = null;

  // 上位候補からルール適合組み合わせを探索
  for(let i=0;i<30000;i++){
    const shuffled = [...top15].sort(()=>Math.random()-0.5);
    const combo    = shuffled.slice(0,6);
    if(new Set(combo).size<6) continue;
    if(!passesRules(combo)) continue;

    const tScore    = combo.reduce((s,n)=>s+(candScores[n]||0),0)/6;
    const baseRes   = scoreCombo(combo,fm,sd.mean,sd.std);
    const combined  = baseRes.score * 0.5 + Math.min(tScore,1.0) * 0.5;

    if(!best||combined>best.combined){
      best = {...baseRes, combined};
    }
  }

  // フォールバック
  if(!best){
    const combo = ranked.slice(0,6).map(x=>x.num);
    const base  = scoreCombo(combo,fm,sd.mean,sd.std);
    best = {...base, combined:base.score};
  }

  return {
    ...best,
    score:   best.combined,
    pattern: "C",
    label:   "推移確率予測",
    method:  `TransitionMatrix（前回: ${lastDraw.numbers.join(",")}）`,
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
  const pClass={A:"pattern-a",B:"pattern-b",C:"pattern-c"};
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
  const d     = STATE.data.find(x=>x.round===round);
  if (!d) return;

  const fd    = analyzeFrequency(STATE.data);
  const fMap  = Object.fromEntries(fd.map(f=>[f.num, f]));
  const maxCnt= Math.max(...fd.map(f=>f.count));

  // ゾーン分布
  const zoneDist = Object.entries(CFG.ZONES).map(([zName, zRange])=>{
    const cnt = d.numbers.filter(n=>zRange.includes(n)).length;
    return {zName, cnt};
  });

  const {pairs, maxLen} = countConsec(d.numbers);
  const even = d.numbers.filter(n=>n%2===0).length;

  document.getElementById("detail-title").textContent = `第 ${d.round} 回  ${d.date}`;
  document.getElementById("detail-content").innerHTML = `

    <!-- 番号表示 -->
    <div class="detail-section">
      <h3>当選番号</h3>
      <div class="number-balls" style="justify-content:center;gap:10px">
        ${d.numbers.map(n=>`<div class="ball ${getBallClass(n)}" style="width:48px;height:48px;font-size:1rem">${n}</div>`).join("")}
      </div>
    </div>

    <!-- 基本統計 -->
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

    <!-- ゾーン分布 -->
    <div class="detail-section">
      <h3>ゾーン分布</h3>
      <div class="zone-dist-row">
        ${zoneDist.map((z,i)=>{
          const colors=["#fd79a8","#fdcb6e","#55efc4","#74b9ff","#a29bfe"];
          return `
            <div class="zone-dist-item">
              <div class="z-name" style="color:${colors[i]}">${z.zName.replace("Zone","Z")}</div>
              <div class="z-val" style="color:${colors[i]}">${z.cnt}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>

    <!-- 各数字の出現頻度 -->
    <div class="detail-section">
      <h3>各数字の全期間出現頻度</h3>
      ${d.numbers.map(n=>{
        const f    = fMap[n];
        const pct  = maxCnt > 0 ? (f.count/maxCnt)*100 : 0;
        const clr  = f.label==="HOT"?"#ff6b6b":f.label==="COLD"?"#74b9ff":"#6c63ff";
        return `
          <div class="detail-freq-row">
            <div class="ball ${getBallClass(n)}" style="width:34px;height:34px;font-size:0.8rem;flex-shrink:0">${n}</div>
            <div class="detail-freq-bar-wrap">
              <div class="detail-freq-bar" style="width:${pct}%;background:${clr}"></div>
            </div>
            <div style="min-width:80px;text-align:right;font-size:0.85rem">
              ${f.count}回
              <span style="font-size:0.7rem;color:${clr};margin-left:4px">${f.label}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
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
  if (STATE.data.length < 10) { showToast("データが10件以上必要です","error"); return; }

  const btn = document.getElementById("btn-predict");
  setLoading(btn, true);

  setTimeout(() => {
    try {
      const pA = predictRuleBased(STATE.data);
      const pB = predictStatistical(STATE.data);
      const pC = predictTransition(STATE.data);

      // ガラポン演出 → 完了後に結果表示
      runGarapon([pA, pB, pC], () => {
        renderPredictions([pA, pB, pC]);
        document.getElementById("predict-section").style.display = "block";
        document.getElementById("predict-section").scrollIntoView({behavior:"smooth"});
        showToast("予測完了！", "success");
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