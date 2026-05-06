// ============================================================
// Pattern C (predictPatternC): ミニロト用精密揺らぎ補正
// ============================================================
function predictPatternC(data, pA = null, pB = null) {
  if (!pA) pA = predictRuleBased(data); 
  if (!pB) pB = predictUltimate(data, pA); 

  let bestBase = [];
  let appliedMethod = "";

  const isBiasedA = [
    [1, 9], [10, 19], [20, 29], [30, 31]
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

    const tensRanges = [[10, 19], [20, 29]];
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

    let needed = 5 - fixedBase.length; 

    if (remainingB.length < needed) {
      let extraA = pA.numbers.filter(n => !fixedBase.includes(n));
      fixedBase.push(...extraA.slice(0, needed - remainingB.length));
      needed = 5 - fixedBase.length;
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
        const z20 = testNums.filter(n => n >= 20 && n <= 29).length;

        if (z20 >= 1 && z20 <= 2) score += 500; 

        if (total >= 65 && total <= 95) score += 800; 
        else if (total > 95) score -= (total - 95) * 10;
        else if (total < 65) score -= (65 - total) * 10;

        if (score > maxScore) {
          maxScore = score;
          bestBase = testNums;
        }
      });
    } else {
      bestBase = [...fixedBase, ...remainingB.slice(0, needed)];
    }
  }

  bestBase.sort((a, b) => a - b);
  const finalNums = [];

  // ── ミニロト用：全番台を最大±2で「無条件に」ランダム揺らし（0を含む） ──
  bestBase.forEach(num => {
    let offset = 0;
    
    let isZone1 = false;
    let isZone4 = false;

    if (num >= 1 && num <= 9) {
      isZone1 = true;
      let offsets = [-2, -1, 0, 1, 2];
      offsets = offsets.filter(off => num + off <= 10);
      offset = offsets.length > 0 ? offsets[Math.floor(Math.random() * offsets.length)] : 0;
    } 
    else if (num >= 10 && num <= 29) { 
      const offsets = [-2, -1, 0, 1, 2]; 
      offset = offsets[Math.floor(Math.random() * offsets.length)];
    }
    else if (num >= 30 && num <= 31) {
      isZone4 = true;
      let offsets = [-2, -1, 0, 1, 2];
      offsets = offsets.filter(off => (num + off >= 30) && (num + off <= 31));
      offset = offsets.length > 0 ? offsets[Math.floor(Math.random() * offsets.length)] : 0;
    }

    let safeNum = num + offset;

    if (safeNum < 1) safeNum = 1;
    if (safeNum > 31) safeNum = 31;
    
    if (isZone1 && safeNum > 10) safeNum = 10;
    if (isZone4 && safeNum < 30) safeNum = 30;

    let step = (offset < 0) ? -1 : 1; 
    if (offset === 0) step = 1; 

    while (finalNums.includes(safeNum)) {
      safeNum += step;
      if (isZone1) {
        if (safeNum > 10) safeNum = 1;
        if (safeNum < 1) safeNum = 10;
      } 
      else if (isZone4) {
        if (safeNum > 31) safeNum = 30;
        if (safeNum < 30) safeNum = 31;
      } 
      else {
        if (safeNum > 31) safeNum = 1;
        if (safeNum < 1) safeNum = 31;
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
    oddCnt: 5 - evCnt,
    pairs: pairs,
    coveredZones: cov,
    pattern: "C",
    label: "状況対応型・ハイブリッド揺らぎ補正",
    method: appliedMethod
  };
}

// ============================================================
// Pattern C2 (predictPatternC2): 合計推移・連番収束 (ミニロト特化±2)
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
  predictedTotal = Math.round((predictedTotal * 0.7) + (80 * 0.3)); 
  predictedTotal = Math.max(40, Math.min(120, predictedTotal));

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
    
    for (let j = 0; j < 5; j++) {
      let num = baseNums[j];
      
      // ★修正: 忖度なし！すべての数字を無条件で [-2, -1, 0, 1, 2] から選ぶ
      const offsets = [-2, -1, 0, 1, 2];
      let offset = offsets[Math.floor(Math.random() * offsets.length)];
      
      cand.push(num + offset);
    }
    
    let isValid = true;
    for(let j=0; j<5; j++){
      if(cand[j] < 1 || cand[j] > 31) isValid = false; 
    }
    if (!isValid) continue;
    
    const uniqueCand = Array.from(new Set(cand));
    if (uniqueCand.length !== 5) continue;
    cand.sort((a, b) => a - b);

    const currentTotal = cand.reduce((a, b) => a + b, 0);
    const diff = Math.abs(predictedTotal - currentTotal);
    const sumScore = Math.max(0, 100 - (diff * 3)); 

    const pairs = getPairs(cand);
    let pairMult = 1.0;
    if (pairs === 0) pairMult = 1.0;      
    else if (pairs === 1) pairMult = 1.0; 
    else if (pairs === 2) pairMult = 0.8; 
    else pairMult = 0.4;

    // Aと全く同じ数字（4個以上一致）になったら大減点する差別化スコア
    const matchWithA = cand.filter(n => baseNums.includes(n)).length;
    const diffPenalty = matchWithA >= 4 ? 50 : 0; 

    // 差別化ペナルティを引く
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
    oddCnt: 5 - evCnt,
    pairs: finalPairs,
    coveredZones: cov,
    pattern: "C2",
    label: "パターン C2 (合計推移・ランダム補正)",
    method: `A基準(±2)から目標[${predictedTotal}]と連番期待値に合致するものを抽出 (A差別化済)`
  };
}
