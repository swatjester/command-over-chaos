/**
 * Three.js isometric scene — M1.2.
 * Ortho camera at classic iso pitch, middle-drag yaw; map from sim data;
 * capsule soldiers, tracers, grenades in flight, smoke clouds, explosions,
 * queued-waypoint paths. World units: meters (sim mm / 1000).
 */
import * as THREE from "three";
import type {
  Boom, GrenadeSnapshot, ShotEvent, SmokeSnapshot, SoldierSnapshot, ZoneSnapshot,
} from "@coc/protocol";
import { ACTIVE_MAP, TICK_RATE, VAULT_TICKS } from "@coc/sim";

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
  updateZones(zones: ZoneSnapshot[]): void;
  /** grenade-armed UI: range rings around throwers (null clears) */
  setThrowRanges(data: { kind: "frag" | "smoke"; rings: Array<{ x: number; y: number; r: number }> } | null): void;
  onGroundClick(cb: (xMm: number, yMm: number, shift: boolean) => void): void;
  onGroundLeftClick(cb: (xMm: number, yMm: number) => void): void;
  onSoldierClick(cb: (id: number) => void): void;
  onAttack(cb: (targetId: number) => void): void;
  onAid(cb: (allyId: number) => void): void;
  onHover(cb: (targetId: number | null, screenX: number, screenY: number) => void): void;
  onMarquee(cb: (ids: number[]) => void): void;
  setCursor(style: string | null): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151a);
  scene.fog = new THREE.Fog(0x11151a, 320, 800);

  // --- camera ---------------------------------------------------------------
  const MAP_W = ACTIVE_MAP.w / 1000;
  const MAP_H = ACTIVE_MAP.h / 1000;
  const camera = new THREE.OrthographicCamera();
  const camTarget = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  let viewSize = 70;
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
  sun.position.set(MAP_W / 2 + 80, 110, MAP_H / 2 + 30);
  sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
  sun.castShadow = true;
  const shadowR = Math.max(MAP_W, MAP_H) * 0.62;
  sun.shadow.camera.left = -shadowR; sun.shadow.camera.right = shadowR;
  sun.shadow.camera.top = shadowR; sun.shadow.camera.bottom = -shadowR;
  sun.shadow.mapSize.set(4096, 4096);
  scene.add(sun, sun.target);

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

  // --- enterable buildings: roof slabs + cutaway fading -----------------------
  interface BuildingViz {
    rect: [number, number, number, number];
    mats: THREE.Material[];
    roofMats: THREE.Material[];
    meshes: THREE.Object3D[];
    fade: number;
    hovered: boolean;
  }
  const buildings: BuildingViz[] = (ACTIVE_MAP.buildings ?? []).map((b) => ({
    rect: [b.x - 300, b.y - 300, b.x + b.w + 300, b.y + b.h + 300],
    mats: [], roofMats: [], meshes: [], fade: 1, hovered: false,
  }));
  const buildingMeshes: THREE.Object3D[] = []; // raycast targets for hover reveal
  function buildingAt(xMm: number, yMm: number): BuildingViz | null {
    for (const b of buildings) {
      if (xMm > b.rect[0] && xMm < b.rect[2] && yMm > b.rect[1] && yMm < b.rect[3]) return b;
    }
    return null;
  }

  // ground decals (parking lot gravel etc.) — under everything else
  const PATCH_COLORS = { gravel: 0x6f6a60, dirt: 0x6b5a43 } as const;
  for (const pt of ACTIVE_MAP.patches ?? []) {
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(pt.w / 1000, pt.h / 1000),
      new THREE.MeshStandardMaterial({ color: PATCH_COLORS[pt.kind], roughness: 1.0 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(pt.x / 1000 + pt.w / 2000, 0.015, pt.y / 1000 + pt.h / 2000);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  const KIND_MATS = {
    wall: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.85 }),
    hay: new THREE.MeshStandardMaterial({ color: 0xc2a24e, roughness: 1.0 }),
    fence: new THREE.MeshStandardMaterial({ color: 0x6d5136, roughness: 0.95 }),
    shed: new THREE.MeshStandardMaterial({ color: 0x5f5648, roughness: 0.9 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1.0 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x3e5f34, roughness: 1.0 }),
    truck: new THREE.MeshStandardMaterial({ color: 0x4a5340, roughness: 0.6, metalness: 0.2 }),
    car: new THREE.MeshStandardMaterial({ color: 0x5a6a75, roughness: 0.5, metalness: 0.3 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 1.0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2d3f4d, roughness: 0.2, metalness: 0.4 }),
  } as const;
  for (const o of ACTIVE_MAP.obstacles) {
    const w = o.w / 1000, d = o.h / 1000, ht = o.ht / 1000;
    const cx = o.x / 1000 + w / 2, cz = o.y / 1000 + d / 2;
    // building walls get their own material clone so the whole structure
    // can fade for the interior cutaway
    const bviz = o.ht > 1200 || o.kind === "window" ? buildingAt(o.x + o.w / 2, o.y + o.h / 2) : null;
    const bmat = (base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      if (!bviz) return base;
      const m = base.clone();
      m.transparent = true;
      bviz.mats.push(m);
      return m;
    };
    if (o.kind === "window") {
      // sill + lintel with an open firing gap between
      const wm = bmat(KIND_MATS.wall);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), wm);
      sill.position.set(cx, 0.5, cz);
      sill.castShadow = true;
      sill.receiveShadow = true;
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), wm);
      lintel.position.set(cx, 2.45, cz);
      lintel.castShadow = true;
      scene.add(sill, lintel);
      if (bviz) {
        sill.userData.bviz = bviz; lintel.userData.bviz = bviz;
        bviz.meshes.push(sill, lintel);
        buildingMeshes.push(sill, lintel);
      }
      continue;
    }
    if (o.kind === "truck" || o.kind === "car") {
      // vehicles: body + cab/cabin along the long axis
      const along = w >= d; // long axis is x?
      const L = along ? w : d, W2 = along ? d : w;
      const bodyH = o.kind === "truck" ? 1.3 : 0.8;
      const topH = o.kind === "truck" ? 1.3 : 0.6;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), KIND_MATS[o.kind]);
      body.position.set(cx, bodyH / 2 + 0.25, cz);
      body.castShadow = true;
      body.receiveShadow = true;
      // top box: truck = cargo bed cover on the rear 60%; car = cabin middle 55%
      const topL = L * (o.kind === "truck" ? 0.55 : 0.55);
      const topOff = o.kind === "truck" ? -L * 0.18 : 0;
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(along ? topL : W2 * 0.9, topH, along ? W2 * 0.9 : topL),
        o.kind === "truck" ? KIND_MATS.truck : KIND_MATS.glass,
      );
      top.position.set(cx + (along ? topOff : 0), bodyH + 0.25 + topH / 2, cz + (along ? 0 : topOff));
      top.castShadow = true;
      // four tire hints
      for (const [tx, tz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as Array<[number, number]>) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.25, 10), KIND_MATS.tire);
        tire.rotation.z = Math.PI / 2;
        tire.rotation.y = along ? 0 : Math.PI / 2;
        tire.position.set(cx + tx * (along ? L : W2) * 0.3, 0.28, cz + tz * (along ? W2 : L) * (along ? 0.45 : 0.3));
        scene.add(tire);
      }
      scene.add(body, top);
      continue;
    }
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
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), bmat(KIND_MATS[o.kind]));
    m.position.set(cx, ht / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (bviz) {
      m.userData.bviz = bviz;
      bviz.meshes.push(m);
      buildingMeshes.push(m);
    }
  }
  // roof slabs (fade out when anyone you can see is inside)
  for (const b of ACTIVE_MAP.buildings ?? []) {
    const viz = buildingAt(b.x + b.w / 2, b.y + b.h / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x46413a, roughness: 0.9, transparent: true });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w / 1000 + 0.4, 0.22, b.h / 1000 + 0.4), mat);
    roof.position.set(b.x / 1000 + b.w / 2000, 3.12, b.y / 1000 + b.h / 2000);
    roof.castShadow = true;
    scene.add(roof);
    if (viz) {
      viz.roofMats.push(mat);
      roof.userData.bviz = viz;
      viz.meshes.push(roof);
      buildingMeshes.push(roof);
    }
  }

  // --- victory-point zones: ground ring + flag ---------------------------------
  const ZONE_NEUTRAL = 0x8b98a5;
  const ZONE_TEAM = [0x4da3ff, 0xff9e4d] as const;
  interface ZoneViz {
    ring: THREE.MeshBasicMaterial;
    flagL: THREE.MeshBasicMaterial;
    flagR: THREE.MeshBasicMaterial;
    contested: boolean;
    capping: number; // -1 or capping team
  }
  const zoneViz: ZoneViz[] = [];
  function makeLabel(text: string): THREE.Sprite {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 96;
    const ctx = cv.getContext("2d")!;
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#0d1218";
    ctx.lineWidth = 8;
    ctx.strokeText(text, 256, 48);
    ctx.fillStyle = "#dfe7ee";
    ctx.fillText(text, 256, 48);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 }));
    sp.scale.set(13, 2.4, 1);
    return sp;
  }
  for (const z of ACTIVE_MAP.zones ?? []) {
    const zx = z.x / 1000, zz = z.y / 1000, zr = z.r / 1000;
    const ringMat = new THREE.MeshBasicMaterial({ color: ZONE_NEUTRAL, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(zr - 0.35, zr, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(zx, 0.04, zz);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 5.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.7 }),
    );
    pole.position.set(zx, 2.6, zz);
    pole.castShadow = true;
    // flag: two half-panels so a contested flag splits blue/orange
    const flagLMat = new THREE.MeshBasicMaterial({ color: ZONE_NEUTRAL, side: THREE.DoubleSide });
    const flagRMat = new THREE.MeshBasicMaterial({ color: ZONE_NEUTRAL, side: THREE.DoubleSide });
    const flagL = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.85), flagLMat);
    const flagR = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.85), flagRMat);
    flagL.position.set(zx + 0.47, 4.6, zz);
    flagR.position.set(zx + 1.27, 4.6, zz);
    const label = makeLabel(z.name);
    label.position.set(zx, 6.8, zz);
    scene.add(ring, pole, flagL, flagR, label);
    zoneViz.push({ ring: ringMat, flagL: flagLMat, flagR: flagRMat, contested: false, capping: -1 });
  }

  function updateZones(zones: ZoneSnapshot[]): void {
    for (let i = 0; i < zones.length && i < zoneViz.length; i++) {
      const z = zones[i]!;
      const v = zoneViz[i]!;
      v.contested = z.contested;
      v.capping = z.capTeam;
      const ownerColor = z.owner >= 0 ? ZONE_TEAM[z.owner as 0 | 1] : ZONE_NEUTRAL;
      if (z.contested) {
        v.flagL.color.setHex(ZONE_TEAM[0]);
        v.flagR.color.setHex(ZONE_TEAM[1]);
        v.ring.color.setHex(0xffffff);
      } else {
        v.flagL.color.setHex(ownerColor);
        v.flagR.color.setHex(ownerColor);
        v.ring.color.setHex(z.capTeam >= 0 ? ZONE_TEAM[z.capTeam as 0 | 1] : ownerColor);
      }
    }
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
    g.userData.baseEmissive = { color: bodyMat.emissive.getHex(), intensity: bodyMat.emissiveIntensity };
    g.userData.flash = 0;
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
      if (s.vaultT > 0) {
        // climb animation: glide from takeoff to landing with a hop arc
        const prog = (VAULT_TICKS - s.vaultT) / VAULT_TICKS;
        const vx = s.x / 1000 + (s.vaultX / 1000 - s.x / 1000) * prog;
        const vz = s.y / 1000 + (s.vaultY / 1000 - s.y / 1000) * prog;
        g.userData.target = new THREE.Vector3(vx, Math.sin(Math.PI * prog) * 0.75, vz);
      } else {
        g.userData.target = new THREE.Vector3(s.x / 1000, 0, s.y / 1000);
      }
      (g.userData.lean as THREE.Vector3).set(s.leanX / 1000, 0, s.leanY / 1000);
      const ring = g.getObjectByName("selection") as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = selSet.has(s.id) && s.alive ? 0.9 : 0;
      if (!s.alive && !g.userData.dead) {
        g.userData.dead = true;
        const mat = g.userData.bodyMat as THREE.MeshStandardMaterial;
        mat.color.multiplyScalar(0.25);
        mat.emissiveIntensity = 0;
        g.scale.y = 0.18;
      } else if (s.alive && s.down) {
        g.scale.y = 0.28; // downed: flat but not gone — revivable
      } else if (s.alive) {
        const base = s.stance === "prone" ? 0.45 : s.stance === "crouch" ? 0.72 : 1;
        // peeking over cover: rise toward crouch height while aiming
        g.scale.y = s.peekUp && base < 0.72 ? 0.72 : base;
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
    // cutaway: fade any building that someone you can see is inside
    const occupied = new Set<BuildingViz>();
    for (const s of soldiers) {
      if (!s.alive) continue;
      const b = buildingAt(s.x, s.y);
      if (b) occupied.add(b);
    }
    for (const b of buildings) b.fade = occupied.has(b) ? 1 : 0;
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

  // --- gunfire readability (I-004): fat tracers, muzzle flash, damage flash ---
  const tracers: Array<{ mesh: THREE.Mesh; ttl: number; max: number }> = [];
  const flashes: Array<{ mesh: THREE.Mesh; ttl: number; max: number }> = [];
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 });
  function addShotEvents(shots: ShotEvent[]): void {
    for (const e of shots) {
      const a = new THREE.Vector3(e.sx / 1000, 1.3, e.sy / 1000);
      const b = new THREE.Vector3(e.tx / 1000, 1.1, e.ty / 1000);
      const len = a.distanceTo(b);
      // beam: a thin stretched box reads at any zoom (Line is 1px)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, len),
        new THREE.MeshBasicMaterial({
          color: e.kill ? 0xff5544 : e.hit ? 0xffc46b : 0xaebccb,
          transparent: true,
          opacity: e.hit ? 0.95 : 0.75,
        }),
      );
      mesh.position.copy(a).lerp(b, 0.5);
      mesh.lookAt(b);
      scene.add(mesh);
      tracers.push({ mesh, ttl: e.hit ? 0.42 : 0.34, max: e.hit ? 0.42 : 0.34 });
      // muzzle flash at the shooter
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flashMat.clone());
      fl.position.copy(a);
      scene.add(fl);
      flashes.push({ mesh: fl, ttl: 0.09, max: 0.09 });
      // damage flash on the victim (if rendered)
      if (e.hit) {
        const tg = soldierMeshes.get(e.target);
        if (tg) tg.userData.flash = 0.35;
      }
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

  // --- grenade range rings (Q/E armed) -----------------------------------------
  const throwGroup = new THREE.Group();
  scene.add(throwGroup);
  function setThrowRanges(data: { kind: "frag" | "smoke"; rings: Array<{ x: number; y: number; r: number }> } | null): void {
    throwGroup.clear();
    if (!data) return;
    const color = data.kind === "frag" ? 0xe6935a : 0x7db8e6;
    for (const rg of data.rings) {
      const r = rg.r / 1000;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.25, r, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(rg.x / 1000, 0.06, rg.y / 1000);
      throwGroup.add(ring);
      // faint fill so the reachable area reads at a glance
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(r, 64),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }),
      );
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(rg.x / 1000, 0.055, rg.y / 1000);
      throwGroup.add(fill);
    }
  }

  // --- picking / hover -----------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  let groundCb: ((x: number, y: number, shift: boolean) => void) | null = null;
  let groundLeftCb: ((x: number, y: number) => void) | null = null;
  let soldierCb: ((id: number) => void) | null = null;
  let attackCb: ((id: number) => void) | null = null;
  let aidCb: ((id: number) => void) | null = null;
  let hoverCb: ((id: number | null, sx: number, sy: number) => void) | null = null;
  let marqueeCb: ((ids: number[]) => void) | null = null;
  let forcedCursor: string | null = null;

  // marquee (click-drag box select) state + overlay
  let marqueeStart: [number, number] | null = null;
  let marqueeActive = false;
  const marqueeDiv = document.createElement("div");
  marqueeDiv.style.cssText =
    "position:fixed;border:1px solid #4da3ff;background:#4da3ff22;pointer-events:none;display:none;z-index:5;";
  document.body.appendChild(marqueeDiv);

  function marqueeRect(ex: number, ey: number): [number, number, number, number] {
    const [sx, sy] = marqueeStart!;
    return [Math.min(sx, ex), Math.min(sy, ey), Math.max(sx, ex), Math.max(sy, ey)];
  }

  function soldiersInRect(x1: number, y1: number, x2: number, y2: number): number[] {
    const rect = canvas.getBoundingClientRect();
    const ids: number[] = [];
    const v = new THREE.Vector3();
    for (const [id, snap] of lastSoldiers) {
      if (!mySet.has(id) || !snap.alive) continue;
      v.set(snap.x / 1000, 0.8, snap.y / 1000).project(camera);
      const px = rect.left + ((v.x + 1) / 2) * rect.width;
      const py = rect.top + ((1 - v.y) / 2) * rect.height;
      if (px >= x1 && px <= x2 && py >= y1 && py <= y2) ids.push(id);
    }
    return ids;
  }

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
      if (forcedCursor) { // armed (grenade targeting): click = throw
        const g = raycastGround(e);
        if (g && groundLeftCb) groundLeftCb(g[0], g[1]);
        return;
      }
      if (id !== null && mySet.has(id) && lastSoldiers.get(id)?.alive) {
        soldierCb?.(id);
        return;
      }
      // empty ground: begin potential marquee drag
      marqueeStart = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      const snap = id !== null ? lastSoldiers.get(id) : undefined;
      if (id !== null && snap?.alive && !mySet.has(id) && !snap.down) {
        attackCb?.(id);
        return;
      }
      if (id !== null && snap?.alive && snap.down && mySet.has(id)) {
        aidCb?.(id); // right-click your own downed soldier = revive order
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
    if (marqueeStart) {
      const [x1, y1, x2, y2] = marqueeRect(e.clientX, e.clientY);
      if (marqueeActive || Math.abs(x2 - x1) + Math.abs(y2 - y1) > 6) {
        marqueeActive = true;
        marqueeDiv.style.display = "block";
        marqueeDiv.style.left = `${x1}px`;
        marqueeDiv.style.top = `${y1}px`;
        marqueeDiv.style.width = `${x2 - x1}px`;
        marqueeDiv.style.height = `${y2 - y1}px`;
      }
      return;
    }
    const id = raycastSoldier(e);
    const hsnap = id !== null ? lastSoldiers.get(id) : undefined;
    const hostile = id !== null && !mySet.has(id) && hsnap?.alive && !hsnap.down;
    canvas.style.cursor = forcedCursor ?? (hostile ? "crosshair" : "default");
    hoverCb?.(hostile ? id : null, e.clientX, e.clientY);
    // hover a building: reveal it (roof + walls go transparent)
    raycaster.setFromCamera(ndcFrom(e), camera);
    const bHit = raycaster.intersectObjects(buildingMeshes, false)[0];
    const hoveredViz = (bHit?.object.userData.bviz as BuildingViz | undefined) ?? null;
    for (const b of buildings) b.hovered = b === hoveredViz;
  });
  const endRotate = (e: PointerEvent): void => {
    if (e.button === 1) rotating = false;
    if (e.button === 0 && marqueeStart) {
      if (marqueeActive) {
        const ids = soldiersInRect(...marqueeRect(e.clientX, e.clientY));
        if (ids.length > 0) marqueeCb?.(ids);
      }
      marqueeStart = null;
      marqueeActive = false;
      marqueeDiv.style.display = "none";
    }
  };
  canvas.addEventListener("pointerup", endRotate);
  canvas.addEventListener("pointercancel", endRotate);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener("wheel", (e) => {
    viewSize = Math.min(175, Math.max(12, viewSize + Math.sign(e.deltaY) * 6));
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
        scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        (tr.mesh.material as THREE.Material).dispose();
        tracers.splice(i, 1);
      } else {
        (tr.mesh.material as THREE.MeshBasicMaterial).opacity *= Math.max(0, tr.ttl / tr.max);
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i]!;
      fl.ttl -= dt;
      if (fl.ttl <= 0) {
        scene.remove(fl.mesh);
        fl.mesh.geometry.dispose();
        (fl.mesh.material as THREE.Material).dispose();
        flashes.splice(i, 1);
      } else {
        const p = fl.ttl / fl.max;
        fl.mesh.scale.setScalar(0.6 + (1 - p) * 1.4);
        (fl.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * p;
      }
    }
    // damage flash: victims light up red for a beat
    for (const g of soldierMeshes.values()) {
      const f = g.userData.flash as number;
      const mat = g.userData.bodyMat as THREE.MeshStandardMaterial;
      const base = g.userData.baseEmissive as { color: number; intensity: number };
      if (f > 0) {
        g.userData.flash = Math.max(0, f - dt);
        mat.emissive.setHex(0xff2a2a);
        mat.emissiveIntensity = 1.2 * (g.userData.flash / 0.35);
        if (g.userData.flash === 0) {
          mat.emissive.setHex(base.color);
          mat.emissiveIntensity = base.intensity;
        }
      }
    }
    // contested / capturing zone rings pulse
    const pulse = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(performance.now() / 180));
    for (const v of zoneViz) {
      v.ring.opacity = v.contested || v.capping >= 0 ? pulse : 0.28;
    }
    // building cutaway fade (occupied by someone you can see, or hovered)
    for (const b of buildings) {
      const open2 = b.fade === 1 || b.hovered;
      const wallTarget = open2 ? 0.35 : 1;
      const roofTarget = open2 ? 0.1 : 1;
      for (const m of b.mats) {
        const mm = m as THREE.MeshStandardMaterial;
        mm.opacity += (wallTarget - mm.opacity) * Math.min(1, dt * 8);
      }
      for (const m of b.roofMats) {
        const mm = m as THREE.MeshStandardMaterial;
        mm.opacity += (roofTarget - mm.opacity) * Math.min(1, dt * 8);
        mm.visible = mm.opacity > 0.12;
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
    updateZones,
    setThrowRanges,
    onGroundClick: (cb) => { groundCb = cb; },
    onGroundLeftClick: (cb) => { groundLeftCb = cb; },
    onSoldierClick: (cb) => { soldierCb = cb; },
    onAttack: (cb) => { attackCb = cb; },
    onAid: (cb) => { aidCb = cb; },
    onHover: (cb) => { hoverCb = cb; },
    onMarquee: (cb) => { marqueeCb = cb; },
    setCursor: (style) => { forcedCursor = style; },
    dispose: () => { disposed = true; marqueeDiv.remove(); renderer.dispose(); },
  };
}
