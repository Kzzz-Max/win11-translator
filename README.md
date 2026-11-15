# Win11 翻译 · 常驻后台的截图 / 划词翻译工具

一个安静的 Windows 桌面小工具：常驻托盘，两个快捷键，把屏幕上看不懂的英文翻成中文。
外观按 Windows 11 Fluent Design

---

## 1. 快速开始

**方式 A：下免安装版（推荐，双击即用）**

到仓库的 **Releases** 下载 `Win11Translator-portable.zip`，解压到任意目录，双击 `Win11Translator.exe`。
里面是 Electron 运行时 + 应用代码，不需要 Node、不需要安装、不写注册表。
第一次启动会打开设置页；之后只在托盘里待着。

**方式 B：自己构建**

```bash
npm install        # Electron 约 270MB，首次较慢
npm start          # 构建渲染层并启动（带控制台窗口）
npm run pack       # 生成免安装版 → release/Win11Translator
```

不想看控制台窗口就用仓库根目录的 `启动翻译工具.vbs`（静默启动）。

### 用法：两下键盘

选中文字按 `Ctrl+Alt+W`，或者在任意界面按 `Ctrl+Alt+S` 拖一个框，剩下的交给它。
其余交互都长在那个结果窗上：顶部换语言、底部复制、Esc 收起。

### 设计取向

**它是一个"按一下就消失"的东西，不是一个要你打开的软件。**
没有主界面、没有输入框等你填，也不占任务栏。工具存在的意义是"这里有个词我不认识"，所以入口只有热键，
出口只有 Esc——用完即走，不制造第二个待办。

**原文在上、译文在下，不是左右对照。**
屏幕上的英文大多在窄栏里：聊天窗口、侧边栏、代码注释、PDF 半页。上下排布能让译文吃满窗口宽度，
长句不必横向折行；左右分栏在 600px 的浮窗里两边都挤，反而更难读。

**只要 90% 的场景够快，不为 10% 的场景变慢。**
截图翻译走离线 OCR + 免费通道，首字 200–300ms；大模型和系统 OCR 都是可选升级项，不是默认路径。
默认配置的目标是"按下去就有反应"，而不是"理论上最准"。

**每个窗口都尽快死掉。**
结果窗隐藏 90 秒后连渲染进程一起销毁，快捷菜单 8 秒没人管就自己收起来。托盘空转时只剩 3 个进程、
约 200MB——一个只用来"偶尔看一眼"的工具，不该在你不用它的时候占着一个浏览器内核。

**宁可少一点效果，也不让字发虚。**
玻璃容器压到很低的折射强度，窗口再自绘一层 88% 的底色。壁纸的透光还在，但白字永远落在足够深的底上——
可读性是底线，质感是加分项。

**失败要说人话。**
取词失败不会静默返回空：它会告诉你"没有检测到选中的文本"，并在日志里留下前台窗口标题和剪贴板序号，
方便你（或者我）判断是权限隔离、还是那个程序压根不支持复制。

---

## 2. 后台常驻机制

| 环节 | 实现 |
| --- | --- |
| 常驻入口 | `Tray`（托盘图标 + 右键菜单），windows 全部 `skipTaskbar`，不占任务栏 |
| 关窗不退出 | `app.on('window-all-closed')` 里什么都不做，进程继续活着；只有托盘菜单「退出」才 `app.quit()` |
| 单实例 | `app.requestSingleInstanceLock()`，第二次启动只会唤起已有窗口 |
| 开机自启 | `app.setLoginItemSettings()`，写 `HKCU\...\Run`；设置页和托盘菜单都能开关 |
| 空闲占用 | 不预热任何窗口、不预热 OCR 引擎；快捷菜单 8 秒无操作自动收起，窗口隐藏 90 秒后销毁渲染进程（实测回到 3 个进程） |
| 退出清理 | `will-quit` 里 `globalShortcut.unregisterAll()`，不留孤儿快捷键 |

托盘菜单：截图翻译 / 划词翻译 / 显示翻译窗口 / 设置 / 窗口置顶 / 开机自启 / 打开日志目录 / 退出。
单击托盘图标 = 打开结果窗，双击 = 打开设置。

---

## 3. 两种触发方式

### 3.1 截图翻译 · `Ctrl+Alt+S`

