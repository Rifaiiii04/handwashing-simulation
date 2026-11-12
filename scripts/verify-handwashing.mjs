import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { fsCache: false });
const { HandwashingSequenceController } = await jiti.import('../app/lib/handwashing/controllers/HandwashingSequenceController.ts');
const { HANDWASHING_STAGES } = await jiti.import('../app/lib/handwashing/config/handwashingConfig.ts');
const { evaluateStagePose } = await jiti.import('../app/lib/handwashing/poses/handwashingPoses.ts');
const { HANDWASHING_SECTIONS } = await jiti.import('../app/lib/handwashing/config/handwashingStepsData.ts');

// Run with: node scripts/verify-handwashing.mjs
// Geometry/skeleton checks use the actual GLB. Textures are irrelevant to these
// CPU checks, so this loader plugin avoids requiring browser image APIs in Node.
const data = await readFile(new URL('../public/models/washand.glb', import.meta.url));
const loader = new GLTFLoader();
globalThis.self ??= globalThis;
loader.register(() => ({ name: 'verification-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
async function loadedController(bindRendererParent = true) {
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const controller = new HandwashingSequenceController();
  assert(controller.bindScene(gltf.scene), 'both hand rigs bind');
  assert(controller.state.hasValidSkeleton, 'both hands retain valid skinning');
  for (const name of ['r_hand', 'l_hand', 'R_Hand', 'L_Hand', 'WaterSpawn', 'sink']) {
    assert(gltf.scene.getObjectByName(name), `GLB object ${name} exists`);
  }
  if (bindRendererParent) {
    // Match app.vue -> WaterSystem: first bind the GLB, start from idle, then
    // bind its enclosing Tres scene. This must not recapture posed rest data.
    controller.restart(true);
    const originalRig = controller.getRig();
    const hands = [originalRig.right, originalRig.left];
    const rest = hands.map(hand => ({ position: hand.restPosition.clone(), quaternion: hand.restQuaternion.clone() }));
    const posed = hands.map(hand => ({ position: hand.armature.position.clone(), quaternion: hand.armature.quaternion.clone() }));
    const rendererScene = new THREE.Scene();
    rendererScene.add(gltf.scene);
    rendererScene.updateMatrixWorld(true);
    assert(controller.bindScene(rendererScene));
    assert.equal(controller.getRig(), originalRig, 'binding the renderer parent reuses the same rig');
    hands.forEach((hand, i) => {
      assert(hand.restPosition.equals(rest[i].position), 'parent bind retains anatomical rest position');
      assert(hand.restQuaternion.equals(rest[i].quaternion), 'parent bind retains anatomical rest rotation');
      assert(hand.armature.position.equals(posed[i].position), 'parent bind preserves current pose position');
      assert(hand.armature.quaternion.equals(posed[i].quaternion), 'parent bind preserves current pose rotation');
    });
    controller.pause();
  }
  return controller;
}

function advance(controller, seconds, fps = 60) {
  const frames = Math.floor(seconds * fps + 1e-9);
  for (let i = 0; i < frames; i++) controller.update(1 / fps);
  const tail = seconds - frames / fps;
  if (tail > 1e-9) controller.update(tail);
}

const c = new HandwashingSequenceController();
c.play();
advance(c, c.state.stageDuration * 0.5);
assert.equal(c.state.soapBlobVisible, false, 'approach must not invent soap');
assert.equal(c.state.faucetActive, false);
assert.equal(c.state.particleMode, 'none');
assert.equal(c.state.particleIntensity, 0);
advance(c, c.state.stageDuration * 0.4);
assert.equal(c.state.faucetActive, true);
assert.equal(c.state.particleMode, 'water');
assert(c.state.particleIntensity > 0 && c.state.particleIntensity < c.getCurrentStage().particleIntensity);

c.goToStage('dispenseSoap', true);
advance(c, c.state.stageDuration * 0.42);
assert(c.state.pumpPressProgress > 0, 'pump presses while dispensing');
assert.equal(c.state.soapBlobVisible, true);
assert.equal(c.state.faucetActive, false);
const paused = { ...c.state };
c.pause();
advance(c, 1);
assert.equal(c.state.stageElapsed, paused.stageElapsed);
assert.equal(c.state.pumpPressProgress, paused.pumpPressProgress);
assert.equal(c.state.soapBlobProgress, paused.soapBlobProgress);
c.goToStage('dispenseSoap', false);
c.update(1 / 60);
assert.equal(c.state.soapBlobVisible, false, 'reentering dispenser clears the old soap');

c.goToStage('rubPalms', true);
advance(c, c.state.stageDuration * 0.12);
assert.equal(c.state.soapBlobVisible, true);
advance(c, c.state.stageDuration * 0.15);
assert.equal(c.state.soapBlobVisible, false);
assert(c.state.foamIntensity > .3, 'palmar rubbing builds visible lather on the facing palms');
assert.equal(c.state.particleMode, 'none', 'palmar foam stays attached to the skin without a spray');

// Seeking backwards must also clear lather from a later stage immediately.
for (const stage of HANDWASHING_STAGES.filter(stage => stage.whoStep === 1 && stage.id !== 'rubPalms')) {
  c.goToStage('interlaceFingers', false);
  c.seek(.6);
  c.goToStage(stage.id, false);
  for (const p of [0, .12, .4, .75, 1]) {
    c.seek(p);
    assert.equal(c.state.foamIntensity, 0, `no early foam during ${stage.id} at ${p}`);
    assert.notEqual(c.state.particleMode, 'foam');
  }
}

if (HANDWASHING_STAGES.some(stage => stage.id === 'rubBacksOfHands')) {
  c.goToStage('rubBacksOfHands', true);
  advance(c, 1);
  assert.equal(c.state.whoStep, 2);
  assert.equal(c.state.soapBlobVisible, false);
  assert.equal(c.state.faucetActive, false);
  assert(c.state.foamIntensity > .9, 'the dorsal approach retains the lather already on the palms');
  advance(c, 3.8);
  assert(c.state.foamIntensity > .9, 'lather persists as dorsal rubbing begins');
}
c.goToStage('interlaceFingers', true);
advance(c, 1);
assert.equal(c.state.whoStep, 3, 'palmar interlacing is available as technique three');
assert.equal(c.state.faucetActive, false);
assert.equal(c.state.soapBlobVisible, false);
assert(c.state.foamIntensity > .9, 'step three retains the lather from the preceding techniques');

c.reset();
c.update(1 / 60);
assert.equal(c.state.sequenceProgress, 0);
assert.equal(c.state.soapBlobVisible, false);
assert.equal(c.state.pumpPressProgress, 0);
assert.equal(c.state.foamIntensity, 0);
assert.equal(c.state.faucetActive, false);

const boundary = new HandwashingSequenceController();
boundary.play();
advance(boundary, boundary.state.stageDuration - 0.013);
boundary.update(0.033);
assert.equal(boundary.state.stageIndex, 1);
assert(Math.abs(boundary.state.stageElapsed - 0.020) < 1e-8, 'carry boundary overflow');

for (const fps of [30, 60, 144]) {
  let completions = 0;
  const timed = new HandwashingSequenceController({}, {
    onSequenceComplete() {
      completions++;
      assert.equal(timed.state.sequenceProgress, 1);
    },
  });
  timed.play();
  advance(timed, timed.totalDuration, fps);
  assert.equal(timed.state.isPlaying, false, `completion at ${fps} FPS`);
  assert.equal(timed.state.stageProgress, 1);
  assert.equal(completions, 1);
  advance(timed, 0.5, fps);
  assert.equal(completions, 1);
  timed.reset(true);
  timed.setLoop(true);
  advance(timed, timed.totalDuration + 0.2, fps);
  assert.equal(timed.state.stageIndex, 0);
  assert(Math.abs(timed.state.stageElapsed - 0.2) < 1e-8);
  assert.equal(timed.state.soapBlobVisible, false);
}
console.log('PASS: approach effects, soap/pump timing, palmar lather onset and persistence into dorsal rubbing, pause/reset, overflow, completion and loop at 30/60/144 FPS.');

const mapped = await loadedController();
const rig = mapped.getRig();
const anchors = { pumpStroke: mapped.config.dispenser.pumpStroke, pumpPressProgress: 0 };
const world = bone => bone.getWorldPosition(new THREE.Vector3());

// Measure complete scrub cycles from the authored hand motion, not from a
// particular sine/cadence implementation. Shared arm sway cancels out.
for (const [stageId, start, end, axis] of [
  ['rubPalms', .10, .92, [0, .083618, -.996498]],
  ['rubBacksOfHands', .14, .43, [0, .258819, -.965926]],
  ['rubBacksOfHands', .59, 1, [0, .258819, -.965926]],
  ['interlaceFingers', .352, .9424, [0, .083618, -.996498]],
]) {
  const duration = HANDWASHING_STAGES.find(stage => stage.id === stageId).duration;
  const direction = new THREE.Vector3(...axis), difference = new THREE.Vector3();
  const longitudinal = p => {
    const pose = evaluateStagePose(stageId, p, p * duration, anchors);
    return difference.fromArray(pose.right.palmOffset).sub(new THREE.Vector3(...pose.left.palmOffset)).dot(direction);
  };
  const center = longitudinal(stageId === 'rubBacksOfHands' ? end : 1);
  const crossings = [];
  let previous = longitudinal(start) - center;
  for (let i = 1; i <= 1200; i++) {
    const p = start + (end - start) * i / 1200, value = longitudinal(p) - center;
    if (previous < 0 && value >= 0) crossings.push(p * duration);
    previous = value;
  }
  assert(crossings.length >= 4, `${stageId}: sustained rubbing rather than a few slow gestures`);
  const periods = crossings.slice(1).map((time, i) => time - crossings[i]);
  const frequency = periods.length / periods.reduce((a, b) => a + b, 0);
  assert(frequency > 1.1 && frequency < 2.2, `${stageId}: brisk, controlled rubbing cadence`);
  assert(Math.max(...periods) / Math.min(...periods) > 1.04, `${stageId}: gentle variation between scrub cycles`);
  console.log(`MEASURE: ${stageId} ${start}..${end}, ${frequency.toFixed(2)} complete scrub cycles/second.`);
}
// Measured visible skin extent along each terminal bone's local +Y axis.
// A terminal bone marks the DIP joint, so its origin is not the visible tip.
const visibleFingerTipLocalY = {
  right: [0.45402, 0.43552, 0.41136, 0.37604],
  left: [0.43194, 0.40757, 0.32907, 0.34465],
};
function apply(stage, p) {
  const duration = HANDWASHING_STAGES.find(s => s.id === stage).duration;
  mapped.handAnimator.applyPose(evaluateStagePose(stage, p, p * duration, anchors), 0, 12, 13);
}
function snapshot() {
  return [rig.right, rig.left].flatMap(hand => [
    hand.currentPalmWorld.clone(),
    ...hand.skeleton.bones.map(world),
  ]);
}
function maxDistance(a, b) {
  return Math.max(...a.map((v, i) => v.distanceTo(b[i])));
}

// Distance between finite line segments, including endpoint and degenerate
// cases. Infinite-line distance would miss the limits of real phalanges.
function finiteSegmentDistance(p1, q1, p2, q2, closest) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-10 && e <= 1e-10) {
    if (closest) { closest[0].copy(p1); closest[1].copy(p2); }
    return p1.distanceTo(p2);
  }
  if (a <= 1e-10) t = THREE.MathUtils.clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e <= 1e-10) s = THREE.MathUtils.clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      s = denominator > 1e-10 ? THREE.MathUtils.clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const pa = p1.clone().addScaledVector(d1, s), pb = p2.clone().addScaledVector(d2, t);
  if (closest) { closest[0].copy(pa); closest[1].copy(pb); }
  return pa.distanceTo(pb);
}

