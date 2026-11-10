// Composite scoring engine
// References: SIGNAL_ENGINE.md Part 5 (Scoring Model)

function getFreshnessMultiplier(detectedAt, signalType) {
  const ageMs = Date.now() - new Date(detectedAt).getTime();
  const days = ageMs / (1000 * 60 * 60 * 24);

  // S08 Pain — fastest decay
  if (signalType === 'S08') {
    if (days <= 1) return 1.0;
    if (days <= 3) return 0.7;
    if (days <= 7) return 0.4;
    return 0.1;
  }

  // S04 Engagement — fast decay
  if (signalType === 'S04') {
    if (days <= 1) return 1.0;
    if (days <= 3) return 0.9;
    if (days <= 7) return 0.7;
    if (days <= 14) return 0.5;
    if (days <= 30) return 0.3;
    return 0;
  }

  // Standard decay
  if (days <= 7) return 1.0;
  if (days <= 21) return 0.8;
  if (days <= 45) return 0.5;
  if (days <= 90) return 0.2;
  return 0;
}

function getOverlapBonus(distinctSignalCount) {
  if (distinctSignalCount >= 5) return 3.0;
  if (distinctSignalCount === 4) return 2.2;
  if (distinctSignalCount === 3) return 1.7;
  if (distinctSignalCount === 2) return 1.3;
  return 1.0;
}

function getIntentTier(score, thresholds) {
  const t = thresholds || { high: 70, moderate: 40, low: 15 };
  if (score >= t.high) return 'high';
  if (score >= t.moderate) return 'moderate';
  if (score >= t.low) return 'low';
  return 'none';
}

function computeScore(signals, campaignWeights, thresholds) {
  if (!signals || signals.length === 0) return { compositeScore: 0, intentTier: 'low' };

  const uniqueTypes = new Set(signals.map(s => s.type));
  const overlapBonus = getOverlapBonus(uniqueTypes.size);

  const weightedSum = signals.reduce((sum, signal) => {
    const weight = (campaignWeights && campaignWeights[signal.type]) || 1.0;
    const freshness = getFreshnessMultiplier(signal.detectedAt, signal.type);
    return sum + (signal.score * weight * freshness);
  }, 0);

  // Normalize: scale so 2-signal lead with good scores hits ~60-70, 3-signal hits ~80+
  const raw = (weightedSum * overlapBonus);
  const compositeScore = Math.min(100, Math.round(Math.sqrt(raw) * 10 * 10) / 10);
  const intentTier = getIntentTier(compositeScore, thresholds);

  return { compositeScore, intentTier };
}

module.exports = { computeScore, getFreshnessMultiplier, getOverlapBonus, getIntentTier };