```
按下快捷键
  → 每个显示器铺一层全屏遮罩（可跨屏，Esc / 右键取消）
  → 拖拽框选，实时显示尺寸
  → 松开鼠标：立刻关遮罩，等 120ms 让桌面重绘
  → desktopCapturer 抓当前显示器 → 按 scaleFactor 换算比例裁剪选区
  → OCR → 结果窗：原文在上、译文在下，自动开始翻译
```

关键点：遮罩必须先关再截图，否则会把自己的暗色蒙层截进去；裁剪比例用「实际缩略图宽度 ÷ 显示器 CSS 宽度」算，
所以 125% / 150% 缩放不会偏。

### 3.2 划词翻译 · `Ctrl+Alt+W`

```
按下快捷键
  → 记住当前剪贴板（文本/图片）
  → 向**当前前台窗口**注入一次 Ctrl+C（keybd_event，不用 SendKeys，不受输入法影响）
  → 用 GetClipboardSequenceNumber 判断剪贴板是否真的被写过
  → 读回文本，立刻把剪贴板还原
  → 光标右下方弹出玻璃快捷菜单（预览 + 翻译 / 复制 / 取消）
  → 点「翻译」或回车 → 结果窗翻译
```

为什么用剪贴板序号而不是「清空剪贴板再看有没有东西」：
选中内容和剪贴板原有内容一样时也能正确判定，而且不用先把用户的剪贴板清空。
只有确认真复制到了东西，才会覆盖、才会还原。

### 3.3 快捷键冲突

默认值刻意避开系统占用：`Win+Shift+S`（系统截图）、`Alt+A`（微信）、`Ctrl+Alt+A`（QQ）都不用。

> **为什么不用 `Alt+Shift+字母`**：`Alt+Shift` 本身就是 Windows 的输入法语言切换组合。
> 按住它触发快捷键时，系统可能已经切了键盘布局；更要命的是，取词时要注入的 `Ctrl+C`
> 会和残留的 Alt/Shift 叠成 `Ctrl+Alt+Shift+C`——在 Edge/Chrome 里那是「检查元素」，
> 于是出现「文字明明选中了，却提示没检测到选中文本」。
> 现在注入前会先松开所有修饰键（`ReleaseModifiers`），并把按键间隔拉开、带真实扫描码、失败重试一次。

启动时会 `globalShortcut.register()` 并检查返回值：

- 注册失败 → 托盘气泡提示「`Ctrl+Alt+S` 已被其他程序占用」，不静默失败；
- 设置页「快捷键检测」→ 列出冲突项，并能一键换成当前机器上可用的组合键；
- 录入新组合键时先 `unregisterAll()`（`hotkeys:suspend`），录完再 `resume`，否则自己会和自己冲突。

所有快捷键都可在设置页改，格式为 Electron accelerator（如 `Ctrl+Alt+F9`）。

---

## 4. 界面

- **结果窗**：无边框、可拖动标题栏、可缩放，默认 600×500，位置/尺寸记忆到配置。
  结构：语言栏（源语言 ⇄ 目标语言）→ 原文卡片（可编辑的输入容器，Ctrl+Enter 重译）→ 译文卡片（流式、可滚动）→ 状态栏。
  支持：一键复制译文、交换语言（已完成的译文会提升为原文再翻回去）、Esc 隐藏、窗口置顶开关。
- **快捷菜单**：268×66 的玻璃胶囊，贴在光标右下，自动避让屏幕边缘，失焦自动消失。
- **框选遮罩**：暗色蒙层 + 选中区域挖空 + 四角标记 + 尺寸提示。
- **设置窗**：自动保存（改完 320ms 落盘），不用点「确定」。

### 流式输出与滚动

- 通道客户端只负责把 token / 句子片段的回调交给主进程，主进程通过 `result:delta` 推给渲染进程；
- 渲染进程只做字符串追加，`useEffect` 里判断「用户是否在底部」再决定要不要 `scrollTop = scrollHeight`，
  用户往上翻的时候不会被强行拽回底部；
- 流式期间在末尾显示一根 2px 的闪烁光标。

---

## 5. 视觉实现：液态玻璃 + Win11 Fluent

### 5.1 用在哪

只用在：双语对比卡片（原文/译文）、译文结果面板、原文输入容器、语言选择控件、悬浮提示框、快捷菜单。
窗口底板不铺玻璃效果。

