import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MAHAVTAAR_LOGO_POLYGONS, type PolygonWithHoles } from "@/components/mahavtaarLogoData";

interface MahavtaarLogoProps {
  className?: string;
  alt?: string;
  interactive?: boolean;
}

interface PetalAnimEntry {
  group: THREE.Group;
  baseRotZ: number;
  basePosZ: number;
  phase: number;
  rotAmp: number;
  zAmp: number;
}

// Note: no top-level RoomEnvironment import needed; exact-color front faces use custom bevel lighting.
interface LogoRig {
  wrapper: THREE.Group;
  lotusGroup: THREE.Group;
  yogiGroup: THREE.Group;
  haloMesh: THREE.Mesh | null;
  petalAnims: PetalAnimEntry[];
  lotusLeafAnims: PetalAnimEntry[];
  motes: THREE.Points | null;
  moteBaseAngles: Float32Array | null;
  moteRadii: Float32Array | null;
  moteSpeeds: Float32Array | null;
  moteOffsets: Float32Array | null;
  logoCanvas: HTMLCanvasElement;
  logoTexture: THREE.CanvasTexture;
  bevelLightUniform: { value: THREE.Vector3 };
}

// Reusable scratch vector so the animation loop performs zero per-frame allocations.
const _targetPointer = new THREE.Vector2(0, 0);

// Exact measured center of the lower-left medallion hollow in world units.
const MEDALLION_CX = -0.472;
const MEDALLION_CY = -0.52;

const LOGO_SOURCE_URL = "/assets/aistudio/Mahavtaar-Logo_4c3e3a78.jpg";

let cachedBleededCanvas: HTMLCanvasElement | null = null;
let cachedBleededCanvasPromise: Promise<HTMLCanvasElement | null> | null = null;

/**
 * Loads the official Mahavtaar JPG once into a 500x500 canvas and runs a 10-pass
 * color-dilation bleed into white/anti-aliased border pixels so 3D extruded bevels
 * never show white JPEG edge halos while front faces retain 100% exact artwork colors.
 */
function getBleededLogoCanvas(): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  if (cachedBleededCanvas) return Promise.resolve(cachedBleededCanvas);
  if (cachedBleededCanvasPromise) return cachedBleededCanvasPromise;

  cachedBleededCanvasPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = 500;
      const h = 500;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const total = w * h;

      // Mark pure artwork pixels (including soft cornflower-blue Padmasana curve) vs white background
      let valid = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        const idx = i * 4;
        const r = data[idx] ?? 255;
        const g = data[idx + 1] ?? 255;
        const b = data[idx + 2] ?? 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const isColor = (min < 216 && max - min > 18) || r + g + b < 605;
        valid[i] = isColor ? 1 : 0;
      }

      // Isotropic multi-pass dilation outward into white gaps/fringes so bevel walls sample true petal color
      const nextData = new Uint8ClampedArray(data);
      for (let pass = 0; pass < 10; pass++) {
        const prevData = new Uint8ClampedArray(nextData);
        const nextValid = new Uint8Array(valid);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            if (valid[p] === 1) continue;

            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let count = 0;
            const neighbors = [p - 1, p + 1, p - w, p + w];
            for (const np of neighbors) {
              if (valid[np] === 1) {
                const nIdx = np * 4;
                sumR += prevData[nIdx] ?? 0;
                sumG += prevData[nIdx + 1] ?? 0;
                sumB += prevData[nIdx + 2] ?? 0;
                count++;
              }
            }

            if (count > 0) {
              const pIdx = p * 4;
              nextData[pIdx] = Math.round(sumR / count);
              nextData[pIdx + 1] = Math.round(sumG / count);
              nextData[pIdx + 2] = Math.round(sumB / count);
              nextData[pIdx + 3] = 255;
              nextValid[p] = 1;
            }
          }
        }
        valid = nextValid;
      }

      imageData.data.set(nextData);
      ctx.putImageData(imageData, 0, 0);
      cachedBleededCanvas = canvas;
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = LOGO_SOURCE_URL;
  });

  return cachedBleededCanvasPromise;
}