assert.equal(finiteSegmentDistance(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, -1, 0), new THREE.Vector3(2, 1, 0)), 1, 'segments ending before a line crossing retain endpoint distance');
assert.equal(finiteSegmentDistance(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.5, -1, 0), new THREE.Vector3(0.5, 1, 0)), 0, 'intersecting finite segments have zero distance');
for (const stage of HANDWASHING_STAGES) {
  for (let i = 0; i <= 40; i++) {
    apply(stage.id, i / 40);
    for (const hand of [rig.right, rig.left]) {
      for (const bone of [hand.armature, ...hand.skeleton.bones]) {
        assert(bone.matrixWorld.elements.every(Number.isFinite), `${stage.id}: finite skeletal transforms`);
      }
      const joints = hand.fingers.middle.joints;
      const anatomicalPalm = world(joints[0].bone).lerp(world(joints[1].bone), 0.65);
      assert(anatomicalPalm.distanceTo(hand.currentPalmWorld) < 1e-7, 'palm locator lies inside the metacarpal, not along the fingers');
    }
    if (stage.id === 'rubPalms' && i / 40 >= 0.22 && i / 40 <= 0.80) {
      // Bone-derived normals differ from the fitted skin tangent on this GLB.
      // Keep this as an opposing-orientation check; measure actual skin below.
      assert(rig.right.currentPalmNormal.dot(rig.left.currentPalmNormal) < -0.8, 'rubbing palms broadly oppose');
    }
    if (stage.id === 'rubBacksOfHands' && ((i / 40 >= 0.18 && i / 40 <= 0.40) || (i / 40 >= 0.63 && i / 40 <= 0.90))) {
      assert(rig.right.currentPalmNormal.dot(rig.left.currentPalmNormal) > 0.97, 'both palms face the same way during dorsum rubbing');
      assert(rig.right.currentPalmNormal.y < -0.9 && rig.left.currentPalmNormal.y < -0.9);
    }
  }
}