### 5.2 怎么用

`src/renderer/shared/ui.jsx` 里的 `<Glass>` 包了两层：

```jsx
<div className="glass-wrap" style={{ backdropFilter: 'blur(var(--glass-blur)) saturate(...)' }}>
  <LiquidGlass radius={8} tint="rgba(255,255,255,0.012)" rim="var(--glass-rim)"
               scale={1.8~3.2} hoverScale={同上} blur={0} saturate={1}
               noiseType="fbm" frequency={2.6} octaves={3}
               specular={false} animate={false} wobble={false} />
</div>
```

对外层负责「一定有的那层亚克力模糊」，组件负责「折射 + 1px 描边」。

参数全部按 Win11 的方向压过：

| 参数 | 组件默认 | 本项目 | 原因 |
| --- | --- | --- | --- |
| `scale`（折射强度） | 20 | 1.8 ~ 3.2 | 20 会让背景明显扭曲，是苹果那种夸张液态玻璃 |
| `hoverScale` | scale×1.9 | = scale | 关掉 hover 形变，Win11 不做「果冻」 |
| `specular` | true | false | 去掉顶部那道强高光 |
| `animate` / `wobble` | true / false | false | 不做呼吸/流动 |
| `blur` | 0 | 0（由外层统一给 16px） | 避免内外两套模糊叠出雾感 |
| `radius` | 16（rounded） | 8（主）/ 4（内部控件） | Win11 圆角规范 |

### 5.3 实测结论（重要）

用 `tools/glass-check.js` 做了对照实验：同样的七彩条纹背景，左边只 `backdrop-filter: blur()`，
右边 `backdrop-filter: blur() + url(#feDisplacementMap)`。

结果：**Electron 33 / Chromium 里 `backdrop-filter` 中的 SVG filter 是生效的**，右侧条纹被真实扭曲。
也就是说这个组件的折射能力在本项目里确实在跑，不是「看起来像玻璃的模糊矩形」。

正因为它真的会扭曲背景，`scale` 才必须压到 2 左右：再大就会把卡片里的中文衬线糊掉，读起来发虚。

### 5.4 文字可读性的兜底

体积小、强度低的玻璃在浅色壁纸上会「白字发灰」。所以窗口底板不靠系统亚克力直接透：
`--bg-acrylic` 给窗口打一层 `rgba(30,30,30,0.88)` 的自绘底色，系统亚克力只透出 12%。
这样：

- 壁纸的柔和透光还在，符合 Win11「淡亚克力」；
- 源文本、译文、语言选择器、按钮文字始终在足够深的底色上，对比度不掉；
- 卡片在底板上再叠 `rgba(255,255,255,0.075)` + 1px 描边 + 顶部 1px 内高光，形成层次。

如果哪天要关掉折射（老显卡、远程桌面），把 `Glass` 里的 `scale` 改成 0 即可，
视觉自动退化为「亚克力 + 描边」，翻译逻辑、流式输出、滚动、复制完全不受影响。

---

## 6. OCR

### 6.1 引擎选择

| 引擎 | 说明 | 何时用 |
| --- | --- | --- |
| **tesseract**（默认） | 内置 WASM 引擎，语言包 `assets/tessdata/eng.traineddata` 随包分发，纯离线 | 默认、以及没装系统英文语言包时 |
| **windows** | `Windows.Media.Ocr`，70–300ms，最快 | 系统装了英文 OCR 语言包时（设置页「自动」会自动选它） |

「自动」的判断逻辑：枚举 `OcrEngine.AvailableRecognizerLanguages`，有 `en-*` 就用系统引擎，否则用内置引擎。

**为什么默认不用系统 OCR**：本机（Win11 24H2 家庭中文版）只装了 `zh-Hans-CN` 识别器，
用它认英文实测结果是这样的：

```
The quick brown foxjumps ove r the lazy dog.
Machine transl ation quality depends on terminol ogy
Press Shift+Enter tO insert a line break i n the paragraph
State-of-the-art models reduce ] atency by 40 ％
```

单词被拆开、字符被认错，直接喂给翻译就是灾难。内置引擎同一张图的结果是逐字正确的。所以默认走内置引擎，
并建议需要更快时可自行安装系统英文 OCR 包（设置页有引导文字，不装也能正常用）。

