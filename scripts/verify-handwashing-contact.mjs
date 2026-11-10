import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createJiti } from 'jiti';

// Run: node scripts/verify-handwashing-contact.mjs
// Measures the actual skinned GLB after final pose application. Baked XYZ
// channels are not anatomical hinge angles, so flexion is measured in world space.
const jiti = createJiti(import.meta.url, { fsCache: false });
const { HandAnimationController } = await jiti.import('../app/lib/handwashing/HandAnimationController.ts');
const { evaluateStagePose } = await jiti.import('../app/lib/handwashing/handwashingPoses.ts');
const { HANDWASHING_STAGES, DEFAULT_HANDWASHING_CONFIG } = await jiti.import('../app/lib/handwashing/handwashingConfig.ts');
const sides = ['right', 'left'], fingers = ['index', 'middle', 'ring', 'pinky'];
const names = ['thumb', ...fingers], rad = Math.PI / 180;
const tipY = { right: [.5528, .45402, .43552, .41136, .37604], left: [.47774, .43194, .40757, .32907, .34465] };
const loader = new GLTFLoader();
globalThis.self ??= globalThis;
loader.register(() => ({ name: 'contact-check-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const bytes = await readFile(new URL('../public/models/washand.glb', import.meta.url));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
gltf.scene.updateMatrixWorld(true);
const animator = new HandAnimationController();
assert(animator.bindScene(gltf.scene), 'the existing pair of hand skeletons binds');
const rig = animator.getRig();
const world = bone => bone.getWorldPosition(new THREE.Vector3());
const endpoint = (side, name) => rig[side].fingers[name].joints.at(-1).bone.localToWorld(new THREE.Vector3(0, tipY[side][names.indexOf(name)], 0));
const chain = (side, name) => [...rig[side].fingers[name].joints.slice(name === 'thumb' ? 0 : 1).map(j => world(j.bone)), endpoint(side, name)];
const dominant = (mesh, v) => {
  const index = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
  let slot = 0;
  for (let k = 1; k < 4; k++) if (weight.getComponent(v, k) > weight.getComponent(v, slot)) slot = k;
  return mesh.skeleton.bones[index.getComponent(v, slot)];
};
const scratch = new THREE.Vector3(), records = {}, palms = {}, palmTriangles = {}, handSkinSurfaces = {};
animator.resetToRestPose();
for (const side of sides) {
  const hand = rig[side];
  records[side] = Object.fromEntries(fingers.map((name, digit) => {
    const joints = hand.fingers[name].joints, middle = joints[2].bone, distal = joints[3].bone;
    const dorsalSign = Math.sign(middle.localToWorld(new THREE.Vector3(0, 0, 1)).sub(world(middle)).dot(hand.currentPalmNormal));
    const patches = { backs: [], tips: [] };
    for (const mesh of hand.skinnedMeshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
      const bone = dominant(mesh, vertex);
      if (bone !== middle && bone !== distal) continue;
      mesh.getVertexPosition(vertex, scratch); mesh.localToWorld(scratch);
      const local = bone.worldToLocal(scratch.clone());
      if (bone === middle && local.z * dorsalSign < -.015 && local.y > -.08 && local.y < .33)
        patches.backs.push({ mesh, vertex, local });
      // A DIP-weighted vertex can be near the joint rather than the fingertip.
      // Only the terminal 40% of the distal segment can establish fingertip contact.
      if (bone === distal && local.y > .6 * tipY[side][digit + 1]) patches.tips.push({ mesh, vertex, local });
    }
    for (const [kind, patch] of Object.entries(patches)) assert(patch.length >= 5, `${side}.${name}: measurable ${kind} skin`);
    return [name, patches];
  }));
  const thumbDistal = hand.fingers.thumb.joints[2].bone;
  records[side].thumb = { tips: [] };
  for (const mesh of hand.skinnedMeshes) for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
    if (dominant(mesh, vertex) !== thumbDistal) continue;
    mesh.getVertexPosition(vertex, scratch); mesh.localToWorld(scratch);
    const local = thumbDistal.worldToLocal(scratch.clone());
    if (local.y > .6 * tipY[side][0]) records[side].thumb.tips.push({ mesh, vertex, local });
  }
  assert(records[side].thumb.tips.length >= 5, `${side}: measurable terminal thumb-pad skin`);
  const allowed = new Set([hand.wristJoint.bone, ...fingers.map(n => hand.fingers[n].joints[0].bone)]);
  palms[side] = hand.skinnedMeshes.filter(m => m.geometry.attributes.position.count > 500).map(source => {
    const geometry = source.geometry.clone(), original = geometry.index.array, indices = [];
    for (let i = 0; i < original.length; i += 3)
      if ([original[i], original[i + 1], original[i + 2]].every(v => allowed.has(dominant(source, v)))) indices.push(original[i], original[i + 1], original[i + 2]);
    geometry.setIndex(indices);
    return { source, mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) };
  });
  // Include the metacarpal skin and mixed triangles at the thumb/index web.
  // Grouping only pure finger faces misses a thumb passing through its own
  // index base, even when the opposite thumb is correctly enclosed.
  const thumbBones = new Set(hand.fingers.thumb.joints.map(j => j.bone));
  const indexBones = new Set(hand.fingers.index.joints.map(j => j.bone));
  const middleBones = new Set(hand.fingers.middle.joints.map(j => j.bone));
  handSkinSurfaces[side] = hand.skinnedMeshes.map(mesh => {
    const labels = Array.from({ length: mesh.geometry.attributes.position.count }, (_, v) => dominant(mesh, v));
    const index = mesh.geometry.index.array, faces = [];
    for (let i = 0; i < index.length; i += 3) {
      const ids = [index[i], index[i + 1], index[i + 2]];
      const thumb = ids.some(v => thumbBones.has(labels[v])), finger = ids.some(v => indexBones.has(labels[v]));
      const thumbSurface = ids.every(v => thumbBones.has(labels[v]));
      const indexSurface = ids.every(v => indexBones.has(labels[v]));
      const middle = ids.some(v => middleBones.has(labels[v]));
      const middleTip = ids.some(v => labels[v] === hand.fingers.middle.joints[3].bone);
      faces.push({ ids, thumb, finger, thumbSurface, indexSurface, middle, middleTip });
    }
    return { mesh, faces };
  });
}

const skinEdgeRay = new THREE.Ray(), skinEdgeDirection = new THREE.Vector3(), skinEdgeHit = new THREE.Vector3();
function currentHandSkinFaces(side) {
  return handSkinSurfaces[side].flatMap(({ mesh, faces }) => {
    const positions = new Map();
    for (const face of faces) for (const vertex of face.ids) if (!positions.has(vertex)) {
      const point = new THREE.Vector3(); mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
      positions.set(vertex, point);
    }
    return faces.map(face => {
      const points = face.ids.map(v => positions.get(v));
      return { ...face, mesh, points, box: new THREE.Box3().setFromPoints(points) };
    });
  });
}
function surfaceCrossings(first, second, sameHand) {
  let crossings = 0;
  for (const a of first) for (const b of second) {
    if (!a.box.intersectsBox(b.box)) continue;
    if (sameHand && a.mesh === b.mesh && a.ids.some(v => b.ids.includes(v))) continue;
    let crosses = false;
    for (const [edgeFace, surface] of [[a, b], [b, a]]) {
      for (let edge = 0; edge < 3; edge++) {
        const from = edgeFace.points[edge], to = edgeFace.points[(edge + 1) % 3];
        skinEdgeDirection.subVectors(to, from);
        const length = skinEdgeDirection.length();
        if (length < 1e-8) continue;
        skinEdgeRay.set(from, skinEdgeDirection.multiplyScalar(1 / length));
        if (!skinEdgeRay.intersectTriangle(...surface.points, false, skinEdgeHit)) continue;
        const distance = skinEdgeHit.distanceTo(from);
        // Shared boundary vertices may have split indices at a mesh seam.
        // They are contact, not an edge piercing the interior of a skin face.
        if (distance <= 1e-6 || distance >= length - 1e-6
          || surface.points.some(point => point.distanceTo(skinEdgeHit) < 1e-6)) continue;
        crosses = true; break;
      }
      if (crosses) break;
    }
    if (crosses) crossings++;
  }
  return crossings;
}
function checkGrippingThumbClearance(side) {
  const receiving = side === 'right' ? 'left' : 'right', faces = currentHandSkinFaces(side);
  const thumb = faces.filter(face => face.thumb), index = faces.filter(face => face.finger);
  assert(thumb.length > 20 && index.length > 20, `${side}: measurable thumb and index-base skin`);
  const selfCrossings = surfaceCrossings(thumb, index, true);
  assert.equal(selfCrossings, 0, `${side}: gripping thumb must not pierce its own index metacarpal/knuckle skin (${selfCrossings} triangle crossings)`);
  // Moving the gripping thumb out of its own palm is insufficient if the
  // correction makes it sweep through the cleaned thumb or its neighbouring
  // fingers during rotation. Keep the whole opposing skin in this check.
  const opposingHandCrossings = surfaceCrossings(thumb, currentHandSkinFaces(receiving), false);
  assert.equal(opposingHandCrossings, 0, `${side}: gripping thumb must not pierce the opposing hand (${opposingHandCrossings} triangle crossings)`);
  return { selfCrossings, opposingHandCrossings };
}
function checkTerminalContact(active, name, receiving, surfaceKind, description) {
  const surfaces = handSkinSurfaces[receiving].flatMap(({ mesh, faces }) => {
    const positions = new Map();
    const selected = faces.filter(face => face[surfaceKind]);
    for (const face of selected) for (const vertex of face.ids) if (!positions.has(vertex)) {
      const point = new THREE.Vector3(); mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
      positions.set(vertex, point);
    }
    return selected.map(face => {
      const triangle = new THREE.Triangle(...face.ids.map(v => positions.get(v)));
      return { triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) };
    });
  });
  assert(surfaces.length > 20, `${receiving}: measurable ${surfaceKind} skin`);
  let minimumGap = Infinity, near = 0;
  const point = new THREE.Vector3(), closest = new THREE.Vector3();
  // An entire-digit minimum can come from the proximal phalanx while the
  // fingertip hangs below the grip. Only the terminal cap establishes this
  // contact. Keep its minimum within 6 mm; this coarse skin needs an 8 mm
  // neighbourhood to measure several vertices supporting that contact patch.
  for (const record of records[active][name].tips) {
    record.mesh.getVertexPosition(record.vertex, point); record.mesh.localToWorld(point);
    let distance = Infinity;
    for (const surface of surfaces) {
      if (surface.box.distanceToPoint(point) > distance) continue;
      surface.triangle.closestPointToPoint(point, closest);
      distance = Math.min(distance, closest.distanceTo(point));
    }
    minimumGap = Math.min(minimumGap, distance);
    if (distance <= .008) near++;
  }
  assert(minimumGap <= .006 && near >= 3,
    `${active}: ${description} (${(minimumGap * 1000).toFixed(2)} scene mm, ${near} terminal vertices within 8 mm)`);
  return { minimumGap, near };
}
function checkMiddleTipOnThumb(active, receiving) {
  return checkTerminalContact(active, 'middle', receiving, 'thumbSurface', 'middle fingertip pad must contact the held thumb');
}
function checkFingerHingeFrame(side, name, jointIndices, rollLimit) {
  const joints = rig[side].fingers[name].joints;
  const orientations = joints.map(j => j.bone.getWorldQuaternion(new THREE.Quaternion()));
  const directions = orientations.map(q => new THREE.Vector3(0, 1, 0).applyQuaternion(q));
  const hinge = directions[1].clone().cross(directions[2]).normalize();
  // Transport each calibrated phalanx frame around the existing PIP hinge.
  // An independent shortest-arc aim can preserve the fingertip position while
  // rolling its skin by 150 degrees; unsigned bend/contact tests miss that.
  const rest = joints[0].bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const restFrames = joints.map(joint => rest.multiply(joint.restQuaternion).clone());
  let maximumRoll = 0;
  for (const index of jointIndices) {
    const frame = restFrames[index].normalize();
    const restY = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);
    const planarY = restY.clone().addScaledVector(hinge, -restY.dot(hinge)).normalize();
    const angle = Math.atan2(hinge.dot(planarY.clone().cross(directions[index])), planarY.dot(directions[index]));
    const expected = new THREE.Quaternion().setFromAxisAngle(hinge, angle)
      .multiply(new THREE.Quaternion().setFromUnitVectors(restY, planarY)).multiply(frame).normalize();
    const rollError = expected.angleTo(orientations[index].normalize()) / rad;
    assert(rollError < rollLimit,
      `${side} ${name} ${index === 2 ? 'Middle' : 'Tip'} retains its hinge frame without axial winding (${rollError.toFixed(4)} deg)`);
    maximumRoll = Math.max(maximumRoll, rollError);
  }
  return maximumRoll;
}
function checkMiddleDistalHinge() {
  const joints = rig.right.fingers.middle.joints;
  assert.deepEqual(joints.map(j => j.name), ['Bone009', 'Bone010', 'Bone011', 'Bone012'],
    'the middle chain maps metacarpal, MCP/Base, PIP/Middle and DIP/Tip in hierarchy order');
  for (let k = 1; k < joints.length; k++) assert.equal(joints[k].bone.parent, joints[k - 1].bone);
  return checkFingerHingeFrame('right', 'middle', [3], .1);
}
const middleSkinNeighbours = new Map();
function neighbouringSkinFaces(a, b) {
  if (a.mesh !== b.mesh) return false;
  if (!middleSkinNeighbours.has(a.mesh)) {
    // Weld duplicate seam vertices in the unchanged bind geometry. Adjacent
    // polygons compress at a low-poly knuckle crease; the regression is the
    // distal skin winding through remote faces, four or more edges away.
    const position = a.mesh.geometry.attributes.position, index = a.mesh.geometry.index.array;
    const welded = new Map(), vertices = [];
    for (let v = 0; v < position.count; v++) {
      const key = [position.getX(v), position.getY(v), position.getZ(v)].map(x => Math.round(x * 1e5)).join(',');
      if (!welded.has(key)) welded.set(key, welded.size);
      vertices.push(welded.get(key));
    }
    const edges = Array.from({ length: welded.size }, () => new Set());
    for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
      const from = vertices[index[i + k]], to = vertices[index[i + (k + 1) % 3]];
      edges[from].add(to); edges[to].add(from);
    }
    const neighbours = edges.map((_, vertex) => {
      let frontier = new Set([vertex]); const seen = new Set(frontier);
      for (let depth = 0; depth < 3; depth++) {
        const next = new Set();
        for (const v of frontier) for (const n of edges[v]) if (!seen.has(n)) { seen.add(n); next.add(n); }
        frontier = next;
      }
      return seen;
    });
    middleSkinNeighbours.set(a.mesh, { vertices, neighbours });
  }
  const { vertices, neighbours } = middleSkinNeighbours.get(a.mesh);
  return a.ids.some(v => b.ids.some(w => neighbours[vertices[v]].has(vertices[w])));
}
function checkMiddleSkinFolds() {
  const faces = currentHandSkinFaces('right').filter(f => f.middle);
  let crossings = 0;
  for (let a = 0; a < faces.length; a++) for (let b = a + 1; b < faces.length; b++) {
    if (!(faces[a].middleTip || faces[b].middleTip) || !faces[a].box.intersectsBox(faces[b].box)
      || neighbouringSkinFaces(faces[a], faces[b])) continue;
    crossings += surfaceCrossings([faces[a]], [faces[b]], true);
  }
  assert.equal(crossings, 0, 'the right middle Tip skin does not fold through nonlocal middle-finger faces');
  assert.equal(surfaceCrossings(faces, currentHandSkinFaces('left'), false), 0,
    'the right middle finger does not pierce the held thumb or opposing hand');
}
function checkThumbOpposition(side) {
  // Collision freedom alone permits an isolated thumb floating beside the
  // clasp. Its terminal pad must oppose the fingers on the outer index skin.
  return checkTerminalContact(side, 'thumb', side, 'indexSurface', 'gripping thumb pad must rest against its own index');
}
function updatePalm(side) {
  palmTriangles[side] = [];
  for (const { source, mesh } of palms[side]) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      source.getVertexPosition(i, scratch); source.localToWorld(scratch); position.setXYZ(i, scratch.x, scratch.y, scratch.z);
    }
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    const index = mesh.geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const points = [index[i], index[i + 1], index[i + 2]].map(v => new THREE.Vector3().fromBufferAttribute(position, v));
      const triangle = new THREE.Triangle(...points), normal = triangle.getNormal(new THREE.Vector3());
      // Cupped MCP landmarks tilt the diagnostic palm normal away from the
      // curved skin. It identifies the palmar side, not a planar contact ray.
      if (normal.dot(rig[side].currentPalmNormal) > .2)
        palmTriangles[side].push({ triangle, normal, box: new THREE.Box3().setFromPoints(points) });
    }
  }
  assert(palmTriangles[side].length > 10, `${side}: measurable outward-facing palmar triangles`);
}
const contactRay = new THREE.Raycaster();
function contactPatch(side, receiver, name, kind) {
  const patch = records[side][name][kind], near = [], all = [], samples = [], closest = new THREE.Vector3();
  for (const record of patch) {
    record.mesh.getVertexPosition(record.vertex, scratch); record.mesh.localToWorld(scratch);
    let distance = Infinity, gap = Infinity;
    for (const surface of palmTriangles[receiver]) {
      if (surface.box.distanceToPoint(scratch) > distance) continue;
      surface.triangle.closestPointToPoint(scratch, closest);
      const candidate = closest.distanceTo(scratch);
      if (candidate < distance) {
        distance = candidate;
        const signed = scratch.clone().sub(closest).dot(surface.normal);
        const barycentric = surface.triangle.getBarycoord(closest, new THREE.Vector3());
        // The cropped palmar patch has open edges. A point outside an edge
        // can lie behind its face plane while remaining outside the hand.
        // Only an interior face projection provides a valid inward sign.
        const interior = barycentric && Math.min(barycentric.x, barycentric.y, barycentric.z) > 1e-5;
        gap = interior && signed < 0 ? -candidate : candidate;
      }
    }
    if (!Number.isFinite(distance)) continue;
    all.push(gap);
    samples.push({ distance, gap, local: record.local.toArray() });
    if (gap >= -.002 && distance <= .008) near.push({ ...record, world: scratch.clone() });
  }
  assert(all.length >= 3, `${kind}.${side}.${name}: measurable distance to opposing palmar skin`);
  if (Math.min(...all) < -.003) console.error('CONTACT PENETRATION:', kind, side, name, JSON.stringify(samples.sort((a, b) => a.gap - b.gap).slice(0, 3)));
  assert(Math.min(...all) > -.003, `${kind}.${side}.${name}: contact skin penetrates the palm (${Math.min(...all)})`);
  if (near.length < 3) console.error('CONTACT PATCH:', kind, side, name, JSON.stringify(samples.sort((a, b) => a.distance - b.distance).slice(0, 8)));
  assert(near.length >= 3, `${kind}.${side}.${name}: contact is a skin patch rather than one vertex (${near.length})`);
  const extent = (items, axis) => Math.max(...items.map(p => p.local[axis])) - Math.min(...items.map(p => p.local[axis]));
  if (kind === 'backs') {
    const longFraction = extent(near, 'y') / extent(patch, 'y'), wideFraction = extent(near, 'x') / extent(patch, 'x');
    // Curved little-finger backs can contact along a long, narrower patch.
    // Require area as well as both dimensions; isolated tip/edge contacts fail.
    assert(longFraction > .1 && wideFraction > .1 && longFraction * wideFraction > .08,
      `${side}.${name}: broad dorsal contact (${longFraction.toFixed(2)}, ${wideFraction.toFixed(2)})`);
  }
  return { min: Math.min(...all), near: near.length, center: near.reduce((s, p) => s.add(p.world), new THREE.Vector3()).multiplyScalar(1 / near.length) };
}
function checkAppliedPose(pose, id) {
  for (const side of sides) for (const name of names) {
    const hand = rig[side], target = pose[side].fingers[name];
    hand.fingers[name].joints.forEach((joint, index) => {
      const expected = joint.restQuaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        target.jointCurls[index] * rad * hand.curlSign, target.jointTwists[index] * rad,
        target.jointSpreads[index] * rad * hand.spreadSign, 'XYZ',
      ))).normalize();
      assert(joint.bone.quaternion.clone().normalize().angleTo(expected) < 1e-7, `${id}.${side}.${joint.name}: final applied articulation matches authored XYZ channels`);
      assert(joint.bone.position.distanceTo(joint.restPosition) < 1e-8, `${id}.${side}.${joint.name}: bone position and length preserved`);
    });
  }
}
function checkBends(side, id) {
  return fingers.map(name => {
    const p = chain(side, name), a = p[1].clone().sub(p[0]), b = p[2].clone().sub(p[1]), c = p[3].clone().sub(p[2]);
    const pip = a.angleTo(b) / rad, dip = b.angleTo(c) / rad;
    assert(pip > 5 && pip < 115 && dip > 5 && dip < 100, `${id}.${side}.${name}: anatomical PIP/DIP bend (${pip.toFixed(1)}, ${dip.toFixed(1)} deg)`);
    return [pip, dip];
  });
}
function checkCluster(active, receiving, patches) {
  const hand = rig[receiving], normal = hand.currentPalmNormal;
  assert(normal.y > .8, 'the receiving palm remains open and upward');
  const u = hand.currentFingerForward.clone().addScaledVector(normal, -hand.currentFingerForward.dot(normal)).normalize();
  const v = normal.clone().cross(u).normalize();
  const center = patches.reduce((s, p) => s.add(p.center), new THREE.Vector3()).multiplyScalar(.25);
  const relative = center.clone().sub(hand.currentPalmWorld); relative.addScaledVector(normal, -relative.dot(normal));
  assert(relative.length() < .045, `the compact fingertip cluster stays in the central palm (${relative.length()})`);
  const points = patches.map(p => p.center.clone().sub(center)), xy = points.map(p => [p.dot(u), p.dot(v)]);
  const spans = [0, 1].map(k => Math.max(...xy.map(p => p[k])) - Math.min(...xy.map(p => p[k])));
  const diameter = Math.max(...points.flatMap(a => points.map(b => a.distanceTo(b))));
  // Normalize to this non-mirrored model's real palm, not an invented scene-mm
  // hand size. Exclude the forearm and extended fingers from the palm bounds.
  const wrist = world(hand.wristJoint.bone), knuckles = fingers.map(n => world(hand.fingers[n].joints[1].bone));
  const start = wrist.clone().sub(hand.currentPalmWorld).dot(u), end = Math.max(...knuckles.map(p => p.clone().sub(hand.currentPalmWorld).dot(u)));
  const palmUV = [];
  for (const { mesh } of palms[receiving]) {
    const position = mesh.geometry.attributes.position;
    for (const index of new Set(mesh.geometry.index.array)) {
      const d = new THREE.Vector3().fromBufferAttribute(position, index).sub(hand.currentPalmWorld), x = d.dot(u);
      if (x >= start && x <= end) palmUV.push([x, d.dot(v)]);
    }
  }
  assert(palmUV.length > 10, 'measurable receiving-palm skin between wrist and MCP joints');
  const bounds = [0, 1].map(k => [Math.min(...palmUV.map(p => p[k])), Math.max(...palmUV.map(p => p[k]))]);
  const palmSpan = bounds.map(([min, max]) => max - min), normalizedSpans = spans.map((span, k) => span / palmSpan[k]);
  for (const patch of patches) {
    const d = patch.center.clone().sub(hand.currentPalmWorld), p = [d.dot(u), d.dot(v)];
    assert(p.every((coordinate, k) => coordinate >= bounds[k][0] - .004 && coordinate <= bounds[k][1] + .004),
      `each fingertip pad contacts the anatomical palm, within wrist/MCP skin bounds (${p}, ${bounds})`);
  }
  assert(normalizedSpans.every(span => span < 1), `the fingertip cluster fits inside the real palm (${normalizedSpans})`);
  const xx = xy.reduce((s, p) => s + p[0] ** 2, 0), yy = xy.reduce((s, p) => s + p[1] ** 2, 0), cross = xy.reduce((s, p) => s + p[0] * p[1], 0);
  const trace = xx + yy, disc = Math.hypot(xx - yy, 2 * cross), ratio = (trace - disc) / (trace + disc);
  assert(ratio > .025, `fingertip contacts occupy a 2D cluster rather than a separated row (${ratio})`);
  // A broad cluster can fit this rig while still being visibly wider than the
  // reference bundle. Report that limitation instead of claiming an exact match.
  if (Math.max(...normalizedSpans) > .55) console.warn(`VISUAL LIMITATION: ${active} fingertip cluster remains broad: ${spans.map(x => (x * 1000).toFixed(1)).join(' x ')} scene mm; palm fractions ${normalizedSpans.map(x => x.toFixed(2)).join(' x ')}.`);
  return { diameter, spans, palmSpan, normalizedSpans, covarianceRatio: ratio, centerOffset: relative.length() };
}
function checkGrip(active, receiving) {
  const { selfCrossings, opposingHandCrossings } = checkGrippingThumbClearance(active);
  const middleTip = checkMiddleTipOnThumb(active, receiving);
  if (active === 'right') { checkMiddleDistalHinge(); checkMiddleSkinFolds(); }
  else for (const name of ['middle', 'ring']) checkFingerHingeFrame('left', name, [2, 3], 5);
  const thumbOpposition = checkThumbOpposition(active);
  const held = chain(receiving, 'thumb'), origin = held[1], axis = held[2].clone().sub(origin).normalize();
  const u = new THREE.Vector3(0, 1, 0).cross(axis).normalize(), v = axis.clone().cross(u);
  const arcs = {}, axial = [];
  for (const name of fingers) {
    const points = chain(active, name), angles = points.map(p => { const d = p.clone().sub(origin); return Math.atan2(d.dot(v), d.dot(u)); });
    const unwrapped = [angles[0]];
    for (let i = 1; i < angles.length; i++) unwrapped.push(unwrapped[i - 1]
      + Math.atan2(Math.sin(angles[i] - angles[i - 1]), Math.cos(angles[i] - angles[i - 1])));
    // Measure the angular span of the hook, not just MCP-to-tip net winding.
    // A correctly curled DIP pad turns back toward the thumb: e.g. a chain
    // spanning 41..129 degrees and ending at 100 still covers 88 degrees.
    // Endpoint subtraction would incorrectly cancel that distal return.
    arcs[name] = (Math.max(...unwrapped) - Math.min(...unwrapped)) / rad;
    if (name === 'index' || name === 'middle') axial.push(...points.map(p => p.clone().sub(origin).dot(axis)));
  }
  // Each digit occupies a different axial part of the thumb. A middle finger
  // can form a valid half-wrap while the index and opposed thumb close the
  // cage. The actual shared skin-section test below establishes enclosure.
  assert(arcs.index > 160 && fingers.every(name => arcs[name] > 80),
    `the articulated gripping fingers curve around the held thumb (${JSON.stringify(arcs)})`);
  const protrusion = held[3].clone().sub(origin).dot(axis) - Math.max(...axial);
  assert(protrusion > .005, `the held thumb protrudes naturally beyond the gripping fingers (${protrusion})`);
  // Test one shared axial section of the real skinned surfaces. Rays must cross
  // the ring's entry and exit surfaces: an odd count places the thumb axis in
  // solid gripping-hand tissue instead of the air space inside a clasp.
  for (const side of [active, receiving]) for (const mesh of rig[side].skinnedMeshes) {
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.side = THREE.DoubleSide;
  }
  let section = { coverage: 0, buriedRays: 0, minimumGap: Infinity };
  for (let sample = 0; sample < 7; sample++) {
    const t = THREE.MathUtils.lerp(Math.min(...axial), Math.max(...axial), (sample + .5) / 7);
    const center = origin.clone().addScaledVector(axis, t), candidate = { coverage: 0, buriedRays: 0, minimumGap: Infinity };
    for (let ray = 0; ray < 12; ray++) {
      const direction = u.clone().multiplyScalar(Math.cos(ray * Math.PI / 6)).addScaledVector(v, Math.sin(ray * Math.PI / 6));
      contactRay.set(center, direction);
      const hits = contactRay.intersectObjects(rig[active].skinnedMeshes, false);
      const distances = hits.map(h => h.distance).filter((d, i, all) => !i || d - all[i - 1] > 1e-5);
      if (!distances.length || distances[0] > .15) continue;
      candidate.coverage++;
      if (distances.length % 2) candidate.buriedRays++;
      const thumbSurface = contactRay.intersectObjects(rig[receiving].skinnedMeshes, false)[0];
      if (thumbSurface) candidate.minimumGap = Math.min(candidate.minimumGap, distances[0] - thumbSurface.distance);
    }
    if (candidate.coverage - candidate.buriedRays > section.coverage - section.buriedRays) section = candidate;
  }
  assert(section.coverage >= 8 && section.buriedRays <= 1, `real grip skin encloses a shared thumb section without burying its axis (${JSON.stringify(section)})`);
  assert(section.minimumGap > -.003 && section.minimumGap < .02, `thumb/grip skins retain close contact at the enclosing section (${section.minimumGap})`);
  return { arcs, protrusion, section, selfCrossings, opposingHandCrossings, middleTip, thumbOpposition };
}
const collectFailures = process.argv.includes('--collect-failures'), failures = [];
for (const [id, kind] of [['rubBacksOfFingers', 'backs'], ['rubThumbs', 'grip'], ['rubFingertips', 'tips']]) {
  for (const active of sides) {
    const receiving = active === 'right' ? 'left' : 'right';
    const samples = kind === 'grip'
      ? Array.from({ length: 17 }, (_, i) => active === 'right' ? .16 + .27 * i / 16 : .61 + .39 * i / 16)
      : active === 'right' ? kind === 'backs' ? [.29, .34, .39, .44] : [.19, .26, .33, .40]
        : kind === 'backs' ? [.78, .85, .90, .98] : [.68, .78, .88, .98];
    for (const progress of samples) {
      try {
      const pose = evaluateStagePose(id, progress, 0, { pumpStroke: 0, pumpPressProgress: 0 });
      animator.applyPose(pose, 0, 28, 28); checkAppliedPose(pose, id);
      const bends = checkBends(active, id), measurement = { id, active, progress, bends };
      if (kind === 'grip') measurement.grip = checkGrip(active, receiving);
      else {
        const touching = kind === 'backs' ? sides : [active], patches = {};
        for (const side of touching) {
          const receiver = side === 'right' ? 'left' : 'right'; updatePalm(receiver);
          patches[side] = fingers.map(name => contactPatch(side, receiver, name, kind));
        }
        measurement.contacts = Object.fromEntries(Object.entries(patches).map(([s, ps]) => [s, ps.map(p => ({ gap: p.min, near: p.near }))]));
        if (kind === 'tips') measurement.cluster = checkCluster(active, receiving, patches[active]);
      }
      console.log('CONTACT:', JSON.stringify(measurement));
      } catch (error) {
        if (!collectFailures) throw error;
        failures.push(`${id}.${active}@${progress}: ${error.message}`); console.error('FAIL:', failures.at(-1));
      }
    }
  }
}
// Seeking straight to a valid pose can hide a thumb moving through its index
// base during filtered playback. Advance the actual rig through the whole stage
// with the production contact filter, checking both established grips at 4 Hz.
const thumbStage = HANDWASHING_STAGES.find(stage => stage.id === 'rubThumbs');
const contactLambda = DEFAULT_HANDWASHING_CONFIG.contactDampingLambda;
for (const fps of [30, 60, 144]) {
  let progress = 0, checked = 0, previousMiddleTip = null, maximumMiddleTipStep = 0;
  try {
    animator.applyPose(evaluateStagePose('rubThumbs', 0, 0, { pumpStroke: 0, pumpPressProgress: 0 }), 0, contactLambda, contactLambda);
    for (let frame = 1; frame <= Math.round(thumbStage.duration * fps); frame++) {
      const elapsed = frame / fps;
      progress = Math.min(1, elapsed / thumbStage.duration);
      animator.applyPose(evaluateStagePose('rubThumbs', progress, elapsed, { pumpStroke: 0, pumpPressProgress: 0 }),
        1 / fps, contactLambda, contactLambda);
      const middleTip = rig.right.fingers.middle.joints[3].bone.quaternion.clone().normalize();
      if (progress >= .18 && progress <= .43) {
        checkMiddleDistalHinge();
        if (previousMiddleTip) maximumMiddleTipStep = Math.max(maximumMiddleTipStep, previousMiddleTip.angleTo(middleTip) / rad);
      }
      if (progress >= .63) for (const name of ['middle', 'ring']) checkFingerHingeFrame('left', name, [2, 3], 5);
      previousMiddleTip = middleTip;
      if (frame % Math.round(fps / 4)) continue;
      const active = progress >= .18 && progress <= .43 ? 'right' : progress >= .63 ? 'left' : null;
      if (active) {
        checkGrippingThumbClearance(active);
        checkMiddleTipOnThumb(active, active === 'right' ? 'left' : 'right');
        if (active === 'right') checkMiddleSkinFolds();
        checkThumbOpposition(active);
        checked++;
      }
    }
    assert(checked >= 30, `${fps} FPS: both thumb grips receive temporal surface checks`);
    assert(maximumMiddleTipStep < 5, `${fps} FPS: right middle Tip moves continuously without axial flips (${maximumMiddleTipStep.toFixed(3)} deg/frame)`);
    console.log(`PASS: thumb skin stays separate and the middle/own-thumb terminal pads keep contact during ${checked} damped playback samples at ${fps} FPS.`);
  } catch (error) {
    if (!collectFailures) throw error;
    failures.push(`rubThumbs.${fps}fps@${progress}: ${error.message}`); console.error('FAIL:', failures.at(-1));
  }
}
for (const hand of Object.values(palms)) for (const { mesh } of hand) { mesh.geometry.dispose(); mesh.material.dispose(); }
assert.equal(failures.length, 0, `${failures.length} sampled contact checks failed; see FAIL diagnostics above`);
console.log('PASS: final skeletal articulation, anatomical bends, broad dorsal skin contact, enclosing thumb grips and compact terminal fingertip clusters. This sampled check is not a complete triangle collision proof.');
