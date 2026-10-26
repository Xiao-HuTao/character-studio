/**
 * 老酸奶 v4 · 动画版 —— Coopanion figure pack 入口。
 *
 * 画法：21 张 PNG 按装配坐标平铺，节点绕 pivot 旋转。
 * 走路由宿主给的 frame.legs（髋/脚在 logo 空间的位置）驱动，不是逐帧动画。
 * 眨眼用眼睛节点竖向压缩；说话用嘴部缩放；挥手/点头/摇头由 frame.gesture 驱动。
 */
const NS = 'http://www.w3.org/2000/svg';

export async function createRigBody(base, opts) {
  const { kit, model, host } = opts;
  const doc = host.root.ownerDocument;

  const baseStr = String(base || '');
  const assetUrl = (p) => {
    if (opts.asset) return String(opts.asset(p.file));
    try { return new URL(p.file, base).href; } catch (e) { return baseStr.replace(/\/?$/, '/') + p.file; }
  };

  const s = model.logo_scale;
  const X = (x) => 128 + (x - model.center_x) * s;
  const Y = (y) => 256 + (y - model.feet_y) * s;
  const deg = Math.PI / 180;

  const N = model.nodes;
  const parts = model.parts.slice().sort((a, b) => a.z - b.z).map((p) => ({
    ...p,
    x: X(p.box[0]), y: Y(p.box[1]), w: p.box[2] * s, h: p.box[3] * s
  }));

  const T = (x, y) => [1, 0, 0, 1, x, y];
  const R = (a) => { const c = Math.cos(a), sn = Math.sin(a); return [c, sn, -sn, c, 0, 0]; };
  const S = (x, y) => [x, 0, 0, y, 0, 0];
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
  ];

  let group = null;
  let flip = null;
  let featEls = null;
  let featEyeEls = null;
  const nodes = new Map();
  const order = [];

  function ensure(petG) {
    if (flip && flip.parentNode === petG) return;
    if (flip && flip.parentNode) flip.parentNode.removeChild(flip);
    nodes.clear();
    order.length = 0;
    flip = doc.createElementNS(NS, 'g');
    group = doc.createElementNS(NS, 'g');
    flip.append(group);
    petG.append(flip);
    for (const p of parts) {
      const im = doc.createElementNS(NS, 'image');
      im.setAttribute('preserveAspectRatio', 'none');
      const url = assetUrl(p);
      im.setAttribute('href', url);
      try { im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url); } catch (e) { /* SVG2 href is enough */ }
      im.setAttribute('width', String(p.w));
      im.setAttribute('height', String(p.h));
      group.append(im);
      nodes.set(p.id, im);
      order.push(p);
    }
    featEls = new Map();
    if (model.feat && model.feat.mouths) {
      for (const [k, rel] of Object.entries(model.feat.mouths)) {
        const fb=model.feat.mouthBoxes?.[k]||model.feat.box;
        const fw=fb[2]*s,fh=fb[3]*s;
        const im = doc.createElementNS(NS, 'image');
        im.setAttribute('preserveAspectRatio', 'none');
        im.setAttribute('href', assetUrl({ file: rel }));
        im.setAttribute('width', String(fw));
        im.setAttribute('height', String(fh));
        im.setAttribute('opacity', '0');
        group.append(im);
        featEls.set(k, im);
      }
    }
    featEyeEls = new Map();
    if (model.feat && model.feat.eyes && model.feat.eyeBoxes) {
      for (const [state, sides] of Object.entries(model.feat.eyes)) {
        for (const side of ['near', 'far']) {
          const b = model.feat.eyeBoxesByState?.[state]?.[side] || model.feat.eyeBoxes[side];
          if (!b || !sides[side]) continue;
          const im = doc.createElementNS(NS, 'image');
          im.setAttribute('preserveAspectRatio', 'none');
          im.setAttribute('href', assetUrl({ file: sides[side] }));
          im.setAttribute('width', String(b[2] * s));
          im.setAttribute('height', String(b[3] * s));
          im.setAttribute('opacity', '0');
          group.append(im);
          featEyeEls.set(state + ':' + side, im);
        }
      }
    }
  }

  const env = (k) => Math.sin(Math.PI * Math.max(0, Math.min(1, k)));

  function draw(petG, face, frame) {
    ensure(petG);
    const nodeDefs = {};
    for (const [k, v] of Object.entries(model.nodes || {})) {
      nodeDefs[k] = Array.isArray(v) ? { pivot: v.slice(0, 2), parent: null } : v;
    }
    const np = (n, d) => (nodeDefs[n] && nodeDefs[n].pivot) || d;
    const mode = frame.mode || 'idle';
    const TUNE = model.tune || {};
    const tv = (m, k, d = 1) => {
      const g = TUNE[m];
      const v = g && Number.isFinite(g[k]) ? g[k] : d;
      return v;
    };
    const walkKey = mode === 'run' ? 'run' : (mode === 'drag' ? 'drag' : (mode === 'air' ? 'jump' : 'walk'));
    const blinkK = Number.isFinite(TUNE.blink) ? TUNE.blink : 1;
    const t = frame.t || 0;
    const breathe = 1 + 0.008 * tv('idle', 'breath') * Math.sin(t * Math.PI * 1.1);
    const sway = (frame.swing || 0);

    // 头部
    let headRot = 1.3 * tv('idle', 'sway') * Math.sin(t * 0.7) + sway * 0.25 * tv('idle', 'sway');
    let headDx = 0;
    const lk = frame.look;
    if (lk) {
      const lx = Array.isArray(lk) ? lk[0] : lk.x;
      if (Number.isFinite(lx)) {
        headRot += Math.max(-10, Math.min(10, lx * 0.2)) * tv('idle', 'head');
        headDx += Math.max(-2.5, Math.min(2.5, lx * 0.15)) * tv('idle', 'head');
      }
    }
    const g = frame.gesture;
    const gk = g && Number.isFinite(g.k) ? g.k : 0;
    if (g && g.kind === 'nod') headRot += 9 * env(gk);
    if (g && g.kind === 'shake') headDx = 3.2 * Math.sin(gk * Math.PI * 6);
    if (g && g.kind === 'wave') headRot -= 3 * tv('wave', 'head') * env(gk);

    const blink = frame.blink || 0;
    const eyeSy = Math.max(0.22, 1 - 0.8 * blinkK * blink);
    const talk = frame.talk || 0;
    const mouthSy = 1 + 0.55 * talk;
    const mouthSx = 1 + 0.15 * talk;

    const bodyM = mul(T(128, 256), mul(S(1, breathe), T(-128, -256)));
    // 腰部：鞠躬只转上身（裙/腿留在 body），头、手臂、上衣都挂在 torso 下
    const wa = np('torso', [620, 1000]);
    const waistX = X(wa[0]), waistY = Y(wa[1]);
    const bow = (g && g.kind === 'bow') ? 12 * tv('bow', 'angle') * env(gk) : 0;
    const torsoM = mul(bodyM, mul(T(waistX, waistY), mul(R(bow * deg), T(-waistX, -waistY))));
    const hd = np('head', [626, 765]);
    const headM = mul(torsoM, mul(T(X(hd[0]) + headDx, Y(hd[1])), mul(R(headRot * deg), T(-X(hd[0]) - headDx, -Y(hd[1])))));
    // 头发直接绑在头上：跟头部一起转，没有自己的摆动，刷/晃时不会和脸错开。
    const hairM = headM;
    const ey = np('eyes', [676, 576]);
    const eyesM = mul(headM, mul(T(X(ey[0]), Y(ey[1])), mul(S(1, eyeSy), T(-X(ey[0]), -Y(ey[1])))));
    // 虹膜单独平移：真视线跟随；眨眼时隐藏虹膜
    const gz = model.gaze || { x: 3.5, y: 2.5, k: 0.8 };
    let gx = 0, gy = 0;
    if (lk) {
      const lx = Array.isArray(lk) ? lk[0] : lk.x;
      const ly = Array.isArray(lk) ? lk[1] : lk.y;
      if (Number.isFinite(lx)) gx = Math.max(-gz.x, Math.min(gz.x, lx * gz.k));
      if (Number.isFinite(ly)) gy = Math.max(-gz.y, Math.min(gz.y, ly * (gz.ky || 0.6)));
    }
    const irisM = mul(eyesM, T(gx, gy));

    // 表情：眉毛随 frame.face 抬/压，嘴随表情微调
    const faceName = frame.face || 'neutral';
    let browLift = 0, browNearTilt = 0, browFarTilt = 0, mouthK = 1;
    if (faceName === 'angry' || faceName === 'determined') { browLift = -2.2; browNearTilt = 8; browFarTilt = -8; mouthK = 0.92; }
    else if (faceName === 'sad' || faceName === 'worried') { browLift = 2.0; browNearTilt = -5; browFarTilt = 5; }
    else if (faceName === 'surprised' || faceName === 'scared') { browLift = 3.5; mouthK = 1.25; }
    else if (faceName === 'happy' || faceName === 'excited') { browLift = 1.6; }

    let eyeState = null;
    if (faceName === 'dizzy') eyeState = 'dizzy';
    else if (faceName === 'dragged' || faceName === 'flustered') eyeState = 'drag';

    if (featEyeEls && model.feat && model.feat.eyeBoxes) {
      for (const [k, im] of featEyeEls) {
        const [st, side] = k.split(':');
        const b = model.feat.eyeBoxesByState?.[st]?.[side] || model.feat.eyeBoxes[side];
        const bw = b[2] * s, bh = b[3] * s;
        const ecx = X(b[0]) + bw / 2, ecy = Y(b[1]) + bh / 2;
        const spinK = tv('dizzy', 'spin', 2.0);
        const jitK = tv('flustered', 'jitter', 0.8);
        const spin = eyeState === 'dizzy' ? (side === 'near' ? 1 : -1) * t * spinK : 0;
        const jx = eyeState === 'drag' ? Math.sin(t * 55 + (side === 'near' ? 0 : 1.4)) * jitK : 0;
        const jy = eyeState === 'drag' ? Math.cos(t * 47 + (side === 'near' ? 0.6 : 0)) * jitK * 0.6 : 0;
        const em = mul(headM, mul(T(ecx + jx, ecy + jy), mul(R(spin), T(-bw / 2, -bh / 2))));
        im.setAttribute('transform', `matrix(${em.map((v) => v.toFixed(4)).join(',')})`);
        im.setAttribute('opacity', st === eyeState ? '1' : '0');
      }
    }

    let mouthState = null;
    if (faceName === 'happy' || faceName === 'excited') mouthState = 'smile';
    else if (faceName === 'surprised' || faceName === 'scared') mouthState = 'o';
    else if (faceName === 'worried' || faceName === 'sad' || faceName === 'cry' || faceName === 'dizzy' || faceName === 'flustered' || faceName === 'dragged') mouthState = 'wavy';
    else if (faceName === 'shy' || faceName === 'love' || faceName === 'pout') mouthState = 'pout';
    if (!featEls?.has(mouthState)) mouthState = null;

    if (featEls && model.feat && model.feat.box) {
      for (const [k, im] of featEls) {
        const fb=model.feat.mouthBoxes?.[k]||model.feat.box;
        const fw=fb[2]*s,fh=fb[3]*s,fcx=X(fb[0])+fw/2,fcy=Y(fb[1])+fh/2;
        const fm=mul(headM,mul(T(fcx,fcy),T(-fw/2,-fh/2)));
        im.setAttribute('transform', `matrix(${fm.map((v) => v.toFixed(4)).join(',')})`);
        im.setAttribute('opacity', k === mouthState ? '1' : '0');
      }
    }

    const browM = (p) => {
      const bx = p.x + p.w / 2, by = p.y + p.h / 2;
      const tilt = p.id.includes('near') ? browNearTilt : browFarTilt;
      return mul(headM, mul(T(0, browLift), mul(T(bx, by), mul(R(tilt * deg), T(-bx, -by)))));
    };

    // 腿角先算：手臂与同侧腿反相
    const legs = frame.legs || [];
    const legAngle = (i) => {
      const f = legs[i];
      if (!f || !Number.isFinite(f[0])) return 0;
      const hx = f[0], hy = f[1], fx = f[2], fy = f[3];
      let d = Math.atan2(fy - hy, fx - hx) - Math.PI / 2;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.max(-0.52 * tv(walkKey, 'leg'), Math.min(0.52 * tv(walkKey, 'leg'), d));
    };
    const legRot = [legAngle(0), legAngle(1)];
    // 手臂：sync=0 与同侧腿反相（正常走），sync=1 同手同脚
    const syncK = Math.max(0, Math.min(1, tv(walkKey, 'sync', 0)));
    const armSign = 1 - 2 * syncK;
    let armNearRot = armSign * legRot[0] / deg * tv(walkKey, 'arm') - sway * 0.2 * tv('idle', 'sway');
    let armFarRot = armSign * legRot[1] / deg * tv(walkKey, 'arm') - sway * 0.2 * tv('idle', 'sway');
    const flailK = mode === 'drag' ? tv('drag', 'flail') : tv('jump', 'arm');
    if (mode === 'drag' || mode === 'air') {
      // 被拎/空中：两臂快速扑腾，左右不同频
      armNearRot = (-42 + 20 * Math.sin(t * 15.5)) * flailK;
      armFarRot = (36 - 18 * Math.sin(t * 13.2 + 1.2)) * flailK;
    }
    if (g && g.kind === 'wave') armNearRot -= 100 * tv('wave', 'angle') * env(gk);
    if (mode === 'idle') {
      armNearRot += 2.2 * tv('idle', 'arm') * Math.sin(t * 1.1);
      armFarRot -= 2.2 * tv('idle', 'arm') * Math.sin(t * 1.1 + 0.5);
    }
    if (frame.mode === 'dance') {
      armNearRot = 16 * tv('dance', 'arm') * Math.sin(t * 4.4);
      armFarRot = -16 * tv('dance', 'arm') * Math.sin(t * 4.4);
      headRot += 3 * tv('dance', 'head') * Math.sin(t * 2.2);
    }

    const an = np('armNear', [500, 760]);
    const armNearM = mul(torsoM, mul(T(X(an[0]), Y(an[1])), mul(R(armNearRot * deg), T(-X(an[0]), -Y(an[1])))));
    const af = np('armFar', [800, 770]);
    const armFarM = mul(torsoM, mul(T(X(af[0]), Y(af[1])), mul(R(armFarRot * deg), T(-X(af[0]), -Y(af[1])))));

    // 腿：用「脚相对髋的偏角」驱动，而不是宿主的绝对脚位。
    // 宿主的髋/脚位是给 Coo/whale 的（HIPS 104/150），直接套会把腿拉离裙摆；
    // 宿主 rest 时脚在髋正下方，所以 idle 偏角为 0，走路时才摆动。
    const legM = (i, id) => {
      const rest = np(id, id === 'legNear' ? [572, 1120] : [742, 1145]);
      const hipX = X(rest[0]), hipY = Y(rest[1]);
      const rot = legRot[i] || 0;
      return mul(bodyM, mul(T(hipX, hipY), mul(R(rot), T(-hipX, -hipY))));
    };

    const M = {
      body: bodyM, torso: torsoM, head: headM, hair: headM,
      eyes: eyesM, iris: irisM,
      armNear: armNearM, armFar: armFarM,
      legNear: legM(0, 'legNear'), legFar: legM(1, 'legFar')
    };
    const pending = new Set(Object.keys(nodeDefs).filter((n) => !M[n]));
    let guard = 0;
    while (pending.size && guard++ < 20) {
      for (const n of [...pending]) {
        const nd = nodeDefs[n];
        const parent = nd.parent;
        if (parent && !M[parent]) continue;
        let r = 0;
        if (/^wrist/i.test(n)) r = -armNearRot * 0.35;
        else if (/^ankle/i.test(n)) r = -legRot[0] / deg * 0.25;
        else if (/^elbow/i.test(n)) r = -armNearRot * 0.25;
        else if (/^knee/i.test(n)) r = -legRot[0] / deg * 0.25;
        const pv = nd.pivot;
        const local = mul(T(pv[0], pv[1]), mul(R(r * deg), T(-pv[0], -pv[1])));
        M[n] = parent && M[parent] ? mul(M[parent], local) : local;
        pending.delete(n);
      }
    }

    for (const p of order) {
      let m = M[p.node] || bodyM;
      if (p.node === 'brow') m = browM(p);
      else if (p.node === 'mouth') m = mul(headM, mul(T(X(p.box[0] + p.box[2] / 2), Y(p.box[1] + p.box[3] / 2)), mul(S(mouthSx * mouthK, mouthSy * mouthK), T(-X(p.box[0] + p.box[2] / 2), -Y(p.box[1] + p.box[3] / 2)))));

      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const local = mul(T(cx, cy), mul(R((p.rot || 0) * deg), T(-p.w / 2, -p.h / 2)));
      const full = mul(m, local);
      const im = nodes.get(p.id);
      im.setAttribute('transform', `matrix(${full.map((v) => v.toFixed(4)).join(',')})`);
      let op = 1;
      if (p.node === 'iris' && blink > 0.55) op = 0;
      if ((p.node === 'eyes' || p.node === 'iris') && eyeState) {
        const side=p.side||(p.box[0]+p.box[2]/2<model.center_x?'near':'far');
        if(featEyeEls?.has(eyeState+':'+side))op=0;
      }
      if (p.node === 'mouth' && mouthState) op = 0;
      im.setAttribute('opacity', String(op));
    }

    // 朝向交给宿主：petG 的 scale 已乘 faceVis，这里再镜像会翻回去
    flip.setAttribute('transform', '');
  }

  const figure = {
    colors: { z: model.accent || '#9d74bb' },
    gestures: ['nod', 'shake', 'wave', 'bow'],
    get extent() {
      const pts = parts.flatMap((p) => {
        const m = [p.x + p.w / 2, p.y + p.h / 2];
        return [[p.x, p.y], [p.x + p.w, p.y + p.h], m];
      });
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    },
    hits: [[128, 170, 64], [128, 96, 42]],
    anchors: { gaze: [128, 112], bubble: [128, 12], z: [150, 46], tear: [140, 132], hearts: [96, 150, 30] },
    draw,
    dispose() {
      if (flip && flip.parentNode) flip.parentNode.removeChild(flip);
      group = null; flip = null; nodes.clear(); order.length = 0;
    }
  };

  return kit.createBody(host, { figure });
}