// Central skin contact measured on the actual skinned meshes, using the fitted
// palm-surface basis rather than pretending the bone landmark normal is the skin
// normal. Nine rays cover a 70 x 50 scene-mm patch through the rubbing orbit.
// A wider grid samples overlapping finger surfaces too. Neither grid checks all
// triangles, so passing this audit does not prove full mesh collision freedom.
{
  const normal = new THREE.Vector3(0.166595, 0.982572, 0.082449).normalize();
  const tangentU = new THREE.Vector3(0, 0.083618, -0.996498).normalize();
  const tangentV = new THREE.Vector3(0.986025, -0.166012, -0.013930).normalize();
  const direction = normal.clone().negate();
  const center = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const point = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const baked = Object.fromEntries(['right', 'left'].map(side => [side,
    rig[side].skinnedMeshes.map(source => ({ source, mesh: new THREE.Mesh(source.geometry.clone(), material) })),
  ]));
  const surfaces = Object.fromEntries(['right', 'left'].map(side => [side, baked[side].map(item => item.mesh)]));
  function bakeCurrentSkin() {
    for (const side of ['right', 'left']) {
      for (const { source, mesh } of baked[side]) {
        const position = mesh.geometry.attributes.position;
        // Bake exactly the current application's skeletal deformation. No
        // hypothetical corrections or tuning overrides are applied in this test.
        for (let i = 0; i < position.count; i++) {
          source.getVertexPosition(i, point);
          source.localToWorld(point);
          position.setXYZ(i, point.x, point.y, point.z);
        }
        mesh.geometry.computeBoundingSphere();
        mesh.geometry.computeBoundingBox();
        mesh.updateMatrixWorld(true);
      }
    }
  }
  function skinGap(x, z, allowBelow = false) {
    origin.copy(center).addScaledVector(tangentV, x).addScaledVector(tangentU, z).addScaledVector(normal, 0.75);
    ray.set(origin, direction);
    if (allowBelow) {
      // Curled fingers may cross a ray more than twice. Pair each skin entry
      // and exit instead of treating the whole hand as one solid interval.
      // The small companion mesh contains open nail patches, not skin volume.
      const ranges = ['right', 'left'].map(side => {
        const skin = baked[side].filter(item => item.source.geometry.attributes.position.count > 500).map(item => item.mesh);
        const hits = ray.intersectObjects(skin, false).map(hit => hit.distance)
          .filter((v, i, all) => i === 0 || v - all[i - 1] > .000001);
        const spans = [];
        for (let i = 0; i + 1 < hits.length; i += 2) spans.push([hits[i], hits[i + 1]]);
        return spans;
      });
      let gap = Infinity;
      for (const a of ranges[0]) for (const b of ranges[1]) gap = Math.min(gap, Math.max(a[0] - b[1], b[0] - a[1]));
      return gap < Infinity ? gap : null;
    }
    const rightHits = ray.intersectObjects(surfaces.right, false);
    const leftHits = ray.intersectObjects(surfaces.left, false);
    if (!rightHits.length || !leftHits.length) return null;
    const upperSkin = Math.min(...rightHits.map(hit => hit.point.dot(normal)));
    const lowerSkin = Math.max(...leftHits.map(hit => hit.point.dot(normal)));
    const gap = upperSkin - lowerSkin;
    return gap;
  }
  let minGap = Infinity;
  let maxGap = -Infinity;
  let missingRays = 0;
  let samples = 0;
  let worstSample = null;
  let fingerMin = Infinity;
  let fingerMax = -Infinity;
  let fingerSamples = 0;
  let fingerMisses = 0;
  let fingerWorst = null;
  let minimumFingerHitsPerPose = Infinity;
  const fingerNames = ['index', 'middle', 'ring', 'pinky'];
  const tipGaps = fingerNames.map(() => ({ min: Infinity, max: -Infinity }));
  let maxFingerNormalSlope = 0;
  let steepestFinger = null;
  for (let i = 0; i <= 96; i++) {
    const progress = 0.16 + (0.84 - 0.16) * i / 96;
    apply('rubPalms', progress);
    bakeCurrentSkin();
    // No-penetration alone permits visibly raised fingers. Check the complete
    // MCP→PIP→DIP→visible-tip chain against the shared palm contact plane, then
    // bound the normal separation between corresponding visible fingertips.
    // This intentionally excludes thumbs and does not move the hand transforms.
    const tips = { right: [], left: [] };
    for (const side of ['right', 'left']) {
      for (let fingerIndex = 0; fingerIndex < fingerNames.length; fingerIndex++) {
        const joints = rig[side].fingers[fingerNames[fingerIndex]].joints;
        const distal = joints[3].bone;
        const visibleTip = distal.localToWorld(new THREE.Vector3(0, visibleFingerTipLocalY[side][fingerIndex], 0));
        const chain = [world(joints[1].bone), world(joints[2].bone), world(distal), visibleTip];
        tips[side].push(visibleTip);
        for (let segment = 0; segment < 3; segment++) {
          const vector = chain[segment + 1].clone().sub(chain[segment]);
          assert(vector.length() > 0.01, 'finger alignment uses non-degenerate phalanx segments');
          const slope = Math.abs(vector.normalize().dot(normal));
          if (slope > maxFingerNormalSlope) {
            maxFingerNormalSlope = slope;
            steepestFinger = { progress, side, finger: fingerNames[fingerIndex], segment };
          }
        }
      }
    }
    for (let fingerIndex = 0; fingerIndex < fingerNames.length; fingerIndex++) {
      const gap = tips.right[fingerIndex].clone().sub(tips.left[fingerIndex]).dot(normal);
      tipGaps[fingerIndex].min = Math.min(tipGaps[fingerIndex].min, gap);
      tipGaps[fingerIndex].max = Math.max(tipGaps[fingerIndex].max, gap);
    }
    center.addVectors(rig.right.currentPalmWorld, rig.left.currentPalmWorld).multiplyScalar(0.5);
    for (const x of [-0.035, 0, 0.035]) {
      for (const z of [-0.025, 0, 0.025]) {
        const gap = skinGap(x, z);
        if (gap === null) {
          missingRays++;
          continue;
        }
        if (gap < minGap) {
          minGap = gap;
          worstSample = { progress, x, z };
        }
        maxGap = Math.max(maxGap, gap);
        samples++;
      }
    }
    let hitsThisPose = 0;
    for (const z of [0.08, 0.12, 0.16, 0.20, 0.24, 0.28, 0.32, 0.36]) {
      for (const x of [-0.14, -0.105, -0.07, -0.035, 0, 0.035, 0.07, 0.105, 0.14]) {
        const gap = skinGap(x, z);
        if (gap === null) {
          fingerMisses++;
          continue;
        }
        if (gap < fingerMin) {
          fingerMin = gap;
          fingerWorst = { progress, x, z };
        }
        fingerMax = Math.max(fingerMax, gap);
        fingerSamples++;
        hitsThisPose++;
      }
    }
    minimumFingerHitsPerPose = Math.min(minimumFingerHitsPerPose, hitsThisPose);
  }
  console.log(`MEASURE: central palm patch ${samples} rays, ${missingRays} misses; signed skin gap ${(minGap * 1000).toFixed(3)}..${(maxGap * 1000).toFixed(3)} scene mm; minimum at ${JSON.stringify(worstSample)}.`);
  console.log(`MEASURE: wider finger grid ${fingerSamples} overlapping rays, ${fingerMisses} non-overlapping rays; signed skin gap ${(fingerMin * 1000).toFixed(3)}..${(fingerMax * 1000).toFixed(3)} scene mm; minimum at ${JSON.stringify(fingerWorst)}; minimum hits per pose ${minimumFingerHitsPerPose}.`);
  console.log(`MEASURE: finger alignment maximum slope ${THREE.MathUtils.radToDeg(Math.asin(maxFingerNormalSlope)).toFixed(3)} degrees at ${JSON.stringify(steepestFinger)}; paired visible-tip normal gaps in scene mm ${JSON.stringify(Object.fromEntries(fingerNames.map((name, i) => [name, [+(tipGaps[i].min * 1000).toFixed(3), +(tipGaps[i].max * 1000).toFixed(3)]])))}.`);
  assert.equal(missingRays, 0, 'every central palm ray hits both skinned meshes');
  assert(minGap >= -0.001, 'central palm samples must not penetrate more than 1 scene mm');
  assert(maxGap < 0.02, 'central palm samples stay within 20 scene mm of contact');
  assert(minimumFingerHitsPerPose >= 10, 'wider finger grid must overlap both hands throughout the orbit');
  assert(fingerMin >= -0.001, 'overlapping wider finger samples must not penetrate more than 1 scene mm');
  assert(maxFingerNormalSlope < 0.12, 'all index-to-pinky phalanges remain within 6.9 degrees of the shared palm contact plane');
  tipGaps.forEach((gap, i) => {
    assert(gap.min > 0, `${fingerNames[i]} visible-tip centers retain their normal-side ordering`);
    assert(gap.max <= 0.085, `${fingerNames[i]} paired visible-tip normal gap stays within 85 scene mm`);
  });
  console.log('PASS: sampled central palm contact, wider skin clearance and paired fingertip alignment through the rubbing orbit; this is not a full mesh-collision test.');
  let interlaceSkinMin = Infinity, interlacePalmMax = 0, interlaceSkinSamples = 0;
  const contactPairs = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3]];
  const sideContacts = contactPairs.map(() => ({ min: Infinity, max: -Infinity }));
  const contactSkin = Object.fromEntries(['right', 'left'].map(side => [side,
    baked[side].filter(item => item.source.geometry.attributes.position.count > 500).map(item => item.mesh),
  ]));
  const nearest = [new THREE.Vector3(), new THREE.Vector3()], across = new THREE.Vector3();
  function neighborSkinGaps() {
    const fingerChains = Object.fromEntries(['right', 'left'].map(side => [side,
      fingerNames.map(name => rig[side].fingers[name].joints.slice(1).map(j => world(j.bone))),
    ]));
    return contactPairs.map(([r, l]) => {
      let minimum = Infinity;
      for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const d = finiteSegmentDistance(fingerChains.right[r][j], fingerChains.right[r][j + 1],
          fingerChains.left[l][k], fingerChains.left[l][k + 1], nearest);
        if (d > .12) continue;
        across.subVectors(nearest[1], nearest[0]).normalize();
        ray.set(nearest[0], across);
        const rightSkin = ray.intersectObjects(contactSkin.right, false)[0]?.distance;
        across.negate(); ray.set(nearest[1], across);
        const leftSkin = ray.intersectObjects(contactSkin.left, false)[0]?.distance;
        if (rightSkin !== undefined && leftSkin !== undefined) minimum = Math.min(minimum, d - rightSkin - leftSkin);
      }
      assert(Number.isFinite(minimum), 'every interlaced neighbor pair has a measurable skin contact');
      return minimum;
    });
  }
  for (let sample = 0; sample <= 32; sample++) {
    apply('interlaceFingers', .28 + .72 * sample / 32);
    bakeCurrentSkin();
    center.addVectors(rig.right.currentPalmWorld, rig.left.currentPalmWorld).multiplyScalar(.5);
    neighborSkinGaps().forEach((gap, i) => {
      sideContacts[i].min = Math.min(sideContacts[i].min, gap);
      sideContacts[i].max = Math.max(sideContacts[i].max, gap);
    });
    for (const x of [-.035, 0, .035]) for (const z of [-.025, 0, .035]) {
      const gap = skinGap(x, z);
      assert(gap !== null && gap >= 0, 'palmar interlacing keeps the central palm surfaces clear');
      interlacePalmMax = Math.max(interlacePalmMax, gap);
    }
    // Include the webs, curved phalanges, and ulnar knuckle contact that a
    // central palm grid and thin bone capsules miss.
    for (let xi = 0; xi <= 30; xi++) {
      const x = -.30 + xi * .02;
      for (let zi = 0; zi <= 24; zi++) {
        const z = -.02 + zi * .02;
        const gap = skinGap(x, z, true);
        if (gap === null) continue;
        interlaceSkinMin = Math.min(interlaceSkinMin, gap);
        interlaceSkinSamples++;
      }
    }
  }
  assert(interlaceSkinSamples > 100, 'step-three skin check has meaningful coverage');
  assert(interlaceSkinMin >= 0, 'sampled finger and knuckle skin does not penetrate during interlacing');
  // Step three cleans the finger sides: central palm distance is diagnostic,
  // not a contact target. The user explicitly allows the palm centers apart.
  for (const [i, contact] of sideContacts.entries()) {
    assert(contact.min >= -.0005, `interlaced side contact ${i} must not pierce the neighboring finger`);
    assert(contact.max < .006, `interlaced side contact ${i} stays close through the whole stroke`);
  }
  console.log(`MEASURE: seven interlaced side contacts, scene mm ${JSON.stringify(sideContacts.map(g => ({min: +(g.min * 1000).toFixed(2), max: +(g.max * 1000).toFixed(2)})))}.`);
  console.log(`MEASURE: step-three skin clearance ${(interlaceSkinMin * 1000).toFixed(3)} scene mm across ${interlaceSkinSamples} overlapping samples; central palm maximum gap ${(interlacePalmMax * 1000).toFixed(3)} scene mm.`);
  let entrySkinMin = Infinity, entrySamples = 0;
  for (let sample = 0; sample <= 20; sample++) {
    apply('interlaceFingers', .28 * sample / 20);
    bakeCurrentSkin();
    center.addVectors(rig.right.currentPalmWorld, rig.left.currentPalmWorld).multiplyScalar(.5);
    for (let xi = 0; xi <= 30; xi++) for (let zi = 0; zi <= 26; zi++) {
      const gap = skinGap(-.30 + xi * .02, -.04 + zi * .02, true);
      if (gap === null) continue;
      entrySkinMin = Math.min(entrySkinMin, gap);
      entrySamples++;
    }
  }
  assert(entrySamples > 100 && entrySkinMin >= 0, 'sampled skin clears during withdrawal, finger insertion and tightening into step three');
  console.log(`MEASURE: step-three entry skin clearance ${(entrySkinMin * 1000).toFixed(3)} scene mm across ${entrySamples} overlapping samples.`);
  // Fast playback includes damping; seeking directly to a clear pose alone
  // cannot detect a hand lagging behind its independently filtered fingers.
  const interlaceDuration = HANDWASHING_STAGES.find(s => s.id === 'interlaceFingers').duration;
  for (const fps of [30, 60, 144]) {
    mapped.goToStage('interlaceFingers', true);
    let min = Infinity, max = -Infinity, samples = 0;
    for (let frame = 1; frame < fps * interlaceDuration; frame++) {
      mapped.update(1 / fps);
      if (mapped.state.stageProgress < .30 || frame % Math.round(fps / 8) !== 0) continue;
      bakeCurrentSkin();
      for (const gap of neighborSkinGaps()) {
        min = Math.min(min, gap); max = Math.max(max, gap); samples++;
      }
    }
    mapped.pause();
    assert(samples > 100 && min >= 0 && max < .006, `${fps} FPS playback retains close, nonpenetrating interlaced side contacts`);
    console.log(`MEASURE: ${fps} FPS playback, seven side-contact skin gaps ${(min * 1000).toFixed(3)}..${(max * 1000).toFixed(3)} scene mm.`);
  }
  for (const side of ['right', 'left']) for (const { mesh } of baked[side]) mesh.geometry.dispose();
  material.dispose();
}

