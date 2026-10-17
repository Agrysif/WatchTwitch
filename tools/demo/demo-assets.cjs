'use strict';
// Картинки демо-режима: аватарки, награды и «кадр стрима» для плеера.
//
// Всё рисуется здесь же, без сети и без чужих логотипов: на снимках для
// README не должно быть ни настоящих людей, ни настоящих брендов, кроме
// обложек игр, которые и так показывает Twitch.

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name) {
  const parts = String(name).replace(/[_\d]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name).slice(0, 2);
  return letters.toUpperCase();
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

/** Аватарка канала: градиент, пара кругов и инициалы. */
function avatarSvg(name) {
  const h = hash(name);
  const hue = h % 360;
  const hue2 = (hue + 40 + (h >> 9) % 80) % 360;
  const cx = 60 + (h >> 4) % 180;
  const cy = 50 + (h >> 12) % 160;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,58%)"/>
      <stop offset="1" stop-color="hsl(${hue2},65%,34%)"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#g)"/>
  <circle cx="${cx}" cy="${cy}" r="120" fill="#fff" opacity="0.08"/>
  <circle cx="${300 - cx}" cy="${300 - cy / 2}" r="70" fill="#000" opacity="0.10"/>
  <text x="150" y="150" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="112" font-weight="700" fill="#fff" opacity="0.95">${escapeXml(initials(name))}</text>
</svg>`;
}

// Значки наград — простые формы, похожие на предметы из игр
const GLYPHS = {
  crate: '<rect x="44" y="52" width="72" height="60" rx="6" fill="C1"/><rect x="44" y="52" width="72" height="16" rx="6" fill="C2"/><rect x="74" y="52" width="12" height="60" fill="C2"/><rect x="70" y="72" width="20" height="14" rx="3" fill="C3"/>',
  hoodie: '<path d="M60 44 L80 54 L100 44 L124 60 L114 82 L104 76 L104 118 L56 118 L56 76 L46 82 L36 60 Z" fill="C1"/><path d="M68 44 Q80 70 92 44" fill="none" stroke="C2" stroke-width="6"/><rect x="66" y="92" width="28" height="12" rx="4" fill="C2"/>',
  spray: '<rect x="62" y="56" width="36" height="64" rx="8" fill="C1"/><rect x="70" y="42" width="20" height="16" rx="3" fill="C2"/><circle cx="104" cy="44" r="4" fill="C3"/><circle cx="114" cy="38" r="3" fill="C3"/><circle cx="112" cy="52" r="3" fill="C3"/><rect x="62" y="78" width="36" height="14" fill="C2"/>',
  badge: '<path d="M80 34 L118 48 L114 88 Q108 112 80 126 Q52 112 46 88 L42 48 Z" fill="C1"/><path d="M80 58 L86 74 L103 74 L89 84 L95 101 L80 91 L65 101 L71 84 L57 74 L74 74 Z" fill="C3"/>',
  gem: '<path d="M54 62 L68 44 L92 44 L106 62 L80 118 Z" fill="C1"/><path d="M54 62 L106 62 L80 118 Z" fill="C2"/><path d="M68 44 L80 62 L92 44" fill="none" stroke="C3" stroke-width="3"/>',
  banner: '<rect x="48" y="36" width="6" height="90" rx="3" fill="C2"/><path d="M54 40 L118 40 L104 62 L118 84 L54 84 Z" fill="C1"/><circle cx="82" cy="62" r="10" fill="C3"/>',
  door: '<rect x="54" y="36" width="52" height="86" rx="4" fill="C1"/><rect x="62" y="46" width="36" height="28" rx="2" fill="C2"/><rect x="62" y="82" width="36" height="30" rx="2" fill="C2"/><circle cx="96" cy="78" r="4" fill="C3"/>',
  charm: '<circle cx="80" cy="84" r="30" fill="C1"/><circle cx="80" cy="84" r="16" fill="C2"/><path d="M80 54 L80 34" stroke="C3" stroke-width="6" stroke-linecap="round"/><circle cx="80" cy="30" r="7" fill="none" stroke="C3" stroke-width="4"/>',
  emote: '<circle cx="80" cy="80" r="40" fill="C1"/><circle cx="66" cy="70" r="6" fill="C2"/><circle cx="94" cy="70" r="6" fill="C2"/><path d="M60 88 Q80 110 100 88" fill="none" stroke="C2" stroke-width="6" stroke-linecap="round"/>',
  card: '<rect x="48" y="36" width="64" height="88" rx="8" fill="C1"/><circle cx="80" cy="68" r="16" fill="C2"/><rect x="58" y="94" width="44" height="8" rx="4" fill="C2"/><rect x="66" y="108" width="28" height="6" rx="3" fill="C3"/>'
};

/** Картинка награды 160×160: тёмная плитка с градиентом и значок. */
function rewardSvg(kind, seed) {
  const h = hash(seed || kind);
  const hue = h % 360;
  const glyph = (GLYPHS[kind] || GLYPHS.crate)
    .replace(/C1/g, `hsl(${hue},70%,62%)`)
    .replace(/C2/g, `hsl(${(hue + 25) % 360},55%,38%)`)
    .replace(/C3/g, `hsl(${(hue + 180) % 360},85%,72%)`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <radialGradient id="b" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="hsl(${hue},45%,30%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 220) % 360},40%,11%)"/>
    </radialGradient>
  </defs>
  <rect width="160" height="160" rx="24" fill="url(#b)"/>
  <ellipse cx="80" cy="132" rx="46" ry="8" fill="#000" opacity="0.28"/>
  ${glyph}
</svg>`;
}

