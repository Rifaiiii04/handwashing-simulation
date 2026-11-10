import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createJiti } from 'jiti';

// Full inter-hand skin checks supplement the small contact patches measured by
// verify-handwashing-contact.mjs. This is an offline check, never a render loop.
const jiti = createJiti(import.meta.url, { fsCache: false });
const { HandAnimationController } = await jiti.import('../app/lib/handwashing/HandAnimationController.ts');
const { evaluateStagePose } = await jiti.import('../app/lib/handwashing/handwashingPoses.ts');
const { HANDWASHING_STAGES, DEFAULT_HANDWASHING_CONFIG } = await jiti.import('../app/lib/handwashing/handwashingConfig.ts');
const anchors = { pumpStroke: 0, pumpPressProgress: 0 };
const stageId = 'rubBacksOfFingers';
const sides = ['right', 'left'];

function dominantBone(mesh, vertex) {
  const index = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
  let slot = 0;
  for (let k = 1; k < 4; k++) if (weight.getComponent(vertex, k) > weight.getComponent(vertex, slot)) slot = k;
  return mesh.skeleton.bones[index.getComponent(vertex, slot)];
}

function skinSurface(hand) {
  const surfaces = hand.skinnedMeshes.map(mesh => {
    const vertices = Array.from({ length: mesh.geometry.attributes.position.count }, () => new THREE.Vector3());
    const labels = vertices.map((_, vertex) => {
      const bone = dominantBone(mesh, vertex);
      return Object.entries(hand.fingers).find(([, finger]) => finger.joints.some(joint => joint.bone === bone))?.[0] ?? 'palm/forearm';
    });
    const index = mesh.geometry.index;
    assert(index, `${mesh.name}: indexed skin geometry`);
    const faces = [];
    for (let k = 0; k < index.count; k += 3) {
      const ids = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
      faces.push({ points: ids.map(v => vertices[v]), label: [...new Set(ids.map(v => labels[v]))].sort().join('/'), min: [0, 0, 0], max: [0, 0, 0] });
    }
    return { mesh, vertices, faces };
  });
  return { surfaces, faces: surfaces.flatMap(surface => surface.faces), tree: null };
}

function refit(node) {
  node.min.fill(Infinity); node.max.fill(-Infinity);
  for (const item of node.faces ?? [refit(node.left), refit(node.right)]) {
    for (let axis = 0; axis < 3; axis++) {
      node.min[axis] = Math.min(node.min[axis], item.min[axis]);
      node.max[axis] = Math.max(node.max[axis], item.max[axis]);
    }
  }
  return node;
}

function tree(faces) {
  const node = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  if (faces.length <= 8) return refit({ ...node, faces });
  for (const face of faces) for (let axis = 0; axis < 3; axis++) {
    node.min[axis] = Math.min(node.min[axis], face.min[axis]);
    node.max[axis] = Math.max(node.max[axis], face.max[axis]);
  }
  const extent = node.max.map((value, axis) => value - node.min[axis]);
  const axis = extent.indexOf(Math.max(...extent));
  const sorted = [...faces].sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const half = Math.floor(sorted.length / 2);
  return { ...node, left: tree(sorted.slice(0, half)), right: tree(sorted.slice(half)) };
}

function updateSkin(surface) {
  for (const { mesh, vertices, faces } of surface.surfaces) {
    vertices.forEach((point, vertex) => mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld));
    for (const face of faces) for (let axis = 0; axis < 3; axis++) {
      face.min[axis] = Math.min(...face.points.map(p => p.getComponent(axis)));
      face.max[axis] = Math.max(...face.points.map(p => p.getComponent(axis)));
    }
  }
  if (surface.tree) refit(surface.tree); else surface.tree = tree(surface.faces);
}

export async function loadKnuckleRig() {
  globalThis.self ??= globalThis;
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'knuckle-check-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const bytes = await readFile(new URL('../public/models/washand.glb', import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const animator = new HandAnimationController();
  assert(animator.bindScene(gltf.scene), 'the preserved GLB hand skeletons bind');
  const rig = animator.getRig();
  const skin = Object.fromEntries(sides.map(side => [side, skinSurface(rig[side])]));
  sides.forEach(side => updateSkin(skin[side]));
  return { scene: gltf.scene, animator, rig, skin, ray: new THREE.Ray(), direction: new THREE.Vector3(), hit: new THREE.Vector3(), barycentric: new THREE.Vector3() };
}

export function applyKnucklePose(harness, progress, delta = 0) {
  const duration = HANDWASHING_STAGES.find(stage => stage.id === stageId).duration;
  const lambda = DEFAULT_HANDWASHING_CONFIG.contactDampingLambda;
  harness.animator.applyPose(evaluateStagePose(stageId, progress, progress * duration, anchors), delta, lambda, lambda);
}

const boxesOverlap = (a, b) => a.min.every((value, axis) => value <= b.max[axis] && a.max[axis] >= b.min[axis]);

