import { beforeEach, describe, expect, it, vi } from "vitest"

const disposals = vi.hoisted(() => ({
  geometry: vi.fn(),
  material: vi.fn(),
  renderer: vi.fn(),
  renderLists: vi.fn(),
  texture: vi.fn(),
}))

vi.mock("three", () => {
  class Group {
    readonly position = { z: 0 }
    readonly rotation = { y: 0 }
    add(_value: unknown): void {}
  }

  class PerspectiveCamera {
    readonly position = { z: 0 }
    constructor(
      readonly _fov: number,
      readonly aspect: number,
    ) {}
  }

  return {
    CanvasTexture: class {
      colorSpace = ""
      needsUpdate = false
      dispose = disposals.texture
      constructor(readonly _source: HTMLCanvasElement) {}
    },
    DoubleSide: 2,
    Group,
    MathUtils: { degToRad: (degrees: number) => (degrees * Math.PI) / 180 },
    Mesh: class extends Group {
      visible = true
      constructor(
        readonly _geometry: unknown,
        readonly _material: unknown,
      ) {
        super()
      }
    },
    MeshBasicMaterial: class {
      dispose = disposals.material
      constructor(readonly _options: unknown) {}
    },
    PerspectiveCamera,
    PlaneGeometry: class {
      dispose = disposals.geometry
      constructor(
        readonly _width: number,
        readonly _height: number,
      ) {}
    },
    Scene: Group,
    SRGBColorSpace: "srgb",
    WebGLRenderer: class {
      readonly renderLists = { dispose: disposals.renderLists }
      outputColorSpace = ""
      dispose = disposals.renderer
      render(): void {}
      setClearColor(): void {}
      setPixelRatio(): void {}
      setSize(): void {}
    },
  }
})

import {
  disposePerspectiveRenderer,
  renderPerspectiveImage,
} from "../src/features/editor/perspective-warp"

beforeEach(() => {
  for (const dispose of Object.values(disposals)) dispose.mockClear()
})

describe("perspective renderer resources", () => {
  it("disposes every GPU resource exactly once", () => {
    // Given
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const source = document.createElement("canvas")
    source.width = 100
    source.height = 80
    renderPerspectiveImage(source, 30)

    // When
    disposePerspectiveRenderer(source)
    disposePerspectiveRenderer(source)

    // Then
    expect(disposals.renderer).toHaveBeenCalledOnce()
    expect(disposals.renderLists).toHaveBeenCalledOnce()
    expect(disposals.geometry).toHaveBeenCalledOnce()
    expect(disposals.texture).toHaveBeenCalledOnce()
    expect(disposals.material).toHaveBeenCalledTimes(2)
  })
})
