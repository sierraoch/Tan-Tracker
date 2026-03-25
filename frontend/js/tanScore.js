// ── Fitzpatrick skin type data ───────────────────────────────────────────
export const FITZPATRICK_TYPES = [
  { type: 1, label: 'Type I',   desc: 'Always burns, never tans',             swatch: '#F7DEC9', gainRate: 0.40, decayRate: 0.12 },
  { type: 2, label: 'Type II',  desc: 'Usually burns, sometimes tans',        swatch: '#E8C9A8', gainRate: 0.60, decayRate: 0.10 },
  { type: 3, label: 'Type III', desc: 'Sometimes burns, gradually tans',      swatch: '#C49A72', gainRate: 0.85, decayRate: 0.07 },
  { type: 4, label: 'Type IV',  desc: 'Rarely burns, always tans',            swatch: '#A0724A', gainRate: 1.00, decayRate: 0.05 },
  { type: 5, label: 'Type V',   desc: 'Very rarely burns, tans deeply',       swatch: '#7B4F30', gainRate: 1.15, decayRate: 0.035 },
  { type: 6, label: 'Type VI',  desc: 'Never burns, deeply pigmented',        swatch: '#4A2E1A', gainRate: 1.25, decayRate: 0.025 },
];

// ── SPF multipliers ──────────────────────────────────────────────────────
const SPF_MULTIPLIERS = {
  none:  1.0,
  spf15: 0.6,
  spf30: 0.4,
  spf50: 0.2,
};

// ── Tanning goals ────────────────────────────────────────────────────────
export const GOALS = [
  { id: 'subtle',     label: 'Subtle glow',    desc: 'Just a hint of color',          target: 45 },
  { id: 'noticeable', label: 'Noticeable tan',  desc: 'People will mention it',        target: 65 },
  { id: 'deep',       label: 'Deep tan',         desc: 'Clearly sun-kissed to everyone', target: 88 },
];

// ── Milestones ───────────────────────────────────────────────────────────
export const MILESTONES = [
  { min: 0,  max: 30, label: 'Building a base',     desc: 'No visible change yet — keep going' },
  { min: 30, max: 60, label: 'Noticeable',           desc: 'People might mention it' },
  { min: 60, max: 85, label: 'Visibly tan',          desc: 'Clearly sun-kissed' },
  { min: 85, max: 100, label: 'Deeply tan',          desc: 'Obvious to everyone' },
];

// ── Normalization constant ───────────────────────────────────────────────
// Calibrated so 45min at UV 6, no SPF, midday, Type III ≈ 5 points
const NORM = 0.022;

/**
 * Returns a multiplier (0–1) based on time of day.
 * @param {number} hour - 0–23
 */
export function timeOfDayMultiplier(hour) {
  if (hour >= 10 && hour < 14) return 1.0;
  if ((hour >= 8 && hour < 10) || (hour >= 14 && hour < 16)) return 0.75;
  return 0.4;
}

/**
 * Calculate the score gain for a single session.
 */
export function calcSessionGain({ uvIndex, durationMinutes, spf = 'none', hour, fitzpatrickType }) {
  const fitzData = FITZPATRICK_TYPES.find(f => f.type === fitzpatrickType);
  const gainRate = fitzData?.gainRate ?? 1.0;
  const spfMult = SPF_MULTIPLIERS[spf] ?? 1.0;
  const timeMult = timeOfDayMultiplier(hour);

  const effectiveUV = uvIndex * durationMinutes * spfMult * timeMult;
  const raw = effectiveUV * gainRate * NORM;
  return Math.min(Math.round(raw * 10) / 10, 20); // round to 1dp, cap at 20
}

/**
 * Apply multiplicative daily decay to a score.
 */
export function applyDecay(score, daysSinceLast, fitzpatrickType) {
  const fitzData = FITZPATRICK_TYPES.find(f => f.type === fitzpatrickType);
  const decayRate = fitzData?.decayRate ?? 0.07;
  const decayed = score * Math.pow(1 - decayRate, daysSinceLast);
  return Math.max(0, Math.round(decayed * 10) / 10);
}

/**
 * Get the current milestone object for a score.
 */
export function getMilestone(score) {
  return MILESTONES.find(m => score >= m.min && score < m.max) ?? MILESTONES[MILESTONES.length - 1];
}

/**
 * Estimate how many minutes are needed right now to get a meaningful session.
 * Returns null if UV is too low.
 */
export function estimateMinutesNeeded(uvIndex, fitzpatrickType, hour = new Date().getHours()) {
  if (uvIndex < 3) return null;

  const fitzData = FITZPATRICK_TYPES.find(f => f.type === fitzpatrickType);
  const gainRate = fitzData?.gainRate ?? 1.0;
  const timeMult = timeOfDayMultiplier(hour);

  // Solve for minutes to gain 3 points (meaningful progress), no SPF, current time
  const targetGain = 3;
  const minutes = targetGain / (uvIndex * timeMult * gainRate * NORM);
  return Math.max(10, Math.round(minutes));
}

/**
 * Get UV description string.
 */
export function uvDescription(uvIndex) {
  if (uvIndex >= 11) return { level: 'extreme',   text: 'Extreme UV — use SPF' };
  if (uvIndex >= 8)  return { level: 'very-high',  text: 'Very high UV — go now!' };
  if (uvIndex >= 6)  return { level: 'high',       text: 'Great tanning conditions' };
  if (uvIndex >= 3)  return { level: 'moderate',   text: 'Moderate — good for a base' };
  return                    { level: 'low',        text: 'UV too low for tanning' };
}

/**
 * Days until score drops from its current milestone to the one below.
 * Returns null if already at base or can't calculate.
 */
export function daysUntilTierDrop(score, fitzpatrickType) {
  const milestone = getMilestone(score);
  const prevMin = milestone.min;
  if (score <= prevMin + 1) return null; // already near the bottom of tier

  const fitzData = FITZPATRICK_TYPES.find(f => f.type === fitzpatrickType);
  const decayRate = fitzData?.decayRate ?? 0.07;

  // score * (1 - decayRate)^days = prevMin
  // days = log(prevMin / score) / log(1 - decayRate)
  const days = Math.log(prevMin / score) / Math.log(1 - decayRate);
  return Math.max(1, Math.ceil(days));
}