小图还会先放大 2× 再识别（`ocr.upscale`），截图选区常常只有几百像素宽，放大后识别率提升明显。

### 6.2 失败处理

| 情况 | 表现 |
| --- | --- |
| 框选太小（<8px） | 直接取消，不进入流程 |
| 截图抓不到屏幕 | 结果窗显示错误横幅「无法获取屏幕画面」+ 重试 |
| OCR 没识别到文字 | 结果窗横幅「OCR 未识别出文字，请重新框选更清晰的区域」+ 重试 |
| 系统 OCR 崩溃 | 自动回退到内置引擎，日志记一条 WARN，用户无感 |

结果窗的「原文」区域可以编辑，识别错了直接改，`Ctrl+Enter` 重译。

---

## 7. 翻译

### 7.1 通道链

```
首选通道失败 → 自动降级 → 再失败 → 给明确错误 + 重试按钮
```

| 通道 | 需要 Key | 实测延迟 | 特点 |
| --- | --- | --- | --- |
| **腾讯交互翻译**（默认） | 否 | 首字 200–310ms | 免费稳定，中文语感好 |
| **大模型**（OpenAI 兼容） | 是 | 取决于供应商 | 真 token 流式，长句/术语最准 |
| **MyMemory** | 否 | 1–4s | 兜底，单次 500 字符 |

链路规则：选了 `llm` 但没填 Key → 自动跳过；`tencent` 失败 → `mymemory`；都失败 → 报错横幅。
如果前半段已经流出来又失败了，会先发 `result:reset` 清屏再换通道，不会出现两段译文拼接。

### 7.2 流式怎么实现的

- **大模型**：`stream: true` 的标准 SSE，逐 token 回调；
- **腾讯 / MyMemory**：按句切分（保留段落边界），**分片并发请求（并发 3）**，谁先回谁先出，
  但严格按原文顺序 flush，所以是「一段段冒出来」而不是整段等完。
  300 字符以内基本是一次请求，句子多的时候首字后的增量会持续涌出。

句子/分片规则在 `src/main/translate.js` 的 `makeChunks()`：按 `。！？；.!?;` 切句，
超过 320 字符的长句按空格再切，段落之间保留换行。

缓存：`from|to|text` 三元组，LRU 300 条，重复划同一个词是 0ms。

### 7.3 失败处理

| 情况 | 用户看到 |
| --- | --- |
| 网络不可用 / 接口 5xx | 自动重试 2 次 → 换通道 → 都失败则红色横幅「翻译失败：xxx」+ 重试 |
| 接口返回结构异常 | 同上，日志里记录原始错误 |
| 大模型 Key 无效 | `HTTP 401` 文案原样透出，并降级到腾讯通道 |
| 取词没取到 | 光标旁弹「没有检测到选中的文本（目标窗口可能不支持复制，或被管理员权限隔离）」 |
| 选中内容过长（>8000 字符） | 「选中的内容太长，请只选需要翻译的部分」 |
| 译文与原文一字不差 | 译文框下方标注「该内容为专有名词」。这不是失败；换大模型通道通常会给出意译 |

---

## 8. 配置文件

`%APPDATA%\win11-translator\config.json`（设置页改完自动写盘）：

```jsonc
{
  "hotkeys": { "region": "Ctrl+Alt+S", "selection": "Ctrl+Alt+W" },
  "provider": "tencent",              // tencent | llm | mymemory
  "llm": { "baseUrl": "https://api.deepseek.com/v1", "apiKey": "", "model": "deepseek-chat", "temperature": 0.2 },
  "sourceLang": "auto",
  "targetLang": "zh",
  "ocr": { "engine": "auto", "upscale": 2 },   // auto | tesseract | windows
  "restoreClipboard": true,
  "alwaysOnTop": true,
  "autoStart": false,
  "theme": "system"                   // system | dark | light
}
```

日志：`%APPDATA%\win11-translator\logs\app.log`（超过 512KB 自动轮转，托盘菜单可直接打开目录）。

---

## 9. 目录结构