function detectSoftwareWebGL(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas");
  const gl =
    probe.getContext("webgl2") ??
    probe.getContext("webgl") ??
    probe.getContext("experimental-webgl");

  if (!gl || !("getParameter" in gl)) return false;

  const glCtx = gl as WebGLRenderingContext;
  const dbg = glCtx.getExtension("WEBGL_debug_renderer_info");
  const rawRenderer = dbg
    ? String(glCtx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? "")
    : String(glCtx.getParameter(glCtx.RENDERER) ?? "");
  const isSoftware = /SwiftShader|llvmpipe|Software/i.test(rawRenderer);

  glCtx.getExtension("WEBGL_lose_context")?.loseContext();
  return isSoftware;
}

/**
 * Creates a fixed 500x500 CanvasTexture matching Mahavtaar-Logo_4c3e3a78.jpg so WebGL2
 * texStorage2D always allocates exact target dimensions before async upload.
 */
function createArtworkCanvasTexture(): {
  logoCanvas: HTMLCanvasElement;
  logoTexture: THREE.CanvasTexture;
} {
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = 500;
  logoCanvas.height = 500;
  const ctx = logoCanvas.getContext("2d");
  if (ctx) {
    if (cachedBleededCanvas) {
      ctx.drawImage(cachedBleededCanvas, 0, 0, 500, 500);
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 500, 500);
    }
  }
  const logoTexture = new THREE.CanvasTexture(logoCanvas);
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  logoTexture.generateMipmaps = false;
  logoTexture.minFilter = THREE.LinearFilter;
  logoTexture.magFilter = THREE.LinearFilter;
  logoTexture.needsUpdate = true;
  return { logoCanvas, logoTexture };
}

function drawArtworkOntoTexture(
  logoCanvas: HTMLCanvasElement,
  logoTexture: THREE.CanvasTexture,
  sourceCanvas: HTMLCanvasElement,
): void {
  const ctx = logoCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, 500, 500);
  ctx.drawImage(sourceCanvas, 0, 0, 500, 500);
  logoTexture.needsUpdate = true;
}

function createRadialGlowTexture(
  stops: Array<{ offset: number; color: string }>,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const half = size * 0.5;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (const stop of stops) {
      gradient.addColorStop(stop.offset, stop.color);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Projects world-space (x, y) vertices straight onto normalized 500x500 artwork UVs
 * (wx = (px - 250)/125 => u = 0.5 + x*0.25; wy = (250 - py)/125 => v = 0.5 + y*0.25).
 */
function assignArtworkPlanarUVs(geometry: THREE.BufferGeometry): void {
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!pos || !uv) return;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = THREE.MathUtils.clamp(0.5 + x * 0.25, 0, 1);
    const v = THREE.MathUtils.clamp(0.5 + y * 0.25, 0, 1);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function shapeFromPolygon(poly: PolygonWithHoles): THREE.Shape {
  const shape = new THREE.Shape();
  const first = poly.outer[0];
  if (!first) return shape;
  shape.moveTo(first[0], first[1]);
  for (let i = 1; i < poly.outer.length; i++) {
    const pt = poly.outer[i];
    if (pt) shape.lineTo(pt[0], pt[1]);
  }
  shape.closePath();

  for (const holePts of poly.holes) {
    const hFirst = holePts[0];
    if (!hFirst) continue;
    const hole = new THREE.Path();
    hole.moveTo(hFirst[0], hFirst[1]);
    for (let i = 1; i < holePts.length; i++) {
      const pt = holePts[i];
      if (pt) hole.lineTo(pt[0], pt[1]);
    }
    hole.closePath();
    shape.holes.push(hole);
  }

  return shape;
}

function buildTexturedExtrudedGroup(
  polygons: PolygonWithHoles[],
  material: THREE.Material,
  options: {
    depth: number;
    bevelThickness: number;
    bevelSize: number;
    zOffset: number;
  },
): THREE.Group {
  const group = new THREE.Group();
  for (const poly of polygons) {
    const shape = shapeFromPolygon(poly);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: options.depth,
      curveSegments: 24,
      bevelEnabled: true,
      bevelThickness: options.bevelThickness,
      bevelSize: options.bevelSize,
      bevelSegments: 4,
    });
    geometry.translate(0, 0, -options.depth * 0.5 + options.zOffset);
    assignArtworkPlanarUVs(geometry);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "MahavtaarExactMesh";
    group.add(mesh);
  }
  return group;
}

