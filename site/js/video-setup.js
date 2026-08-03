// Dedicated video/YouTube setup page. Accepts an HLS stream, a UniFi camera
// share, or a YouTube video/playlist URL — previews it and mints a board code
// (Settings → Live Video / YouTube → Enter code). The code merges ONLY the
// Live Video block — never the rest of the board's config.

import { WORKER_URL } from './env.js';
import { encodeVideoCode } from './config.js';
import { isCameraShare, isHlsUrl, isYouTubeUrl, youtubeEmbedUrl } from './widgets/iptv.js';

const $ = (sel) => document.querySelector(sel);
const STREAM_RE = /^https:\/\/\S+$/i;

const urlInput = $('#vs-url');
const status = $('#vs-status');
const video = $('#vs-video');
let hls = null;

function currentUrl() {
  const u = urlInput.value.trim();
  return STREAM_RE.test(u) ? u : '';
}

function refresh() {
  const u = urlInput.value.trim();
  $('#vs-getcode').disabled = !currentUrl();
  $('#vs-code').hidden = true; // an edited link stales any shown code
  const bad = u && !STREAM_RE.test(u);
  status.textContent = bad ? 'Must be an https link (HLS stream, camera share, or YouTube URL).' : '';
  status.className = bad ? 'hint ps-bad' : 'hint';
}
urlInput.addEventListener('input', refresh);
refresh();

async function preview() {
  const url = currentUrl();
  if (!url) { refresh(); return; }
  const frame = document.getElementById('vs-frame');

  if (isYouTubeUrl(url)) {
    video.hidden = true;
    hls?.destroy();
    hls = null;
    const embedUrl = youtubeEmbedUrl(url);
    if (!embedUrl) {
      status.textContent = "Couldn't parse that YouTube URL. Try a youtube.com/watch or youtu.be link.";
      status.className = 'hint ps-bad';
      return;
    }
    frame.innerHTML = `<iframe src="${embedUrl.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media" style="width:100%;height:240px;border:0;border-radius:12px;background:#000"></iframe>`;
    frame.hidden = false;
    status.textContent = 'YouTube preview — the board will play this muted and looping.';
    status.className = 'hint ps-ok';
    return;
  }

  if (isCameraShare(url)) {
    // UniFi's own player in an iframe — nothing for hls.js to do.
    video.hidden = true;
    frame.innerHTML = `<iframe src="${url.replace(/"/g, '&quot;')}" allow="autoplay" style="width:100%;height:240px;border:0;border-radius:12px;background:#000"></iframe>`;
    frame.hidden = false;
    status.textContent = "If UniFi's player appears and plays, the board will show the same thing.";
    status.className = 'hint';
    return;
  }
  frame.hidden = true;
  hls?.destroy();
  hls = null;
  video.hidden = false;
  status.textContent = 'Loading preview…';
  status.className = 'hint';
  const ok = () => { status.textContent = '✓ Playing.'; status.className = 'hint ps-ok'; };
  const bad = () => {
    status.textContent = "Couldn't play it here. If the stream is network-restricted it may still work on your board.";
    status.className = 'hint ps-bad';
  };
  // Progressive video (go2rtc stream.mp4, direct .mp4) or native HLS (Safari):
  // straight into the <video> element, no hls.js.
  if (!isHlsUrl(url) || video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.onplaying = ok;
    video.onerror = bad;
    video.play().catch(bad);
    return;
  }
  try {
    await import('./vendor/hls.light.min.js');
    if (!window.Hls?.isSupported()) { bad(); return; }
    hls = new window.Hls({ capLevelToPlayerSize: true, backBufferLength: 90, maxBufferLength: 30 });
    hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) bad(); });
    hls.loadSource(url);
    hls.attachMedia(video);
    video.onplaying = ok;
    video.play?.().catch(() => {});
  } catch {
    bad();
  }
}
$('#vs-preview').addEventListener('click', preview);

async function getCode() {
  const btn = $('#vs-getcode');
  btn.disabled = true;
  btn.textContent = 'Getting code…';
  try {
    const encoded = await encodeVideoCode({ url: currentUrl(), label: $('#vs-label').value });
    const res = await fetch(`${WORKER_URL}/code`, { method: 'POST', body: JSON.stringify({ cfg: encoded }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code } = await res.json();
    $('#vs-code-out').textContent = code;
    $('#vs-code-note').textContent = 'On your board, open Settings → Live Video, tap Enter code, and type this in. Press Save. The code expires in 1 hour.';
    $('#vs-code').hidden = false;
    $('#vs-code').scrollIntoView({ block: 'end' });
  } catch (err) {
    $('#vs-code-out').textContent = '—';
    $('#vs-code-note').textContent = `Couldn't reach the code service (${err.message}). Try again in a moment.`;
    $('#vs-code').hidden = false;
  } finally {
    btn.textContent = 'Get board code';
    btn.disabled = !currentUrl();
  }
}
$('#vs-getcode').addEventListener('click', getCode);