function pierces(a, b, harness) {
  for (const [edgeFace, surface] of [[a, b], [b, a]]) for (let k = 0; k < 3; k++) {
    const from = edgeFace.points[k], to = edgeFace.points[(k + 1) % 3];
    harness.direction.subVectors(to, from);
    const length = harness.direction.length();
    if (length < 1e-8) continue;
    harness.ray.set(from, harness.direction.multiplyScalar(1 / length));
    if (!harness.ray.intersectTriangle(...surface.points, false, harness.hit)) continue;
    const barycentric = THREE.Triangle.getBarycoord(harness.hit, ...surface.points, harness.barycentric);
    // A surface edge resting on the other triangle is contact (a T-junction),
    // not an edge passing through the interior of the opposing skin face.
    if (!barycentric || Math.min(barycentric.x, barycentric.y, barycentric.z) <= 1e-7) continue;
    const distance = harness.hit.distanceTo(from);
    // Shared edge/vertex contact is allowed. An interior edge crossing is not.
    if (distance > 1e-6 && distance < length - 1e-6 && !surface.points.some(point => point.distanceTo(harness.hit) < 1e-6)) return true;
  }
  return false;
}

export function measureInterHandCrossings(harness, { details = false, limit = Infinity } = {}) {
  harness.scene.updateMatrixWorld(true);
  sides.forEach(side => updateSkin(harness.skin[side]));
  let pairs = 0;
  const groups = {};
  function visit(face, node) {
    if (pairs >= limit || !boxesOverlap(face, node)) return;
    if (!node.faces) { visit(face, node.left); visit(face, node.right); return; }
    for (const other of node.faces) if (boxesOverlap(face, other) && pierces(face, other, harness)) {
      pairs++;
      if (details) { const key = `${face.label} -> ${other.label}`; groups[key] = (groups[key] ?? 0) + 1; }
      if (pairs >= limit) return;
    }
  }
  for (const face of harness.skin.right.faces) { visit(face, harness.skin.left.tree); if (pairs >= limit) break; }
  return { pairs, groups };
}

function snapshot(harness) {
  return sides.flatMap(side => harness.rig[side].skeleton.bones.map(bone => ({
    position: bone.getWorldPosition(new THREE.Vector3()), quaternion: bone.getWorldQuaternion(new THREE.Quaternion()).normalize(),
  })));
}

function compare(a, b) {
  return { distance: Math.max(...a.map((v, i) => v.position.distanceTo(b[i].position))), angle: Math.max(...a.map((v, i) => v.quaternion.angleTo(b[i].quaternion))) };
}

function verifyTriangleClassifier() {
  const face = points => ({ points: points.map(point => new THREE.Vector3(...point)) });
  const scratch = { ray: new THREE.Ray(), direction: new THREE.Vector3(), hit: new THREE.Vector3(), barycentric: new THREE.Vector3() };
  const flat = face([[-1, -1, 0], [1, -1, 0], [0, 1, 0]]);
  for (const [description, points, expected] of [
    ['interior crossing', [[0, -.25, -1], [0, -.25, 1], [0, .75, 0]], true],
    ['separated surfaces', [[3, -.25, -1], [3, -.25, 1], [3, .75, 0]], false],
    ['coplanar contact', [[0, -.25, 0], [1, -.25, 0], [0, .75, 0]], false],
    ['terminal vertex contact', [[0, 0, 0], [1, 0, 1], [0, 1, 1]], false],
    ['edge resting on a face', [[0, -2, 0], [0, 2, 0], [0, 0, 1]], false],
  ]) assert.equal(pierces(flat, face(points), scratch), expected, description);
}

function measureContinuity(harness, steps, duration) {
  applyKnucklePose(harness, 0);
  let previous = snapshot(harness), largestStep = 0, largestAngle = 0, largestStepAt = 0, largestAngleAt = 0;
  for (let k = 1; k <= steps; k++) {
    applyKnucklePose(harness, k / steps);
    const next = snapshot(harness), difference = compare(previous, next);
    assert(Number.isFinite(difference.distance) && Number.isFinite(difference.angle), `finite skeletal transforms at ${k / steps}`);
    if (difference.distance > largestStep) { largestStep = difference.distance; largestStepAt = k / steps; }
    if (difference.angle > largestAngle) { largestAngle = difference.angle; largestAngleAt = k / steps; }
    previous = next;
  }
  return { steps, largestStepMm: largestStep * 1000, largestStepAt,
    largestStepDeg: THREE.MathUtils.radToDeg(largestAngle), largestAngleAt,
    maximumSampledSpeedSceneMmPerSecond: largestStep * 1000 * steps / duration,
    maximumSampledAngularSpeedDegPerSecond: THREE.MathUtils.radToDeg(largestAngle) * steps / duration };
}