// Keep thumbs alongside their own index fingers without splaying away from
// each other. Include the visible terminal phalanx, not just bone origins.
{
  const tipY = { right: .55280, left: .47774 };
  let minThumbGap = Infinity, maxThumbGap = -Infinity;
  let minIndexDistance = Infinity, maxIndexDistance = -Infinity;
  for (let sample = 0; sample <= 96; sample++) {
    apply('rubPalms', .16 + .68 * sample / 96);
    const thumbs = {};
    for (const side of ['right', 'left']) {
      const joints = rig[side].fingers.thumb.joints;
      const tip = joints[2].bone.localToWorld(new THREE.Vector3(0, tipY[side], 0));
      const index = rig[side].fingers.index.joints;
      const distance = finiteSegmentDistance(tip, tip, world(index[1].bone), world(index[2].bone));
      minIndexDistance = Math.min(minIndexDistance, distance);
      maxIndexDistance = Math.max(maxIndexDistance, distance);
      const scale = joints[2].bone.getWorldScale(new THREE.Vector3());
      thumbs[side] = [...joints.map(joint => world(joint.bone)), joints[2].bone.localToWorld(new THREE.Vector3(0, tipY[side] - .028 / Math.abs(scale.y), 0))];
    }
    let gap = Infinity;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) gap = Math.min(gap,
      finiteSegmentDistance(thumbs.right[a], thumbs.right[a + 1], thumbs.left[b], thumbs.left[b + 1]) - .056);
    minThumbGap = Math.min(minThumbGap, gap);
    maxThumbGap = Math.max(maxThumbGap, gap);
  }
  console.log(`MEASURE: thumb capsule clearance ${(minThumbGap * 1000).toFixed(3)}..${(maxThumbGap * 1000).toFixed(3)} scene mm; thumb-tip to own index distance ${(minIndexDistance * 1000).toFixed(3)}..${(maxIndexDistance * 1000).toFixed(3)} scene mm.`);
  assert(minThumbGap > 0, 'estimated thumb capsules stay separated throughout palm rubbing');
  assert(maxThumbGap < .060, 'opposing thumbs remain close instead of splaying apart');
  assert(minIndexDistance > .047, 'thumb tips retain space beside their index fingers');
  assert(maxIndexDistance < .090, 'thumb tips remain alongside the proximal index fingers');
}

apply('dispenseSoap', 1);
const soapContactEndpoint = snapshot();
apply('rubPalms', 0);
assert(maxDistance(soapContactEndpoint, snapshot()) < 1e-7, 'soap return ends in the exact rubbing pose without a rest-pose detour');
apply('rubPalms', .04);
assert(maxDistance(soapContactEndpoint, snapshot()) > .0001, 'rubbing starts during the first four percent instead of waiting for another joining phase');

apply('rubBacksOfHands', 1);
const backEndpoint = snapshot();
apply('interlaceFingers', 0);
assert(maxDistance(backEndpoint, snapshot()) < 1e-7, 'step three begins at the exact final pose of step two');

