# SiYuan Unsplash 题头图插件开发计划 (`siyuan-plugin-unsplash-cover`)

> **文档用途**：本文档为 AI Agent 友好的端到端开发执行蓝图（Step-by-Step Execution Plan）。每个阶段均包含明确的目标、涉及文件路径、核心数据契约、实现逻辑与可执行验收标准（Checklist）。
>
> **版本**：v2（依据代码/文档/合规审查修订，见文末「变更记录」）。v1 备份于 `DEVELOPMENT_PLAN.v1.bak.md`。
>
> **执行状态**：尚未开始编码。本文件仅为计划。

---

## 1. 项目概览与架构约束 (Context & Guardrails)

### 1.1 项目定位

开发一款基于 **Vite + Svelte 5 + TypeScript** 的思源笔记（SiYuan Note）前端插件，接入 Unsplash 官方图片 API，为思源文档提供：

1. **基于文档标题的零开销智能预搜**：打开选图面板时自动读取当前文档标题，通过「正则清洗 + 浏览器原生 `Intl.Segmenter` 分词」提取核心关键词并自动加载首屏候选图。
2. **关键词搜索与网格选图**：支持中英文关键词检索、横向（`landscape`）优选、分页加载、摄影师署名展示与归属信息写入。
3. **一键随机题头图**：无需打开弹窗，直接按文档标题关键词或兜底主题获取高清横图并应用。
4. **双模式图片存储**：默认**直接引用 Unsplash 托管的远程 URL（合规、零磁盘占用）**；可选开启「下载并调用思源内核接口转存至 `/assets/` 本地持久化」。

### 1.2 合规优先原则（本项目的一等约束）

Unsplash API Guidelines 明确要求：

- **必须使用 API 返回的托管 URL（hotlink）**，且适用于图片的**所有**使用场景，不仅是搜索结果页；
- 调用 `photo.links.download_location` 来统计「下载行为」；
- 展示摄影师署名与主页链接；
- 若对返回的图片 URL 做缩放/裁剪，**必须保留 URL 中的 `ixid` 参数**（否则无法统计浏览量，违反规范）。

因此本插件的**默认行为是外链引用**。本地转存属于「用户主动触发的下载行为」，作为**显式可选项**提供，并在 UI 与 README 中说明其影响与清理方式。

### 1.3 核心参考文档与规范链接