function wrapWithPivot(obj: THREE.Object3D, pivotX: number, pivotY: number): THREE.Group {
  obj.position.x -= pivotX;
  obj.position.y -= pivotY;
  const pivot = new THREE.Group();
  pivot.position.set(pivotX, pivotY, 0);
  pivot.add(obj);
  return pivot;
}

function createExactColorSculptedMaterial(options: {
  map?: THREE.Texture;
  color: number;
  bevelLightUniform: { value: THREE.Vector3 };
  minBevelShade: number;
  maxBevelShade: number;
  specStrength: number;
  cacheKey: string;
}): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map: options.map ?? null,
    color: options.color,
    toneMapped: false,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });

  mat.customProgramCacheKey = () => options.cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms["uBevelLightDir"] = options.bevelLightUniform;
    shader.uniforms["uMinBevelShade"] = { value: options.minBevelShade };
    shader.uniforms["uMaxBevelShade"] = { value: options.maxBevelShade };
    shader.uniforms["uSpecStrength"] = { value: options.specStrength };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vObjNormal;
varying vec3 vCustomViewNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vObjNormal = normal;
vCustomViewNormal = normalize( normalMatrix * normal );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vObjNormal;
varying vec3 vCustomViewNormal;
uniform vec3 uBevelLightDir;
uniform float uMinBevelShade;
uniform float uMaxBevelShade;
uniform float uSpecStrength;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
float frontWeight = smoothstep(0.55, 0.92, vObjNormal.z);
vec3 customN = normalize(vCustomViewNormal);
vec3 customL = normalize(uBevelLightDir);
vec3 customH = normalize(customL + vec3(0.0, 0.0, 1.0));
float bevelDiffuse = mix(uMinBevelShade, uMaxBevelShade, max(dot(customN, customL), 0.0));
float bevelSpec = pow(max(dot(customN, customH), 0.0), 36.0) * uSpecStrength;
vec3 sideShaded = diffuseColor.rgb * bevelDiffuse + vec3(bevelSpec);
diffuseColor.rgb = mix(sideShaded, diffuseColor.rgb, frontWeight);`,
      );
  };

  return mat;
}

/**
 * Builds the 100%-pixel-accurate Mahavtaar 3D scene from Marching-Squares-extracted
 * vector polygons and edge-bled artwork textures, preserving exact artwork RGB colors
 * on front faces with subtle 3D bevel relief and clean background glow.
 */
function buildMahavtaarLogoRig(includeDivineAura: boolean, isSoftwareGl: boolean): LogoRig {
  const root = new THREE.Group();
  root.name = "MahavtaarLogoRoot";

  const cx = MEDALLION_CX;
  const cy = MEDALLION_CY;

  const bevelLightUniform = { value: new THREE.Vector3(0.32, 0.52, 0.78).normalize() };
  const { logoCanvas, logoTexture } = createArtworkCanvasTexture();
  const artworkMat = createExactColorSculptedMaterial({
    map: logoTexture,
    color: 0xffffff,
    bevelLightUniform,
    minBevelShade: 0.78,
    maxBevelShade: 1.0,
    specStrength: 0.08,
    cacheKey: "mahavtaar-exact-artwork-v3",
  });

  const petalAnims: PetalAnimEntry[] = [];
  const lotusLeafAnims: PetalAnimEntry[] = [];

  // ---------------------------------------------------------------------------
  // 1. Four Sweeping Layered Petals (Exact Marching-Squares Contours)
  // ---------------------------------------------------------------------------
  const outerLayerSpecs: Array<{
    polygons: PolygonWithHoles[];
    zOffset: number;
    depth: number;
    phase: number;
    rotAmp: number;
  }> = [
    {
      polygons: MAHAVTAAR_LOGO_POLYGONS.purple,
      zOffset: -0.06,
      depth: 0.045,
      phase: 0,
      rotAmp: 0.011,
    },
    {
      polygons: MAHAVTAAR_LOGO_POLYGONS.blue,
      zOffset: -0.02,
      depth: 0.045,
      phase: 1.15,
      rotAmp: 0.011,
    },
    {
      polygons: MAHAVTAAR_LOGO_POLYGONS.green,
      zOffset: 0.02,
      depth: 0.045,
      phase: 2.3,
      rotAmp: 0.011,
    },
    {
      polygons: MAHAVTAAR_LOGO_POLYGONS.flame,
      zOffset: 0.06,
      depth: 0.048,
      phase: 3.45,
      rotAmp: 0.009,
    },
  ];

  for (const spec of outerLayerSpecs) {
    const group = buildTexturedExtrudedGroup(spec.polygons, artworkMat, {
      depth: spec.depth,
      bevelThickness: 0.012,
      bevelSize: 0.006,
      zOffset: spec.zOffset,
    });
    const pivot = wrapWithPivot(group, cx, cy);
    root.add(pivot);
    petalAnims.push({
      group: pivot,
      baseRotZ: 0,
      basePosZ: 0,
      phase: spec.phase,
      rotAmp: spec.rotAmp,
      zAmp: 0.008,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Exact 7-Petal Lotus + Inner Arm Tips
  // ---------------------------------------------------------------------------
  const lotusRaw = buildTexturedExtrudedGroup(MAHAVTAAR_LOGO_POLYGONS.lotus, artworkMat, {
    depth: 0.044,
    bevelThickness: 0.011,
    bevelSize: 0.005,
    zOffset: 0.02,
  });
  const lotusGroup = wrapWithPivot(lotusRaw, cx, cy);
  lotusGroup.name = "MahavtaarLotus";
  root.add(lotusGroup);
  lotusLeafAnims.push({
    group: lotusGroup,
    baseRotZ: 0,
    basePosZ: 0,
    phase: 0.4,
    rotAmp: 0.008,
    zAmp: 0.006,
  });

  // ---------------------------------------------------------------------------
  // 3. Pure-White Meditating Yogi + Exact Royal-Blue Padmasana Silhouette Rim
  // ---------------------------------------------------------------------------
  const yogiGroup = new THREE.Group();
  yogiGroup.name = "MahavtaarMeditatingYogi";

  const yogiMat = createExactColorSculptedMaterial({
    color: 0xffffff,
    bevelLightUniform,
    minBevelShade: 0.91,
    maxBevelShade: 1.0,
    specStrength: 0.03,
    cacheKey: "mahavtaar-exact-yogi-v3",
  });

  const yogiMeshGroup = buildTexturedExtrudedGroup(MAHAVTAAR_LOGO_POLYGONS.yogi, yogiMat, {
    depth: 0.036,
    bevelThickness: 0.009,
    bevelSize: 0.003,
    zOffset: 0.012,
  });
  yogiGroup.add(yogiMeshGroup);

  // Exact pixel-traced blue Padmasana line & feet contour proud in front of yogi base
  const rimGroup = buildTexturedExtrudedGroup(MAHAVTAAR_LOGO_POLYGONS.rim, artworkMat, {
    depth: 0.038,
    bevelThickness: 0.008,
    bevelSize: 0.003,
    zOffset: 0.042,
  });
  yogiGroup.add(rimGroup);

  const yogiPivot = wrapWithPivot(yogiGroup, cx, cy);
  root.add(yogiPivot);

  // ---------------------------------------------------------------------------
  // 4. Subtle Divine Background Aura (no circled rings; strictly at z <= -0.38)
  // ---------------------------------------------------------------------------
  let haloMesh: THREE.Mesh | null = null;
  let motes: THREE.Points | null = null;
  let moteBaseAngles: Float32Array | null = null;
  let moteRadii: Float32Array | null = null;
  let moteSpeeds: Float32Array | null = null;
  let moteOffsets: Float32Array | null = null;

  if (includeDivineAura) {
    const haloTexture = createRadialGlowTexture([
      { offset: 0, color: "rgba(255, 240, 196, 0.45)" },
      { offset: 0.45, color: "rgba(251, 191, 36, 0.14)" },
      { offset: 0.78, color: "rgba(168, 85, 247, 0.05)" },
      { offset: 1, color: "rgba(255, 255, 255, 0)" },
    ]);
    const haloGeom = new THREE.PlaneGeometry(3.2, 3.2);
    const haloMat = new THREE.MeshBasicMaterial({
      map: haloTexture,
      toneMapped: false,
      transparent: true,
      opacity: 0.18,
      depthTest: true,
      depthWrite: false,
    });
    haloMesh = new THREE.Mesh(haloGeom, haloMat);
    haloMesh.position.set(cx + 0.25, cy + 0.25, -0.56);
    haloMesh.renderOrder = 2;
    root.add(haloMesh);

    const moteCount = isSoftwareGl ? 16 : 24;
    const positions = new Float32Array(moteCount * 3);
    const colors = new Float32Array(moteCount * 3);
    moteBaseAngles = new Float32Array(moteCount);
    moteRadii = new Float32Array(moteCount);
    moteSpeeds = new Float32Array(moteCount);
    moteOffsets = new Float32Array(moteCount);

    const palette = [
      new THREE.Color(0xfbbf24),
      new THREE.Color(0xf59e0b),
      new THREE.Color(0xc084fc),
      new THREE.Color(0x38bdf8),
    ];

    for (let i = 0; i < moteCount; i++) {
      moteBaseAngles[i] = (i / moteCount) * Math.PI * 2;
      moteRadii[i] = 1.05 + ((i * 37) % 100) * 0.01;
      moteSpeeds[i] = 0.14 + ((i * 19) % 100) * 0.002;
      moteOffsets[i] = ((i * 53) % 100) * 0.0628;

      positions[i * 3] = cx;
      positions[i * 3 + 1] = cy;
      positions[i * 3 + 2] = -0.5;

      const c = palette[i % palette.length];
      if (c) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }

    const moteSprite = createRadialGlowTexture(
      [
        { offset: 0, color: "rgba(255, 245, 205, 1)" },
        { offset: 0.4, color: "rgba(251, 191, 36, 0.65)" },
        { offset: 1, color: "rgba(255, 255, 255, 0)" },
      ],
      64,
    );

    const motesGeom = new THREE.BufferGeometry();
    motesGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    motesGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const motesMat = new THREE.PointsMaterial({
      size: 0.075,
      map: moteSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthTest: true,
      depthWrite: false,
      sizeAttenuation: true,
    });

    motes = new THREE.Points(motesGeom, motesMat);
    motes.renderOrder = 3;
    root.add(motes);
  }

  // Center strictly around the foreground artwork bounds
  const coreBounds = new THREE.Box3();
  for (const entry of petalAnims) {
    coreBounds.expandByObject(entry.group);
  }
  coreBounds.expandByObject(lotusGroup);
  coreBounds.expandByObject(yogiPivot);

  const center = new THREE.Vector3();
  coreBounds.getCenter(center);
  root.position.set(-center.x, -center.y, -center.z);

  const wrapper = new THREE.Group();
  wrapper.name = "MahavtaarCenteredLogo";
  wrapper.add(root);

  return {
    wrapper,
    lotusGroup,
    yogiGroup: yogiPivot,
    haloMesh,
    petalAnims,
    lotusLeafAnims,
    motes,
    moteBaseAngles,
    moteRadii,
    moteSpeeds,
    moteOffsets,
    logoCanvas,
    logoTexture,
    bevelLightUniform,
  };
}

function disposeSceneResources(scene: THREE.Scene): void {
  const disposedTextures = new Set<THREE.Texture>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
      if (!disposedGeometries.has(obj.geometry)) {
        obj.geometry.dispose();
        disposedGeometries.add(obj.geometry);
      }

      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) {
        if (!mat || disposedMaterials.has(mat)) continue;
        if ("map" in mat && mat.map instanceof THREE.Texture && !disposedTextures.has(mat.map)) {
          mat.map.dispose();
          disposedTextures.add(mat.map);
        }
        mat.dispose();
        disposedMaterials.add(mat);
      }
    }
  });
}

/**
 * Interactive transparent-background Three.js showcase of the exact Mahavtaar
 * 3D logo with edge-bled artwork fidelity, subtle divine background aura,
 * and floating lotus bloom with zero color distortion.
 */
export function MahavtaarLogo3D({
  className = "h-[160px] w-[200px]",
  alt = "Mahavtaar Enterprises",
  interactive = true,
}: MahavtaarLogoProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const initialWidth = Math.max(container.clientWidth, 120);
    const initialHeight = Math.max(container.clientHeight, 120);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(32, initialWidth / initialHeight, 0.1, 40);
    camera.position.set(0, 0, 6.2);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initialWidth, initialHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.background = "transparent";
    canvas.style.touchAction = interactive ? "pan-y" : "auto";
    container.appendChild(canvas);

    const rig = buildMahavtaarLogoRig(true, isSoftwareGl);
    scene.add(rig.wrapper);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let disposed = false;

    void getBleededLogoCanvas().then((bleededCanvas) => {
      if (disposed || !bleededCanvas) return;
      drawArtworkOntoTexture(rig.logoCanvas, rig.logoTexture, bleededCanvas);
      renderer.render(scene, camera);
    });

    const fitCameraToViewport = (width: number, height: number) => {
      const safeW = Math.max(width, 1);
      const safeH = Math.max(height, 1);
      camera.aspect = safeW / safeH;
      const aspectCompensation = camera.aspect < 1 ? 1 / camera.aspect : 1;
      camera.position.z = 6.0 * Math.min(Math.max(aspectCompensation * 0.92, 1), 1.35);
      camera.updateProjectionMatrix();
      renderer.setSize(safeW, safeH);
    };

    fitCameraToViewport(initialWidth, initialHeight);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      fitCameraToViewport(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(container);

    let pointerInside = false;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragStartX = 0;
    let dragStartY = 0;

    const updateNormalizedPointer = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      _targetPointer.x = THREE.MathUtils.clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      _targetPointer.y = THREE.MathUtils.clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    };

    const onPointerEnter = (e: PointerEvent) => {
      if (!interactive) return;
      pointerInside = true;
      updateNormalizedPointer(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!interactive) return;
      updateNormalizedPointer(e.clientX, e.clientY);
      if (isDragging) {
        dragOffsetY = THREE.MathUtils.clamp((e.clientX - dragStartX) * 0.0085, -0.75, 0.75);
        dragOffsetX = THREE.MathUtils.clamp((e.clientY - dragStartY) * 0.006, -0.45, 0.45);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!interactive) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    };

    const onPointerUpOrLeave = () => {
      isDragging = false;
      dragOffsetX = 0;
      dragOffsetY = 0;
      pointerInside = false;
      _targetPointer.set(0, 0);
    };

    if (interactive) {
      container.addEventListener("pointerenter", onPointerEnter);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUpOrLeave);
      container.addEventListener("pointerleave", onPointerUpOrLeave);
    }

    let rafId = 0;
    let timeoutId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const renderFrame = (now: number) => {
      if (disposed) return;

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      elapsed += dt;

      // 1. Serene levitation & interactive damped 3D inspection
      const breath = Math.sin(elapsed * 1.1);
      const idleRotY = Math.sin(elapsed * 0.62) * 0.11;
      const idleRotX = Math.cos(elapsed * 0.48) * 0.045;
      const idleRotZ = Math.sin(elapsed * 0.4) * 0.02;
      const idleFloatY = breath * 0.06;

      const targetRotY = isDragging
        ? dragOffsetY
        : pointerInside
          ? _targetPointer.x * 0.34
          : idleRotY;
      const targetRotX = isDragging
        ? dragOffsetX
        : pointerInside
          ? _targetPointer.y * 0.22
          : idleRotX;

      rig.wrapper.rotation.y = THREE.MathUtils.damp(rig.wrapper.rotation.y, targetRotY, 6, dt);
      rig.wrapper.rotation.x = THREE.MathUtils.damp(rig.wrapper.rotation.x, targetRotX, 6, dt);
      rig.wrapper.rotation.z = THREE.MathUtils.damp(
        rig.wrapper.rotation.z,
        pointerInside ? -_targetPointer.x * 0.04 : idleRotZ,
        5,
        dt,
      );
      rig.wrapper.position.y = THREE.MathUtils.damp(rig.wrapper.position.y, idleFloatY, 5, dt);

      // 2. Subtle staggered cosmic petal bloom (stays well inside overlap margins)
      for (const entry of rig.petalAnims) {
        const wave = Math.sin(elapsed * 1.2 - entry.phase);
        entry.group.rotation.z = entry.baseRotZ + wave * entry.rotAmp;
        entry.group.position.z = entry.basePosZ + wave * entry.zAmp;
      }

      // 3. Gentle symmetrical lotus & meditative breathing
      for (const leaf of rig.lotusLeafAnims) {
        const lotusWave = Math.sin(elapsed * 1.1 + leaf.phase);
        leaf.group.rotation.z = leaf.baseRotZ + lotusWave * leaf.rotAmp;
        leaf.group.position.z = leaf.basePosZ + Math.cos(elapsed * 1.1) * leaf.zAmp;
      }
      rig.yogiGroup.position.z = Math.sin(elapsed * 1.1 + 0.3) * 0.008;

      // 4. Soft radiant halo pulse strictly in background (no circular torus lines)
      if (rig.haloMesh) {
        const haloScale = 0.96 + Math.sin(elapsed * 1.1) * 0.06;
        rig.haloMesh.scale.set(haloScale, haloScale, 1);
        const mat = rig.haloMesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.28 + Math.sin(elapsed * 1.1) * 0.08;
      }

      // 5. Spiraling ascending prana motes strictly BEHIND logo (z <= -0.38)
      if (rig.motes && rig.moteBaseAngles && rig.moteRadii && rig.moteSpeeds && rig.moteOffsets) {
        const posAttr = rig.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const count = rig.moteBaseAngles.length;
        for (let i = 0; i < count; i++) {
          const speed = rig.moteSpeeds[i] ?? 0.18;
          const offset = rig.moteOffsets[i] ?? 0;
          const baseAngle = rig.moteBaseAngles[i] ?? 0;
          const baseRadius = rig.moteRadii[i] ?? 0.95;
          const cycle = (elapsed * speed + offset) % 1;
          const angle = baseAngle + elapsed * (0.24 + (i % 3) * 0.07);
          const radius = baseRadius * (0.85 + cycle * 0.55);
          arr[i * 3] = MEDALLION_CX + Math.cos(angle) * radius;
          arr[i * 3 + 1] = MEDALLION_CY - 0.55 + cycle * 2.35 + Math.sin(angle * 2) * 0.07;
          arr[i * 3 + 2] = -0.38 - (1 - Math.sin(cycle * Math.PI)) * 0.24;
        }
        posAttr.needsUpdate = true;
      }

      // 6. Soft gliding directional highlight strictly along 3D bevels & side walls
      rig.bevelLightUniform.value
        .set(Math.sin(elapsed * 0.8) * 0.45, Math.cos(elapsed * 1.05) * 0.45 + 0.25, 0.82)
        .normalize();

      renderer.render(scene, camera);
    };

    const scheduleNextFrame = () => {
      if (disposed || document.hidden) return;
      if (isSoftwareGl) {
        timeoutId = window.setTimeout(() => {
          if (disposed || document.hidden) return;
          renderFrame(performance.now());
          scheduleNextFrame();
        }, 1000 / 30);
      } else {
        rafId = window.requestAnimationFrame((now) => {
          renderFrame(now);
          scheduleNextFrame();
        });
      }
    };

    const onVisibilityChange = () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      if (!document.hidden && !disposed) {
        lastTime = performance.now();
        scheduleNextFrame();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    renderFrame(lastTime);
    scheduleNextFrame();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();

      if (interactive) {
        container.removeEventListener("pointerenter", onPointerEnter);
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUpOrLeave);
        container.removeEventListener("pointerleave", onPointerUpOrLeave);
      }

      disposeSceneResources(scene);
      renderer.dispose();
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    };
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={alt}
      className={`relative select-none ${interactive ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
    />
  );
}