for (const [stage, boundaries] of [['dispenseSoap', [.28, .68, .94]], ['rubPalms', [0, .10, .92, 1]], ['rubBacksOfHands', [.035, .105, .14, .43, .47, .55, .59, .959, 1]], ['interlaceFingers', [.044, .128, .14, .20, .28, .352, .9424, 1]]]) {
  for (const boundary of boundaries) {
    apply(stage, boundary - 1e-6);
    const before = snapshot();
    apply(stage, boundary + 1e-6);
    assert(maxDistance(before, snapshot()) < 0.001, `${stage} boundary ${boundary}: no skeletal position jump`);
  }
}

apply('rubBacksOfHands', 0.3);
assert(rig.right.currentPalmWorld.y - rig.left.currentPalmWorld.y > 0.12, 'right palm is above the left dorsum');
apply('rubBacksOfHands', 0.75);
assert(rig.left.currentPalmWorld.y - rig.right.currentPalmWorld.y > 0.12, 'left palm is above the right dorsum');
apply('rubBacksOfHands', 0.51);
assert(Math.abs(rig.right.currentPalmWorld.x - rig.left.currentPalmWorld.x) > 0.5, 'hands disengage laterally while exchanging height');

// Approximate cross-hand finger capsules in both dorsum-contact windows. Include
// DIP-to-tip: checking only the bone origins omits the final phalanx and can pass
// even when visible fingertips cross. Radii match the on-screen debug metric.
{
  const fingerNames = ['index', 'middle', 'ring', 'pinky'];
  const radii = [0.019, 0.020, 0.019, 0.016];
  // Subtract the cap radius from the measured skin extent before positioning
  // its center; alignment checks above instead use the full visible tip.
  const scale = new THREE.Vector3();
  function capsulePoints(side, fingerIndex, pair = rig) {
    const joints = pair[side].fingers[fingerNames[fingerIndex]].joints;
    assert.equal(joints.length, 4, 'finger capsule expects metacarpal, MCP, PIP and DIP bones');
    const distal = joints[3].bone;
    distal.getWorldScale(scale);
    const terminalLength = Math.max(0, visibleFingerTipLocalY[side][fingerIndex] - radii[fingerIndex] / Math.abs(scale.y));
    return [world(joints[1].bone), world(joints[2].bone), world(distal), distal.localToWorld(new THREE.Vector3(0, terminalLength, 0))];
  }
  function minimumCapsuleGap(pair) {
    const points = Object.fromEntries(['right', 'left'].map(side => [side,
      fingerNames.map((_, fingerIndex) => capsulePoints(side, fingerIndex, pair)),
    ]));
    let minimum = Infinity;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        minimum = Math.min(minimum, finiteSegmentDistance(points.right[a][i], points.right[a][i + 1], points.left[b][j], points.left[b][j + 1]) - radii[a] - radii[b]);
      }
    }
    return minimum;
  }
  // Reproduce the exact progress at which Chrome exposed the double-bind bug.
  // Single-root and renderer-parent paths must produce the same live metric.
  const singleBind = await loadedController(false);
  const parentBind = await loadedController();
  singleBind.goToStage('rubBacksOfHands', false);
  singleBind.seek(0.72);
  parentBind.goToStage('rubBacksOfHands', false);
  parentBind.seek(0.72);
  const singleRig = singleBind.getRig();
  const parentRig = parentBind.getRig();
  for (const side of ['right', 'left']) {
    assert(parentRig[side].currentPalmWorld.distanceTo(singleRig[side].currentPalmWorld) < 1e-8, 'parent-bound and single-bound palms match at 72%');
    parentRig[side].skeleton.bones.forEach((bone, i) => {
      const difference = world(bone).distanceTo(world(singleRig[side].skeleton.bones[i]));
      assert(difference < 1e-8, `parent-bound and single-bound ${side} ${bone.name} positions match at 72% (difference ${difference})`);
    });
  }
  const singleGap = minimumCapsuleGap(singleRig);
  const parentGap = minimumCapsuleGap(parentRig);
  assert(Math.abs(singleGap - parentGap) < 1e-8, 'live capsule metric matches across GLB and renderer-parent binding');
  console.log(`PASS: renderer-parent binding preserves rig identity/rest/pose; 72% live capsule estimate ${(parentGap * 1000).toFixed(3)} scene mm equals single binding.`);
  singleBind.dispose();
  parentBind.dispose();
  const capsuleWindows = [];
  for (const [start, end] of [[0.14, 0.43], [0.59, 1]]) {
    let minimum = Infinity;
    let worst = null;
    let comparisons = 0;
    let maxWidthRatio = 0, maxBend = 0, minLaneMargin = Infinity, maxTipPlaneGap = 0;
    const strokeRange = { upper: [Infinity, -Infinity], lower: [Infinity, -Infinity] };
    for (let sample = 0; sample <= 100; sample++) {
      const progress = start + (end - start) * sample / 100;
      apply('rubBacksOfHands', progress);
      const points = Object.fromEntries(['right', 'left'].map(side => [side,
        fingerNames.map((_, fingerIndex) => capsulePoints(side, fingerIndex)),
      ]));
      const upperSide = start < .5 ? 'right' : 'left';
      const lowerSide = upperSide === 'right' ? 'left' : 'right';
      const span = side => {
        const xs = points[side].map(chain => chain[3].x);
        return Math.max(...xs) - Math.min(...xs);
      };
      const ratio = span(upperSide) / span(lowerSide);
      maxWidthRatio = Math.max(maxWidthRatio, ratio);
      assert(ratio <= 1, 'scrubbing finger fan stays within the width of the supporting high-five hand');
      for (const side of ['right', 'left']) for (const chain of points[side]) {
        const dirs = chain.slice(1).map((p, i) => p.clone().sub(chain[i]).normalize());
        for (let j = 1; j < dirs.length; j++) {
          const bend = dirs[j].angleTo(dirs[j - 1]);
          maxBend = Math.max(maxBend, bend);
          assert(bend < THREE.MathUtils.degToRad(3), 'extended phalanges do not bend sideways or hook over the opposite fingers');
        }
      }
      // Width alone passed the old sideways-skewed, floating pose. Check the
      // actual alternating lanes at the distal joints and visible fingertips.
      // The hands have opposite anatomical ordering: upper index lies between
      // lower pinky/ring, middle between ring/middle, ring between middle/index.
      const forward = new THREE.Vector3(0, .258819, -.965926).normalize();
      const normal = new THREE.Vector3(0, .965926, .258819).normalize();
      const atLongitudinal = (chain, longitudinal) => {
        const first = chain[0], last = chain[3];
        const t = (longitudinal - first.dot(forward)) / last.clone().sub(first).dot(forward);
        return first.clone().lerp(last, t);
      };
      for (let finger = 0; finger < 3; finger++) {
        for (const joint of [2, 3]) {
          const point = points[upperSide][finger][joint];
          const lowerA = atLongitudinal(points[lowerSide][3 - finger], point.dot(forward));
          const lowerB = atLongitudinal(points[lowerSide][2 - finger], point.dot(forward));
          const margin = Math.min(point.x - Math.min(lowerA.x, lowerB.x), Math.max(lowerA.x, lowerB.x) - point.x);
          minLaneMargin = Math.min(minLaneMargin, margin);
          assert(margin > .025, 'upper distal fingers stay inside separate lower-hand gaps throughout each scrub');
          if (joint === 3) {
            const planeGap = Math.abs(point.clone().sub(lowerA.clone().lerp(lowerB, .5)).dot(normal));
            maxTipPlaneGap = Math.max(maxTipPlaneGap, planeGap);
            assert(planeGap < .035, 'upper fingertips descend into the gaps instead of floating above the lower fingers');
          }
        }
      }
      const target = evaluateStagePose('rubBacksOfHands', progress, progress * 12, anchors);
      for (const [role, side] of [['upper', upperSide], ['lower', lowerSide]]) {
        const offset = target[side].palmOffset;
        const longitudinal = offset[1] * .258819 - offset[2] * .965926;
        strokeRange[role][0] = Math.min(strokeRange[role][0], longitudinal);
        strokeRange[role][1] = Math.max(strokeRange[role][1], longitudinal);
      }
      for (let rightFinger = 0; rightFinger < 4; rightFinger++) {
        for (let leftFinger = 0; leftFinger < 4; leftFinger++) {
          for (let rightSegment = 0; rightSegment < 3; rightSegment++) {
            for (let leftSegment = 0; leftSegment < 3; leftSegment++) {
              const gap = finiteSegmentDistance(
                points.right[rightFinger][rightSegment], points.right[rightFinger][rightSegment + 1],
                points.left[leftFinger][leftSegment], points.left[leftFinger][leftSegment + 1],
              ) - radii[rightFinger] - radii[leftFinger];
              assert(Number.isFinite(gap), 'finite capsule clearance');
              if (gap < minimum) {
                minimum = gap;
                worst = { progress, rightFinger: fingerNames[rightFinger], leftFinger: fingerNames[leftFinger], rightSegment, leftSegment };
              }
              comparisons++;
            }
          }
        }
      }
    }
    console.log(`MEASURE: dorsum window ${start}..${end}, ${comparisons} finite-segment capsule comparisons including fingertips; minimum ${(minimum * 1000).toFixed(3)} scene mm at ${JSON.stringify(worst)}.`);
    console.log(`MEASURE: open-hand width ratio ${maxWidthRatio.toFixed(3)}, largest phalanx bend ${THREE.MathUtils.radToDeg(maxBend).toFixed(2)} degrees; scrub travel ${((strokeRange.upper[1] - strokeRange.upper[0]) * 1000).toFixed(2)} scene mm.`);
    console.log(`MEASURE: interlaced distal-joint lane margin ${(minLaneMargin * 1000).toFixed(2)} scene mm; maximum fingertip distance from the lower finger plane ${(maxTipPlaneGap * 1000).toFixed(2)} scene mm.`);
    assert(maxBend > THREE.MathUtils.degToRad(.5), 'dorsal rubbing includes gentle phalanx flexion instead of rigid fingers');
    assert(strokeRange.upper[1] - strokeRange.upper[0] > .06, 'scrubbing has visible longitudinal travel');
    assert(strokeRange.lower[1] - strokeRange.lower[0] < .006, 'supporting hand stays steady during scrubbing');
    capsuleWindows.push({ start, end, minimum });
  }
  for (const { start, end, minimum } of capsuleWindows) assert(minimum >= -0.001, `dorsum window ${start}..${end}: estimated finger capsules must not overlap by more than 1 scene mm`);
  console.log('PASS: approximate finger capsule clearance in both dorsum-contact windows; capsule radii and tip centers are estimates, not full skin-collision proof.');
  for (const [start, end] of [[0, .14], [.43, .59]]) {
    let minimum = Infinity;
    for (let sample = 0; sample <= 100; sample++) {
      apply('rubBacksOfHands', start + (end - start) * sample / 100);
      minimum = Math.min(minimum, minimumCapsuleGap(rig));
    }
    assert(minimum > .01, 'fingers disengage before moving sideways and align before descending into the next contact pose');
    console.log(`MEASURE: approach/swap ${start}..${end}, minimum estimated finger clearance ${(minimum * 1000).toFixed(3)} scene mm across 101 poses.`);
  }
  const normal = new THREE.Vector3(.166595, .982572, .082449).normalize();
  const forward = new THREE.Vector3(0, .083618, -.996498).normalize();
  const lateral = new THREE.Vector3(.986025, -.166012, -.013930).normalize();
  // Rounded finger cores measured from this rig's posed skin. Full skin rays
  // above remain necessary: these capsules cannot model webs or joint bulges.
  const interlaceRadii = [.026, .027, .026, .023, .030];
  let minInterlaceGap = Infinity, minLaneMargin = Infinity;
  let minMiddleBend = Infinity, maxMiddleBend = 0, minTipDepth = Infinity;
  const travel = { right: [Infinity, -Infinity], left: [Infinity, -Infinity] };
  for (let sample = 0; sample <= 160; sample++) {
    const p = sample / 160;
    apply('interlaceFingers', p);
    const chains = Object.fromEntries(['right', 'left'].map(side => {
      const js = rig[side].fingers.thumb.joints;
      const tip = js[2].bone.localToWorld(new THREE.Vector3(0, side === 'right' ? .5528 : .47774, 0));
      tip.addScaledVector(tip.clone().sub(world(js[2].bone)).normalize(), -interlaceRadii[4]);
      return [side, [...fingerNames.map((_, f) => {
        const chain = capsulePoints(side, f);
        chain[3].addScaledVector(chain[3].clone().sub(chain[2]).normalize(), radii[f] - interlaceRadii[f]);
        return chain;
      }), [...js.map(j => world(j.bone)), tip]]];
    }));
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
      minInterlaceGap = Math.min(minInterlaceGap, finiteSegmentDistance(chains.right[a][j], chains.right[a][j + 1], chains.left[b][k], chains.left[b][k + 1]) - interlaceRadii[a] - interlaceRadii[b]);
    }
    if (p < .28) continue;
    assert(rig.right.currentPalmNormal.dot(rig.left.currentPalmNormal) < -.9, 'step three opposes palms instead of rubbing a dorsum');
    const target = evaluateStagePose('interlaceFingers', p, p * 12, anchors);
    for (const side of ['right', 'left']) {
      const value = new THREE.Vector3(...target[side].palmOffset).dot(forward);
      travel[side][0] = Math.min(travel[side][0], value);
      travel[side][1] = Math.max(travel[side][1], value);
    }
    const crossings = [];
    for (const side of ['right', 'left']) for (let f = 0; f < 4; f++) {
      const chain = chains[side][f];
      const dirs = chain.slice(1).map((v, i) => v.clone().sub(chain[i]).normalize());
      const middleBend = dirs[0].angleTo(dirs[1]) * 180 / Math.PI;
      const endBend = dirs[1].angleTo(dirs[2]) * 180 / Math.PI;
      minMiddleBend = Math.min(minMiddleBend, middleBend);
      maxMiddleBend = Math.max(maxMiddleBend, middleBend);
      assert(middleBend > 40 && middleBend < 80, 'every finger curves at its middle joint instead of remaining a flat fan');
      assert(endBend > 15 && endBend < 40, 'fingertips retain a loose curve instead of closing into a fist');
      const heights = chain.map(v => v.clone().sub(rig.contactWorldCenter).dot(normal));
      const depth = heights[3] * (side === 'right' ? -1 : 1);
      minTipDepth = Math.min(minTipDepth, depth);
      assert(depth > .05, 'all eight fingers pass through the opposing gaps with a loose fingertip curve');
      let crossing = null;
      for (let j = 0; j < 3; j++) if (heights[j] * heights[j + 1] < 0) {
        crossing = chain[j].clone().lerp(chain[j + 1], heights[j] / (heights[j] - heights[j + 1]));
        break;
      }
      assert(crossing, 'every finger actually crosses the shared palm plane');
      crossings.push({ side, x: crossing.dot(lateral) });
    }
    crossings.sort((a, b) => a.x - b.x);
    for (let i = 1; i < crossings.length; i++) {
      assert.notEqual(crossings[i].side, crossings[i - 1].side, 'all four fingers of each hand alternate through the palmar gaps');
      const margin = crossings[i].x - crossings[i - 1].x;
      minLaneMargin = Math.min(minLaneMargin, margin);
      // Curved fingers can cross the plane at similar lateral coordinates but
      // different longitudinal positions. Require alternating order here;
      // actual skin distances above check the three-dimensional clearance.
      assert(margin > 0, 'crossing finger centers remain in distinct alternating lanes while scrubbing');
    }
  }
  // Circular capsules overestimate the flattened sides of this posed mesh.
  // Bound gross bone overlap here, and use the strict skin/side-contact checks
  // above for penetration rather than forcing an artificial visible gap.
  assert(minInterlaceGap > -.006, 'step-three finger and thumb cores remain separated within the capsule approximation');
  for (const side of ['right', 'left']) assert(travel[side][1] - travel[side][0] > .015, 'both hands participate in the palmar interlacing stroke');
  console.log(`MEASURE: step-three finger/thumb capsule clearance ${(minInterlaceGap * 1000).toFixed(3)} scene mm; distal lane margin ${(minLaneMargin * 1000).toFixed(2)} scene mm; both hands scrub through ${(1000 * (travel.right[1] - travel.right[0])).toFixed(2)} scene mm.`);
  console.log(`MEASURE: all-eight-finger middle-joint bend ${minMiddleBend.toFixed(1)}..${maxMiddleBend.toFixed(1)} degrees; minimum tip depth beyond shared palm plane ${(minTipDepth * 1000).toFixed(1)} scene mm.`);
}