- **官方插件模板（直接作为脚手架起点）**：[siyuan-note/plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte)（Svelte 5 Runes + `svelte-check` + `make_dev_link.js` + zip 打包）
- **插件前端 API 类型声明**：[siyuan-note/petal](https://github.com/siyuan-note/petal) / npm 包 [`siyuan`](https://www.npmjs.com/package/siyuan)
- **思源内核公开 API 文档（权威，位于主仓库 `docs/`）**：[siyuan-note/siyuan/docs/API.md](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)、[docs/API.zh-CN.md](https://github.com/siyuan-note/siyuan/blob/master/docs/API.zh-CN.md)
- **插件集市发布规范**：[docs/PLUGIN-PUBLISH.zh-CN.md](https://github.com/siyuan-note/siyuan/blob/master/docs/PLUGIN-PUBLISH.zh-CN.md)
- **Unsplash API 文档**：[unsplash.com/documentation](https://unsplash.com/documentation)（`lang`/限流/动态缩放/`ixid`）
- **Unsplash API Guidelines**：[help.unsplash.com — API Guidelines](https://help.unsplash.com/en/collections/1451694-api-guidelines)、[Guideline: Hotlinking](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images)、[Guideline: Attribution](https://help.unsplash.com/en/articles/2511258-guideline-attribution)
- **`title-img` 属性 XSS 背景（必须遵守的最小版本依据）**：[CVE-2026-66396](https://nvd.nist.gov/vuln/detail/CVE-2026-66396) — SiYuan < v3.7.2 在 Gallery/Kanban 渲染 `title-img` 时未转义，导致存储型 XSS（CVSS 9.3）。

### 1.4 Agent 必须遵守的硬性约束 (Hard Guardrails)

1. **严禁使用 Node.js `fs` 写 `data/assets/`**：所有本地化文件必须通过内核接口 `POST /api/asset/upload` 写入，以保证跨端同步、资源索引与云端一致性。
2. **`minAppVersion` 必须为 `3.8.0`**（不低于 `3.7.2`）：低于该版本的内核在渲染 `title-img` 时存在未转义导致存储型 XSS 的风险（CVE-2026-66396）。不得为了让老版本可用而降低该值。
3. **`title-img` 值采用白名单校验，禁止「删字符式消毒」**：只允许以下两种形态，否则抛错并中止写入：
   - 本地资源：`/^assets\/[\w\-.]{1,180}\.(jpg|jpeg|png|webp|avif)$/i`
   - 远程资源：`new URL(u)` 解析成功，且 `protocol === "https:"` 且 `hostname === "images.unsplash.com"`
   构造后仍强制检查最终字符串**不含** `"` `'` `` ` `` `(` `)` `\` `<` `>` 与任何空白/控制字符；命中即中止（Unsplash 合法 URL 不会包含这些字符）。输出格式固定为：`background-image:url("<url>");background-position:center 50%;`
4. **不得手写前端 DOM 去「补渲染」题头图**：调用 `POST /api/attr/setBlockAttrs` 后，内核会向前端推送 `updateAttrs` 事务；`app/src/protyle/wysiwyg/transaction.ts` 中检测到 `title-img`/`icon`/`tags` 变化时会自行调用 `protyle.background.render(ial, rootID)`（移动端另有分支）。手动改 DOM 会与内核渲染互相覆盖、并随版本变动失效。仅在**实测发现**未刷新时，才允许增加一个独立、幂等、带超时的兜底函数（见 Phase 5.5）。
5. **所有内核 API 调用必须使用 `siyuan` 包导出的 `fetchPost` / `fetchSyncPost` / `fetchGet`**，不得裸写 `fetch("/api/...")`：前者会附加应用标识并处理「访问授权码」场景。`fetchSyncPost` 已确认支持直接透传 `FormData`（`app/src/util/fetch.ts` 中 `data instanceof FormData` 分支）。
6. **零后台常驻开销**：严禁在 `switch-protyle`、键盘输入、定时器中发起 Unsplash 请求或写盘。分词与网络请求仅在用户主动点击菜单/按钮/快捷键时触发。
7. **遵守 Unsplash API 规范（可执行条款）**：
   - 所有 API 请求带 `Authorization: Client-ID <AccessKey>` 与 `Accept-Version: v1`；
   - 应用图片时**必须**异步触发一次 `photo.links.download_location`（失败静默）；
   - 展示摄影师姓名与带 UTM 参数的主页链接（`?utm_source=siyuan_unsplash_plugin&utm_medium=referral`）；
   - 任何对图片 URL 的缩放参数化处理**必须保留 `ixid`**（用 `URL` + `URLSearchParams` 合并查询参数，禁止字符串拼接）；
   - 应用图片时把归属信息写入文档自定义属性（见 1.5），保证题头图脱离插件上下文后仍可溯源。
8. **Svelte 5 生命周期与内存防泄漏**：`new Dialog({...})` 的 `destroyCallback` 中必须 `unmount(componentInstance)`；所有事件/定时器/进行中的请求（`AbortController`）随卸载清理。
9. **配置变更必须落盘**：改配置只能经由统一 store + `saveConfig`，组件不得直接改 props 对象。
10. **速率友好**：demo 级 Access Key 仅 **50 请求/小时**（生产审批后 1000/小时），且**仅 `api.unsplash.com` 的 JSON 请求计数**，`images.unsplash.com` 的图片请求不计数。必须实现会话级结果缓存 + 请求去重 + 剩余额度显示。

### 1.5 归属信息属性契约（写入文档属性）

应用图片时除 `title-img` 外，同时写入以下自定义属性（便于溯源；不改变思源默认渲染）：

| 属性名 | 值 |
| --- | --- |
| `title-img` | `background-image:url("...");background-position:center 50%;` |
| `custom-unsplash-id` | `photo.id` |
| `custom-unsplash-author` | `photo.user.name` |
| `custom-unsplash-author-url` | 摄影师主页 + UTM |
| `custom-unsplash-link` | `photo.links.html` + UTM |

> 说明：`/api/attr/setBlockAttrs` 支持一次写入多个属性。清空字段用法传 `null`。

---

## 2. 目标目录结构 (Target Directory Structure)

工作目录：`/Users/qydxyx/projects/siyuan_unsplash`

```text
/Users/qydxyx/projects/siyuan_unsplash/
├── public/
│   ├── i18n/
│   │   ├── zh_CN.json              # 简体中文语言包（扁平 key）
│   │   └── en_US.json              # 英文语言包（扁平 key）
│   └── icon.png                    # 插件集市图标（Phase 1 必须存在）
│   └── preview.png                 # 插件集市预览图（Phase 1 必须存在）
├── scripts/
│   ├── make_dev_link.js            # 取自官方模板，软链接到 {workspace}/data/plugins/
│   ├── make_install.js             # 打包 package.zip（集市提交用）
│   └── clean.js                    # 清理产物目录
├── src/
│   ├── index.ts                    # 插件主入口（生命周期、菜单、顶栏、命令、Dialog 挂载、openSetting）
│   ├── index.scss                  # 全局与弹窗样式（适配思源 CSS 变量与暗黑模式）
│   ├── types/
│   │   └── index.ts                # PluginConfig / UnsplashPhoto / 内核信封类型
│   ├── stores/
│   │   └── config.svelte.ts        # 共享响应式配置（Svelte 5 Runes）+ 落盘回调
│   ├── services/
│   │   ├── config.ts               # loadConfig / saveConfig（loadData/saveData 封装）
│   │   ├── siyuan-kernel.ts        # 内核 API 薄封装（信封解包、上传、属性、代理）
│   │   ├── keyword-extractor.ts    # 标题清洗 + 懒加载 Intl.Segmenter 分词器
│   │   ├── title-img.ts            # title-img 值构造 + 白名单校验（纯函数，可单测）
│   │   ├── unsplash.ts             # Unsplash 客户端（搜索/随机/下载计数/错误映射/缓存/去重）
│   │   └── banner-applier.ts       # 题头图应用编排（转存、写入属性、撤销栈、本地资源复用）
│   ├── components/
│   │   ├── UnsplashPicker.svelte   # 选图主面板
│   │   ├── SettingPanel.svelte     # 设置面板
│   │   └── PhotoGrid.svelte        # 网格 + 卡片（拆分以便复用与测试视觉）
│   └── env.d.ts
├── tests/
│   ├── keyword-extractor.test.ts
│   ├── title-img.test.ts
│   └── unsplash-parse.test.ts
├── plugin.json                     # 插件元数据清单
├── package.json
├── tsconfig.json
├── svelte.config.js
├── vite.config.ts
├── vitest.config.ts
├── README.md
└── README_zh_CN.md
```

---

## 3. 分阶段实施步骤 (Step-by-Step Execution Plan)

### Phase 1: 脚手架（以官方模板为基线）+ 预检

#### 目标
以 `plugin-sample-vite-svelte` 为起点初始化工程，避免手写构建配置带来的偏差；补齐集市打包所需资源；完成必要的环境预检。

#### 执行方式（重要）
1. 将模板内容（`vite.config.ts`、`svelte.config.js`、`tsconfig.json`、`scripts/make_dev_link.js`、`scripts/*.js`）**复制为本项目基线**，再删除与本插件无关的部分（`src/kernel.ts`、`VITE_BUILD_TARGET=kernel` 相关脚本与 yaml i18n 插件，本项目使用 JSON i18n）。
2. **不要引入模板中的 YAML i18n 插件**，`public/i18n/*.json` 通过 `vite-plugin-static-copy` 直接复制到 `i18n/`。

#### 涉及文件
`package.json`、`plugin.json`、`tsconfig.json`、`svelte.config.js`、`vite.config.ts`、`vitest.config.ts`、`public/i18n/zh_CN.json`、`public/i18n/en_US.json`、`public/icon.png`、`public/preview.png`、`src/env.d.ts`

#### 实现细节

1. **`package.json`**
   - `devDependencies`：`svelte`(^5)、`@sveltejs/vite-plugin-svelte`、`svelte-check`、`typescript`、`vite`、`vite-plugin-static-copy`、`vite-plugin-zip-pack`、`sass`、`siyuan`(Petal 类型)、`vitest`、`cross-env`、`npm-run-all`、`@types/node`。
   - `scripts`：
     ```json
     {
       "dev": "cross-env NODE_ENV=development vite build --watch",
       "build": "run-s clean build:app",
       "build:app": "cross-env NODE_ENV=production vite build",
       "clean": "node ./scripts/clean.js",
       "check": "run-s check:types check:svelte",
       "check:types": "tsc --noEmit",
       "check:svelte": "svelte-check --tsconfig ./tsconfig.json",
       "test": "vitest run",
       "make-link": "node --no-warnings ./scripts/make_dev_link.js",
       "make-install": "pnpm run build && node --no-warnings ./scripts/make_install.js"
     }
     ```
   - **`check` 必须包含 `svelte-check`**：`tsc --noEmit` 不检查 `.svelte` 文件。

2. **`plugin.json`**（字段名以当前模板为准）
   ```json
   {
     "name": "siyuan-plugin-unsplash-cover",
     "author": "qydxyx",
     "url": "https://github.com/qydxyx/siyuan-plugin-unsplash-cover",
     "version": "0.1.0",
     "minAppVersion": "3.8.0",
     "backends": ["windows", "linux", "darwin", "docker", "ios", "android", "harmony"],
     "frontends": ["desktop", "mobile", "browser-desktop", "browser-mobile", "desktop-window"],
     "displayName": { "default": "Unsplash Cover", "zh_CN": "Unsplash 题头图", "zh-CN": "Unsplash 题头图" },
     "description": {
       "default": "Search or pick random Unsplash photos as document covers, with smart title keyword extraction.",
       "zh_CN": "接入 Unsplash 图库补充文档题头图，支持按文档标题智能分词预搜与一键随机换图。",
       "zh-CN": "接入 Unsplash 图库补充文档题头图，支持按文档标题智能分词预搜与一键随机换图。"
     },
     "readme": { "default": "README.md", "zh_CN": "README_zh_CN.md", "zh-CN": "README_zh_CN.md" },
     "icon": "icon.png",
     "preview": "preview.png",
     "funding": {},
     "keywords": ["unsplash", "cover", "banner", "title-img", "题头图"]
   }
   ```
   - 双语 key **同时写 `zh_CN` 与 `zh-CN`**，规避不同版本/集市端取值差异。
   - `minAppVersion` 见 Guardrail 2，不得下调。

3. **`vite.config.ts`**
   - `external: ["siyuan"]`；输出 `cjs`；入口 `src/index.ts` → `index.js`；样式 → `index.css`。
   - `vite-plugin-static-copy` 复制：`public/i18n/*` → `i18n/`、`plugin.json`、`README.md`、`README_zh_CN.md`、`icon.png`、`preview.png`。
   - dev 输出 `dev/`，prod 输出 `dist/`；生产构建附加 `vite-plugin-zip-pack` 生成 `package.zip`（集市提交需要）。

4. **集市资源必须在 Phase 1 就位**：`icon.png`（160×160）、`preview.png`（1024×768，建议多张截图命名 `preview.png`、`preview-1.png`…）。若用占位图，必须在本阶段生成真实文件，避免静态复制阶段报错。

5. **i18n 初始结构**：本阶段只建立**骨架键**（`pluginName`、`common.*`）；其余键随 Phase 6 增量补齐，Phase 6 结束时做完整性校验。

6. **预检脚本（一次性，写在 Phase 1 验收里，不进入产物）**：确认目标 workspace 插件目录可写、`make_dev_link.js` 生成软链接成功。

#### 验收标准 (Checklist)
- [ ] `pnpm install` 无版本冲突；`pnpm run check`（tsc + svelte-check）零错误。
- [ ] `pnpm run build` 产出 `dist/index.js`、`dist/index.css`、`dist/plugin.json`、`dist/i18n/zh_CN.json`、`dist/i18n/en_US.json`、`dist/package.zip`。
- [ ] `plugin.json` 中 `minAppVersion === "3.8.0"`。
- [ ] `public/icon.png`、`public/preview.png` 为真实存在的图片文件。

---

### Phase 2: 类型系统与配置持久化

#### 目标
定义配置与数据模型，实现配置读写与**共享响应式配置 store**（供组件与主入口共用，避免「配置改了但没保存 / props 不更新」问题）。

#### 涉及文件
`src/types/index.ts`、`src/services/config.ts`、`src/stores/config.svelte.ts`

#### 实现细节

1. **`PluginConfig`（`src/types/index.ts`）**
   ```typescript
   export interface PluginConfig {
     /** Unsplash API Access Key（demo key 即可，仅存于工作空间插件数据） */
     accessKey: string;
     /** 是否把选中的图片转存到思源本地 /assets/（默认 false：遵守 Unsplash hotlink 规范） */
     saveToLocalAssets: boolean;
     /** 题头图目标宽度（像素）。生成 URL 时保留 ixid，附加 w/q/fm/fit 参数 */
     imageWidth: 1080 | 1600 | 1920 | 2400;
     /** 图片质量（imgix q 参数） */
     imageQuality: 60 | 80 | 90;
     /** 打开选图面板时是否自动提取文档标题关键词并预搜（默认 true） */
     autoExtractTitleKeyword: boolean;
     /** 无法提取有效词或空文档时的兜底搜索词 */
     fallbackQuery: string;
     /** 是否通过思源内核正向代理发起网络请求（默认 false） */
     useKernelProxy: boolean;
   }
   export const DEFAULT_CONFIG: PluginConfig = {
     accessKey: "",
     saveToLocalAssets: false,
     imageWidth: 1920,
     imageQuality: 80,
     autoExtractTitleKeyword: true,
     fallbackQuery: "nature landscape",
     useKernelProxy: false,
   };
   ```
   - **删除原 v1 的 `imageQuality: "raw"` 语义**：`raw` 原图常达数十 MB，不适合题头图。改为「宽度 + 质量 + 格式」三参数化（`fm=jpg`），并对 `raw`/`full` URL 追加参数时**保留 `ixid`**。

2. **内核信封与错误类型**
   ```typescript
   export interface KernelEnvelope<T> { code: number; msg: string; data: T; }
   export class KernelError extends Error { constructor(msg: string, public code?: number) { super(msg); } }
   ```

3. **`UnsplashPhoto`**：保留 v1 定义（`id/description/alt_description/color/width/height/urls{five}/links{html,download_location}/user.name/user.username/user.links.html`），另增：
   ```typescript
   export interface UnsplashSearchResponse { total: number; total_pages: number; results: UnsplashPhoto[]; }
   export interface UnsplashResult<T> { data: T; rateRemaining: number | null; }
   ```

4. **`src/services/config.ts`**
   - `STORAGE_NAME = "unsplash-cover-config.json"`。
   - `loadConfig(plugin)`：`await plugin.loadData(STORAGE_NAME)`，与 `DEFAULT_CONFIG` 合并，并对每个字段做**类型/枚举兜底**（防止手改 JSON 导致非法宽度）。
   - `saveConfig(plugin, config)`：`plugin.saveData(STORAGE_NAME, config)`。
   - 安全提示：Access Key 以明文存于工作空间插件数据（会随云端同步），在设置面板与 README 中注明「建议仅使用低权限 demo key」。

5. **`src/stores/config.svelte.ts`**
   ```typescript
   import type { Plugin } from "siyuan";
   export function createConfigStore(plugin: Plugin, initial: PluginConfig) {
     let value = $state<PluginConfig>({ ...initial });
     const persist = debounce(() => saveConfig(plugin, $state.snapshot(value)), 300);
     return {
       get current() { return value; },
       update(patch: Partial<PluginConfig>) { Object.assign(value, patch); persist(); },
       async replace(next: PluginConfig) { value = next; await saveConfig(plugin, next); },
       flush: persist.flush,   // onunload 时同步落盘
     };
   }
   ```
   - 组件通过 `configStore.current` 读取、`configStore.update()` 写入；**禁止直接改 props 里的 config 对象**。

#### 验收标准 (Checklist)
- [ ] 首次运行（无配置文件）返回 `DEFAULT_CONFIG`，`saveToLocalAssets === false`。
- [ ] 手工把配置文件改成 `imageWidth: 999` 后加载，被规范化为合法枚举值，不抛异常。
- [ ] 组件侧修改配置后 300ms 内落盘，重启思源后生效。

---

### Phase 3: 标题清洗与 `Intl.Segmenter` 分词器

#### 目标
零第三方依赖、零常驻开销地从文档标题提取 1~3 个核心检索词与候选词列表。

#### 涉及文件
`src/services/keyword-extractor.ts`、`tests/keyword-extractor.test.ts`

#### 实现细节

1. **函数签名（保持 v1）**
   ```typescript
   export interface TitleExtractionResult { primaryQuery: string; tokens: string[]; }
   export function extractKeywordsFromTitle(rawTitle: string, fallbackQuery?: string): TitleExtractionResult;
   ```

2. **分词器懒加载单例（修正 v1 的性能假设）**
   ```typescript
   let segmenter: Intl.Segmenter | null | undefined;
   function getSegmenter(): Intl.Segmenter | null {
     if (segmenter !== undefined) return segmenter;
     try {
       segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
         ? new Intl.Segmenter("zh-CN", { granularity: "word" })
         : null;
     } catch { segmenter = null; }
     return segmenter;
   }
   ```
   - **不承诺 `< 1ms`**：首次调用需要初始化 ICU 数据（可能数毫秒）。仅在缓存命中后的稳态调用做性能断言（见验收）。
   - `Intl.Segmenter` 不可用时（极老内核）：降级为「按空格/标点切分 + 中文按 2-gram 切分」的简易回退，保证功能不缺失。

3. **清洗流水线（修正正则与顺序）**
   固定顺序：**日期 → 括号内容 → 套路词 → 标点归空 → 章节前缀 → 空白压缩**。
   - 日期：不使用 `\b`（对中文无效，会出现「16日」只吃掉「16」的回溯问题），改用 lookaround：
     - `/(?<!\d)\d{4}\s*[-/.年]\s*\d{1,2}(?:\s*[-/.月]\s*\d{1,2}\s*日?)?(?!\d)/g`
     - `/(?<!\d)\d{8}(?!\d)/g`
   - 括号：`/【[^】]*】/g`、`/\[[^\]]*\]/g`、`/（[^）]*）/g`、`/\([^)]*\)/g`
   - 套路词：`读书笔记|学习笔记|会议纪要|周报|日报|复盘|总结|草稿|未命名|Untitled`（忽略大小写）
   - 章节前缀（置于标点清理之前）：`/^(第[一二三四五六七八九十百千万零两0-9]+[章节篇讲课回]|Chapter\s*\d+|Part\s*\d+|\d+(?:\.\d+)*[\s.、\-:：]*)\s*/i`
   - 标点归空：`/[\p{P}\p{S}]+/gu`（Unicode 属性类，Node 与 Chromium 均支持）
   - 空白压缩：`/\s+/g` → 单空格 + `trim()`

4. **过滤规则**
   - 仅保留 `isWordLike === true`；
   - 停用词集合（中英，保持精简，可扩）与单字虚词过滤：中文保留 `length >= 2`（如「秋日」「露营」），英文保留 `length >= 2` 且不在停用词表；
   - 去重（大小写不敏感），`tokens` 最多 6 个；`primaryQuery` 取前 2~3 个（英文优先取前 3，中文取前 2~3 视长度而定）；
   - 空结果（如「2026-10-16 日报」「未命名」）→ `primaryQuery = fallbackQuery`，`tokens = []`。

#### 验收标准 (Checklist)
- [ ] **以性质断言，而非固定分词结果**（`Intl.Segmenter` 输出随 ICU 版本变化）：
  - 输入 `"2026-10-16 【读书笔记】第3章：秋日露营与咖啡冲泡指南"`：
    - 结果**包含** `露营`、`咖啡`；
    - 结果**不含** `2026`、`10`、`16`、`读书笔记`、`第3章`、停用词；
    - `primaryQuery` 非空且其分词结果均为实义词。
- [ ] 输入 `"2026-10-16 周报"`、`"未命名"`、`""` → `primaryQuery === fallbackQuery`，`tokens` 为空数组，不抛异常。
- [ ] 输入 `"秋日"`（单词语）→ `tokens` 含 `秋日`，不因长度过滤被清空。
- [ ] 稳态性能断言：预热一次后连续 1000 次调用平均耗时符合阈值（阈值由实测确定并写死在测试中，**不假设 1ms**）。
- [ ] 模拟 `delete (Intl as any).Segmenter` 时走降级分支且不抛异常。

---

### Phase 4: 内核 API 薄封装与 Unsplash 客户端

#### 目标
统一内核调用与网络通道，把「直连」与「内核代理」两种模式的返回结构、错误语义、限流信息归一化，供上层无差别使用。

#### 涉及文件
`src/services/siyuan-kernel.ts`、`src/services/unsplash.ts`、`tests/unsplash-parse.test.ts`

#### 实现细节

1. **`src/services/siyuan-kernel.ts`**
   ```typescript
   import { fetchSyncPost } from "siyuan";

   export async function apiJson<T>(path: string, body?: unknown): Promise<T> {
     const res = await fetchSyncPost(path, body);
     if (!res || res.code !== 0) throw new KernelError(res?.msg || "内核接口调用失败", res?.code);
     return res.data as T;
   }
   /** 上传返回：优先 succFiles[0].path，其次 succMap[fileName]；两者都缺则视为失败 */
   export async function uploadAsset(blob: Blob, fileName: string): Promise<string>;
   export async function setBlockAttrs(id: string, attrs: Record<string, string | null>): Promise<void>;
   export async function getBlockAttrs(id: string): Promise<Record<string, string>>;
   export interface ForwardProxyResult { status: number; body: string; bodyEncoding: "text" | "base64"; headers: Record<string, string>; }
   export async function forwardProxy(opts: {
     url: string; method?: string; timeout?: number;
     headers?: Record<string, string>;
     payload?: unknown; payloadEncoding?: "json" | "base64" | "hex";
     responseEncoding?: "text" | "base64";
   }): Promise<ForwardProxyResult>;
   export async function fetchImageBlob(url: string, config: PluginConfig): Promise<Blob>;
   ```
   - **`forwardProxy` 必须解包并核对两层状态**（v1 缺失）：
     ```typescript
     const env = await fetchSyncPost("/api/network/forwardProxy", {
       url, method: opts.method ?? "GET", timeout: opts.timeout ?? 15000,
       contentType: "application/json",
       headers: [opts.headers ?? {}],          // 注意：数组，元素为 key→value 对象
       responseEncoding: opts.responseEncoding ?? "text",
       ...(opts.payload !== undefined ? { payload: opts.payload, payloadEncoding: opts.payloadEncoding ?? "json" } : {}),
     });
     if (env.code !== 0) throw new KernelError(env.msg || "代理请求失败", env.code);
     return { status: env.data.status, body: env.data.body, headers: env.data.headers ?? {}, bodyEncoding: env.data.bodyEncoding };
     ```
   - **`fetchImageBlob` 双通道（v1 只在 API 层做了代理）**：
     - 直连：`fetch(url)` → `blob()`；
     - 代理：`forwardProxy({ url, responseEncoding: "base64" })` → `base64ToBlob(body, contentType)`；
     - 大小上限：`forwardProxy` 响应体上限 **32 MiB**，超出会返回 `code: 10`。因此默认按 `imageWidth`（≤2400、`q=80`、`fm=jpg`）请求，必然远小于上限；命中 `code === 10` 时给出明确错误提示。

2. **`src/services/unsplash.ts`**
   ```typescript
   export interface RequestContext { config: PluginConfig; signal?: AbortSignal; }
   async function requestUnsplash<T>(endpoint: string, params: Record<string, string>, ctx: RequestContext): Promise<UnsplashResult<T>>;
   export async function searchPhotos(query: string, page: number, perPage: number, ctx: RequestContext): Promise<UnsplashResult<UnsplashSearchResponse>>;
   export async function getRandomPhoto(query: string, ctx: RequestContext): Promise<UnsplashResult<UnsplashPhoto>>;
   export async function triggerDownloadTrack(downloadLocation: string, ctx: RequestContext): Promise<void>; // 静默失败
   ```
   - URL 构造：`https://api.unsplash.com${endpoint}` + `URLSearchParams`。
   - 请求头：`Authorization: Client-ID <trim(accessKey)>`、`Accept-Version: v1`；代理模式把这两个头放进 `headers` 数组。
   - `searchPhotos` 固定 `orientation=landscape`、`per_page`（默认 12）；`query` 含中文（`/[\u4e00-\u9fa5]/`）时附加 `lang=zh-Hans`（已核对官方语言表：简中为 `zh-Hans`）。
   - **限流信息归一化**：直连从 `res.headers.get("x-ratelimit-remaining")` 读取；代理从 `data.headers` **大小写不敏感**读取；统一返回 `rateRemaining: number | null`。
   - **错误映射（修正 v1 的 403 语义）**：403 既可能是「权限不足」也可能是「超出限流」，必须读 body 判断：
     | 情况 | 用户提示（i18n key） |
     | --- | --- |
     | 未配置 key | `error.noAccessKey`：引导前往设置 |
     | 401 | `error.invalidKey`：Access Key 无效 |
     | 403 + body 含 `Rate Limit Exceeded` | `error.rateLimit`：已超每小时配额，附剩余重置提示 |
     | 403 其他 | `error.forbidden`：该 Key 无此接口权限 |
     | 404（`/photos/random`） | 交给上层回退逻辑，不直接提示 |
     | 网络失败/超时 | `error.network`：建议开启「使用思源内核代理」 |
   - **缓存与去重**（对 50 次/小时的限额至关重要）：
     - 会话内存缓存 `Map<string, {at: number; payload: unknown}>`，键 `search:${query}|${page}|${perPage}`，TTL 10 分钟；
     - 进行中的同键请求复用同一个 `Promise`（in-flight 去重）；
     - `AbortController`：新搜索取消旧搜索，避免乱序覆盖；
     - 不在本地持久化任何 Unsplash 响应。
   - **`getRandomPhoto` 回退链**：`query` →（404/空）`fallbackQuery` →（仍失败）无 query 的 `orientation=landscape` 随机；三次都失败才提示错误。

#### 验收标准 (Checklist)
- [ ] 单元测试（`tests/unsplash-parse.test.ts`）覆盖：代理信封 `code != 0`、`status 401/403(限流)/403(权限)`、`data.headers` 大小写差异、`code === 10`（响应体超限）、JSON 解析失败。
- [ ] 同一查询连续调用两次仅产生 **1** 次真实请求（命中缓存），且并发两次也只发 **1** 次（in-flight 去重）。
- [ ] 代理模式下 `fetchImageBlob` 不使用直连 `fetch`（用 mock 断言）。
- [ ] 中文查询自动附带 `lang=zh-Hans`，所有搜索均带 `orientation=landscape`。

---

### Phase 5: 题头图应用服务（转存、写入、撤销）

#### 目标
把选中的图片安全地应用为文档题头图，处理两种存储模式、归属信息写入、重复转存复用与一键撤销。

#### 涉及文件
`src/services/banner-applier.ts`、`src/services/title-img.ts`、`tests/title-img.test.ts`

#### 实现细节

1. **`src/services/title-img.ts`（纯函数，先写测试）**
   ```typescript
   export function buildImageUrl(photo: UnsplashPhoto, config: PluginConfig): string; // 保留 ixid + w/q/fm/fit
   export function safeTitleImgUrl(rawUrl: string): string | null;                    // 白名单校验，失败返回 null
   export function buildTitleImgCss(safeUrl: string): string;                         // 固定格式
   ```
   - `buildImageUrl` 必须在 `photo.urls.raw` 的查询串上**合并**参数（`URLSearchParams`），保证 `ixid` 与 `fm`、`w`、`q`、`fit=max` 共存；不得删掉 `ixid`。
   - `safeTitleImgUrl` 失败时**返回 null 并中止写入**（不是删字符），符合 Guardrail 3。

2. **文档上下文获取（修正 v1 的移动端问题）**
   ```typescript
   export interface DocContext { docId: string; docTitle: string; }
   export function getActiveDocContext(): DocContext | null;
   ```
   - 优先使用 petal 的 `getActiveEditor()`（移动端也适用），取 `protyle.block.rootID`；
   - 标题读取顺序：`protyle.title?.editElement` →（`HTMLInputElement/HTMLTextAreaElement` 时取 `.value`，否则 `.textContent`）→ 为空时回退空串（触发 `fallbackQuery` 分支）；
   - **不再使用** `.layout__wnd--active .protyle` 这类桌面端专属选择器作为主路径（可保留为最后兜底）；
   - 标题图标菜单入口直接使用事件对象：`detail.protyle.block.rootID` 与 `detail.protyle` 上下文（**不依赖 `detail.data.name`**，该字段在类型声明中未确认）。

3. **上传本地化**
   - 文件名：`unsplash-${photo.id}.jpg`（扩展名与 `Blob.type` 保持一致：`image/png` → `.png`，`image/webp` → `.webp`，其余 `.jpg`）。**不再手动拼接 `Date.now()`**——内核会在落盘时追加时间戳与随机后缀（如 `assets/unsplash-abc-20210719092549-9j5y79r.jpg`）。
   - `uploadAsset` 使用 `FormData`：`assetsDirPath = "/assets/"`、`file[]`（字段名带方括号）；返回路径优先取 `data.succFiles[0].path`。
   - **重复转存复用**：插件数据维护 `asset-cache.json`（`{ [photoId]: { path, width } }`）。同 `photoId` 且同宽度已存在时直接复用，避免反复随机换图堆积孤儿资源。

4. **`applyPhotoToDoc(docId, photo, ctx)` 编排**
   ```
   1) 读取旧 title-img（getBlockAttrs）→ 暂存到撤销栈（仅内存，最近 10 条）
   2) 尽力触发 triggerDownloadTrack(photo.links.download_location)（不 await 阻塞主流程）
   3) 计算目标 URL：
        saveToLocalAssets ? await 转存(得到 assets/... 路径) : buildImageUrl(photo)
   4) safeTitleImgUrl 校验 → null 则抛错给 UI（不写入任何属性）
   5) setBlockAttrs(docId, { "title-img": css, "custom-unsplash-*": ... })
   6) 等待一次内核推送完成（可选：轮询 300ms 内 background 是否更新，仅用于测试断言）
   ```
   - 并发保护：同 `docId` 的应用操作串行化（简单互斥队列），防止连点导致属性写入交错。
   - 转存失败时的降级：**自动降级为外链模式**并提示（`warn.localSaveFailedFellBack`），而不是直接失败。
   - 撤销：`undoLastApply(docId)` 恢复上一份 `title-img` 与 `custom-unsplash-*`（无历史时禁用按钮）。

5. **（条件项，默认不实现）Phase 5.5 兜底渲染**：仅当「待验证事项清单」第 2 条实测确认内核未自动重渲染时，才在 `banner-applier.ts` 中增加一个独立函数 `ensureBackgroundRendered(docId, safeUrl, timeoutMs = 400)`：
   - 在 `setBlockAttrs` 之后启动，轮询 `.protyle-background[data-node-id="<docId>"] img`；
   - 若 400ms 内 `src` 已是目标 URL，直接结束（幂等，不与内核抢占）；
   - 仅在超时未更新时，才做一次最小 DOM 同步，并 `console.warn` 记录版本信息，便于后续判断是否需要移除；
   - 该函数**不得**出现在主流程路径上（默认分支不调用它）。

6. **孤儿资源提示**：README 与设置面板注明「开启本地转存后，反复更换会积累图片文件，建议定期用思源自带的未引用资源清理功能处理」，插件不做删除（避免误删）。

#### 验收标准 (Checklist)
- [ ] `tests/title-img.test.ts`：`ixid` 保留、参数合并正确；`javascript:`、`data:`、`http:`、`images.unsplash.com.evil.com`、含 `"`/`()` 的 URL 一律返回 `null`；`assets/../etc/passwd`、多级路径失败；合法 `assets/xxx-20210719-abc.jpg` 通过。
- [ ] `saveToLocalAssets=false`（默认）时 `title-img` 值为 `https://images.unsplash.com/...` 且**包含 `ixid`**。
- [ ] `saveToLocalAssets=true` 时文件落于工作空间 `data/assets/`，`title-img` 为 `assets/...`。
- [ ] 转存失败时自动外链降级并提示，不写入非法值。
- [ ] 应用后**不执行任何手写 DOM 操作**，当前打开的文档题头图在 100ms 内自动更新（验证方式：应用前给 `.protyle-background` 打标记，应用后断言该元素被内核重新渲染/内容变化，且代码中不存在直接修改 `.protyle-background__img` 的逻辑）。
- [ ] 连点 5 次仅产生一次最终属性写入（互斥生效），过程中无属性交错。
- [ ] 「恢复上一张」可正确回滚 `title-img` 与 4 个归属属性。

---

### Phase 6: Svelte 5 交互组件

#### 目标
用 Svelte 5 Runes 实现选图主面板、图片网格与设置面板，完全适配思源主题变量。

#### 涉及文件
`src/components/UnsplashPicker.svelte`、`src/components/PhotoGrid.svelte`、`src/components/SettingPanel.svelte`、`src/index.scss`、`public/i18n/*.json`

#### 实现细节

1. **`UnsplashPicker.svelte`**
   - Props：`docId`、`docTitle`、`configStore`、`i18n`、`onApplied`、`onOpenSetting`、`onUndo`（撤销回调由主入口注入）。
   - 顶部工具栏：搜索框（回车/按钮触发）、「一键随机」（当前词随机并应用）、本地转存开关（读写 `configStore.update`，**不是直接改 props**）。
   - 分词胶囊：挂载时若 `autoExtractTitleKeyword` 为真，调用 `extractKeywordsFromTitle(docTitle, fallbackQuery)`，填入 `primaryQuery` 并自动搜索；下方渲染 `tokens` 为可点胶囊；第一个胶囊为「组合词」。
   - 网格（3 列，窄屏 2 列）：`photo.urls.small` 缩略图 + 底部渐变署名（摄影师姓名，点击打开主页 `?utm_source=...&utm_medium=referral`，`stopPropagation` 不触发选图）。
   - 卡片状态：`idle | applying | done | error`，应用期间显示进度文案（「正在下载转存」/「正在应用」），并禁用其他卡片的点击（全局互斥）。
   - 底栏：结果总数、上一页/下一页、当前页码、**剩余额度**（`rateRemaining` 显示为「本小时剩余 N 次」，为 null 时隐藏）、「恢复上一张」。
   - 未配置 Key 的引导态：居中卡片 + 「前往设置」按钮（调用 `onOpenSetting`）。
   - **空结果处理**：搜索 0 结果时自动以 `fallbackQuery` 重试一次，并以 `info` 提示已回退；仍为 0 时展示空状态。
   - 归属声明：面板底部固定一行 "Photos provided by Unsplash"（hyperlinked + UTM）。

2. **`PhotoGrid.svelte`**：纯展示 + 事件向上抛出（`onpick`），便于后续替换布局。

3. **`SettingPanel.svelte`**
   - Access Key（`type=password`，可切换明文）、申请链接、「仅建议使用低权限 demo key，明文存储于工作空间」提示；
   - 「转存到本地 /assets/」开关 + 合规说明（默认关闭）+ 孤儿资源清理提示；
   - 目标宽度（1080/1600/1920/2400）、质量（60/80/90）；
   - 「打开时自动提取标题关键词」开关、兜底搜索词输入框；
   - 「使用思源内核代理」开关 + 网络受限场景说明；
   - 所有修改经 `configStore.update()`，即时保存。

4. **`src/index.scss`**：全部使用思源 CSS 变量（`--b3-theme-background/surface/on-background/primary`、`--b3-border-color`、`--b3-theme-on-surface`），不硬编码颜色；弹窗高度 100% 填充容器。

5. **i18n**：本阶段补齐全部 UI 键（含上述 `error.*`、`warn.*`），并保证 `zh_CN.json` 与 `en_US.json` **键集合完全一致**。

#### 验收标准 (Checklist)
- [ ] 仅使用 Runes（`$state`/`$props`/`$derived`/`$effect`），`pnpm run check` 无 Svelte 4 废弃语法告警。
- [ ] `zh_CN.json` 与 `en_US.json` 键集合一致（用一个 vitest 用例断言），且代码中无硬编码中文/英文文案。
- [ ] 面板在日间/夜间主题下均可读（人工核对，截图存档）。
- [ ] 弹窗关闭后无残留 DOM、无未清理的 `setTimeout`/事件监听/进行中的请求（`AbortController` 已 abort）。

---

### Phase 7: 主入口串联与生命周期

#### 目标
串联配置、事件、入口与 Dialog 挂载，并保证卸载干净。

#### 涉及文件
`src/index.ts`、`scripts/make_dev_link.js`（模板带来）、`README.md`、`README_zh_CN.md`

#### 实现细节

1. **生命周期与清理**
   ```typescript
   private onTitleIconClick = ({ detail }: CustomEvent) => { ... };   // 绑定实例，便于 off

   async onload() {
     this.config = await loadConfig(this);
     this.configStore = createConfigStore(this, this.config);
     this.eventBus.on("click-editortitleicon", this.onTitleIconClick);
     this.addTopBar({ icon: "iconImage", title: ..., callback: ... });
     this.addCommand({ langKey: "openPicker", hotkey: "", callback: () => this.openPickerForActiveDoc() });
     this.addCommand({ langKey: "randomCover", hotkey: "", callback: () => this.randomCoverForActiveDoc() });
   }

   onunload() {
     this.eventBus.off("click-editortitleicon", this.onTitleIconClick);
     this.configStore.flush();          // 同步落盘
     this.pickerDialog?.destroy();      // 关闭遗留弹窗（其 destroyCallback 会 unmount）
   }

   async uninstall() { await this.removeData(STORAGE_NAME); }
   ```
   - **`onunload` 中必须 `eventBus.off`**（v1 缺失）。
   - **`uninstall` 中清理插件数据**（v1 缺失）。

2. **三处入口（保留 v1 设计，仅修正取值来源）**
   - 入口 1：`click-editortitleicon` → 菜单注入「搜索选图」「一键随机题头图」；上下文取 `detail.protyle.block.rootID`。
   - 入口 2：顶栏按钮 → `getActiveDocContext()`（`getActiveEditor()` 实现）。
   - 入口 3：两个命令 `openPicker` / `randomCover`（不设默认快捷键，避免与用户键位冲突，由用户在设置中绑定）。

3. **`openPickerDialog`（修正 v1 的组件挂载与单例管理）**
   ```typescript
   let appInstance: ReturnType<typeof mount> | null = null;
   let pickerDialog: Dialog | null = null;

   private openPickerDialog(docId: string, docTitle: string) {
     this.pickerDialog?.destroy();                     // 单例：避免多开
     const dialog = new Dialog({
       title: this.i18n.pickerTitle,
       content: `<div class="unsplash-dialog-container"></div>`,
       width: this.isMobile ? "92vw" : "760px",
       height: this.isMobile ? "80vh" : "580px",
       destroyCallback: () => {
         if (appInstance) { void unmount(appInstance); appInstance = null; }
         if (this.pickerDialog === dialog) this.pickerDialog = null;
       },
     });
     this.pickerDialog = dialog;
     appInstance = mount(UnsplashPicker, {
       target: dialog.element.querySelector(".unsplash-dialog-container")!,
       props: { docId, docTitle, configStore: this.configStore, i18n: this.i18n,
                onApplied: () => dialog.destroy(), onUndo: () => this.undoLast(docId),
                onOpenSetting: () => { dialog.destroy(); this.openSetting(); } },
     });
   }
   ```

4. **`openSetting()` 覆写（v1 缺失）**
   ```typescript
   openSetting() {
     const dialog = new Dialog({ title: this.i18n.settingTitle, content: `<div class="unsplash-setting-container"></div>`,
       width: this.isMobile ? "92vw" : "640px", height: "600px",
       destroyCallback: () => { if (settingApp) { void unmount(settingApp); settingApp = null; } } });
     settingApp = mount(SettingPanel, { target: dialog.element.querySelector(".unsplash-setting-container")!, props: { configStore: this.configStore, i18n: this.i18n } });
     return dialog;
   }
   ```

5. **`randomCoverForActiveDoc`**：`getActiveDocContext()` → 分词 → `getRandomPhoto`（含三级回退）→ `applyPhotoToDoc` → `showMessage` 进度与结果提示。

6. **`scripts/make_dev_link.js`**：沿用模板（支持 `SIYUAN_PLUGIN_DIR` 环境变量与命令行参数），产出 `{workspace}/data/plugins/siyuan-plugin-unsplash-cover`。

7. **README（中英）必须包含**：
   - 功能简介与截图；
   - 如何申请 Unsplash Access Key、demo 限额（50 次/小时）说明；
   - **合规声明**：默认外链引用；本地转存为可选且有孤儿资源风险；归属信息以自定义属性写入文档；
   - 隐私说明：Access Key 明文存于工作空间插件数据（会随同步）；插件不上传用户笔记内容，仅发送标题派生的检索词、且仅在用户主动操作时；
   - 网络受限时开启内核代理的说明；
   - 卸载清理说明。

#### 验收标准 (Checklist)
- [ ] `pnpm run check` 与 `pnpm run test` 全绿。
- [ ] 在思源中启用插件后：标题图标菜单、顶栏按钮、两个命令均可正常打开选图/随机换图。
- [ ] 关闭并重新加载插件后，事件监听不重复触发（日志仅 1 次），无控制台报错。
- [ ] 移除插件（uninstall）后插件数据被清理。

---

### Phase 8: 发布准备

#### 目标
产出可提交集市的产物与文档，完成一次端到端回归。

#### 实现细节
1. `pnpm run make-install` 生成 `package.zip`。
2. 版本号统一：`plugin.json` 与 `package.json` 同步（提供 `update-version` 脚本）。
3. 集市资源：`icon.png`(160×160)、`preview.png`(1024×768)、README 双语。
4. 手工回归清单（下节）。

#### 验收标准 (Checklist)
- [ ] `dist/` 内容与 `package.zip` 一致，且 `package.zip` 根层即 `plugin.json`（不含外层目录）。
- [ ] 按下方「端到端手工回归清单」全部通过并记录结果。

---

## 4. 测试与验证策略

### 4.1 自动化测试（vitest，Node 环境）
| 文件 | 覆盖内容 |
| --- | --- |
| `tests/keyword-extractor.test.ts` | 清洗顺序、中文日期边界、Unicode 标点、停用词、空标题回退、`Intl.Segmenter` 缺失降级、稳态性能 |
| `tests/title-img.test.ts` | URL 参数合并与 `ixid` 保留、白名单拒绝清单、CSS 模板固定格式 |
| `tests/unsplash-parse.test.ts` | 代理信封解包、状态码与限流错误映射、headers 大小写、`code:10` 超限、缓存与 in-flight 去重 |
| `tests/i18n.test.ts` | `zh_CN` / `en_US` 键集合一致 |

> 纯函数（清洗器、URL 校验、响应解析）是本项目的主要风险面，必须做到无网络可测。

### 4.2 端到端手工回归清单
1. 无 Key 状态：打开面板 → 显示引导态 → 点「前往设置」→ 填写 Key 后返回面板可搜索。
2. 默认（外链）模式：标题预搜自动填充 → 选图 → 题头图立即出现 → 文档属性含 4 个 `custom-unsplash-*`。
3. 本地转存模式：选图 → `data/assets/` 出现文件 → `title-img` 为 `assets/...` → 同步到另一设备后图片正常。
4. 一键随机（不打开弹窗）→ 有提示 → 题头图更新。
5. 「恢复上一张」→ 回到上一张。
6. 断网 + 关闭代理 → 友好网络错误；开启内核代理 → 功能恢复（含图片下载通道）。
7. 无效 Key（401）与错误 Key（403 权限）→ 文案正确区分；限流触发时文案为配额提示。
8. 夜间/日间主题、第三方主题下样式可读。
9. 移动端（或模拟窄屏）：面板 92vw/80vh 布局可用，标题读取正常。
10. 禁用/重载插件：无残留 DOM、无重复监听、无控制台报错。
11. 连续随机 10 次（本地模式）：已转存过的图片复用，不产生重复文件。

---

## 5. 待验证事项清单（编码期间必须实测后再定稿）

这些点依赖运行环境或具体内核版本，**不得凭假设实现**，需在开发机上实测并回填到本文档。
标注「已按源码确认」的条目已核对 SiYuan master 源码，但仍建议在真机上跑一遍确认行为。

原文 6 条 → 当前状态：

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | `/api/network/forwardProxy` 的 `responseEncoding: "base64"` 可用性 | **待真机验证**。已按 `docs/API.md` 实现，并处理 `code: 10`（32 MiB 上限）。若该版本不支持 base64，改用 `/api/network/proxy?u=<base64url>&h=<base64url-headers>`（代码集中在 `forwardProxy` / `fetchImageBlob`，改动点只有一处）。 |
| 2 | `setBlockAttrs` 后前端是否自动重渲染题头图 | **已按源码确认**：`app/src/protyle/wysiwyg/transaction.ts` 的 `updateAttrs` 分支检测到 `title-img` 变化后调用 `protyle.background.render(ial, rootID)`（移动端另有分支）。因此**没有**实现 Phase 5.5 的兜底函数；若真机发现不刷新，再按 5.5 的约束补一个幂等兜底。 |
| 3 | 标题元素类型 | **已按源码确认**：`app/src/protyle/header/Title.ts` 中 `editElement` 是 `<div contenteditable="true" class="protyle-title__input">`，因此读 `textContent`；`readTitleFromProtyle` 同时兼容 `input/textarea`。 |
| 4 | 上传返回 `succFiles` / `succMap` | **已按源码确认**：master 两者都存在，`succMap` 标注为兼容字段。实现优先 `succFiles[0].path`，回退 `succMap[fileName]`。 |
| 5 | `addTopBar` 的 `icon` 命名 | **已按源码确认**：`iconImage` / `iconRefresh` / `iconCheck` 均存在于 `app/appearance/icons/litheness/icon.js`；`contextMenu` 选项本插件未使用。 |
| 6 | demo key 限流阈值与代理模式下的响应头透传 | **待真机验证**：直连读响应头，代理读 `data.headers`（大小写不敏感），并已在 UI 显示剩余次数。 |

### To-be-verified on a real device (after enabling the plugin)

- [ ] 远程 URL 经过 `title-img` IAL 往返后 `&` 是否保持正确（若被转义成 `&amp;` 导致图片 404，则改为写入 `&amp;`，因为 `Background.render` 会调用 `Lute.UnEscapeHTMLStr` 还原）。
- [ ] 代理模式下的图片下载通道（`responseEncoding: base64`）。
- [ ] 直连模式在目标网络环境下是否可用（受限网络需开启代理）。
- [ ] 应用后当前文档是否在 100ms 内出现题头图（不手写 DOM 的前提下）。
- [ ] 移动端（或窄屏）面板布局与标题读取。
- [ ] 本地转存模式：`data/assets/` 落盘、同图复用、跨设备同步。

---

## 6. 风险登记（Risk Register）

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 违反 Unsplash hotlink/署名规范被停用 Key | 插件核心功能失效 | 默认外链；署名 + UTM；`ixid` 保留；归属属性写入文档 |
| `title-img` 注入（CVE-2026-66396 同类问题） | 用户存储型 XSS | 白名单校验 + `minAppVersion 3.8.0` + 单测覆盖拒绝清单 |
| demo Key 50 次/小时被快速耗尽 | 用户体感「插件坏了」 | 会话缓存、in-flight 去重、剩余额度显示、明确限流文案 |
| 中文检索词在 Unsplash 上相关性差 | 结果不理想 | `lang=zh-Hans`；0 结果自动回退兜底词；支持英文兜底 |
| `Intl.Segmenter` 结果跨版本不一致 | 测试脆弱 / 结果波动 | 测试用性质断言，不用固定分词快照 |
| 本地转存堆积孤儿资源 | 磁盘膨胀 | 同 `photoId` 复用、文档内提示清理方式，不自动删除 |
| 内核接口/前端实现随版本变化 | 功能静默失效 | 集中在 `siyuan-kernel.ts` 薄封装；待验证清单逐条实测；兜底函数仅在实测需要时添加 |
| 网络受限（国内直连 Unsplash） | 完全不可用 | 代理模式 + 图片下载同通道 + 明确网络错误提示 |

---

## 7. 执行记录（Phase 1–8 实施结果）

> 记录时间：本次实施；命令均在 `/Users/qydxyx/projects/siyuan_unsplash` 下执行。

### 7.1 完成状态

| Phase | 结果 | 验收证据 |
| --- | --- | --- |
| 1 脚手架 | 完成 | `pnpm install` 无冲突；`pnpm run check`（tsc + svelte-check）0 error；`public/icon.png`(160×160)、`public/preview.png`(1024×768) 为真实图片 |
| 2 类型与配置 | 完成 | `normalizeConfig` 对非法 `imageWidth` 兜底；`saveToLocalAssets` 默认 `false`；组件改动经 store 落盘 |
| 3 分词器 | 完成 | `tests/keyword-extractor.test.ts` 通过；真实标题用例命中「露营/咖啡」；空标题回退兜底词 |
| 4 内核封装与客户端 | 完成 | `tests/unsplash-parse.test.ts` 覆盖 401/403(限流)/403(权限)/404、`code:10`、缓存与 in-flight 去重、`lang=zh-Hans` |
| 5 题头图应用 | 完成 | `tests/title-img.test.ts` 覆盖白名单拒绝清单与固定 CSS 形态；未实现手动 DOM 刷新（见 §5 第 2 条） |
| 6 Svelte 组件 | 完成 | svelte-check 0 error 0 warning；`tests/i18n.test.ts` 校验中英键集合一致 |
| 7 主入口与生命周期 | 完成 | CJS 产物 `module.exports = <class>` 已验证可被 `require`；`onunload` 解绑事件、`uninstall` 清理数据 |
| 8 发布准备 | 完成 | `pnpm run build` 产出 `dist/`（index.js / index.css / plugin.json / i18n / icon / preview / 双语 README）与 `package.zip` |

### 7.2 最终验证命令与结果

```bash
pnpm run check   # tsc --noEmit + svelte-check：0 error, 0 warning
pnpm run test    # vitest：4 files, 58 tests passed
pnpm run build   # dist/index.js 71.6 kB, dist/index.css 3.6 kB, package.zip
```

- 构建产物结构：`package.zip` 内为 `index.js`、`index.css`、`plugin.json`、`i18n/{zh_CN,en_US}.json`、`icon.png`、`preview.png`、`README*.md`（无多余目录）。
- 产物导出校验：用 Node 加载 `dist/index.js`（stub 掉 `siyuan`）确认 `module.exports` 为插件类。

### 7.3 与计划的差异（实施记录）

1. **新增 `src/utils/i18n.ts`、`src/services/doc-context` 相关函数合并在 `banner-applier.ts`、`tests/stubs/siyuan.ts`**：用于 i18n 取值/错误文案映射、文档上下文解析、以及 vitest 中对 `siyuan` 包的别名替身（该包在 Node 下无法解析）。
2. **Access Key 支持思源密钥库**：若内核提供 `plugin.getSecret()`，优先读取名为 `unsplash_access_key` 的密钥，缺失时回退到插件配置（明文，已在 UI/README 说明）。这是计划外的增强，用于降低明文存储风险。
3. **应用图片后不自动关闭面板**：改为卡片显示成功状态 + 顶部提示，并在底栏提供「关闭」按钮（符合 Phase 6 验收中「关闭弹窗或提示成功」的可选项）。
4. **`forwardProxy` 仅保留 GET + 头 + `responseEncoding`**：未实现 `payload` 参数（插件不需要），参数类型因此无需绕过 `JSONValue` 约束。
5. **`pnpm-workspace.yaml` 显式关闭 `@parcel/watcher` 构建脚本**：Vite/sass 不需要该原生 watcher，避免安装期非确定性。
6. **vite 配置适配 Vite 8**：`minify: !isDev`（`"esbuild"` 在新版会要求额外安装 esbuild）；`assetFileNames` 将任意 CSS 重命名为 `index.css`；`public/` 交给 Vite 的 publicDir 复制，`vite-plugin-static-copy` 只复制 `plugin.json` 与双语 README（否则会出现 `dist/public/` 重复目录）。
7. **未实现 Phase 5.5 兜底渲染**：依据源码确认为非必需（见 §5）。
8. **性能断言阈值**：分词器验收改为「预热后 500 次调用平均 < 2ms/次」，测试中实际远低于该值；不再承诺「首次调用 < 1ms」。

### 7.4 未完成/阻塞项

- 真机验证：本环境未运行 SiYuan（`http://127.0.0.1:6806` 无响应），因此 §5 的「To-be-verified on a real device」清单与手工回归清单尚未执行。
- 链接到工作空间需用户侧执行：`pnpm run make-link -- /path/to/workspace/data/plugins`（或先启动思源后用 `pnpm run make-link` 自动探测）。

---

## 8. 变更记录（v1 → v2 → 实施）


| # | 变更 | 原因 |
| --- | --- | --- |
| 1 | `saveToLocalAssets` 默认改为 `false`；本地转存变为显式可选并附合规/清理提示 | Unsplash 规范要求使用 API 返回的托管 URL |
| 2 | 新增「归属信息属性契约」（`custom-unsplash-*`） | 题头图脱离插件上下文后仍需可溯源/署名 |
| 3 | 删除 Phase 5 的手写 DOM 刷新，改为依据内核 `updateAttrs` → `background.render` 的既有行为，仅在实测失败时加独立兜底 | 手动改 DOM 会与内核渲染冲突且随版本失效 |
| 4 | 补全 `forwardProxy` 双层状态解包（`code` + `data.status` + `data.headers`） | v1 未处理返回信封，错误无法辨别 |
| 5 | 图片下载也走代理（`responseEncoding: base64`），并标注 32 MiB 上限与超限错误码 | v1 代理只覆盖 API，受限网络下转存必失败 |
| 6 | 消毒策略由「删字符」改为白名单 + 失败中止；`minAppVersion` 提升至 3.8.0 | 删字符不足以防属性逃逸；CVE-2026-66396 影响 < 3.7.2 |
| 7 | 全部内核调用改用 `fetchPost/fetchSyncPost`（含 `FormData` 透传） | 兼容「访问授权码」场景 |
| 8 | 新增共享响应式配置 store + 落盘回调 | v1 的「实时同步开关」无保存路径，props 也不会更新 |
| 9 | 补 `openSetting()` 覆写、`onunload` 事件解绑、`uninstall` 数据清理 | v1 设置面板无法挂载、监听与数据泄漏 |
| 10 | 文档上下文改用 `getActiveEditor()`，弃用桌面端专属选择器；不再依赖 `detail.data.name` | 移动端可用性 + 类型未确认字段 |
| 11 | 新增请求取消/去重、结果缓存、限流额度显示、`/photos/random` 三级回退 | 50 次/小时限额与乱序覆盖问题 |
| 12 | `imageQuality: raw/full` 改为「宽度 + 质量 + `fm=jpg`」参数化，且强制保留 `ixid` | 原图过大不适合题头图；参数化会丢失 `ixid` 违反规范 |
| 13 | 文件名不再拼 `Date.now()`，扩展名与 `Blob.type` 一致；优先读 `succFiles` | 与内核落盘命名机制重复；返回值字段优先级 |
| 14 | 新增同名 `photoId` 转存复用 + 撤销（恢复上一张） | 减少孤儿资源、提升可用性 |
| 15 | 分词器改为懒加载单例，撤销「<1ms」承诺；正则改用 lookaround 并固定清洗顺序 | ICU 初始化耗时；`\b` 对中文无效导致 `16日` 回溯 |
| 16 | 关键词验收改为性质断言；`Intl.Segmenter` 缺失时提供降级实现 | 分词结果随 ICU 版本变化 |
| 17 | 新增 vitest 测试、`svelte-check`、i18n 键一致性校验 | `tsc --noEmit` 不检查 `.svelte`；v1 无任何测试 |
| 18 | 阶段顺序调整：集市图片资源与脚手架同阶段落地；i18n 完整性校验后移到 Phase 6 | 静态复制依赖 README/图片；界面未写时无法保证键完整 |
| 19 | 脚手架改为「克隆官方模板再裁剪」 | 避免手写构建/软链脚本偏差 |
| 20 | 参考链接更正为官方 `docs/API.md`、Unsplash Guidelines 与 CVE 条目 | v1 引用了第三方转载与出处不匹配的引用 |
| 21 | 新增「待验证事项清单」与「风险登记」 | 多处行为依赖内核版本，需实测而非假设 |
