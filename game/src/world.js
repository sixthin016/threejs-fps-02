// FOUNDRY-9: the map. A dusk industrial foundry, 44 x 32 m, two bomb sites — A FURNACE
// (north-west) and B CRANE YARD (north-east) — joined by a conveyor mid lane. Every box is
// a collider for players and bots and a surface a bullet stops on. Plain geometry plus two
// procedural canvas textures; no models, no external files, no network.
//
// The map also owns the bot waypoint graph: nodes at every junction, edges auto-connected
// where a straight walk between two nodes clears every collider footprint. Bots pathfind
// over it with BFS; the graph is small enough that a search is a few microseconds.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const FLOOR_Y = 0;

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2b241c';
  g.fillRect(0, 0, 512, 512);
  // concrete slabs
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  // stains and wear
  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 4 + Math.random() * 26;
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.08})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // painted lane lines
  g.strokeStyle = 'rgba(255,154,60,0.55)';
  g.lineWidth = 5;
  g.setLineDash([26, 18]);
  g.beginPath(); g.moveTo(256, 512); g.lineTo(256, 0); g.stroke();
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function letterTexture(letter, colour) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = colour;
  g.font = '900 190px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = 0.85;
  g.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: name === 'hairline' || name === 'rust' ? 0.25 : 0.03,
    });
  }
  const glowA = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3a1c05'), emissive: new THREE.Color('#ff7a18'),
    emissiveIntensity: 2.2, roughness: 0.6,
  });
  const glowB = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#06231f'), emissive: new THREE.Color('#2fd8bd'),
    emissiveIntensity: 1.4, roughness: 0.6,
  });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material ?? materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (opts.ry) mesh.rotation.y = opts.ry;
    group.add(mesh);
    if (!opts.noCollide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rt, rb, h, x, y, z, material, segments = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // ---- floor ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44.4, 32.4),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push(new THREE.Box3(new THREE.Vector3(-22.2, -0.4, -16.2), new THREE.Vector3(22.2, 0, 16.2)));

  // ---- perimeter walls (h 5) ----
  box(44.4, 5, 0.6, 0, 2.5, -16.2, 'surface');
  box(44.4, 5, 0.6, 0, 2.5, 16.2, 'surface');
  box(0.6, 5, 32.4, -22.2, 2.5, 0, 'surface');
  box(0.6, 5, 32.4, 22.2, 2.5, 0, 'surface');

  // ---- cross walls with door gaps: one at z=-4, one at z=+5 ----
  // north cross wall (z=-4): gaps at x -14..-10, -2..2, 10..14
  for (const [cx, w] of [[-19, 6], [-6, 8], [6, 8], [19, 6]]) box(w, 3.4, 0.6, cx, 1.7, -4, 'hairline');
  // south cross wall (z=+5): gaps at x -12..-8, -2..2, 8..12
  for (const [cx, w] of [[-18, 8], [-5, 6], [5, 6], [18, 8]]) box(w, 3.4, 0.6, cx, 1.7, 5, 'hairline');

  // ---- Site A: FURNACE (north-west), a glowing furnace block + chimney ----
  box(7, 4.2, 1, -14, 2.1, -14.6, 'rust'); // back wall of the furnace
  box(3.4, 2.6, 1.6, -14, 1.3, -13.2, 'hairline', { material: glowA }); // furnace mouth
  cylinder(0.7, 0.9, 7, -16.5, 3.5, -14.8, 'hairline'); // smokestack
  cylinder(0.7, 0.9, 7, -11.5, 3.5, -14.8, 'hairline');
  box(2.2, 1.1, 2.2, -18, 0.55, -10, 'rust'); // crate stack A
  box(2.2, 1.1, 2.2, -18, 1.65, -10, 'rust');
  box(1.2, 1.1, 3.4, -9.5, 0.55, -11, 'hairline'); // low cover A
  // site letter decal on the floor
  const decalA = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4),
    new THREE.MeshBasicMaterial({ map: letterTexture('A', '#ff9a3c'), transparent: true, opacity: 0.5, depthWrite: false }),
  );
  decalA.rotation.x = -Math.PI / 2;
  decalA.position.set(-14, 0.02, -10);
  group.add(decalA);

  // ---- Site B: CRANE YARD (north-east), containers + overhead crane beam ----
  box(4.6, 2.6, 1.4, 14, 1.3, -14.6, 'rust'); // container row
  box(4.6, 2.6, 1.4, 18.6, 1.3, -12.4, 'hairline');
  box(2.4, 1.2, 2.4, 10.5, 0.6, -10.5, 'rust');
  box(2.4, 1.2, 2.4, 10.5, 1.8, -10.5, 'hairline');
  box(1.2, 1.1, 3.4, 17.5, 0.55, -8.5, 'hairline'); // low cover B
  box(12, 0.7, 1.1, 14, 4.6, -12, 'hairline'); // crane beam overhead
  box(0.8, 4.6, 0.8, 8.6, 2.3, -12, 'rust'); // crane legs
  box(0.8, 4.6, 0.8, 19.4, 2.3, -12, 'rust');
  const decalB = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4),
    new THREE.MeshBasicMaterial({ map: letterTexture('B', '#37c8ab'), transparent: true, opacity: 0.5, depthWrite: false }),
  );
  decalB.rotation.x = -Math.PI / 2;
  decalB.position.set(14, 0.02, -10);
  group.add(decalB);

  // ---- Mid: CONVEYOR lane ----
  box(1.6, 1.0, 9, 0, 0.5, 0, 'rust'); // conveyor belt block
  box(1.6, 0.25, 9, 0, 1.12, 0, 'hairline'); // belt top
  box(2.2, 1.1, 2.2, -5, 0.55, 0.5, 'hairline'); // mid crates west
  box(2.2, 1.1, 2.2, 5, 0.55, -0.5, 'hairline'); // mid crates east
  box(1.2, 2.8, 1.2, -3.4, 1.4, -1.5, 'surface'); // pillar
  box(1.2, 2.8, 1.2, 3.4, 1.4, 1.5, 'surface');
  box(6, 0.5, 2.2, 0, 0.25, 8.6, 'surface'); // raised platform south mid
  box(1.2, 1.1, 1.2, -8, 0.55, 8.6, 'rust');
  box(1.2, 1.1, 1.2, 8, 0.55, 8.6, 'rust');

  // ---- extra cover in lanes ----
  box(2.4, 1.1, 1.2, -13, 0.55, 1.5, 'hairline');
  box(2.4, 1.1, 1.2, 13, 0.55, -1.5, 'hairline');
  box(1.2, 1.1, 2.6, -17, 0.55, 4.5, 'rust');
  box(1.2, 1.1, 2.6, 17, 0.55, 4.5, 'rust');

  // ---- distant silhouettes outside the walls (no collide) ----
  for (const [x, z, h] of [[-26, -20, 12], [-30, -8, 15], [28, -18, 11], [30, 6, 14], [-28, 14, 10]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, h, 10), materials.hairline);
    stack.position.set(x, h / 2, z);
    group.add(stack);
  }

  // ---- lights: dusk sun, furnace glow, yard teal, sky fill ----
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8a7a66'), new THREE.Color('#191410'), 0.85));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.4);
  sun.position.set(18, 22, 14);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const furnaceLight = new THREE.PointLight(new THREE.Color('#ff7a18'), 60, 22, 1.8);
  furnaceLight.position.set(-14, 2.2, -12.4);
  scene.add(furnaceLight);
  const yardLight = new THREE.PointLight(new THREE.Color('#2fd8bd'), 28, 18, 1.8);
  yardLight.position.set(14, 3, -11);
  scene.add(yardLight);
  const midLight = new THREE.PointLight(new THREE.Color('#ffb066'), 16, 14, 1.8);
  midLight.position.set(0, 3.4, 2);
  scene.add(midLight);

  // ---- sites, spawns, waypoints ----
  const sites = {
    A: { x: -14, z: -10, r: 3.4, name: 'FURNACE' },
    B: { x: 14, z: -10, r: 3.4, name: 'CRANE YARD' },
  };
  const spawns = {
    sable: [[-4, 13.5], [-1.5, 14], [1.5, 14], [4, 13.5], [0, 12]],
    ember: [[-4, -13.5], [-1.5, -14], [1.5, -14], [4, -13.5], [0, -12]],
  };

  const nodeCoords = [
    [0, 13], [-6, 11], [6, 11], [-11, 8], [0, 8], [11, 8],
    [-16, 4], [-9, 3], [0, 3], [9, 3], [16, 4],
    [-18, -1], [-11, -1], [-3, -1], [3, -1], [11, -1], [18, -1],
    [-14, -6.5], [-6, -7], [0, -7.5], [6, -7], [14, -6.5],
    [-14, -10], [14, -10], [0, -12], [-6, -13], [6, -13], [0, -14.5],
  ];
  // 2D segment vs collider-footprint test (ignore floor + tall stacks by y range)
  function blocked2D(ax, az, bx, bz) {
    for (const c of colliders) {
      if (c.max.y < 0.5) continue; // floor slab
      if (c.min.y > 2.6) continue; // overhead crane beam
      // segment vs AABB in xz, with 0.45 m clearance
      const minX = c.min.x - 0.45, maxX = c.max.x + 0.45;
      const minZ = c.min.z - 0.45, maxZ = c.max.z + 0.45;
      const dx = bx - ax, dz = bz - az;
      let t0 = 0, t1 = 1;
      for (const [p, q, lo, hi] of [[-dx, ax - minX, minX, maxX], [dx, maxX - ax, minX, maxX], [-dz, az - minZ, minZ, maxZ], [dz, maxZ - az, minZ, maxZ]]) {
        if (Math.abs(p) < 1e-9) { if (q < 0) return true; }
        else {
          const t = q / p;
          if (p < 0) { if (t > t1) return true; if (t > t0) t0 = t; }
          else { if (t < t0) return true; if (t < t1) t1 = t; }
        }
      }
      if (t0 <= t1) return true;
    }
    return false;
  }
  const nodes = nodeCoords.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 9.5 && !blocked2D(a.x, a.z, b.x, b.z)) {
        a.links.push({ to: j, cost: d });
        b.links.push({ to: i, cost: d });
      }
    }
  }
  function nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (const n of nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }
  function findPath(sx, sz, tx, tz) {
    const start = nearestNode(sx, sz);
    const goal = nearestNode(tx, tz);
    if (start === goal) return [{ x: tx, z: tz }];
    // BFS over the graph (uniform enough: edges are short hops)
    const prev = new Array(nodes.length).fill(-1);
    const seen = new Array(nodes.length).fill(false);
    const queue = [start];
    seen[start] = true;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const edge of nodes[cur].links) {
        if (!seen[edge.to]) { seen[edge.to] = true; prev[edge.to] = cur; queue.push(edge.to); }
      }
    }
    if (!seen[goal]) return [{ x: tx, z: tz }];
    const path = [];
    let cur = goal;
    while (cur !== -1) { path.push({ x: nodes[cur].x, z: nodes[cur].z }); cur = prev[cur]; }
    path.reverse();
    path.push({ x: tx, z: tz });
    return path;
  }
  function hasLineOfSight(ax, ay, az, bx, by, bz) {
    // cheap 2D check: any collider footprint between the two points, tall enough to block
    for (const c of colliders) {
      if (c.max.y < Math.min(ay, by) - 0.1) continue;
      if (c.min.y > Math.max(ay, by) + 0.1) continue;
      if (c.max.y < 0.5) continue;
      const minX = c.min.x, maxX = c.max.x, minZ = c.min.z, maxZ = c.max.z;
      const dx = bx - ax, dz = bz - az;
      let t0 = 0, t1 = 1;
      let hit = true;
      for (const [p, q] of [[-dx, ax - minX], [dx, maxX - ax], [-dz, az - minZ], [dz, maxZ - az]]) {
        if (Math.abs(p) < 1e-9) { if (q < 0) { hit = false; break; } }
        else {
          const t = q / p;
          if (p < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; }
          else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
        }
      }
      if (hit && t0 <= t1) return false;
    }
    return true;
  }

  return { colliders, shootables, group, sites, spawns, nodes, nearestNode, findPath, hasLineOfSight, FLOOR_Y };
}