// User-calibrated thumb translations are part of the stage, independent of the
// inspector. They must neither accumulate nor leak into steps one and two.
{
  const thumbs = [[rig.right.fingers.thumb.joints[0], -.0730169139], [rig.left.fingers.thumb.joints[2], -.0243389724]];
  for (let n = 0; n < 8; n++) apply('interlaceFingers', .5);
  for (const [joint, x] of thumbs) {
    const actual = joint.bone.position.clone().sub(joint.restPosition);
    assert(Math.abs(actual.x - x) < 1e-8 && Math.abs(actual.y) < 1e-8 && Math.abs(actual.z) < 1e-8, 'saved bone-local calibration applies once without inspector state');
  }
  const pose = evaluateStagePose('interlaceFingers', .5, 6, anchors);
  const debug = { right: { position: [0, 0, 0], rotation: [0, 0, 0], bones: {
    Bone017: { position: [.01, 0, 0], rotation: [0, 0, 0] },
  } }, left: { position: [0, 0, 0], rotation: [0, 0, 0], bones: {} } };
  mapped.handAnimator.applyPose(pose, 0, 12, 13, debug);
  assert(Math.abs(thumbs[0][0].bone.position.x - thumbs[0][0].restPosition.x - thumbs[0][1] - .01) < 1e-8, 'debug translation adds to the saved pose instead of replacing it');
  apply('interlaceFingers', .5);
  assert(Math.abs(thumbs[0][0].bone.position.x - thumbs[0][0].restPosition.x - thumbs[0][1]) < 1e-8, 'disabling debug preserves the saved pose calibration');
  apply('rubPalms', .5);
  for (const [joint] of thumbs) assert(joint.bone.position.distanceTo(joint.restPosition) < 1e-8, 'leaving step three restores the original bone translations');
  console.log('PASS: persistent local thumb calibration, additive inspector offsets and restoration outside step three.');
}

