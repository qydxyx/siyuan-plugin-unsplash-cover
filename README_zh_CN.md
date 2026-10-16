# Unsplash 题头图（SiYuan 插件）

[English](README.md)

从 [Unsplash](https://unsplash.com) 挑选图片，设为思源文档的题头图（`title-img`）。打开选图面板时会
读取当前文档标题，自动清洗并分词成检索词，因此通常不用输入任何内容就能看到相关的候选图。

## 从哪里打开

本插件**不会替换**思源自带的题头图对话框（「设置题头图」里的 内置 / 我的），而是另外提供入口，共四处：

1. **顶栏图标**：右上角图标区里的图片图标（提示文字「Unsplash 题头图」）。
   如果看不到，检查一下插件是否启用，以及顶栏条目是否被隐藏。
2. **文档标题左侧图标**：点击后菜单里选「Unsplash：打开选图面板」或「Unsplash：随机更换题头图」。
3. **命令面板**：点顶栏的闪电图标（或 `Ctrl/Cmd+P`），搜索 `Unsplash`。
4. **快捷键**：上面两个命令都可以在 `设置 → 快捷键` 里绑定。

## 功能

- **按标题预搜**：标题先做正则清洗（日期、括号标注、「读书笔记/会议纪要」类套路词、章节前缀），再用浏览器
  原生的 `Intl.Segmenter` 分词。不引入任何词库，也没有常驻开销——只有你打开面板时才会分词。
- **关键词胶囊**：点击任一提取出的词可单独检索，也可以点击组合词。
- **一键随机题头图**：从文档标题图标菜单、顶栏按钮或命令触发，无需打开弹窗。
- **两种存储模式**：默认直接引用 Unsplash 的图片地址；也可通过内核接口下载并转存到工作空间的
  `data/assets/`。
- **归属信息随文档保存**：摄影师、图片 ID 与链接会写入 `custom-unsplash-*` 块属性，方便溯源。
- **可恢复上一张**：面板会记住每篇文档的上一张题头图，一键回滚。
- **网络受限可用**：API 请求与图片下载都可以改走思源内核代理。

## 获取 Access Key

1. 在 <https://unsplash.com/oauth/applications> 创建一个应用。
2. 复制其中的 **Access Key**（不是 secret key）。
3. 在思源中打开 **设置 → Unsplash 题头图**，粘贴进去。

开发者（demo）Key 的限额是**每小时 50 次请求**，且只统计 `api.unsplash.com` 的调用；从
`images.unsplash.com` 下载图片不计数。插件会把搜索结果缓存 10 分钟、对重复请求去重，并在面板底部显示
本小时剩余次数，因此 demo Key 通常够用。

也可以把 Key 存到思源的加密密钥库（**设置 → 密钥和变量**）中，名称为 `unsplash_access_key`，插件会优先
使用它。

## 合规说明

- 默认**直接引用 Unsplash API 返回的图片地址（hotlink）**，这是 [Unsplash API 规范](https://help.unsplash.com/en/collections/1451694-api-guidelines)
  的要求。转存到本地是显式可选项，因为规范期望图片的所有使用场景都使用 API 返回的地址。
- 缩放图片时是在返回的 URL 上合并 imgix 参数（`w`、`q`、`fm`、`fit`），并保留 `ixid` 参数，否则无法统计
  图片浏览量。
- 应用图片时会调用一次 `photo.links.download_location`；面板中展示摄影师姓名与带 UTM 参数的主页链接。
- 思源的题头图存在 `title-img` 块属性里，无法在其中渲染署名行。因此插件把归属信息写入文档的
  `custom-unsplash-*` 属性，并在选图时展示摄影师。

## 隐私

- 插件不会上传笔记内容。只有从文档标题提取的关键词（或你输入的关键词）会发送到 `api.unsplash.com`，且仅在
  你主动打开面板、点击随机或执行命令时发送。
- 除非你使用思源的密钥库，Access Key 会以明文保存在本工作空间的插件数据中（会随云端同步）。建议只使用低权限
  的 demo Key。

## 本地转存

开启「转存到本地 assets」后，图片会通过 `POST /api/asset/upload` 下载写入（绝不直接写文件），因此能像其他
资源一样同步。反复更换题头图会留下未被引用的文件，建议定期使用思源自带的未引用资源清理功能；同一张图片再次
被选中时会复用已下载的文件，不会重复下载。

## 命令

| 命令 | 说明 |
| --- | --- |
| `Unsplash：打开选图面板` | 为当前文档打开选图面板 |
| `Unsplash：随机更换题头图` | 不打开弹窗，直接应用一张随机图片 |

两个命令都可以在 **设置 → 快捷键** 中绑定。也可以在文档标题图标菜单和顶栏按钮中使用。

## 开发

```bash
pnpm install
pnpm run dev            # 监听构建到 dev/
pnpm run make-link      # 把 dev/ 软链接到 {workspace}/data/plugins（需思源正在运行）
pnpm run check          # tsc + svelte-check
pnpm run test           # vitest
pnpm run build          # 产出 dist/ 与 package.zip
```

`make-link` 也支持直接指定目录：`pnpm run make-link -- /path/to/workspace/data/plugins`，或设置
`SIYUAN_PLUGIN_DIR`。

## 许可

MIT
