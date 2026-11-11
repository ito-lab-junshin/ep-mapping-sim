/**
 * glTF 2.0 の最小限の読み書き（docs/DESIGN.md §9.1、Phase 7）。三角形メッシュの頂点位置と index だけを扱う。
 *  - 読み込み：GLB（バイナリ）と、データを data URI で埋め込んだ .gltf（JSON）。ノードの変換（matrix／TRS）を反映する
 *  - 書き出し：GLB。単位は glTF の規約どおりメートル（このアプリの mm を 1/1000 にする）
 * 外部ファイルを参照する .gltf（.bin が別ファイル）は、resources に URI → バイト列を渡せば読める。
 */

export interface GltfPrimitive {
  /** メッシュ（またはノード）の名前 */
  name: string;
  /** 頂点位置（ノードの変換を反映したもの。単位は glTF のまま） */
  positions: Float32Array;
  indices: Uint32Array;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

function decodeBase64(s: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < clean.length ? table.indexOf(clean[i + k]) : 0));
    const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/** GLB または .gltf（JSON 文字列・バイト列）を読む */
export function parseGltf(data: ArrayBuffer | Uint8Array | string, resources: Record<string, Uint8Array> = {}): GltfPrimitive[] {
  let json: Json;
  let bin: Uint8Array | null = null;
  if (typeof data === 'string') json = JSON.parse(data);
  else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength >= 12 && dv.getUint32(0, true) === GLB_MAGIC) {
      let off = 12;
      json = {};
      while (off < bytes.byteLength) {
        const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
        const chunk = bytes.subarray(off + 8, off + 8 + len);
        if (type === CHUNK_JSON) json = JSON.parse(utf8(chunk));
        else if (type === CHUNK_BIN) bin = chunk;
        off += 8 + len;
      }
    } else json = JSON.parse(utf8(bytes));
  }
  const buffers: Uint8Array[] = (json.buffers ?? []).map((b: Json, i: number) => {
    if (b.uri === undefined) { if (!bin) throw new Error('GLB のバイナリがありません'); return bin; }
    if (typeof b.uri === 'string' && b.uri.startsWith('data:')) return decodeBase64(b.uri.slice(b.uri.indexOf(',') + 1));
    const r = resources[b.uri];
    if (!r) throw new Error(`外部のバッファを読めません：${b.uri ?? i}`);
    return r;
  });

  const readAccessor = (index: number): { data: Float32Array | Uint32Array; size: number } => {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const buf = buffers[view.buffer];
    const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[acc.type];
    const compBytes = ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1 } as Record<number, number>)[acc.componentType];
    if (!size || !compBytes) throw new Error(`対応していない accessor：${acc.type} / ${acc.componentType}`);
    const stride = view.byteStride ?? size * compBytes;
    const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = acc.componentType === 5126 ? new Float32Array(acc.count * size) : new Uint32Array(acc.count * size);
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < size; k++) {
      const p = base + i * stride + k * compBytes;
      out[i * size + k] = acc.componentType === 5126 ? dv.getFloat32(p, true)
        : acc.componentType === 5125 ? dv.getUint32(p, true) : acc.componentType === 5123 ? dv.getUint16(p, true) : dv.getUint8(p);
    }
    return { data: out, size };
  };

  const out: GltfPrimitive[] = [];
  const visit = (nodeIndex: number, parent: number[]) => {
    const node = json.nodes[nodeIndex];
    const m = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      (mesh.primitives as Json[]).forEach((prim, pi) => {
        if ((prim.mode ?? 4) !== 4) return; // 三角形だけ
        const pos = readAccessor(prim.attributes.POSITION).data as Float32Array;
        const positions = new Float32Array(pos.length);
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          positions[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          positions[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          positions[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        }
        const indices = prim.indices !== undefined
          ? Uint32Array.from(readAccessor(prim.indices).data)
          : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
        const name = mesh.name ?? node.name ?? `mesh${node.mesh}`;
        out.push({ name: mesh.primitives.length > 1 ? `${name}#${pi}` : name, positions, indices });
      });
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? (json.nodes ?? []).map((_: unknown, i: number) => i);
  for (const r of roots) visit(r, IDENTITY);
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** 列優先の 4×4 行列の積 a × b */
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(node: Json): number[] {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** GLB を書く（positions は mm で渡し、メートルにして書く） */
export function writeGlb(meshes: { name: string; positionsMm: Float32Array; indices: Uint32Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let binLen = 0;
  const bufferViews: Json[] = [], accessors: Json[] = [];
  const push = (bytes: Uint8Array, target: number) => {
    const offset = binLen;
    parts.push(bytes);
    binLen += bytes.byteLength;
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); binLen += pad; }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    return bufferViews.length - 1;
  };
  const meshesJson = meshes.map((m) => {
    const p = new Float32Array(m.positionsMm.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i++) {
      p[i] = m.positionsMm[i] / 1000;
      min[i % 3] = Math.min(min[i % 3], p[i]); max[i % 3] = Math.max(max[i % 3], p[i]);
    }
    const pv = push(new Uint8Array(p.buffer.slice(0)), 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count: p.length / 3, type: 'VEC3', min, max });
    const posAcc = accessors.length - 1;
    const iv = push(new Uint8Array(new Uint32Array(m.indices).buffer), 34963);
    accessors.push({ bufferView: iv, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
    return { name: m.name, primitives: [{ attributes: { POSITION: posAcc }, indices: accessors.length - 1, mode: 4 }] };
  });
  const json = {
    asset: { version: '2.0', generator: 'ep-mapping-sim' },
    scene: 0, scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: meshesJson, accessors, bufferViews, buffers: [{ byteLength: binLen }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jpad) { const t = new Uint8Array(jsonBytes.byteLength + jpad).fill(0x20); t.set(jsonBytes); jsonBytes = t; }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true); dv.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  let off = 20 + jsonBytes.byteLength;
  dv.setUint32(off, binLen, true); dv.setUint32(off + 4, CHUNK_BIN, true);
  off += 8;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}
