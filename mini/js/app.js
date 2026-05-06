// ────────────────────────────────────────────────────────────
// API・データ読み込み（Netlify Functions 通信・保存対応版）
// ────────────────────────────────────────────────────────────
async function apiGet() {
  // ミニロト専用の Function を呼び出す
  const timestamp = new Date().getTime();
  const r = await fetch("/.netlify/functions/getMiniData?t=" + timestamp);
  if (!r.ok) throw new Error(`取得失敗: ${r.status}`);
  return await r.json();
}

async function apiSave(data, sha) {
  // ミニロト専用の Function で保存する
  const r = await fetch("/.netlify/functions/saveMiniData", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ data, sha }),
  });
  if (!r.ok) throw new Error(`保存失敗: ${r.status}`);
  return await r.json();
}

async function loadData() {
  try {
    const res = await apiGet();
    
    // ★ここが原因でした！ GitHubの上書きに必要な sha をしっかり記憶させる
    STATE.sha = res.sha; 

    // JSONの形式が 配列か、オブジェクト( {data: [...]} )かを判別して柔軟に読み込む
    let rawData = [];
    if (Array.isArray(res)) {
      rawData = res;
    } else if (res.data && Array.isArray(res.data)) {
      rawData = res.data;
    } else if (res.data && res.data.data && Array.isArray(res.data.data)) {
      rawData = res.data.data;
    }

    STATE.data = rawData.sort((a,b) => a.round - b.round);
    updateUI();
  } catch(e) {
    console.error(e);
    showToast("読み込みエラー: " + e.message, "error");
    updateUI();
  }
}

async function saveData() {
  // 画面のデータ(STATE.data)をJSON用の形式に整えて保存する
  const sorted = [...STATE.data].sort((a,b) => b.round - a.round);
  const payload = {
    lastUpdated: sorted[0]?.date || "",
    totalRounds: STATE.data.length,
    data: sorted,
  };
  
  // 記憶しておいた鍵(sha)を使って上書き保存
  const res = await apiSave(payload, STATE.sha);
  
  // 保存に成功したら、新しく発行された鍵(sha)を記憶し直す
  STATE.sha = res.sha;
}
