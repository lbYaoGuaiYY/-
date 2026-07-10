# 轻设开源复用边界

轻设保留现有 React + Fabric 编辑器，只复用能够减少通用交互和本地存储维护成本的免费开源模块。所有项目与图片仍留在浏览器本地，不需要账号、密钥、服务器或付费授权。

## 已采用模块

| 模块 | 固定版本 | 许可证 | 用途 | 数据与网络 |
| --- | ---: | --- | --- | --- |
| Fabric.js | 7.4.0 | MIT | 画布渲染、选中、变换与导出 | 本地运行，无必需网络 |
| @dnd-kit/core | 6.3.1 | MIT | 素材拖拽上下文、传感器与覆盖层 | 本地运行，无必需网络 |
| @dnd-kit/sortable | 10.0.0 | MIT | 图层排序 | 本地运行，无必需网络 |
| @dnd-kit/utilities | 3.2.2 | MIT | 拖拽样式与坐标辅助 | 本地运行，无必需网络 |
| Dexie.js Core | 4.4.4 | Apache-2.0 | IndexedDB 事务、版本与迁移 | 仅访问本地 IndexedDB |

## 明确禁止

- 不安装或导入 Dexie Cloud、Polotno、CE.SDK 或任何需要生产付费、账号、密钥、服务器、按导出计费或带水印的组件。
- 不用新的编辑器外壳替换 Fabric，不引入第二套画布模型。
- 不把本地图片、项目文档或使用数据发送给第三方。

## 许可证门

`pnpm licenses:check` 检查全部生产依赖。默认接受 MIT、MIT-0、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC 和 0BSD；当前出现的复合表达式仅在至少包含一个已接受许可证选项且已写入门禁时允许。未知、缺失、UNLICENSED、付费或 source-available 许可证直接失败。

上游来源：

- Fabric.js: https://github.com/fabricjs/fabric.js
- dnd-kit: https://github.com/clauderic/dnd-kit
- Dexie.js: https://github.com/dexie/Dexie.js
