import {
  CanvasTexture,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three"

const MAX_ORIENTATION_ANGLE = 60
const MAX_SIDE_LAYERS = 16
const CAMERA_FOV = 35

export type OrientationRenderPlan = Readonly<{
  cameraDistance: number
  yawDegrees: number
  sideLayerCount: number
  sideDepth: number
}>

type PixelBuffer = Readonly<{
  data: Uint8ClampedArray
  height: number
  width: number
}>

export type OpaqueBounds = Readonly<{
  height: number
  width: number
  x: number
  y: number
}>

const renderers = new WeakMap<HTMLCanvasElement, PerspectiveCanvasRenderer>()

export function calculateOrientationRenderPlan(
  perspectiveX: number,
  aspect = 1,
): OrientationRenderPlan {
  const yawDegrees = Math.min(MAX_ORIENTATION_ANGLE, Math.max(-MAX_ORIENTATION_ANGLE, perspectiveX))
  const normalized = Math.abs(yawDegrees) / MAX_ORIENTATION_ANGLE
  const yawRadians = MathUtils.degToRad(Math.abs(yawDegrees))
  const cameraTangent = Math.tan(MathUtils.degToRad(CAMERA_FOV / 2))
  const nearEdgeOffset = aspect * Math.sin(yawRadians)
  const horizontalFitDistance = nearEdgeOffset + Math.cos(yawRadians) / cameraTangent
  const verticalFitDistance = nearEdgeOffset + 1 / cameraTangent

  return {
    cameraDistance: Math.max(horizontalFitDistance, verticalFitDistance) * 1.015,
    yawDegrees,
    sideLayerCount: yawDegrees === 0 ? 0 : Math.max(4, Math.round(6 + normalized * 10)),
    sideDepth: 0.035 + normalized * 0.085,
  }
}

export function calculatePerspectivePreviewSkew(..._unused: readonly number[]): number {
  return 0
}

export function calculateOpaqueBounds(buffer: PixelBuffer): OpaqueBounds | null {
  let left = buffer.width
  let top = buffer.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 0; x < buffer.width; x += 1) {
      if (buffer.data[(y * buffer.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (right === -1 || bottom === -1) return null
  return { height: bottom - top + 1, width: right - left + 1, x: left, y: top }
}

export function renderPerspectiveImage(
  source: HTMLCanvasElement,
  perspectiveX: number,
): HTMLCanvasElement {
  if (Math.abs(perspectiveX) < 0.01) return source
  try {
    let renderer = renderers.get(source)
    if (renderer === undefined) {
      renderer = new PerspectiveCanvasRenderer(source)
      renderers.set(source, renderer)
    }
    return trimTransparentPadding(renderer.render(perspectiveX))
  } catch {
    return source
  }
}

export function disposePerspectiveRenderer(source: HTMLCanvasElement): void {
  const renderer = renderers.get(source)
  if (renderer === undefined) return
  renderers.delete(source)
  renderer.dispose()
}

function trimTransparentPadding(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const readCanvas = document.createElement("canvas")
  readCanvas.width = canvas.width
  readCanvas.height = canvas.height
  const context = readCanvas.getContext("2d")
  if (context === null) return canvas
  context.drawImage(canvas, 0, 0)
  const bounds = readOpaqueBounds(context, canvas)
  if (bounds === null) return canvas
  const trimmed = document.createElement("canvas")
  trimmed.width = bounds.width
  trimmed.height = bounds.height
  const trimmedContext = trimmed.getContext("2d")
  if (trimmedContext === null) return canvas
  trimmedContext.drawImage(
    readCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  )
  return trimmed
}

function readOpaqueBounds(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): OpaqueBounds | null {
  try {
    return calculateOpaqueBounds(context.getImageData(0, 0, canvas.width, canvas.height))
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return null
    throw error
  }
}

class PerspectiveCanvasRenderer {
  private readonly camera: PerspectiveCamera
  private readonly canvas: HTMLCanvasElement
  private readonly frontMaterial: MeshBasicMaterial
  private readonly geometry: PlaneGeometry
  private readonly renderer: WebGLRenderer
  private readonly sideMaterial: MeshBasicMaterial
  private readonly sideLayers: readonly Mesh[]
  private readonly texture: CanvasTexture
  private readonly subject = new Group()
  private readonly scene = new Scene()
  private disposed = false

  constructor(source: HTMLCanvasElement) {
    const width = Math.max(1, source.width)
    const height = Math.max(1, source.height)
    const aspect = width / height

    this.canvas = document.createElement("canvas")
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas: this.canvas,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(width, height, false)

    this.camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 100)
    this.camera.position.z = calculateOrientationRenderPlan(0, aspect).cameraDistance

    this.texture = new CanvasTexture(source)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.needsUpdate = true

    this.geometry = new PlaneGeometry(aspect * 2, 2)
    this.frontMaterial = new MeshBasicMaterial({
      alphaTest: 0.02,
      map: this.texture,
      side: DoubleSide,
      transparent: true,
    })
    this.subject.add(new Mesh(this.geometry, this.frontMaterial))

    this.sideMaterial = new MeshBasicMaterial({
      alphaTest: 0.02,
      color: 0x554239,
      map: this.texture,
      side: DoubleSide,
      transparent: true,
    })
    this.sideLayers = Array.from({ length: MAX_SIDE_LAYERS }, () => {
      const sideLayer = new Mesh(this.geometry, this.sideMaterial)
      sideLayer.visible = false
      this.subject.add(sideLayer)
      return sideLayer
    })

    this.scene.add(this.subject)
  }

  render(perspectiveX: number): HTMLCanvasElement {
    const plan = calculateOrientationRenderPlan(perspectiveX, this.camera.aspect)
    this.camera.position.z = plan.cameraDistance
    this.subject.rotation.y = MathUtils.degToRad(plan.yawDegrees)

    for (const [index, sideLayer] of this.sideLayers.entries()) {
      sideLayer.visible = index < plan.sideLayerCount
      sideLayer.position.z = (-plan.sideDepth * (index + 1)) / MAX_SIDE_LAYERS
    }

    this.renderer.render(this.scene, this.camera)
    return this.canvas
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.texture.dispose()
    this.geometry.dispose()
    this.frontMaterial.dispose()
    this.sideMaterial.dispose()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
  }
}
