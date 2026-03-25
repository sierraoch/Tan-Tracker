import { FITZPATRICK_TYPES, GOALS } from './tanScore.js';
import { saveProfile } from './api.js';

const SPF_OPTIONS = [
  { id: 'none',  label: 'None',    desc: 'I go bare' },
  { id: 'spf15', label: 'SPF 15',  desc: 'Light protection' },
  { id: 'spf30', label: 'SPF 30',  desc: 'Balanced' },
  { id: 'spf50', label: 'SPF 50+', desc: 'Max protection' },
];

export function startOnboarding(container, onComplete) {
  let step = 0;
  const data = { name: '', fitzpatrickType: null, goal: null, spf: 'spf15' };

  container.classList.remove('hidden');
  container.innerHTML = buildShell();
  renderStep();

  function buildShell() {
    return `
      <div class="ob-dots" id="ob-dots"></div>
      <div id="ob-screens"></div>
    `;
  }

  function renderDots(total, current) {
    const dots = document.getElementById('ob-dots');
    dots.innerHTML = Array.from({ length: total }, (_, i) =>
      `<div class="ob-dot ${i === current ? 'active' : ''}"></div>`
    ).join('');
  }

  function renderStep() {
    renderDots(4, step);
    const screens = document.getElementById('ob-screens');
    const prev = screens.querySelector('.ob-screen.active');
    if (prev) {
      prev.classList.add('exit');
      prev.classList.remove('active');
      setTimeout(() => prev.remove(), 300);
    }

    const el = document.createElement('div');
    el.className = 'ob-screen';
    screens.appendChild(el);

    const steps = [buildStep0, buildStep1, buildStep2, buildStep3];
    steps[step](el);

    requestAnimationFrame(() => el.classList.add('active'));
  }

  // ── Step 0: Name ────────────────────────────────────────────────────
  function buildStep0(el) {
    el.innerHTML = `
      <p class="ob-step">1 of 4</p>
      <h1 class="ob-title">Hey there,<br><em>what's your name?</em></h1>
      <p class="ob-sub">We'll use it to personalize your tan journey.</p>
      <div class="ob-content">
        <input
          class="ob-name-input"
          id="ob-name"
          type="text"
          placeholder="Your first name"
          autocomplete="off"
          autocorrect="off"
          maxlength="30"
          value="${data.name}"
        >
      </div>
      <div class="ob-footer">
        <button class="ob-cta" id="ob-next-0" ${data.name ? '' : 'disabled'}>Continue</button>
      </div>
    `;

    const input = el.querySelector('#ob-name');
    const btn = el.querySelector('#ob-next-0');
    input.addEventListener('input', () => {
      data.name = input.value.trim();
      btn.disabled = !data.name;
    });
    btn.addEventListener('click', () => { step = 1; renderStep(); });
    setTimeout(() => input.focus(), 350);
  }

  // ── Step 1: Fitzpatrick type ──────────────────────────────────────
  function buildStep1(el) {
    const typesHTML = FITZPATRICK_TYPES.map(f => `
      <button class="skin-type-btn ${data.fitzpatrickType === f.type ? 'selected' : ''}" data-type="${f.type}">
        <div class="skin-swatch" style="background:${f.swatch}"></div>
        <div class="skin-info">
          <span class="skin-type-label">${f.label}</span>
          <span class="skin-type-desc">${f.desc}</span>
        </div>
      </button>
    `).join('');

    el.innerHTML = `
      <p class="ob-step">2 of 4</p>
      <h1 class="ob-title">What's your<br><em>skin type?</em></h1>
      <p class="ob-sub">This calibrates how your tan score builds and fades.</p>
      <div class="ob-content">
        <div class="skin-types">${typesHTML}</div>
      </div>
      <div class="ob-footer">
        <button class="ob-cta" id="ob-next-1" ${data.fitzpatrickType ? '' : 'disabled'}>Continue</button>
      </div>
    `;

    el.querySelectorAll('.skin-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        data.fitzpatrickType = parseInt(btn.dataset.type);
        el.querySelectorAll('.skin-type-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        el.querySelector('#ob-next-1').disabled = false;
      });
    });
    el.querySelector('#ob-next-1').addEventListener('click', () => { step = 2; renderStep(); });
  }

  // ── Step 2: Tanning goal ─────────────────────────────────────────
  function buildStep2(el) {
    const goalsHTML = GOALS.map(g => `
      <button class="goal-btn ${data.goal === g.id ? 'selected' : ''}" data-goal="${g.id}">
        <div class="goal-title">${g.label}</div>
        <div class="goal-desc">${g.desc}</div>
      </button>
    `).join('');

    el.innerHTML = `
      <p class="ob-step">3 of 4</p>
      <h1 class="ob-title">What's your<br><em>tanning goal?</em></h1>
      <p class="ob-sub">Sets where your "achieved" marker lands on the progress bar.</p>
      <div class="ob-content">
        <div class="goal-options">${goalsHTML}</div>
      </div>
      <div class="ob-footer">
        <button class="ob-cta" id="ob-next-2" ${data.goal ? '' : 'disabled'}>Continue</button>
      </div>
    `;

    el.querySelectorAll('.goal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        data.goal = btn.dataset.goal;
        el.querySelectorAll('.goal-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        el.querySelector('#ob-next-2').disabled = false;
      });
    });
    el.querySelector('#ob-next-2').addEventListener('click', () => { step = 3; renderStep(); });
  }

  // ── Step 3: Default SPF ─────────────────────────────────────────
  function buildStep3(el) {
    const spfHTML = SPF_OPTIONS.map(s => `
      <button class="spf-btn-ob ${data.spf === s.id ? 'selected' : ''}" data-spf="${s.id}">
        <div style="font-weight:600;margin-bottom:3px">${s.label}</div>
        <div style="font-size:0.72rem;color:var(--text-3)">${s.desc}</div>
      </button>
    `).join('');

    el.innerHTML = `
      <p class="ob-step">4 of 4</p>
      <h1 class="ob-title">What SPF do<br><em>you usually wear?</em></h1>
      <p class="ob-sub">Your default when logging sessions. You can change it per session.</p>
      <div class="ob-content">
        <div class="spf-options-ob">${spfHTML}</div>
      </div>
      <div class="ob-footer">
        <button class="ob-cta" id="ob-finish">Let's go</button>
      </div>
    `;

    el.querySelectorAll('.spf-btn-ob').forEach(btn => {
      btn.addEventListener('click', () => {
        data.spf = btn.dataset.spf;
        el.querySelectorAll('.spf-btn-ob').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    el.querySelector('#ob-finish').addEventListener('click', async () => {
      const profile = {
        name: data.name,
        fitzpatrickType: data.fitzpatrickType,
        goal: data.goal,
        defaultSpf: data.spf,
        createdAt: new Date().toISOString(),
      };
      try {
        await saveProfile(profile);
      } catch (e) {
        console.warn('Could not save profile to KV:', e.message);
        // Store locally as fallback
        localStorage.setItem('tan_profile', JSON.stringify(profile));
      }
      container.classList.add('hidden');
      onComplete(profile);
    });
  }
}