// The armature origin is distant from the palm. Damping its position and
// quaternion separately used to sweep the pivot away from the intended path.
const startPose = evaluateStagePose('dispenseSoap', 1, 4.8, anchors);
const targetPose = evaluateStagePose('rubPalms', 0.16, 1.6, anchors);
mapped.handAnimator.applyPose(startPose, 0, 12, 13);
const pivots = [rig.right, rig.left].map(h => h.armature.localToWorld(h.palmLocalPivot.clone()));
mapped.handAnimator.applyPose(targetPose, 1 / 30, 12, 13);
for (const [i, side] of ['right', 'left'].entries()) {
  const hand = rig[side];
  const target = hand.palmWorldRest.clone().add(new THREE.Vector3(...targetPose[side].palmOffset));
  const expected = pivots[i].lerp(target, 1 - Math.exp(-12 / 30));
  const actual = hand.armature.localToWorld(hand.palmLocalPivot.clone());
  assert(actual.distanceTo(expected) < 1e-7, 'damped palm pivot follows its intended path');
}
console.log('PASS: actual GLB rig, anatomical palm locator, finite transforms, contact normals, substage continuity, role swap clearance and pivot damping.');

// Compare actual damped skeletal trajectories at common wall-clock samples.
// This tolerates the small integration difference of discrete target sampling,
// while catching frame-count based motion and large low-frame-rate drift.
const trajectories = [];
for (const fps of [30, 60, 144]) {
  const controller = await loadedController();
  controller.play();
  const samples = [];
  let elapsed = 0;
  for (const seconds of [1, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 35.5, 37, 39, 42, 45, 46.6, 49, 52, 56, 59, 62, 66, 70, 73, 76, 80, 84, 86.6]) {
    advance(controller, seconds - elapsed, fps);
    elapsed = seconds;
    const pair = controller.getRig();
    samples.push({
      stageId: controller.state.stageId,
      elapsed: controller.state.stageElapsed,
      points: [pair.right, pair.left].flatMap(h => [h.currentPalmWorld.clone(), world(h.fingers.middle.joints.at(-1).bone)]),
    });
  }
  trajectories.push(samples);
}
let maxTrajectoryDifference = 0;
let worstTrajectory;
for (const samples of trajectories.slice(1)) {
  samples.forEach((sample, i) => {
    const reference = trajectories[0][i];
    assert.equal(sample.stageId, reference.stageId);
    assert(Math.abs(sample.elapsed - reference.elapsed) < 1e-7, 'identical elapsed time across frame rates');
    const difference = maxDistance(sample.points, reference.points);
    if (difference > maxTrajectoryDifference) {
      maxTrajectoryDifference = difference;
      worstTrajectory = { stage: sample.stageId, elapsed: sample.elapsed, sample: i };
    }
  });
}
assert(maxTrajectoryDifference < 0.025, `skeletal trajectory frame-rate difference stays below 2.5 scene cm (${maxTrajectoryDifference}, ${JSON.stringify(worstTrajectory)})`);
console.log(`PASS: 30/60/144 FPS trajectories; largest sampled difference ${(maxTrajectoryDifference * 1000).toFixed(2)} scene mm.`);

// A background-tab delay is clamped; pause freezes even bound skeletal poses.
mapped.goToStage('rubBacksOfHands', true);
mapped.update(120);
assert.equal(mapped.state.stageElapsed, 0.05);
mapped.pause();
const frozenPose = snapshot();
advance(mapped, 1);
assert.equal(maxDistance(frozenPose, snapshot()), 0, 'pause freezes bones');
mapped.update(Number.NaN);
assert.equal(mapped.state.stageElapsed, 0.05);
console.log('PASS: background-tab delta clamp, invalid delta handling and bound-rig pause. These checks do not prove triangle-level collision freedom or rendering performance.');