function svgDataUri(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// Палитры сцен по играм: [небо сверху, небо снизу, дальний план, ближний план, акцент]
const SCENES = {
  wild: { sky: ['#1b2a4a', '#e0895a'], far: '#3b3f5c', near: '#1d2030', accent: '#ffcf7a', sun: true },
  desert: { sky: ['#2c3b52', '#d9a36a'], far: '#6b5a49', near: '#2f2a24', accent: '#ffe0a0', sun: true },
  canyon: { sky: ['#3a1f2e', '#f08a5d'], far: '#7a3b33', near: '#2b1717', accent: '#ffd08a', sun: true },
  city: { sky: ['#120c2c', '#4b1d6b'], far: '#2a1f4d', near: '#110d22', accent: '#ff4fd8', neon: true },
  arena: { sky: ['#0f1d2e', '#2d6f8f'], far: '#24425a', near: '#0d1824', accent: '#ff5a5f', neon: true },
  day: { sky: ['#3f8fd6', '#bfe3ff'], far: '#7aa6c9', near: '#3d5a75', accent: '#ffb347', sun: true },
  space: { sky: ['#05060f', '#1a1440'], far: '#2b2f6e', near: '#0b0c1c', accent: '#5ef0ff', stars: true }
};

/**
 * Страница вместо плеера Twitch: холст с анимированной сценой, отданный в
 * <video> через captureStream. Видео настоящее — у него идёт currentTime,
 * поэтому сторож воспроизведения считает стрим живым. Текста на странице
 * нет: сторож ищет в нём «не в эфире» и «ошибка сети».
 */
function playerHtml(sceneName, seed) {
  const scene = SCENES[sceneName] || SCENES.wild;
  const config = JSON.stringify({ scene, seed: hash(seed || sceneName) % 1000 });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video, canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  canvas { visibility: hidden; }
</style></head>
<body>
<canvas width="1280" height="720"></canvas>
<video muted autoplay playsinline></video>
<script>
(() => {
  const cfg = ${config};
  const S = cfg.scene;
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let seed = cfg.seed + 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const ridge = (count, base, amp) => Array.from({ length: count + 1 }, (_, i) => [i * W / count, base - rnd() * amp]);
  const far = ridge(14, H * 0.62, H * 0.22);
  const near = ridge(9, H * 0.80, H * 0.16);
  const towers = Array.from({ length: 26 }, (_, i) => ({ x: i * W / 26, w: W / 30, h: H * (0.18 + rnd() * 0.42), lit: rnd() }));
  const stars = Array.from({ length: 160 }, () => ({ x: rnd() * W, y: rnd() * H * 0.7, r: rnd() * 1.6 + 0.3, p: rnd() * 6 }));
  const motes = Array.from({ length: 40 }, () => ({ x: rnd() * W, y: rnd() * H, v: 0.2 + rnd() * 0.6 }));

  function poly(points, color, bottom) {
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(W, bottom);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function frame(t) {
    const sec = t / 1000;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, S.sky[0]);
    sky.addColorStop(1, S.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    if (S.stars) {
      stars.forEach(s => {
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(sec * 1.5 + s.p);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc((s.x + sec * 6) % W, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      const px = W * 0.72, py = H * 0.34;
      const planet = ctx.createRadialGradient(px - 50, py - 50, 20, px, py, 150);
      planet.addColorStop(0, S.accent); planet.addColorStop(1, S.far);
      ctx.fillStyle = planet;
      ctx.beginPath(); ctx.arc(px, py, 140, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(px, py, 230, 46, -0.3, 0, Math.PI * 2); ctx.stroke();
    }

    if (S.sun) {
      const sx = W * 0.68, sy = H * 0.46 + Math.sin(sec / 6) * 6;
      const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 260);
      glow.addColorStop(0, S.accent); glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = S.accent;
      ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        const cx = (i * 380 + sec * 18) % (W + 300) - 150;
        ctx.beginPath(); ctx.ellipse(cx, H * 0.18 + i * 26, 120, 18, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    poly(far, S.far, H);

    if (S.neon) {
      towers.forEach((b, i) => {
        const x = b.x, y = H * 0.78 - b.h;
        ctx.fillStyle = S.near;
        ctx.fillRect(x, y, b.w, b.h);
        ctx.fillStyle = S.accent;
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(sec * 2 + i);
        for (let wy = y + 10; wy < H * 0.76; wy += 22) {
          if ((wy + i * 7) % 3 < 1.6) ctx.fillRect(x + 6, wy, b.w - 12, 6);
        }
        ctx.globalAlpha = 1;
      });
    }

    poly(near, S.near, H);

    motes.forEach(m => {
      m.y -= m.v; m.x += Math.sin(sec + m.y / 40) * 0.3;
      if (m.y < 0) { m.y = H; m.x = rnd() * W; }
      ctx.fillStyle = S.accent; ctx.globalAlpha = 0.5;
      ctx.fillRect(m.x, m.y, 2, 2);
    });
    ctx.globalAlpha = 1;

    // Интерфейс игры: прицел, мини-карта, полоски — без надписей и логотипов
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, H / 2); ctx.lineTo(W / 2 - 5, H / 2);
    ctx.moveTo(W / 2 + 5, H / 2); ctx.lineTo(W / 2 + 14, H / 2);
    ctx.moveTo(W / 2, H / 2 - 14); ctx.lineTo(W / 2, H / 2 - 5);
    ctx.moveTo(W / 2, H / 2 + 5); ctx.lineTo(W / 2, H / 2 + 14);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(W - 110, 110, 74, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(W - 110, 110, 74, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(W - 110, 110); ctx.rotate(sec / 8);
    ctx.fillStyle = S.accent;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
    ctx.restore();

    const bars = [[0.82, '#5ee08f'], [0.56, '#5ec8ff']];
    bars.forEach(([v, c], i) => {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(40, H - 70 + i * 22, 260, 12);
      ctx.fillStyle = c;
      ctx.fillRect(40, H - 70 + i * 22, 260 * v, 12);
    });
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i === 1 ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.38)';
      ctx.fillRect(W / 2 - 165 + i * 56, H - 72, 50, 50);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const video = document.querySelector('video');
  video.srcObject = canvas.captureStream(30);
  video.play().catch(() => {});
})();
</script>
</body></html>`;
}

module.exports = { avatarSvg, rewardSvg, svgDataUri, playerHtml, hash };
