# SiYuan Unsplash 题头图插件开发计划 (`siyuan-plugin-unsplash-cover`)

> **文档用途**：本文档为 AI Agent 友好的端到端开发执行蓝图（Step-by-Step Execution Plan）。每个阶段均包含明确的目标、涉及文件路径、核心数据契约、完整实现逻辑与可执行验收标准（Checklist）。

## 1. 项目概览与架构约束 (Context & Guardrails)

### 1.1 项目定位
开发一款基于 **Vite + Svelte 5 + TypeScript** 的思源笔记（SiYuan Note）前端插件，接入 Unsplash 官方图片 API，为思源文档提供：
1. **基于文档标题的零开销智能预搜**：打开选图面板时，自动读取当前文档标题，通过「正则清洗 + 浏览器原生 `Intl.Segmenter` 分词」提取核心关键词并自动加载首屏候选图。
2. **关键词搜索与瀑布流/网格选图**：支持中英文关键词检索、方向筛选（横向 `landscape` 默认）、分页加载与摄影师署名展示。
3. **一键随机题头图**：无需打开弹窗（或在弹窗内一键触发），直接获取匹配当前文档标题或预设主题的高清随机横图并应用。
4. **双模式图片存储（可选本地 `assets` 转存）**：支持「下载并调用思源内核接口上传至 `/assets/` 本地持久化（默认推荐）」与「直接引用 Unsplash 远程 URL」两种模式自由切换。

