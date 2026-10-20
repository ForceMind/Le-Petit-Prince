# 小王子：星辰之旅（The Little Prince Among the Stars）

一个基于 **Unity WebGL（WebGPU）** 的互动叙事游戏的网页发布构建。本仓库是 Unity 打包出的「可直接部署的静态站点」，**不含 Unity 源码工程**（无 `Assets/`、`ProjectSettings/`、`Packages/`）。

## 这是什么

- **引擎**：Unity `6000.3.25f1`，渲染走 **WebGPU**（无 WebGL2 回退，编译期烘定）
- **外壳**：`index.html` 为手工编写的加载页，含 8 种语言 i18n（en/fr/es/de/pt/zh/ja/ko）、WebGPU 检测、错误分类处理、进度展示
- **资源**：Unity Addressables，bundle 存于 `StreamingAssets/aa/Brotli/`
- **关卡（场景）**：B612 星球、Bar（酒鬼）、Desert（沙漠 Dunes/Valley）、国王 RoyalCourt、StarObservatory（天文台）、Theater（剧院）、MapLibrary 等

## 目录结构

| 路径 | 内容 |
|---|---|
| `index.html` | 加载页外壳（核心可维护资产），内嵌 i18n + 资源清单 + 加载逻辑 |
| `Build/` | Unity 引擎构建产物：`*.wasm.br`（编译后游戏代码）、`*.data.br`（引擎数据）、`*.framework.js.br`、`*.loader.js` |
| `StreamingAssets/aa/` | Addressables 资源：`catalog.bin`、`settings.json`、`Brotli/` 下的 100+ 个 bundle |
| `fonts/`、`logo*.png`、`keyart*.jpg`、`favicon.ico` | 加载页品牌资源 |
| `loading.*.js` | 加载进度辅助脚本 |

> **注意**：所有 `*.br` 文件实为**未压缩内容**（扩展名误标），服务器/本地均以原始字节返回，不带 `Content-Encoding: br`。

## 本地运行

需要一个能正确处理 MIME 的静态服务器（wasm 必须是 `application/wasm`）：

```bash
# 见 tools/serve_local.py（或任何支持自定义 MIME 的静态服务器）
python3 tools/restore_resources.py  # 克隆后先还原两个超限资源，自动校验 SHA-256
python3 tools/serve_local.py   # 默认 http://127.0.0.1:8901
```

浏览器要求：支持 **WebGPU**（Chrome/Edge 113+、Safari 26、Firefox 141+），并经 **HTTPS 或 localhost** 打开。

## 资源抢救记录（重要）

本仓库初始状态**严重残缺**：12 个 bundle 是 CDN 错误页（内容为 `No Content: ...`），`Build/` 缺 wasm/data。所有缺失文件实际仍存于源站 `https://littleprince.dev/`。已通过 **Cloudflare 优选 IP（`104.16.179.91`，SIN 节点，约 1.6MB/s）+ curl 断点续传** 从源站补齐。

- 抢救脚本/清单位于 `/tmp/lpp_*`（未入库，一次性用途）
- 完整资源清单内嵌于 `index.html` 的 `LPWebDecodedSizes` / catalog 哈希表

## 继续开发的方向

这是**构建产物而非源码**。若要改游戏玩法/关卡/美术，需原始 Unity 工程（`tools/shared/web/make_page_i18n.py` 等线索表明源码工程存在过）。当前仓库适合做：

1. **网页外壳维护**：i18n、加载体验、错误处理、部署
2. **资源解包分析**：bundle 为标准 UnityFS，可用 UnityPy（需 Python ≥3.10）/AssetStudio 解出贴图/音频/剧情文本
3. **部署**：静态托管（需注意 `.br` 不能带 `Content-Encoding: br`）

## Git 分卷备份

两个超过 GitHub 100MiB 限制的场景文件保存在 `resource-parts/`，每卷最多 90MiB。`manifest.json` 记录原文件和各分卷的 SHA-256。克隆后运行 `python3 tools/restore_resources.py` 还原；本机原始资源仍保留，但不再直接纳入 Git。不要使用 `git push --all`：本地 `backup/pre-resource-split` 分支保留了旧的大文件提交，仅供本地恢复。
