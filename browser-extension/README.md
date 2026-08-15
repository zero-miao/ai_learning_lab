# AI Learning Lab 浏览器页面采集器

## 构建

```bash
cd browser-extension
npm install
npm run build
```

Chrome 或 Edge 打开扩展管理页，启用开发者模式，然后加载
`browser-extension/dist`。

生成可分发压缩包：

```bash
npm run package
```

压缩包输出到 `browser-extension/release/ai-learning-lab-browser-capture.zip`。

扩展默认连接 `http://127.0.0.1:8000`，应用预览页默认使用同一主机的
`5173` 端口。连接地址可在扩展弹窗中修改。