### 1.2 核心参考文档与规范链接
- **官方开发模板**：[siyuan-note/plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte)（Svelte 5 Runes 架构）
- **插件前端 API 类型声明**：[siyuan-note/petal](https://github.com/siyuan-note/petal)
- **思源内核公开 HTTP API**：[思源笔记公开 API 文档](https://siyuannote.com/article/1749331310)
- **插件生命周期与事件总线指南**：[SiYuan Plugin Development: Quick Start](https://liuyun.io/article/1724560411861)
- **文档块与题头图机制说明**：[文档块 | 思源笔记用户指南](https://siyuannote.com/article/1725202786)

### 1.3 Agent 必须遵守的硬性约束 (Hard Guardrails)
1. **严禁直接调用 Node.js `fs` 写入 `data/assets/`**：所有本地化的题头图文件必须通过思源内核接口 `POST /api/asset/upload` 写入，以确保跨端同步与资源索引正常（参见 [官方插件开发规范](https://github.com/siyuan-note/plugin-sample-vite-svelte)）。
2. **Svelte 5 生命周期与内存防泄漏**：思源的 `Dialog` 销毁不会自动触发前端框架卸载。在创建 `new Dialog({...})` 时，**必须**在 `destroyCallback` 中显式调用 Svelte 5 的 `unmount(app)` 释放组件实例（参见 [内存泄漏说明](https://liuyun.io/article/1724560411861)）。
3. **零后台常驻开销**：严禁在 `switch-protyle` 或键盘输入事件中自动发起 Unsplash 网络请求或写盘操作。标题分词与图片请求**仅在用户主动点击插件菜单/按钮时按需触发**。
4. **`title-img` 属性安全转义**：构造 `title-img` 的内联 CSS 字符串时，必须对 URL 中的双引号 `"`、括号 `()` 及 HTML 特殊字符进行安全清洗/转义，严格输出 `background-image:url("...");background-position:center 50%;`，防止属性逃逸（参见 [CVE-2026-66396](https://nvd.nist.gov/vuln/detail/CVE-2026-66396)）。
5. **遵守 Unsplash API 规范**：
   - 所有图片请求需附带 `Authorization: Client-ID <AccessKey>`。
   - 用户选中并应用某张图片时，异步触发一次该图片的 `links.download_location` 请求（统计下载量）。
   - 在选图卡片底部展示摄影师姓名及带 UTM 参数（`?utm_source=siyuan_unsplash_plugin&utm_medium=referral`）的主页链接。

---

## 2. 目标目录结构 (Target Directory Structure)

工作目录：`/Users/qydxyx/projects/siyuan_unsplash`

```text
/Users/qydxyx/projects/siyuan_unsplash/
├── public/
│   └── i18n/
│       ├── zh_CN.json              # 简体中文语言包
│       └── en_US.json              # 英文语言包
├── scripts/
│   └── make_dev_link.js            # 软链接生成脚本（绑定到思源 workspace/data/plugins）
├── src/
│   ├── index.ts                    # 插件主入口（生命周期、菜单注册、快捷键、Dialog 挂载）
│   ├── index.scss                  # 插件全局与弹窗样式（适配思源 CSS 变量与暗黑模式）
│   ├── types/
│   │   └── index.ts                # 插件配置、Unsplash API 响应与内部数据结构定义
│   ├── services/
│   │   ├── config.ts               # 配置管理服务（封装 loadData / saveData 与默认值合并）
│   │   ├── keyword-extractor.ts    # 标题正则清洗 + Intl.Segmenter 零开销分词提取器
│   │   ├── unsplash.ts             # Unsplash API 客户端（搜索、随机图、下载计数触发、代理降级）
│   │   └── banner-applier.ts       # 题头图应用服务（/api/asset/upload 本地转存 + /api/attr/setBlockAttrs + DOM 即时刷新）
│   └── components/
│       ├── UnsplashPicker.svelte   # Svelte 5 选图主面板（搜索栏、分词标签、图片网格、一键随机、状态栏）
│       └── SettingPanel.svelte     # Svelte 5 插件设置面板（Access Key、存储模式开关、默认参数）
├── icon.png                        # 插件集市图标 (160x160 PNG)
├── preview.png                     # 插件集市预览图 (1024x768 PNG)
├── plugin.json                     # 思源插件元数据清单
├── package.json                    # 依赖与构建脚本声明
├── tsconfig.json                   # TypeScript 配置（适配 Svelte 5）
├── svelte.config.js                # Svelte 5 编译配置
└── vite.config.ts                  # Vite 打包配置（输出 CommonJS 格式的 index.js 和 index.css）
```

---

## 3. 分阶段实施步骤 (Step-by-Step Execution Plan)

### Phase 1: 项目工程脚手架与构建配置初始化

#### 目标
初始化符合思源笔记插件规范的 Vite + Svelte 5 + TypeScript 工程，支持开发态软链接与生产态打包。

#### 涉及文件
- `package.json`
- `plugin.json`
- `tsconfig.json`
- `svelte.config.js`
- `vite.config.ts`
- `public/i18n/zh_CN.json`
- `public/i18n/en_US.json`

#### 实现细节
1. **`package.json` 依赖配置**：
   - `dependencies`: 无运行时重依赖（保持极致轻量）。
   - `devDependencies`: `siyuan` (Petal 类型声明), `svelte` (`^5.0.0`), `@sveltejs/vite-plugin-svelte`, `typescript`, `vite`, `vite-plugin-static-copy`, `sass`, `terser`.
   - `scripts`:
     - `"dev": "vite build --watch --mode development"`
     - `"build": "vite build --mode production"`
     - `"check": "tsc --noEmit"`
     - `"make-link": "node ./scripts/make_dev_link.js"`
2. **`plugin.json` 关键字段**：
   ```json
   {
     "name": "siyuan-plugin-unsplash-cover",
     "author": "qydxyx",
     "url": "https://github.com/qydxyx/siyuan-plugin-unsplash-cover",
     "version": "0.1.0",
     "minAppVersion": "3.1.0",
     "backends": ["windows", "linux", "darwin", "docker", "ios", "android"],
     "frontends": ["desktop", "mobile", "browser-desktop", "browser-mobile", "desktop-window"],
     "displayName": {
       "default": "Unsplash Cover",
       "zh_CN": "Unsplash 题头图"
     },
     "description": {
       "default": "Search or pick random Unsplash photos as document cover images with smart title keyword extraction and local asset saving.",
       "zh_CN": "接入 Unsplash 图库补充文档题头图，支持按文档标题智能分词预搜、一键随机换图与本地 assets 转存。"
     },
     "readme": {
       "default": "README.md",
       "zh_CN": "README_zh_CN.md"
     },
     "funding": {},
     "keywords": ["unsplash", "cover", "banner", "title-img", "题头图"]
   }
   ```
3. **`vite.config.ts` 打包规则**：
   - 将 `siyuan` 设为 `external: ["siyuan"]`，输出格式为 `cjs`（CommonJS），入口文件 `src/index.ts` 编译为 `index.js`，样式编译为 `index.css`。
   - 使用 `vite-plugin-static-copy` 将 `public/i18n/*`、`plugin.json`、`README*.md`、`icon.png`、`preview.png` 复制到构建输出目录（开发模式为 `dev/`，生产模式为 `dist/`）。

#### 验收标准 (Checklist)
- [ ] `pnpm install` 安装成功且无版本冲突。
- [ ] `plugin.json` 字段合法且包含中英双语描述。
- [ ] `public/i18n/zh_CN.json` 与 `en_US.json` 包含所有 UI 文案键值。

---

### Phase 2: 类型系统与配置持久化服务 (`src/types/` & `src/services/config.ts`)

#### 目标
定义插件配置项与 Unsplash 数据模型，实现基于 `plugin.loadData` / `plugin.saveData` 的配置管理。

#### 涉及文件
- `src/types/index.ts`
- `src/services/config.ts`

#### 实现细节
1. **核心配置接口 `PluginConfig` (`src/types/index.ts`)**：
   ```typescript
   export interface PluginConfig {
     /** Unsplash API Access Key */
     accessKey: string;
     /** 是否将选中的 Unsplash 图片下载并转存到思源本地 /assets/ 目录（默认 true） */
     saveToLocalAssets: boolean;
     /** 转存到本地或者直接引用时使用的图片质量尺寸 */
     imageQuality: "regular" | "full" | "raw";
     /** 打开选图面板时是否自动提取文档标题关键词进行初始搜索（默认 true） */
     autoExtractTitleKeyword: boolean;
     /** 标题无法提取有效词或为空文档时的默认兜底搜索词 */
     fallbackQuery: string;
     /** 是否通过思源内核正向代理 (/api/network/forwardProxy) 请求 Unsplash API（默认 false，遇跨域或网络受限时可开启） */
     useKernelProxy: boolean;
   }
   ```
2. **默认配置常量 `DEFAULT_CONFIG`**：
   - `accessKey: ""`
   - `saveToLocalAssets: true`
   - `imageQuality: "regular"`（宽度 1080px，兼顾清晰度与加载/转存速度）
   - `autoExtractTitleKeyword: true`
   - `fallbackQuery: "nature landscape"`
   - `useKernelProxy: false`
3. **Unsplash 照片数据结构 `UnsplashPhoto`**：
   ```typescript
   export interface UnsplashPhoto {
     id: string;
     description: string | null;
     alt_description: string | null;
     color: string;
     width: number;
     height: number;
     urls: {
       raw: string;
       full: string;
       regular: string;
       small: string;
       thumb: string;
     };
     links: {
       html: string;
       download_location: string;
     };
     user: {
       name: string;
       username: string;
       links: {
         html: string;
       };
     };
   }
   ```
4. **配置读写封装 (`src/services/config.ts`)**：
   - 使用存储文件名 `STORAGE_NAME = "unsplash-cover-config.json"`。
   - `loadConfig(plugin: Plugin)`：调用 `await plugin.loadData(STORAGE_NAME)` 并与 `DEFAULT_CONFIG` 浅合并（`{ ...DEFAULT_CONFIG, ...(saved || {}) }`）。
   - `saveConfig(plugin: Plugin, config: PluginConfig)`：调用 `await plugin.saveData(STORAGE_NAME, config)`。

#### 验收标准 (Checklist)
- [ ] 配置加载在首次运行（无历史配置文件）时能平滑返回 `DEFAULT_CONFIG`。
- [ ] `tsc --noEmit` 类型检查通过。

---

### Phase 3: 零开销文档标题清洗与 `Intl.Segmenter` 分词器 (`src/services/keyword-extractor.ts`)

#### 目标
在不引入任何第三方词库、零内存常驻开销的前提下，耗时 `< 1ms` 从当前文档标题中提取出适合 Unsplash 检索的 1~3 个核心关键词（以及候选词标签列表，供用户在 UI 上点击切换）。

#### 涉及文件
- `src/services/keyword-extractor.ts`

#### 实现细节
1. **函数签名**：
   ```typescript
   export interface TitleExtractionResult {
     /** 组合后的主搜索词（用于自动填入搜索框并发起首屏搜索） */
     primaryQuery: string;
     /** 拆分出的独立候选词数组（用于在搜索框下方渲染快捷 Tag 胶囊） */
     tokens: string[];
   }

   export function extractKeywordsFromTitle(
     rawTitle: string,
     fallbackQuery = "nature landscape"
   ): TitleExtractionResult;
   ```
2. **三步处理流水线**：
   - **Step 1 — 正则噪声清洗 (`cleanTitle`)**：
     - 去除常见日期与时间戳前缀/后缀：如 `\b\d{4}[-/.年]\d{1,2}([-/.月]\d{1,2}日?)?\b`、`\b\d{8}\b`。
     - 去除章节/序号前缀：如 `^(第[一二三四五六七八九十百千万0-9]+[章节篇讲课回]|Chapter\s*\d+|Part\s*\d+|\d+(\.\d+)*[\s.、-]*)\s*`（忽略大小写）。
     - 去除常见笔记套路词与括号标注：如 `【.*?】`、`\[.*?\]`、（如 `读书笔记`、`学习笔记`、`会议纪要`、`周报`、`日报`、`复盘`、`总结`、`草稿`、`未命名`、`Untitled`）。
     - 将标点符号、特殊符号替换为空格。
   - **Step 2 — 浏览器原生 `Intl.Segmenter` 分词**：
     - 检测 `typeof Intl !== "undefined" && "Segmenter" in Intl`。
     - 实例化 `new Intl.Segmenter("zh-CN", { granularity: "word" })`，对清洗后的文本执行 `.segment(cleaned)`。
     - 仅保留 `segment.isWordLike === true` 的词元。
     - 过滤中英文停用词（内置极简 `Set`：如 `的, 了, 和, 与, 在, 是, 我, 你, 如何, 什么, 关于, 使用, 指南, 教程, 分析, 研究, the, a, an, of, in, on, for, to, with, how, what`）及单字虚词（保留有实义的双字及以上中文词、长度 `>= 2` 的英文词）。
   - **Step 3 — 排序与回退组装**：
     - 去重后优先保留前 2~3 个实义词拼成 `primaryQuery`（以空格连接），`tokens` 保存全部提取出的最多 6 个候选词（方便用户在弹窗中点选单个词重搜）。
     - 若清洗分词后为空（例如标题叫《2026-10-16 日报》或《未命名》），则 `primaryQuery` 自动回退为 `fallbackQuery`。

#### 验收标准 (Checklist)
- [ ] 输入 `"2026-10-16 【读书笔记】第3章：秋日露营与咖啡冲泡指南"`，能提取出 `tokens: ["秋日", "露营", "咖啡", "冲泡"]`，`primaryQuery` 为 `"秋日 露营 咖啡"`。
- [ ] 输入 `"2026-10-16 周报"` 或 `""`，能安全回退至 `fallbackQuery`。
- [ ] 单次调用执行时间 `< 1ms`，无外部依赖。

---

### Phase 4: Unsplash API 客户端与内核代理兼容 (`src/services/unsplash.ts`)

#### 目标
封装 Unsplash REST API 请求，支持直连 `fetch` 与思源内核正向代理 `/api/network/forwardProxy` 双通道，支持关键词搜索、随机获取及下载量回调。

#### 涉及文件
- `src/services/unsplash.ts`

#### 实现细节
1. **统一请求底层 `requestUnsplash<T>(endpoint: string, params: Record<string, string>, config: PluginConfig)`**：
   - 校验 `config.accessKey`：若为空，抛出带有明确引导文案的错误（提示用户在插件设置中填入 Unsplash Access Key）。
   - 构造 URL：`https://api.unsplash.com${endpoint}?${new URLSearchParams(params).toString()}`。
   - 请求头：`{ "Authorization": `Client-ID ${config.accessKey.trim()}`, "Accept-Version": "v1" }`。
   - **通道分支**：
     - 当 `config.useKernelProxy === false` 时，直接使用浏览器 `fetch(url, { headers })`。
     - 当 `config.useKernelProxy === true` 时，调用思源公开 API [`POST /api/network/forwardProxy`](https://siyuannote.com/article/1749331310)：
       ```typescript
       const proxyRes = await fetch("/api/network/forwardProxy", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           url,
           method: "GET",
           timeout: 10000,
           contentType: "application/json",
           headers: [{ Authorization: `Client-ID ${config.accessKey.trim()}` }, { "Accept-Version": "v1" }],
           responseEncoding: "text"
         })
       }).then(r => r.json());
       ```
2. **核心业务方法**：
   - `searchPhotos(query: string, page: number, perPage: number, config: PluginConfig)`：
     - 调用 `/search/photos`，参数：`query`, `page`, `per_page: String(perPage)`（默认 12）, `orientation: "landscape"`（题头图固定优选横图）。
     - 若 `query` 包含中文字符（`/[\u4e00-\u9fa5]/`），自动附带 `lang: "zh-Hans"` 参数。
   - `getRandomPhoto(query: string, config: PluginConfig)`：
     - 调用 `/photos/random`，参数：`orientation: "landscape"`, `query: query || config.fallbackQuery`。
   - `triggerDownloadTrack(downloadLocationUrl: string, config: PluginConfig)`：
     - 异步调用 `download_location`（附带 `Client-ID`），捕获并忽略任何网络异常，绝不阻塞主流程。

#### 验收标准 (Checklist)
- [ ] 搜索接口与随机图接口能正确附带 `orientation=landscape` 与中文 `lang=zh-Hans`。
- [ ] 当 HTTP 状态码为 `401`（Key 无效）或 `403`（触发每小时 50 次限流）时，返回人类可读的中文错误提示。

---

### Phase 5: 题头图本地 `assets` 转存与属性写入服务 (`src/services/banner-applier.ts`)

#### 目标
将用户选定或随机抽中的 Unsplash 图片应用为指定文档的题头图，处理「下载转存 `/assets/`」与「直接外链」两种模式，并实现**无闪烁即时刷新当前文档界面**。

#### 涉及文件
- `src/services/banner-applier.ts`

#### 实现细节
1. **获取当前文档 ID 与标题的辅助函数**：
   - 从 `click-editortitleicon` 事件传入的 `detail.data.rootID` 和 `detail.data.name` 直接获取；
   - 若从顶栏按钮或快捷键触发，通过查找当前激活的编辑器 DOM（`document.querySelector(".layout__wnd--active .protyle:not(.fn__none)") || document.querySelector(".protyle:not(.fn__none)")`），读取 `.protyle-title` 的 `data-node-id`（作为 `docId`）和 `.protyle-title__input` 的 `textContent`（作为文档标题）。
2. **图片本地化上传函数 `uploadImageToAssets(imageUrl: string, photoId: string): Promise<string>`**：
   - 使用 `fetch(imageUrl)` 获取图片 `Blob`（根据 `Blob.type` 决定扩展名 `.jpg` 或 `.png`，默认 `.jpg`）。
   - 构造文件名：`unsplash-${photoId}-${Date.now()}.jpg`。
   - 构造 `FormData`：
     ```typescript
     const formData = new FormData();
     formData.append("assetsDirPath", "/assets/");
     formData.append("file[]", new File([blob], fileName, { type: blob.type || "image/jpeg" }));
     ```
   - 请求 [`POST /api/asset/upload`](https://siyuannote.com/article/1749331310)，从返回的 `res.data.succMap[fileName]` 中提取本地路径（形如 `assets/unsplash-xxx-20261016120000-abcdefg.jpg`）。
3. **安全构造与写入 `title-img` 属性 `applyPhotoToDoc(docId: string, photo: UnsplashPhoto, config: PluginConfig)`**：
   - 异步触发 `triggerDownloadTrack(photo.links.download_location, config)`。
   - 根据 `config.imageQuality` 选取目标图片 URL（默认 `photo.urls.regular`）。
   - 若 `config.saveToLocalAssets === true`，调用 `uploadImageToAssets` 获取本地 `assets/...` 路径；若上传失败则弹窗提示或降级。
   - **安全转义 URL**：过滤任何 `"`、`'`、`\\`、`<`、`>` 字符，构造：
     ```typescript
     const safeUrl = finalUrl.replace(/["'<>\\]/g, "");
     const titleImgCss = `background-image:url("${safeUrl}");background-position:center 50%;`;
     ```
   - 调用 [`POST /api/attr/setBlockAttrs`](https://siyuannote.com/article/1749331310)：
     ```typescript
     await fetch("/api/attr/setBlockAttrs", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         id: docId,
         attrs: { "title-img": titleImgCss }
       })
     });
     ```
4. **前端 DOM 即时无闪烁同步刷新 (`refreshProtyleBackgroundDom(docId: string, safeUrl: string, titleImgCss: string)`)**：
   - 查找当前打开了该文档的所有 `.protyle` 容器（匹配 `.protyle-background[data-node-id="${docId}"]`）。
   - 若存在 `.protyle-background__img img`：
     - 将其 `src` 更新为 `safeUrl`，将 `style` 更新为 `background-position: center 50%;`，并移除 `.protyle-background__img` 上的 `.fn__none` 隐藏类。
   - 确保用户点击图片后**无需关闭重开文档**即可在 100ms 内看到新题头图生效。

#### 验收标准 (Checklist)
- [ ] 开启 `saveToLocalAssets` 时，图片成功保存在工作空间 `data/assets/` 下，且 `title-img` 属性值为 `assets/unsplash-...jpg`。
- [ ] 关闭 `saveToLocalAssets` 时，`title-img` 属性值为 `https://images.unsplash.com/...`。
- [ ] 点击选图后，当前打开的文档顶部立即渲染出题头图，无需手动刷新页面。

---

### Phase 6: Svelte 5 交互组件实现 (`src/components/` & `src/index.scss`)

#### 目标
使用 Svelte 5 Runes（`$state`, `$props`, `$effect`）构建响应式选图弹窗与设置面板，原生融入思源笔记的日间/夜间主题配色。

#### 涉及文件
- `src/components/UnsplashPicker.svelte`
- `src/components/SettingPanel.svelte`
- `src/index.scss`

#### 实现细节
1. **`UnsplashPicker.svelte` 选图弹窗核心功能**：
   - **Props**：`docId: string`, `docTitle: string`, `config: PluginConfig`, `i18n: Record<string, string>`, `onApplied: () => void`, `onOpenSetting: () => void`。
   - **顶部工具栏**：
     - 搜索输入框（回车或点击搜索按钮触发检索）。
     - 「一键随机」按钮（按当前搜索词直接随机抽一张并应用）。
     - 「本地转存 `assets`」快捷切换 Checkbox（实时同步状态）。
   - **智能分词快捷标签栏（Tag Pills）**：
     - 组件挂载时，若 `config.autoExtractTitleKeyword` 为 `true`，调用 `extractKeywordsFromTitle(docTitle, config.fallbackQuery)`。
     - 将 `primaryQuery` 填入搜索框并自动发起第 1 页搜索；同时在搜索框下方展示 `tokens` 胶囊按钮（如 `[组合词]`、`[秋日]`、`[露营]`），用户点击任一胶囊即可切换搜索词。
   - **3 列响应式图片网格（Photo Grid）**：
     - 展示 `photo.urls.small` 作为缩略图，底部渐变遮罩展示摄影师名字（点击打开摄影师 Unsplash 主页，不触发选图）。
     - 点击图片卡片主体：在该卡片上显示 Loading 遮罩（提示“正在下载转存至 assets...”或“正在应用...”），调用 `applyPhotoToDoc`，成功后触发 `onApplied()` 关闭弹窗或提示成功。
   - **底部分页栏**：
     - 显示总结果数、「上一页 / 下一页」按钮及当前页码。
   - **未配置 Access Key 引导态**：
     - 若检测到 `!config.accessKey`，在弹窗中央显示友好的引导卡片与「前往插件设置填写 Access Key」按钮。
2. **`SettingPanel.svelte` 设置面板**：
   - 提供 `Access Key` 密码/文本输入框（附带申请 Unsplash Developer Key 的说明链接）。
   - 提供「转存图片到本地 `/assets/` 目录」开关、「图片清晰度选择（Regular 1080p / Full / Raw）」、「打开时自动提取文档标题关键词」开关、「默认兜底搜索词」输入框、「使用思源内核代理」开关。
3. **`src/index.scss` 样式规范**：
   - 全部颜色使用思源原生 CSS 变量：`var(--b3-theme-background)`, `var(--b3-theme-surface)`, `var(--b3-theme-on-background)`, `var(--b3-theme-primary)`, `var(--b3-border-color)`，自动兼容所有日间/暗黑第三方主题。

#### 验收标准 (Checklist)
- [ ] 使用 Svelte 5 Runes 语法（`$state`, `$props`），无 Svelte 4 废弃语法警告。
- [ ] 弹窗关闭时通过 `unmount` 彻底销毁组件，无残留 DOM 或定时器。

---

### Phase 7: 插件主入口串联与多入口挂载 (`src/index.ts` & `scripts/make_dev_link.js`)

#### 目标
在 `Plugin` 主类中串联配置服务、事件总线菜单、顶栏图标、快捷键命令与 Dialog 挂载，并提供一键软链接脚本与双语 README。

#### 涉及文件
- `src/index.ts`
- `scripts/make_dev_link.js`
- `README.md` & `README_zh_CN.md`

#### 实现细节
1. **三处交互入口注册 (`src/index.ts`)**：
   - **入口 1 — 文档标题图标右键/左键菜单（最核心入口）**：
     监听 `this.eventBus.on("click-editortitleicon", this.onEditorTitleIconClick)`，向 `detail.menu` 注入两个子菜单项或并列菜单项：
     - `🖼️ Unsplash 搜索选图（按标题预搜）` $\rightarrow$ 打开 `UnsplashPicker` 弹窗。
     - `🎲 Unsplash 一键随机题头图` $\rightarrow$ 直接后台提取标题关键词（或兜底词），拉取一张随机横图并应用，底部 `showMessage` 提示进度。
   - **入口 2 — 顶栏快捷按钮 (`this.addTopBar`)**：
     注册自定义相机/图片 SVG 图标，点击后自动识别当前活动文档（`getActiveDocContext()`）并打开 `UnsplashPicker` 弹窗。
   - **入口 3 — 全局快捷键命令 (`this.addCommand`)**：
     注册命令 `open-unsplash-picker`（打开选图面板）和 `random-unsplash-cover`（为当前文档随机更换 Unsplash 题头图）。
2. **Svelte 5 `mount` / `unmount` 标准封装**：
   ```typescript
   import { mount, unmount } from "svelte";
   import UnsplashPicker from "./components/UnsplashPicker.svelte";

   private openPickerDialog(docId: string, docTitle: string) {
     let appInstance: Record<string, any> | null = null;
     const dialog = new Dialog({
       title: this.i18n.pickerTitle || "Unsplash 题头图",
       content: `<div class="unsplash-dialog-container"></div>`,
       width: this.isMobile ? "92vw" : "760px",
       height: this.isMobile ? "80vh" : "580px",
       destroyCallback: () => {
         if (appInstance) {
           unmount(appInstance);
           appInstance = null;
         }
       }
     });
     const target = dialog.element.querySelector(".unsplash-dialog-container")!;
     appInstance = mount(UnsplashPicker, {
       target,
       props: {
         docId,
         docTitle,
         config: this.config,
         i18n: this.i18n,
         onApplied: () => dialog.destroy(),
         onOpenSetting: () => {
           dialog.destroy();
           this.openSetting();
         }
       }
     });
   }
   ```
3. **开发软链接脚本 (`scripts/make_dev_link.js`)**：
   - 支持通过环境变量 `SIYUAN_PLUGIN_DIR` 或命令行参数指定思源工作空间的 `data/plugins` 目录，将构建产物目录（`dev` 或 `dist`）软链接为 `{workspace}/data/plugins/siyuan-plugin-unsplash-cover`。

#### 验收标准 (Checklist)
- [ ] `pnpm run check` (TypeScript 类型检查) 零错误通过。
- [ ] `pnpm run build` 成功生成 `dist/index.js`, `dist/index.css`, `dist/plugin.json`, `dist/i18n/*`。
- [ ] 在思源笔记中启用插件后，点击文档标题图标菜单、顶栏图标均可正常弹出选图界面并完成本地化题头图设置。
