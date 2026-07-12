import { describe, expect, it } from "vitest"

import { formatAssetAdminError } from "../src/features/asset-admin/AssetAdminApp"

describe("asset admin error messages", () => {
  it("keeps operation context and the service error", () => {
    // Given
    const error = new Error("连接失败")

    // When / Then
    expect(formatAssetAdminError("apply", error)).toBe("分类修改失败：连接失败")
    expect(formatAssetAdminError("restore", error)).toBe("素材恢复失败：连接失败")
    expect(formatAssetAdminError("backup", error)).toBe("目录备份失败：连接失败")
    expect(formatAssetAdminError("repair", error)).toBe("索引修复失败：连接失败")
  })
})
