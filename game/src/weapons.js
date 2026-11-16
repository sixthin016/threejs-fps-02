// The arsenal: four hitscan weapons with distinct roles, prices and feel. The weapon owns
// its numbers, its view model and its firing rhythm; main.js owns the ray and the damage.
// Every weapon is a box-built model on the camera — no imported meshes, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 SIDEARM', price: 0, mag: 12, reserve: 48,
    damage: 26, headMult: 3, fireGap: 0.16, reloadTime: 1.3, auto: false,
    spreadStill: 0.004, spreadMove: 0.02, range: 60, zoom: 1,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 RIFLE', price: 2700, mag: 30, reserve: 90,
    damage: 34, headMult: 4, fireGap: 0.096, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, range: 90, zoom: 1,
  },
  raptor: {
    id: 'raptor', name: 'RAPTOR SMG', price: 1500, mag: 32, reserve: 128,
    damage: 22, headMult: 3, fireGap: 0.062, reloadTime: 1.6, auto: true,
    spreadStill: 0.006, spreadMove: 0.034, range: 55, zoom: 1,
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT DMR', price: 4750, mag: 5, reserve: 20,
    damage: 92, headMult: 2.2, fireGap: 0.85, reloadTime: 2.6, auto: false,
    spreadStill: 0.0006, spreadMove: 0.05, range: 120, zoom: 2.4,
  },
};

const ORDER = ['p9', 'vk47', 'raptor', 'longshot'];

function buildModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    model.add(m);
    return m;
  };
  if (def.id === 'p9') {
    add(0.07, 0.09, 0.24, 0, 0, -0.1, light);
    add(0.06, 0.12, 0.08, 0, -0.08, 0.02, dark);
    add(0.02, 0.03, 0.05, 0, 0.055, -0.2, accent);
  } else if (def.id === 'vk47') {
    add(0.09, 0.1, 0.46, 0, 0, -0.1, light);
    add(0.045, 0.045, 0.42, 0, 0.028, -0.42, dark);
    add(0.075, 0.08, 0.24, 0, -0.02, 0.3, dark);
    add(0.06, 0.14, 0.07, 0, -0.1, -0.05, dark); // grip + mag
    add(0.03, 0.04, 0.1, 0, 0.06, -0.28, accent); // sight
  } else if (def.id === 'raptor') {
    add(0.08, 0.09, 0.34, 0, 0, -0.08, dark);
    add(0.04, 0.04, 0.3, 0, 0.02, -0.3, light);
    add(0.06, 0.16, 0.06, 0, -0.1, -0.02, light);
    add(0.07, 0.07, 0.14, 0, -0.015, 0.22, accent);
  } else {
    add(0.08, 0.09, 0.62, 0, 0, -0.16, dark);
    add(0.04, 0.04, 0.5, 0, 0.03, -0.5, light);
    add(0.07, 0.07, 0.2, 0, -0.02, 0.24, dark);
    add(0.05, 0.05, 0.16, 0, 0.075, -0.2, accent); // scope
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const id of ORDER) {
    models[id] = buildModel(WEAPONS[id]);
    models[id].visible = false;
    camera.add(models[id]);
  }
  // muzzle flash: a soft radial glow on a small plane, not a hard card
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fg = flashCanvas.getContext('2d');
  const grad = fg.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,154,60,0.9)');
  grad.addColorStop(1, 'rgba(255,154,60,0)');
  fg.fillStyle = grad;
  fg.fillRect(0, 0, 64, 64);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const owned = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
  const state = {
    current: 'p9', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    switchLeft: 0, bobPhase: 0, bobAmp: 0,
  };
  models.p9.visible = true;

  function currentDef() {
    return WEAPONS[state.current];
  }
  function currentAmmo() {
    return owned[state.current];
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bobPhase += dt * (4 + moving * 1.6);
    state.bobAmp += ((moving > 0.3 ? 1 : 0) - state.bobAmp) * Math.min(1, dt * 8);
    const model = models[state.current];
    const bobY = Math.sin(state.bobPhase * 2) * 0.008 * state.bobAmp;
    const bobX = Math.cos(state.bobPhase) * 0.006 * state.bobAmp;
    model.position.set(0.24 + bobX, -0.2 + bobY, -0.42 + state.kick);
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = currentDef();
      model.rotation.x = -0.55 * Math.sin(Math.PI * (1 - state.reloadLeft / def.reloadTime));
      if (state.reloadLeft === 0) {
        const ammo = currentAmmo();
        const need = def.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
    if (state.switchLeft > 0) {
      model.position.y = -0.2 - 0.16 * Math.sin(Math.PI * (state.switchLeft / 0.32));
    }
    flash.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    defs: WEAPONS,
    order: ORDER,
    current() {
      return currentDef();
    },
    ammo() {
      return currentAmmo();
    },
    owned(id) {
      return !!owned[id];
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    equip(id) {
      if (!owned[id] || state.current === id || state.reloadLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.switchLeft = 0.32;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    step,
    ready() {
      return currentAmmo().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      state.cooldown = currentDef().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const ammo = currentAmmo();
      if (ammo.mag <= 0) return false;
      ammo.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      const ammo = currentAmmo();
      if (state.reloadLeft > 0 || ammo.mag === def.mag || ammo.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
    },
    spread(speed) {
      const def = currentDef();
      return def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMove;
    },
    refill() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    muzzleWorld(out) {
      // muzzle tip in world space, for tracers
      const model = models[state.current];
      out.set(0.24, -0.16, -0.95);
      return camera.localToWorld(out);
    },
  };
}
