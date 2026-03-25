import {
  calcSessionGain,
  applyDecay,
  getMilestone,
  estimateMinutesNeeded,
  uvDescription,
  daysUntilTierDrop,
  GOALS,
} from './tanScore.js';
import { getSessions, getTanScore, saveTanScore, logSession, fetchUV } from './api.js';

let profile = null;
let currentScore = 0;
let currentUV = 0;
let sessions = [];

// Duration stepper state
let sessionDuration = 30;
let sessionSpf = 'spf15';

export async function initMyTanPage(userProfile) {
  profile = userProfile;

  // Personalized greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('mytan-greeting').textContent =
    profile?.name ? `${greeting}, ${profile.name}` : greeting;

  // Set default SPF from profile
  sessionSpf = profile?.defaultSpf ?? 'spf15';

  await loadData();
  setupModal();
}

async function loadData() {
  try {
    // Load in parallel
    const [scoreData, sessionsData] = await Promise.all([
      getTanScore().catch(() => null),
      getSessions().catch(() => []),
    ]);

    sessions = sessionsData ?? [];

    // Apply decay since last session
    let score = scoreData?.score ?? 0;
    if (scoreData?.lastUpdated && profile) {
      const daysSince = (Date.now() - new Date(scoreData.lastUpdated).getTime()) / 86400000;
      if (daysSince > 0.1) {
        score = applyDecay(score, daysSince, profile.fitzpatrickType);
        // Save updated decayed score
        await saveTanScore({ score, lastUpdated: new Date().toISOString() }).catch(() => {});
      }
    }

    currentScore = score;
    renderScore(score);
    renderSessions(sessions);

    // Load current UV for widget
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async pos => {
          const { latitude, longitude } = pos.coords;
          const uvData = await fetchUV(latitude, longitude);
          currentUV = uvData.uvIndex ?? 0;
          window.__currentUV__ = currentUV;
          renderTimeNeeded(currentUV);
          document.getElementById('modal-uv-value').textContent = currentUV.toFixed(1);
        }, () => renderTimeNeeded(0));
      }
    } catch {}
  } catch (e) {
    console.warn('loadData error:', e.message);
  }
}

function renderScore(score) {
  if (!profile) return;

  // Score number
  document.getElementById('score-number').textContent = Math.round(score);

  // Progress bar
  const fill = document.getElementById('progress-fill');
  fill.style.width = `${Math.min(score, 100)}%`;

  // Goal marker
  const goalObj = GOALS.find(g => g.id === profile.goal);
  if (goalObj) {
    const marker = document.getElementById('goal-marker');
    marker.style.left = `${goalObj.target}%`;
  }

  // Milestone
  const milestone = getMilestone(score);
  document.getElementById('milestone-label').textContent = milestone.label;

  // Trend / stats
  const lastSession = sessions[0];
  const daysSince = lastSession
    ? Math.floor((Date.now() - new Date(lastSession.timestamp).getTime()) / 86400000)
    : null;

  const daysSinceEl = document.getElementById('stat-days-since');
  daysSinceEl.textContent = daysSince === null ? '--' : daysSince === 0 ? 'Today' : daysSince;

  // Days to tier drop
  const dropDays = daysUntilTierDrop(score, profile.fitzpatrickType);
  document.getElementById('stat-decay-days').textContent =
    dropDays === null ? '--' : dropDays;

  // Trend indicator
  const trendEl = document.getElementById('score-trend');
  const trending = daysSince !== null && daysSince <= 2;
  trendEl.innerHTML = trending
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg> Rising`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg> Fading`;
  trendEl.style.color = trending ? 'var(--uv-green)' : 'var(--uv-orange)';
}