```
win11-translator/
├─ src/
│  ├─ main/                主进程
│  │  ├─ main.js           入口：托盘、快捷键、IPC、业务流程编排
│  │  ├─ windows.js        四类窗口的创建与定位（亚克力底材判定）
│  │  ├─ hotkeys.js        注册 / 冲突检测 / 冲突后建议可用组合
│  │  ├─ selection.js      划词取词（keybd_event + 剪贴板序号判定 + 还原）
│  │  ├─ ocr.js            引擎选择、tesseract worker、系统 OCR 回退、预热
│  │  ├─ translate.js      通道链、切句并发流式、SSE、缓存
│  │  ├─ config.js         配置读写（深合并 + 原子写）
│  │  ├─ logger.js         滚动日志
│  │  └─ ps.js             PowerShell 子进程封装（-ExecutionPolicy Bypass）
│  ├─ ps/                  PowerShell 脚本（UTF-8 BOM，否则 PS5.1 会按 GBK 读坏）
│  │  ├─ copy-selection.ps1
│  │  └─ ocr-windows.ps1
│  ├─ renderer/
│  │  ├─ shared/           theme.css（Win11 tokens）+ ui.jsx（Glass / LangSelect / Tip）
│  │  ├─ result/  popup/  overlay/  settings/
│  └─ preload.js           contextBridge 白名单
├─ assets/                 图标 + tessdata/eng.traineddata（离线识别数据）
├─ tools/
│  └─ pack.js              免安装打包（npm run pack）
├─ build.mjs               esbuild 构建（React + JSX 自动运行时 + CSS 内联）
├─ 启动翻译工具.vbs         静默启动，不弹控制台
└─ release/Win11Translator 免安装产物（npm run pack 生成，不入库）
```

---

## 10. 资源占用与实测数据（本机 Win11 24H2 / i7 / 150% 缩放）

**空闲态（只留托盘，窗口全部关闭 90 秒后）**

| 指标 | 数值 |
| --- | --- |
| 进程数 | 3（main / GPU / utility） |
| 合计内存（工作集） | ≈ 205 MB |
| CPU | 0（无轮询、无定时器空转） |

**使用中**

| 场景 | 结果 |
| --- | --- |
| 划词取词（含 PowerShell 启动） | 750–920ms |
| 截图 → 裁切 → OCR（180×700 选区） | 245–670ms，置信度 72–95 |
| tesseract 引擎冷启动 | 228ms，在用户拖框的 1 秒里并行完成，不额外等待 |
| 翻译首字 | 200–310ms |
| 整段翻译完成 | 250–520ms（2–3 句） |
| 同文本二次翻译 | 0ms（缓存） |
| 打开结果窗后 | 5 个进程，约 500 MB（Electron 每个渲染进程 ~100MB，这是框架地板价） |
| 免安装包体积 | 320.8 MB |

> 前几轮开发时看到「占用突然变大」，是因为同时跑了两份实例（源码版 + 打包版）在抢快捷键，
> 还叠加了出图/自检工具进程和 6 个测试用浏览器标签。正常使用只有上面这一组数字。

---

## 11. 已知限制

1. **划词取词依赖注入 Ctrl+C。** 全屏独占程序、以管理员身份运行而本程序未提权的窗口，会因为 Windows UIPI 收不到按键。
   这种情况会明确提示「没有检测到选中的文本」，不会静默失败；需要时请用截图翻译。
2. **剪贴板还原只还原文本或位图。** 如果复制前剪贴板里是复杂格式（HTML、文件列表），还原后只剩纯文本/图片。
   可以在设置里关掉「复制后还原剪贴板」。
3. **OCR 只带英文语言数据。** 要识别中文/日文需要往 `assets/tessdata` 放对应的 `traineddata` 并调整语言参数。
4. **未做代码签名。** 免安装包第一次运行可能被 SmartScreen 提示「未知发布者」，选「更多信息 → 仍要运行」。
5. **窗口亚克力依赖 Win11 22H2+。** 低于该版本会自动降级为不透明深色底（`surface-solid`），功能不受影响。

---

## 12. 开发命令

```bash
npm install            # 装依赖（Electron 约 270MB，首次较慢）
npm start              # 构建渲染层 + 启动
npm run pack           # 打包免安装版 → release/Win11Translator
node build.mjs         # 只构建渲染层
node build.mjs --watch # 渲染层 watch
```

> 注意：如果 shell 里存在 `ELECTRON_RUN_AS_NODE=1`（某些 IDE 会注入），Electron 会退化成 Node 而启动不了应用，
> 用 `env -u ELECTRON_RUN_AS_NODE npx electron .` 规避。
