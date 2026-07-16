# 轻设浏览器插件

这是轻设的配套浏览器扩展（收集器），面向 ChatGPT、Gemini、AI Studio、Claude 和 Copilot 的图片生成页面。

## 构建与安装

在项目根目录执行：

```bash
pnpm extension:build
```

Chrome/Edge 打开扩展管理页，开启“开发者模式”，选择“加载已解压的扩展程序”，指向 `browser-extension/dist`。

## 使用

1. 打开生成图片的对话页，点击扩展图标并扫描。
2. 选择图片后可单张下载、批量下载或 ZIP 打包。
3. 点击“发送到素材面板”，扩展会打开 `https://assets.xiduoduo.top/admin/asset-admin.html`；登录后，选中的图片通过页面桥接传给管理台。
4. 管理台继续执行格式校验、分类识别和云端入库。外部成品建议使用透明 PNG。

扩展只把用户主动选择的图片发送到素材面板，不包含 `191.*` 备用 IP、管理令牌或服务器 SSH 信息。弹窗关闭后，发送任务由 Manifest V3 后台 worker 继续完成；面板内容脚本会先完成握手，再分块传输图片。扩展依赖 Chrome 官方 `downloads` API 进行下载，并使用项目已有的 `fflate` 进行 ZIP 打包。
