// Rounds: the match state machine. Buy phase, live round, round end, next round — first
// to 5 takes the match (9 rounds max). The economy is Counter-Strike-style: kills pay,
// wins pay more than losses, and the buy menu spends it between rounds. SABLE defends,
// EMBER attacks with the spike; the round is won by elimination, detonation or defuse.
import * as THREE from 'three';

export const BUY_TIME = 8;
export const ROUND_TIME = 100;
export const END_TIME = 4.5;
export const FUSE_TIME = 40;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export const SHOP = [
  { id: 'vk47', name: 'VK-47 RIFLE', price: 2700, blurb: 'Reliable. 30 rounds, accurate when still.' },
  { id: 'raptor', name: 'RAPTOR SMG', price: 1500, blurb: 'Fast. 32 rounds, close quarters.' },
  { id: 'longshot', name: 'LONGSHOT DMR', price: 4750, blurb: 'One shot, one kill. 5 rounds, scoped.' },
  { id: 'armor', name: 'KEVLAR VEST', price: 650, blurb: 'Absorbs half of each hit until it breaks.' },
];

export function createRounds(scene, world, deps) {
  const { audio, rng } = deps;
  // the spike: a small orange case with a blinking light, shown when dropped or planted
  const spike = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff9a3c'), emissive: new THREE.Color('#ff7a18'), emissiveIntensity: 0.7, roughness: 0.5 }),
  );
  caseMesh.castShadow = true;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2222') }),
  );
  lamp.position.set(0, 0.17, 0);
  spike.add(caseMesh, lamp);
  spike.visible = false;
  scene.add(spike);

  const state = {
    phase: 'buy', // buy | live | end | match
    round: 1,
    scoreSable: 0,
    scoreEmber: 0,
    timer: BUY_TIME,
    money: 800,
    site: 'A',
    bomb: { state: 'carried', site: 'A', x: 0, z: 0, plantedAt: 0, carrierId: null },
    lastReason: '',
    winner: null,
    beepAt: 0,
  };

  function pickSite() {
    return rng() < 0.5 ? 'A' : 'B';
  }

  function startRound(game) {
    state.site = pickSite();
    state.bomb = { state: 'carried', site: state.site, x: 0, z: 0, plantedAt: 0, carrierId: null };
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.lastReason = '';
    spike.visible = false;
    const carrier = game.bots.carrier();
    if (carrier) state.bomb.carrierId = carrier.id;
    game.onRoundStart(state);
  }

  function startMatch(game) {
    state.round = 1;
    state.scoreSable = 0;
    state.scoreEmber = 0;
    state.money = 800;
    state.winner = null;
    startRound(game);
  }

  function endRound(game, winner, reason) {
    if (state.phase === 'end' || state.phase === 'match') return;
    state.phase = 'end';
    state.timer = END_TIME;
    state.lastReason = reason;
    if (winner === 'sable') {
      state.scoreSable += 1;
      state.money += 3250;
      audio.roundWin();
    } else {
      state.scoreEmber += 1;
      state.money += 1900;
      audio.roundLose();
    }
    game.onRoundEnd(state, winner, reason);
    if (state.scoreSable >= WIN_ROUNDS || state.scoreEmber >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'match';
      state.winner = state.scoreSable > state.scoreEmber ? 'sable' : state.scoreEmber > state.scoreSable ? 'ember' : 'draw';
      state.timer = 0;
      game.onMatchEnd(state);
    }
  }

  function step(dt, time, game) {
    if (state.phase === 'match') return;
    state.timer -= dt;
    const bomb = state.bomb;

    if (state.phase === 'buy' && state.timer <= 0) {
      state.phase = 'live';
      state.timer = ROUND_TIME;
      game.onLiveStart(state);
      return;
    }
    if (state.phase === 'end' && state.timer <= 0) {
      state.round += 1;
      startRound(game);
      return;
    }
    if (state.phase !== 'live') return;

    // bomb fuse
    if (bomb.state === 'planted') {
      const left = FUSE_TIME - (time - bomb.plantedAt);
      if (time >= state.beepAt) {
        audio.beep();
        state.beepAt = time + Math.max(0.25, left / 40);
      }
      lamp.material.color.setHex(Math.floor(time * 4) % 2 === 0 ? 0xff2222 : 0x661111);
      if (left <= 0) {
        endRound(game, 'ember', 'Spike detonated');
        return;
      }
    }
    // round timer
    if (state.timer <= 0) {
      endRound(game, bomb.state === 'planted' ? 'ember' : 'sable', bomb.state === 'planted' ? 'Time expired with the spike live' : 'Time expired — site held');
      return;
    }
    // elimination
    const sableAlive = game.bots.aliveCount('sable') + (game.playerAlive ? 1 : 0);
    const emberAlive = game.bots.aliveCount('ember');
    if (emberAlive === 0) {
      endRound(game, 'sable', bomb.state === 'planted' ? 'Squad eliminated after the plant' : 'Squad eliminated');
      return;
    }
    if (sableAlive === 0) {
      endRound(game, 'ember', 'Squad eliminated');
      return;
    }
    // dropped spike pickup: an EMBER bot walking over it takes it
    if (bomb.state === 'dropped') {
      spike.visible = true;
      spike.position.set(bomb.x, 0.15, bomb.z);
      for (const bot of game.bots.list) {
        if (!bot.alive || bot.team !== 'ember') continue;
        const d = Math.hypot(bot.mover.state.position.x - bomb.x, bot.mover.state.position.z - bomb.z);
        if (d < 1.4) {
          bomb.state = 'carried';
          bomb.carrierId = bot.id;
          bot.role = 'carrier';
          spike.visible = false;
          game.onPickup(bot);
          break;
        }
      }
    }
  }

  return {
    state,
    shop: SHOP,
    startMatch,
    startRound,
    endRound,
    step,
    buy(id) {
      const item = SHOP.find((s) => s.id === id);
      if (!item || state.phase !== 'buy') return false;
      if (state.money < item.price) return false;
      state.money -= item.price;
      return true;
    },
    awardKill() {
      state.money += 300;
    },
    awardPlant() {
      state.money += 300;
    },
    onPlant(bot, time) {
      const bomb = state.bomb;
      bomb.state = 'planted';
      bomb.plantedAt = time;
      bomb.x = bot.mover.state.position.x;
      bomb.z = bot.mover.state.position.z;
      spike.visible = true;
      spike.position.set(bomb.x, 0.15, bomb.z);
      audio.plant();
    },
    onDefuse(bot) {
      state.bomb.state = 'gone';
      spike.visible = false;
      audio.defuse();
    },
    onCarrierDeath(bot) {
      if (state.bomb.state !== 'carried') return;
      state.bomb.state = 'dropped';
      state.bomb.x = bot.mover.state.position.x;
      state.bomb.z = bot.mover.state.position.z;
      state.bomb.carrierId = null;
      spike.visible = true;
      spike.position.set(state.bomb.x, 0.15, state.bomb.z);
    },
    spikeMesh() {
      return spike;
    },
  };
}