// Debug tools use the same actual GLB and procedural animation path as playback.
// Keep these regression checks in the repository rather than the temporary QA harness.
{
  const debugController = await loadedController();
  debugController.goToStage('rubBacksOfHands', false);
  debugController.seek(0.25);
  const pair = debugController.getRig();
  const basePalm = pair.right.currentPalmWorld.clone();
  const joint = pair.right.fingers.index.joints[1];
  const baseRotation = joint.bone.quaternion.clone();
  const basePosition = joint.bone.position.clone();
  debugController.debug.enabled = true;
  debugController.debug.selectedBone = joint.name;
  const override = debugController.getDebugStage();
  override.right.position[0] = 0.05;
  debugController.seek(0.25);
  assert(Math.abs(pair.right.currentPalmWorld.x - basePalm.x - 0.05) < 1e-8, 'debug hand offset uses world units');
  override.right.bones[joint.name] = { position: [0.1, -0.05, 0.02], rotation: [15, -8, 4] };
  debugController.seek(0.25);
  const expectedPosition = basePosition.clone().add(new THREE.Vector3(0.1, -0.05, 0.02));
  assert(joint.bone.position.distanceTo(expectedPosition) < 1e-8, 'debug bone translation uses raw local units');
  const expectedRotation = baseRotation.clone().multiply(new THREE.Quaternion().setFromEuler(
    new THREE.Euler(15 * Math.PI / 180, -8 * Math.PI / 180, 4 * Math.PI / 180, 'XYZ'),
  ));
  assert(joint.bone.quaternion.angleTo(expectedRotation) < 1e-7, 'debug bone rotation composes after the procedural rotation');
  const inspected = debugController.getDebugSnapshot();
  assert.equal(inspected.selectedBone.name, joint.name);
  assert.equal(inspected.hands.right.bones.length, pair.right.skeleton.bones.length, 'inspector includes every bone');
  assert(inspected.diagnostics.finiteTransforms);
  assert.equal(inspected.progress, 0.25);
  debugController.setDebugMetrics({ fingerClearance: -0.003, closestFingerPair: 'right.index / left.middle' });
  assert.equal(debugController.getDebugSnapshot().diagnostics.fingerClearance, -0.003);
  assert.equal(debugController.getDebugSnapshot().diagnostics.closestFingerPair, 'right.index / left.middle');

  // Selecting a bone or helper changes inspection only, not poses or the timeline.
  const beforeSelection = joint.bone.position.clone();
  debugController.debug.selectedBone = pair.right.fingers.middle.joints[1].name;
  debugController.debug.showAxes = true;
  debugController.debug.showSkeleton = true;
  debugController.update(1 / 60);
  assert.equal(debugController.state.stageProgress, 0.25);
  assert(joint.bone.position.distanceTo(beforeSelection) < 1e-8);

  const exported = debugController.exportDebugOverrides();
  const saved = JSON.stringify(exported);
  debugController.resetDebugStage();
  debugController.seek(0.25);
  assert(pair.right.currentPalmWorld.distanceTo(basePalm) < 1e-8, 'reset debug stage restores base hand pose');
  assert(joint.bone.position.distanceTo(basePosition) < 1e-8, 'reset clears bone translation');
  assert(debugController.importDebugOverrides(exported).ok);
  debugController.seek(0.25);
  assert(joint.bone.position.distanceTo(basePosition) > 0.05, 'JSON roundtrip restores overrides');
  const invalid = structuredClone(exported);
  invalid.stages.rubBacksOfHands.right.bones.wrong_bone = { position: [0, 0, 0], rotation: [0, 0, 0] };
  assert(!debugController.importDebugOverrides(invalid).ok, 'unknown bone import is rejected');
  assert.equal(JSON.stringify(debugController.exportDebugOverrides()), saved, 'failed import is atomic');
  const wrongUnits = structuredClone(exported);
  wrongUnits.units.rotation = 'radians';
  assert(!debugController.importDebugOverrides(wrongUnits).ok, 'unit mismatch is rejected');
  assert.equal(JSON.stringify(debugController.exportDebugOverrides()), saved);

  debugController.debug.enabled = false;
  debugController.update(1 / 60);
  assert(pair.right.currentPalmWorld.distanceTo(basePalm) < 1e-8, 'disable restores base hand pose while paused');
  assert(joint.bone.position.distanceTo(basePosition) < 1e-8, 'disable clears edited bone translation');
  assert(joint.bone.quaternion.angleTo(baseRotation) < 1e-7, 'disable restores procedural bone rotation');

  debugController.debug.enabled = true;
  debugController.debug.playbackRate = 0.5;
  debugController.seek(0.25);
  debugController.play();
  advance(debugController, 1);
  assert(Math.abs(debugController.state.stageElapsed - debugController.state.stageDuration * 0.25 - 0.5) < 1e-8, 'half-speed advances half a second');
  debugController.seek(0.999);
  debugController.play();
  advance(debugController, 1);
  assert.equal(debugController.state.stageId, 'rubBacksOfHands', 'debug loops the current stage');
  assert(debugController.state.stageProgress < 0.1);
  debugController.debug.enabled = false;
  debugController.seek(0.999);
  debugController.play();
  advance(debugController, 1);
  assert.equal(debugController.state.stageId, 'interlaceFingers', 'debug disabled resumes the sequence into step three');
  assert.equal(debugController.state.isPlaying, true);
  debugController.seek(.999);
  debugController.play();
  advance(debugController, 1);
  assert.equal(debugController.state.stageId, 'rubBacksOfFingers', 'step three continues into step four');
  debugController.goToStage('rubFingertips', false);
  debugController.seek(.999);
  debugController.play();
  advance(debugController, 1);
  assert.equal(debugController.state.stageId, 'rinseHands', 'the sixth technique flows into the final rinse');
  assert.equal(debugController.state.isPlaying, true, 'the final rinse continues playback');
  assert.equal(debugController.state.faucetActive, true);
  assert.equal(debugController.state.particleMode, 'water');
  advance(debugController, 8);
  assert.equal(debugController.state.stageId, 'finish', 'the rinse flows into the return-to-rest stage');
  assert.equal(debugController.state.isPlaying, false, 'the complete sequence stops after returning to rest');
  assert.equal(debugController.state.stageProgress, 1);
  assert.equal(debugController.state.faucetActive, false);
  assert.equal(debugController.state.foamIntensity, 0);
  debugController.dispose();
}
console.log('PASS: debug world/local overrides, exact seek, snapshots, inspection selection, validated JSON roundtrip, atomic invalid import, reset/disable restoration, speed and stage loop.');

// Steps four through six use authored joint channels and the existing controller.
// Check the actual rig at phase boundaries, including the last calibrated pose
// of step three; no mesh/IK solver is involved in playback.
const lateStages = ['rubBacksOfFingers', 'rubThumbs', 'rubFingertips'];
const interlaceSection = HANDWASHING_SECTIONS.find(s => s.whoStepNumber === 3);
assert.equal(interlaceSection.playThroughStageIndex, 6,
  'step three playback includes the authored step-four handoff stage');
const knuckleSection = HANDWASHING_SECTIONS.find(s => s.whoStepNumber === 4);
assert.equal(knuckleSection.playThroughStageIndex, 7,
  'step four playback includes the authored thumb handoff stage');
const thumbSection = HANDWASHING_SECTIONS.find(s => s.whoStepNumber === 5);
assert.equal(thumbSection.playThroughStageIndex, 8,
  'step five playback includes the authored fingertip handoff stage');
for (const [i, id] of lateStages.entries()) {
  const stage = HANDWASHING_STAGES.find(s => s.id === id);
  assert.equal(stage.whoStep, i + 4);
  const section = HANDWASHING_SECTIONS.find(s => s.whoStepNumber === i + 4);
  assert(section.enabled && HANDWASHING_STAGES[section.startStageIndex].id === id);
  if (id !== 'rubFingertips') assert.equal(section.startStageIndex, section.endStageIndex);
  c.goToStage(id, false);
  c.seek(.35);
  assert(c.state.foamIntensity > .9);
  assert.equal(c.state.faucetActive, false);
  assert.equal(c.state.pumpPressProgress, 0);
  assert.equal(c.state.soapBlobVisible, false);
  for (const p of id === 'rubBacksOfFingers' ? [0, .12, .26, .46, .66, 1] : [0, .16, .43, .61, 1]) {
    apply(id, Math.max(0, p - 1e-6)); const before = snapshot();
    apply(id, Math.min(1, p + 1e-6));
    assert(maxDistance(before, snapshot()) < .0002, `${id}: continuous substage at ${p}`);
  }
}
const finalSection = HANDWASHING_SECTIONS.find(s => s.whoStepNumber === 6);
assert.equal(finalSection.endStageIndex, HANDWASHING_STAGES.length - 1,
  'step six includes the final rinse and return stages');
const rinseTransitionWindow = .22;
apply('rubFingertips', 1);
const fingertipEndpoint = snapshot();
apply('rinseHands', 0);
assert(maxDistance(fingertipEndpoint, snapshot()) < 1e-8,
  'rinse starts from the final fingertip pose');
apply('rinseHands', rinseTransitionWindow);
const rinsePoseStart = snapshot();
apply('wetHands', 0);
assert(maxDistance(rinsePoseStart, snapshot()) < 1e-6,
  'rinse handoff reaches the preparation rinse pose before continuing');
for (const [before, after] of [['interlaceFingers', lateStages[0]], [lateStages[0], lateStages[1]], [lateStages[1], lateStages[2]]]) {
  apply(before, 1); const end = snapshot();
  apply(after, 0);
  const start = snapshot();
  assert(maxDistance(end, start) < 1e-6, `${before} -> ${after}: pose handoff within floating-point precision`);
  apply(after, .15);
  assert(maxDistance(start, snapshot()) > .02, `${before} -> ${after}: authored transition visibly moves before the destination rub`);
}

// Baked XYZ channels require anatomical and skin-based checks, rather than
// raw curl thresholds or nearest-vertex contact. Keep these on the real GLB.
await import('./verify-handwashing-contact.mjs');
await (await import('./verify-handwashing-knuckles.mjs')).verifyKnuckles();
