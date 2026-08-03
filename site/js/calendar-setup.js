// Phone-side calendar setup page. Lets the user paste up to 3 iCal feed URLs
// (webcal:// or https://) and an optional label, then mints a '~C~' board code
// the user types in Settings → Calendar → Enter code.

import { WORKER_URL } from './env.js';
import { encodeCalendarCode } from './config.js';

const $ = (sel) => document.querySelector(sel);

const ICAL_RE = /^(https?|webcal):\/\/\S+$/i;
const MAX_FEEDS = 3;

let feeds = []; // [{url, label}]

function renderFeeds() {
  const list = $('#cs-feed-list');
  list.innerHTML = feeds.map((f, i) => `
    <div class="field" style="margin-bottom:12px">
      <label style="display:block;margin-bottom:4px">Calendar URL</label>
      <div class="ziprow">
        <input type="url" maxlength="500" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"
          placeholder="webcal://… or https://…" value="${f.url.replace(/"/g, '&quot;')}" data-feed-url="${i}">
        <button class="btn btn--ghost" data-rm="${i}" type="button">Remove</button>
      </div>
      <label style="display:block;margin-top:8px;margin-bottom:4px">Label (optional)</label>
      <input type="text" maxlength="40" placeholder="e.g. Team Calendar" value="${f.label.replace(/"/g, '&quot;')}" data-feed-label="${i}">
    </div>`).join('');

  list.querySelectorAll('[data-feed-url]').forEach((el) =>
    el.addEventListener('input', () => {
      feeds[Number(el.dataset.feedUrl)].url = el.value.trim();
      refresh();
    }));
  list.querySelectorAll('[data-feed-label]').forEach((el) =>
    el.addEventListener('input', () => {
      feeds[Number(el.dataset.feedLabel)].label = el.value.trim();
    }));
  list.querySelectorAll('[data-rm]').forEach((el) =>
    el.addEventListener('click', () => {
      feeds.splice(Number(el.dataset.rm), 1);
      renderFeeds();
      refresh();
    }));

  $('#cs-add').hidden = feeds.length >= MAX_FEEDS;
  $('#cs-limit').hidden = feeds.length < MAX_FEEDS;
}

function refresh() {
  const valid = feeds.filter((f) => ICAL_RE.test(f.url));
  $('#cs-getcode').disabled = valid.length === 0;
  $('#cs-code').hidden = true;
}

$('#cs-add').addEventListener('click', () => {
  if (feeds.length < MAX_FEEDS) {
    feeds.push({ url: '', label: '' });
    renderFeeds();
    refresh();
    // Focus the new URL input
    const inputs = document.querySelectorAll('[data-feed-url]');
    inputs[inputs.length - 1]?.focus();
  }
});

// Start with one empty feed slot
feeds.push({ url: '', label: '' });
renderFeeds();
refresh();

async function getCode() {
  const btn = $('#cs-getcode');
  btn.disabled = true;
  btn.textContent = 'Getting code…';
  try {
    const validFeeds = feeds.filter((f) => ICAL_RE.test(f.url));
    const encoded = await encodeCalendarCode({ feeds: validFeeds });
    const res = await fetch(`${WORKER_URL}/code`, {
      method: 'POST',
      body: JSON.stringify({ cfg: encoded }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code } = await res.json();
    $('#cs-code-out').textContent = code;
    $('#cs-code-note').textContent = 'On your board, open Settings → Calendar, tap Enter code, and type this in. Press Save. The code expires in 1 hour.';
    $('#cs-code').hidden = false;
    $('#cs-code').scrollIntoView({ block: 'end' });
  } catch (err) {
    $('#cs-code-out').textContent = '—';
    $('#cs-code-note').textContent = `Couldn't reach the code service (${err.message}). Try again in a moment.`;
    $('#cs-code').hidden = false;
  } finally {
    btn.textContent = 'Get board code';
    btn.disabled = feeds.filter((f) => ICAL_RE.test(f.url)).length === 0;
  }
}
$('#cs-getcode').addEventListener('click', getCode);