function renderTimeNeeded(uvIndex) {
  const mainEl = document.getElementById('time-needed-main');
  const subEl = document.getElementById('time-needed-sub');

  if (!profile) {
    mainEl.textContent = 'Complete setup first';
    return;
  }

  if (uvIndex < 3) {
    mainEl.textContent = 'UV is too low right now for tanning';
    subEl.textContent = 'Check back later — conditions improve around midday';
    return;
  }

  const mins = estimateMinutesNeeded(uvIndex, profile.fitzpatrickType, new Date().getHours());
  if (!mins) {
    mainEl.textContent = 'Checking conditions...';
    return;
  }

  mainEl.textContent = `You need about ${mins} min outside today`;
  subEl.textContent = uvIndex >= 8
    ? `UV is very high (${uvIndex.toFixed(1)}) — consider SPF to avoid burning`
    : `Current UV: ${uvIndex.toFixed(1)} — ${uvDescription(uvIndex).text}`;
}

function renderSessions(sessionsArr) {
  const list = document.getElementById('sessions-list');
  const empty = document.getElementById('sessions-empty');

  if (!sessionsArr.length) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = sessionsArr.slice(0, 20).map(s => {
    const date = new Date(s.timestamp);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const spfLabel = { none: 'No SPF', spf15: 'SPF 15', spf30: 'SPF 30', spf50: 'SPF 50+' }[s.spf] ?? s.spf;
    const points = s.gain ? `+${s.gain.toFixed(1)}` : '+--';
    return `
      <div class="session-item">
        <span class="session-date">${dateStr}</span>
        <span class="session-points">${points}</span>
        <span class="session-meta">${s.duration} min &middot; UV ${s.uvIndex?.toFixed(1) ?? '--'} &middot; ${spfLabel}</span>
      </div>
    `;
  }).join('');
}

// ── Log Session Modal ──────────────────────────────────────────────────
function setupModal() {
  const modal = document.getElementById('log-modal');
  const openBtn = document.getElementById('log-session-btn');
  const closeBtn = document.getElementById('modal-close');
  const saveBtn = document.getElementById('save-session-btn');
  const minusBtn = document.getElementById('duration-minus');
  const plusBtn = document.getElementById('duration-plus');
  const durationEl = document.getElementById('duration-value');

  // Set initial SPF selection
  setModalSpf(sessionSpf);

  openBtn.addEventListener('click', () => {
    modal.classList.remove('hidden');
    const uv = window.__currentUV__ ?? 0;
    document.getElementById('modal-uv-value').textContent = uv ? uv.toFixed(1) : '--';
  });

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

  minusBtn.addEventListener('click', () => {
    sessionDuration = Math.max(5, sessionDuration - 5);
    durationEl.textContent = sessionDuration;
  });
  plusBtn.addEventListener('click', () => {
    sessionDuration = Math.min(300, sessionDuration + 5);
    durationEl.textContent = sessionDuration;
  });

  document.querySelectorAll('#spf-options .spf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sessionSpf = btn.dataset.spf;
      setModalSpf(sessionSpf);
    });
  });

  saveBtn.addEventListener('click', async () => {
    const now = new Date();
    const uvIndex = window.__currentUV__ ?? 0;
    const hour = now.getHours();
    const gain = profile
      ? calcSessionGain({
          uvIndex,
          durationMinutes: sessionDuration,
          spf: sessionSpf,
          hour,
          fitzpatrickType: profile.fitzpatrickType,
        })
      : 0;

    const session = {
      duration: sessionDuration,
      spf: sessionSpf,
      uvIndex,
      hour,
      gain,
    };

    try {
      await logSession(session);

      // Update tan score
      const newScore = Math.min(100, currentScore + gain);
      await saveTanScore({ score: newScore, lastUpdated: now.toISOString() });

      currentScore = newScore;
    } catch (e) {
      console.warn('Save session failed:', e.message);
    }

    modal.classList.add('hidden');
    await loadData();
  });
}

function setModalSpf(spf) {
  document.querySelectorAll('#spf-options .spf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.spf === spf);
  });
}