export async function verifyKnuckles({ collect = process.argv.includes('--collect-failures'), clearBy = .04, quick = process.argv.includes('--quick') } = {}) {
  verifyTriangleClassifier();
  const harness = await loadKnuckleRig(), failures = [];
  const duration = HANDWASHING_STAGES.find(stage => stage.id === stageId).duration;
  const lambda = DEFAULT_HANDWASHING_CONFIG.contactDampingLambda;
  const check = (condition, message) => { if (condition) return; if (!collect) assert(condition, message); failures.push(message); };
  harness.animator.applyPose(evaluateStagePose('interlaceFingers', 1, 12, anchors), 0, lambda, lambda);
  const previousEnd = snapshot(harness);
  applyKnucklePose(harness, 0);
  const handoff = compare(previousEnd, snapshot(harness));
  assert(handoff.distance < 1e-6 && handoff.angle < 1e-6, `step three/four handoff preserves the full skeletal pose (${JSON.stringify(handoff)})`);
  const inherited = measureInterHandCrossings(harness).pairs;
  let exactSamples = 0, exactMaximum = 0;
  const count = quick ? 40 : 120;
  const seekPoints = [...new Set([
    ...Array.from({ length: count + 1 }, (_, k) => k / count),
    ...Array.from({ length: 17 }, (_, k) => clearBy * k / 16),
  ])].sort((a, b) => a - b);
  for (const progress of seekPoints) {
    applyKnucklePose(harness, progress);
    const result = measureInterHandCrossings(harness, { details: true });
    if (progress > 0 && progress < clearBy) check(result.pairs <= inherited, `entry ${progress.toFixed(4)}: withdrawal increases inherited crossings (${inherited} -> ${result.pairs})`);
    else if (progress >= clearBy) check(result.pairs === 0, `seek ${progress.toFixed(4)}: ${result.pairs} skin triangle crossings ${JSON.stringify(result.groups)}`);
    if (progress >= clearBy) exactMaximum = Math.max(exactMaximum, result.pairs);
    exactSamples++;
  }
  // Halving the time step should reduce the largest sampled movement. A pose
  // jump persists at the finer step. This avoids an arbitrary velocity limit in
  // model scene units; it does not establish natural acceleration or timing.
  const coarseContinuity = measureContinuity(harness, 1000, duration);
  const fineContinuity = measureContinuity(harness, 2000, duration);
  const positionRatio = fineContinuity.largestStepMm / Math.max(1e-6, coarseContinuity.largestStepMm);
  const angleRatio = fineContinuity.largestStepDeg / Math.max(1e-6, coarseContinuity.largestStepDeg);
  check(positionRatio < .75 && angleRatio < .75,
    `continuous scrub trajectory converges when halving the step: position ratio ${positionRatio}, orientation ratio ${angleRatio}`);
  const playback = [];
  for (const fps of quick ? [60] : [30, 60, 144]) {
    applyKnucklePose(harness, 0);
    let samples = 0, maximum = 0, nextSample = 0;
    const sampleRate = quick ? 8 : 16;
    for (let frame = 1; frame <= duration * fps; frame++) {
      const progress = frame / (duration * fps);
      applyKnucklePose(harness, progress, 1 / fps);
      // Inspect each withdrawal frame, including the first frame after the
      // clearance deadline; sample the longer scrubbing windows at 8/16 Hz.
      if (progress > clearBy + .02 && progress + 1e-9 < nextSample) continue;
      nextSample = (Math.floor(progress * duration * sampleRate + 1e-9) + 1) / (duration * sampleRate);
      const result = measureInterHandCrossings(harness, { details: true });
      if (progress < clearBy) check(result.pairs <= inherited, `${fps}fps entry ${progress.toFixed(4)}: new crossings during withdrawal (${inherited} -> ${result.pairs})`);
      else { maximum = Math.max(maximum, result.pairs); check(result.pairs === 0, `${fps}fps ${progress.toFixed(4)}: ${result.pairs} skin triangle crossings ${JSON.stringify(result.groups)}`); }
      samples++;
    }
    playback.push({ fps, samples, maximumCrossingPairsAfterWithdrawal: maximum });
  }
  applyKnucklePose(harness, 1); const end = snapshot(harness);
  harness.animator.applyPose(evaluateStagePose('rubThumbs', 0, 0, anchors), 0, lambda, lambda);
  const nextHandoff = compare(end, snapshot(harness));
  assert(nextHandoff.distance < 1e-6 && nextHandoff.angle < 1e-6, 'step four/five preserves the adjusted knuckle endpoint');
  const report = { inheritedCrossingPairs: inherited, clearByProgress: clearBy, exactSamples, exactMaximum,
    continuity: { coarse: coarseContinuity, fine: fineContinuity, positionRatio, angleRatio }, playback, failures };
  console.log(`KNUCKLES: ${JSON.stringify({ ...report, failures: failures.slice(0, 8), failureCount: failures.length })}`);
  harness.animator.dispose();
  assert.equal(failures.length, 0, `${failures.length} knuckle skin/continuity checks failed`);
  console.log('PASS: sampled full hand skins, inherited-contact withdrawal, fitted rubbing, role exchange and frame-rate filtered playback. Sampling does not prove every continuous triangle sweep is collision-free.');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyKnuckles();
