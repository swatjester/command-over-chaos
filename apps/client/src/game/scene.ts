/**
 * Three.js isometric scene — M1.2.
 * Ortho camera at classic iso pitch, middle-drag yaw; map from sim data;
 * capsule soldiers, tracers, grenades in flight, smoke clouds, explosions,
 * queued-waypoint paths. World units: meters (sim mm / 1000).
 */
import * as THREE from "three";
import type {
  Boom, GrenadeSnapshot, ShotEvent, SmokeSnapshot, SoldierSnapshot,
} from "@coc/protocol";
import { ACTIVE_MAP, TICK_RATE } from "@coc/sim";

const CAM_PITCH = Math.atan(1 / Math.SQRT2); // classic 2:1 iso pitch

export interface EffectsData {
  grenades: GrenadeSnapshot[];
  smokes: SmokeSnapshot[];
  booms: Boom[];
  tick: number;
}

export interface SceneApi {
  updateSoldiers(soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedIds: number[]): void;
  addShotEvents(shots: ShotEvent[]): void;
  updateEffects(fx: EffectsData): void;
  onGroundClick(cb: (xMm: number, yMm: number, shift: boolean) => void): void;
  onGroundLeftClick(cb: (xMm: number, yMm: number) => void): void;
  onSoldierClick(cb: (id: number) => void): void;
  onAttack(cb: (targetId: number) => void): void;
  onHover(cb: (targetId: number | null, screenX: number, screenY: number) => void): void;
  setCursor(style: string | null): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151a);
  scene.fog = new THREE.Fog(0x11151a, 160, 320);

  // --- camera ---------------------------------------------------------------
  const MAP_W = ACTIVE_MAP.w / 1000;
  const MAP_H = ACTIVE_MAP.h / 1000;
  const camera = new THREE.OrthographicCamera();
  const camTarget = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  let viewSize = 55;
  let yaw = Math.PI / 4;
  function layoutCamera(): void {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
    camera.near = -200;
    camera.far = 500;
    const r = 120;
    camera.position.set(
      camTarget.x + r * Math.cos(yaw),
      r * Math.sin(CAM_PITCH) * Math.SQRT2,
      camTarget.z + r * Math.sin(yaw),
    );
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  // --- lights ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x223311, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(60, 80, 20);
  sun.castShadow = true;
  sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // --- map from sim data (what you see is what collides) ---------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W, MAP_H),
    new THREE.MeshStandardMaterial({ color: 0x445142, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(MAP_W / 2, 0, MAP_H / 2);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  const grid = new THREE.GridHelper(Math.max(MAP_W, MAP_H), Math.max(MAP_W, MAP_H) / 5, 0x2a3138, 0x232a30);
  grid.position.set(MAP_W / 2, 0.01, MAP_H / 2);
  scene.add(grid);

  const KIND_MATS = {
    wall: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.85 }),
    hay: new THREE.MeshStandardMaterial({ color: 0xc2a24e, roughness: 1.0 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x6d5136, roughness: 0.95 }),
    shed: new THREE.MeshStandardMaterial({ color: 0x5f5648, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1.0 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3e5f34, roughness: 1.0 }),
  } as const;
  for (const o of ACTIVE_MAP.obstacles) {
    const w = o.w / 1000, d = o.h / 1000, ht = o.ht / 1000;
    const cx = o.x / 1000 + w / 2, cz = o.y / 1000 + d / 2;
    if (o.kind === "tree") {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 8), KIND_MATS.trunk);
      trunk.position.set(cx, 1.1, cz);
      trunk.castShadow = true;
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), KIND_MATS.leaf);
      leaves.position.set(cx, 3.1, cz);
      leaves.scale.y = 0.85;
      leaves.castShadow = true;
      scene.add(trunk, leaves);
      continue;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), KIND_MATS[o.kind]);
    m.position.set(cx, ht / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // --- soldiers ---------------------------------------------------------------
  const soldierGroup = new THREE.Group();
  scene.add(soldierGroup);
  const soldierMeshes = new Map<number, THREE.Group>();
  const TEAM_COLORS = [0x4da3ff, 0xff9e4d] as const;
  let mySet = new Set<number>();
  let lastSoldiers = new Map<number, SoldierSnapshot>();
  const pathGroup = new THREE.Group();
  scene.add(pathGroup);

  function makeSoldier(team: 0 | 1, mine: boolean): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: TEAM_COLORS[team],
      roughness: 0.6,
      emissive: mine ? TEAM_COLORS[team] : 0x000000,
      emissiveIntensity: mine ? 0.12 : 0,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 1.2, 12), bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), bodyMat);
    head.position.y = 1.62;
    head.castShadow = true;
    // figure subgroup leans out of cover when peeking (ring stays put)
    const figure = new THREE.Group();
    figure.name = "figure";
    figure.add(body, head);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.name = "selection";
    g.add(figure, ring);
    g.userData.bodyMat = bodyMat;
    g.userData.lean = new THREE.Vector3(0, 0, 0);
    return g;
  }

  // last-known-position ghosts (the CoC red diamond): an enemy that breaks
  // LOS leaves a marker where you last saw them, fading after a few seconds
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xd6484f, transparent: true, opacity: 0.85 });
  const ghosts = new Map<number, { mesh: THREE.Mesh; age: number }>();
  const GHOST_TTL = 10; // seconds

  function updateSoldiers(
    soldiers: SoldierSnapshot[], mySoldierIds: number[], selectedIds: number[],
  ): void {
    mySet = new Set(mySoldierIds);
    const selSet = new Set(selectedIds);
    const prev = lastSoldiers;
    lastSoldiers = new Map(soldiers.map((s) => [s.id, s]));
    const seen = new Set<number>();
    // rebuild queued-path lines for selected own soldiers
    pathGroup.clear();
    for (const s of soldiers) {
      seen.add(s.id);
      let g = soldierMeshes.get(s.id);
      if (!g) {
        g = makeSoldier(s.team, mySet.has(s.id));
        g.userData.soldierId = s.id;
        soldierMeshes.set(s.id, g);
        soldierGroup.add(g);
        g.position.set(s.x / 1000, 0, s.y / 1000);
      }
      g.userData.target = new THREE.Vector3(s.x / 1000, 0, s.y / 1000);
      (g.userData.lean as THREE.Vector3).set(s.leanX / 1000, 0, s.leanY / 1000);
      const ring = g.getObjectByName("selection") as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = selSet.has(s.id) && s.alive ? 0.9 : 0;
      if (!s.alive && !g.userData.dead) {
        g.userData.dead = true;
        const mat = g.userData.bodyMat as THREE.MeshStandardMaterial;
        mat.color.multiplyScalar(0.25);
        mat.emissiveIntensity = 0;
        g.scale.y = 0.18;
      } else if (s.alive) {
        g.scale.y = s.stance === "prone" ? 0.45 : s.stance === "crouch" ? 0.72 : 1;
      }
      // waypoint path for selected own soldiers
      if (selSet.has(s.id) && mySet.has(s.id) && s.alive && s.tx !== null && s.ty !== null) {
        const pts = [
          new THREE.Vector3(s.x / 1000, 0.15, s.y / 1000),
          new THREE.Vector3(s.tx / 1000, 0.15, s.ty / 1000),
          ...s.queue.map(([qx, qy]) => new THREE.Vector3(qx / 1000, 0.15, qy / 1000)),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.45 }),
        );
        pathGroup.add(line);
      }
    }
    for (const [id, g] of soldierMeshes) {
      g.visible = seen.has(id) || mySet.has(id);
    }
    // ghost lifecycle: enemy alive last frame, gone this frame -> marker;
    // reappears -> marker cleared
    for (const [id, last] of prev) {
      if (mySet.has(id) || !last.alive || seen.has(id)) continue;
      if (!ghosts.has(id)) {
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), ghostMat.clone());
        mesh.scale.y = 0.25;
        mesh.position.set(last.x / 1000, 0.12, last.y / 1000);
        scene.add(mesh);
        ghosts.set(id, { mesh, age: 0 });
      }
    }
    for (const [id, gh] of ghosts) {
      if (seen.has(id)) {
        scene.remove(gh.mesh);
        ghosts.delete(id);
      }
    }
  }

  // --- tracers ----------------------------------------------------------------
  const tracers: Array<{ line: THREE.Line; ttl: number; max: number }> = [];
  function addShotEvents(shots: ShotEvent[]): void {
    for (const e of shots) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(e.sx / 1000, 1.3, e.sy / 1000),
        new THREE.Vector3(e.tx / 1000, 1.1, e.ty / 1000),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: e.kill ? 0xff5544 : e.hit ? 0xffd27d : 0x8fa3b8,
        transparent: true,
        opacity: 0.9,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      tracers.push({ line, ttl: 0.25, max: 0.25 });
    }
  }

  // --- grenades, smoke, explosions ---------------------------------------------
  const grenadeMeshes = new Map<number, THREE.Mesh>();
  const smokeMeshes = new Map<number, THREE.Group>();
  const booms: Array<{ ring: THREE.Mesh; ttl: number; max: number }> = [];
  const fragMat = new THREE.MeshStandardMaterial({ color: 0x2f3a2a, roughness: 0.6 });
  const smokeGrenMat = new THREE.MeshStandardMaterial({ color: 0x7a8894, roughness: 0.6 });
  const smokeCloudMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc0, transparent: true, opacity: 0.55, depthWrite: false });
  let fx: EffectsData = { grenades: [], smokes: [], booms: [], tick: 0 };
  let fxTime = 0;

  function updateEffects(data: EffectsData): void {
    fx = data;
    fxTime = performance.now();
    // explosions
    for (const b of data.booms) {
      if (b.kind === "frag") {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.3, 1.0, 24),
          new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(b.x / 1000, 0.1, b.y / 1000);
        scene.add(ring);
        booms.push({ ring, ttl: 0.5, max: 0.5 });
      }
    }
    // smoke clouds: create/update/remove keyed by id
    const liveSmoke = new Set(data.smokes.map((c) => c.id));
    for (const [id, g] of smokeMeshes) {
      if (!liveSmoke.has(id)) {
        scene.remove(g);
        smokeMeshes.delete(id);
      }
    }
    for (const c of data.smokes) {
      let g = smokeMeshes.get(c.id);
      if (!g) {
        g = new THREE.Group();
        const r = c.r / 1000;
        for (let i = 0; i < 5; i++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(r * (0.5 + (i % 3) * 0.18), 10, 8), smokeCloudMat);
          const a = (i / 5) * Math.PI * 2;
          puff.position.set(Math.cos(a) * r * 0.45, 1.0 + (i % 2) * 0.8, Math.sin(a) * r * 0.45);
          g.add(puff);
        }
        g.position.set(c.x / 1000, 0, c.y / 1000);
        scene.add(g);
        smokeMeshes.set(c.id, g);
      }
      // fade out over the last 5 seconds
      const fade = Math.min(1, c.ttl / (5 * TICK_RATE));
      g.traverse((m) => {
        if (m instanceof THREE.Mesh) (m.material as THREE.MeshLambertMaterial).opacity = 0.55 * fade;
      });
    }
    // grenade meshes lifecycle
    const liveG = new Set(data.grenades.map((g) => g.id));
    for (const [id, m] of grenadeMeshes) {
      if (!liveG.has(id)) {
        scene.remove(m);
        grenadeMeshes.delete(id);
      }
    }
    for (const g of data.grenades) {
      if (!grenadeMeshes.has(g.id)) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), g.kind === "frag" ? fragMat : smokeGrenMat);
        scene.add(m);
        grenadeMeshes.set(g.id, m);
      }
    }
  }

  // --- picking / hover -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  let groundCb: ((x: number, y: number, shift: boolean) => void) | null = null;
  let groundLeftCb: ((x: number, y: number) => void) | null = null;
  let soldierCb: ((id: number) => void) | null = null;
  let attackCb: ((id: number) => void) | null = null;
  let hoverCb: ((id: number | null, sx: number, sy: number) => void) | null = null;
  let forcedCursor: string | null = null;

  function ndcFrom(e: PointerEvent): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function raycastSoldier(e: PointerEvent): number | null {
    raycaster.setFromCamera(ndcFrom(e), camera);
    const hits = raycaster.intersectObjects(soldierGroup.children, true);
    for (const h of hits) {
      const id = h.object.parent?.userData.soldierId as number | undefined;
      if (id !== undefined && soldierMeshes.get(id)?.visible) return id;
    }
    return null;
  }

  function raycastGround(e: PointerEvent): [number, number] | null {
    raycaster.setFromCamera(ndcFrom(e), camera);
    const hit = raycaster.intersectObject(ground, false)[0];
    if (!hit) return null;
    return [Math.round(hit.point.x * 1000), Math.round(hit.point.z * 1000)];
  }

  function pick(e: PointerEvent): void {
    const id = raycastSoldier(e);
    if (e.button === 0) {
      if (id !== null && mySet.has(id) && lastSoldiers.get(id)?.alive) {
        soldierCb?.(id);
        return;
      }
      const g = raycastGround(e);
      if (g && groundLeftCb) groundLeftCb(g[0], g[1]);
      return;
    }
    if (e.button === 2) {
      if (id !== null && !mySet.has(id) && lastSoldiers.get(id)?.alive) {
        attackCb?.(id);
        return;
      }
      const g = raycastGround(e);
      if (g && groundCb) groundCb(g[0], g[1], e.shiftKey);
    }
  }

  // --- input -----------------------------------------------------------------
  let rotating = false;
  let lastRotX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      rotating = true;
      lastRotX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    } else {
      pick(e);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (rotating) {
      yaw += (e.clientX - lastRotX) * 0.008;
      lastRotX = e.clientX;
      layoutCamera();
      return;
    }
    const id = raycastSoldier(e);
    const hostile = id !== null && !mySet.has(id) && lastSoldiers.get(id)?.alive;
    canvas.style.cursor = forcedCursor ?? (hostile ? "crosshair" : "default");
    hoverCb?.(hostile ? id : null, e.clientX, e.clientY);
  });
  const endRotate = (e: PointerEvent): void => {
    if (e.button === 1) rotating = false;
  };
  canvas.addEventListener("pointerup", endRotate);
  canvas.addEventListener("pointercancel", endRotate);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener("wheel", (e) => {
    viewSize = Math.min(95, Math.max(12, viewSize + Math.sign(e.deltaY) * 4));
    layoutCamera();
  }, { passive: true });

  // --- render loop --------------------------------------------------------------
  let disposed = false;
  const clock = new THREE.Clock();
  function frame(): void {
    if (disposed) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const pan = 35 * dt;
    if (keys.has("w")) { camTarget.x -= pan * Math.cos(yaw); camTarget.z -= pan * Math.sin(yaw); }
    if (keys.has("s")) { camTarget.x += pan * Math.cos(yaw); camTarget.z += pan * Math.sin(yaw); }
    if (keys.has("a")) { camTarget.x -= pan * Math.sin(yaw); camTarget.z += pan * Math.cos(yaw); }
    if (keys.has("d")) { camTarget.x += pan * Math.sin(yaw); camTarget.z -= pan * Math.cos(yaw); }
    layoutCamera();

    for (const g of soldierMeshes.values()) {
      const t = g.userData.target as THREE.Vector3 | undefined;
      if (t) g.position.lerp(t, Math.min(1, dt * 12));
      const fig = g.getObjectByName("figure");
      const lean = g.userData.lean as THREE.Vector3 | undefined;
      if (fig && lean) fig.position.lerp(lean, Math.min(1, dt * 10)); // lean out / tuck back
    }

    // grenades in flight: interpolate along arc using extrapolated sim tick
    const simTick = fx.tick + ((performance.now() - fxTime) / 1000) * TICK_RATE;
    for (const g of fx.grenades) {
      const m = grenadeMeshes.get(g.id);
      if (!m) continue;
      const t = Math.min(1, Math.max(0, (simTick - g.thrownTick) / Math.max(1, g.landTick - g.thrownTick)));
      const x = g.sx / 1000 + (g.x / 1000 - g.sx / 1000) * t;
      const z = g.sy / 1000 + (g.y / 1000 - g.sy / 1000) * t;
      m.position.set(x, 1.2 + 10 * t * (1 - t), z);
    }

    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i]!;
      tr.ttl -= dt;
      if (tr.ttl <= 0) {
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        tracers.splice(i, 1);
      } else {
        (tr.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (tr.ttl / tr.max);
      }
    }
    for (const [id, gh] of ghosts) {
      gh.age += dt;
      if (gh.age > GHOST_TTL) {
        scene.remove(gh.mesh);
        ghosts.delete(id);
      } else {
        const m = gh.mesh.material as THREE.MeshBasicMaterial;
        m.opacity = gh.age < GHOST_TTL - 3 ? 0.85 : 0.85 * ((GHOST_TTL - gh.age) / 3);
        gh.mesh.rotation.y += dt * 1.5; // slow spin reads as "stale intel"
      }
    }
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i]!;
      b.ttl -= dt;
      if (b.ttl <= 0) {
        scene.remove(b.ring);
        booms.splice(i, 1);
      } else {
        const p = 1 - b.ttl / b.max;
        b.ring.scale.setScalar(1 + p * 6);
        (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - p);
      }
    }

    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * devicePixelRatio || canvas.height !== h * devicePixelRatio) {
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(devicePixelRatio);
    }
    renderer.render(scene, camera);
  }
  layoutCamera();
  frame();

  return {
    updateSoldiers,
    addShotEvents,
    updateEffects,
    onGroundClick: (cb) => { groundCb = cb; },
    onGroundLeftClick: (cb) => { groundLeftCb = cb; },
    onSoldierClick: (cb) => { soldierCb = cb; },
    onAttack: (cb) => { attackCb = cb; },
    onHover: (cb) => { hoverCb = cb; },
    setCursor: (style) => { forcedCursor = style; },
    dispose: () => { disposed = true; renderer.dispose(); },
  };
}