let cachedMarkDataUrl: string | null = null;
let cachedMarkPromise: Promise<string | null> | null = null;

function renderThreeMarkSnapshot(): Promise<string | null> {
  if (cachedMarkDataUrl) return Promise.resolve(cachedMarkDataUrl);
  if (cachedMarkPromise) return cachedMarkPromise;

  cachedMarkPromise = getBleededLogoCanvas().then((bleededCanvas) => {
    if (typeof document === "undefined") return null;

    const isSoftwareGl = detectSoftwareWebGL();
    const size = 192;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch {
      return null;
    }

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(0.1, 0.06, 5.8);
    camera.lookAt(0, 0, 0);

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const rig = buildMahavtaarLogoRig(false, isSoftwareGl);
    if (bleededCanvas) {
      drawArtworkOntoTexture(rig.logoCanvas, rig.logoTexture, bleededCanvas);
    }
    rig.wrapper.rotation.set(0.04, -0.06, 0);
    scene.add(rig.wrapper);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");

    disposeSceneResources(scene);
    renderer.dispose();

    cachedMarkDataUrl = dataUrl;
    return dataUrl;
  });

  return cachedMarkPromise;
}

/**
 * Compact header/sidebar brand mark generated from the exact Three.js 3D scene
 * as a transparent PNG snapshot, avoiding extra idle WebGL contexts in chrome.
 */
export function MahavtaarLogoMark({
  className = "size-10 shrink-0 object-contain",
  alt = "Mahavtaar Enterprises",
}: Pick<MahavtaarLogoProps, "className" | "alt">) {
  const [src, setSrc] = useState<string | null>(cachedMarkDataUrl);

  useEffect(() => {
    let mounted = true;
    if (!cachedMarkDataUrl) {
      void renderThreeMarkSnapshot().then((url) => {
        if (mounted && url) setSrc(url);
      });
    }
    return () => {
      mounted = false;
    };
  }, []);

  if (!src) {
    return <span aria-hidden="true" className={`inline-block ${className}`} />;
  }

  return <img src={src} alt={alt} className={className} />;
}
