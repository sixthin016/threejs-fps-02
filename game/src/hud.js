// The DOM HUD: health, armour, ammo, money, timer, team score, kill feed, round banners,
// a live minimap, the buy menu and the damage direction indicator. It never touches the
// simulation; main.js pushes numbers in and reads the play / buy callbacks out.
const COPY = {
  start: { title: 'SABLE LINE', copy: 'Foundry-9. Five rounds take the match. Hold the sites, stop the spike.', action: 'Deploy' },
  paused: { title: 'SABLE LINE', copy: 'Paused. Click to resume.', action: 'Resume' },
  roundEnd: { title: '', copy: '', action: 'Next round' },
  match: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerLabel = $('timer-label');
  const scoreSable = $('score-sable');
  const scoreEmber = $('score-ember');
  const roundLabel = $('round-label');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const vignette = $('vignette');
  const damageDir = $('damage-dir');
  const plantBar = $('plantbar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');
  const buyMenu = $('buymenu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const toastEl = $('toast');
  let bannerTimer = 0;
  let toastTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp, armor) {
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.classList.toggle('low', hp <= 30);
      healthNum.textContent = String(Math.max(0, Math.round(hp)));
      armorNum.textContent = armor > 0 ? `+${Math.round(armor)}` : '';
    },
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag; lastReserve = reserve; lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(v) { moneyValue.textContent = `$${v.toLocaleString('en-US')}`; },
    setTimer(sec, phase) {
      timerValue.textContent = fmtTime(sec);
      timerValue.classList.toggle('urgent', phase === 'live' && sec <= 10);
      timerLabel.textContent = phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND' : '—';
    },
    setScore(sable, ember, round) {
      scoreSable.textContent = String(sable);
      scoreEmber.textContent = String(ember);
      roundLabel.textContent = `ROUND ${round} / 9`;
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      const hm = $('hitmarker');
      hm.classList.add('on');
      hm.classList.toggle('kill', !!killed);
      clearTimeout(hm._t);
      hm._t = setTimeout(() => hm.classList.remove('on', 'kill'), holdMs);
    },
    damageFrom(angleDeg) {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      damageDir.classList.add('on');
      setTimeout(() => damageDir.classList.remove('on'), 450);
    },
    killfeed(html) {
      const div = document.createElement('div');
      div.className = 'feed-line';
      div.innerHTML = html;
      killfeed.prepend(div);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 600); }, 5200);
    },
    banner(titleText, subText, ms = 2400) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
    },
    setPlant(progress, label) {
      if (progress == null) { plantBar.hidden = true; return; }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    drawMinimap(world, playerPos, playerYaw, bots, bomb) {
      const W = minimap.width, H = minimap.height;
      const sx = W / 46, sz = H / 34;
      const X = (x) => (x + 23) * sx;
      const Z = (z) => (z + 17) * sz;
      mctx.clearRect(0, 0, W, H);
      mctx.fillStyle = 'rgba(20,16,12,0.72)';
      mctx.fillRect(0, 0, W, H);
      // walls
      mctx.fillStyle = 'rgba(242,237,227,0.28)';
      mctx.fillRect(X(-22.2), Z(-16.2), 44.4 * sx, 1.5);
      mctx.fillRect(X(-22.2), Z(16.2) - 1.5, 44.4 * sx, 1.5);
      mctx.fillRect(X(-22.2), Z(-16.2), 1.5, 32.4 * sz);
      mctx.fillRect(X(22.2) - 1.5, Z(-16.2), 1.5, 32.4 * sz);
      // sites
      for (const [key, s] of Object.entries(world.sites)) {
        mctx.beginPath();
        mctx.arc(X(s.x), Z(s.z), s.r * sx, 0, Math.PI * 2);
        mctx.fillStyle = key === 'A' ? 'rgba(255,154,60,0.25)' : 'rgba(55,200,171,0.25)';
        mctx.fill();
        mctx.fillStyle = key === 'A' ? '#ff9a3c' : '#37c8ab';
        mctx.font = 'bold 11px system-ui, sans-serif';
        mctx.textAlign = 'center';
        mctx.fillText(key, X(s.x), Z(s.z) + 4);
      }
      // bomb
      if (bomb.state === 'planted' || bomb.state === 'dropped') {
        mctx.fillStyle = '#ff5a3c';
        mctx.beginPath();
        mctx.arc(X(bomb.x), Z(bomb.z), 4.5, 0, Math.PI * 2);
        mctx.fill();
      }
      // teammates
      for (const bot of bots) {
        if (!bot.alive || bot.team !== 'sable') continue;
        mctx.fillStyle = '#37c8ab';
        mctx.beginPath();
        mctx.arc(X(bot.mover.state.position.x), Z(bot.mover.state.position.z), 3, 0, Math.PI * 2);
        mctx.fill();
      }
      // player arrow
      mctx.save();
      mctx.translate(X(playerPos.x), Z(playerPos.z));
      mctx.rotate(Math.atan2(-Math.sin(playerYaw), -Math.cos(playerYaw)) + Math.PI / 2);
      mctx.fillStyle = '#f2ede3';
      mctx.beginPath();
      mctx.moveTo(0, -6);
      mctx.lineTo(4.5, 5);
      mctx.lineTo(-4.5, 5);
      mctx.closePath();
      mctx.fill();
      mctx.restore();
    },
    buildBuyMenu(shop, money, owned, onBuy) {
      buyItems.innerHTML = '';
      for (const item of shop) {
        const div = document.createElement('div');
        div.className = 'buy-item';
        const isOwned = owned(item.id);
        const afford = money >= item.price;
        div.classList.toggle('owned', isOwned);
        div.classList.toggle('cant', !isOwned && !afford);
        div.innerHTML = `<b>${item.name}</b><span>${item.blurb}</span><i>${isOwned ? 'OWNED' : '$' + item.price.toLocaleString('en-US')}</i>`;
        div.addEventListener('click', () => onBuy(item.id));
        buyItems.appendChild(div);
      }
      buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
    },
    showBuy(open) {
      buyMenu.hidden = !open;
    },
    buyOpen() {
      return !buyMenu.hidden;
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode] || COPY.start;
      title.textContent = data.title ?? text.title;
      copy.textContent = data.copy ?? text.copy;
      play.textContent = data.action ?? text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
