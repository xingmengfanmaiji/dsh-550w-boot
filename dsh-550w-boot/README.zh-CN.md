# dsh-550w-boot — DeepSeek Harness 启动动画插件

把一份独立的 HTML 动画变成 DSH 的启动动画：程序打开时先全屏播放它，播完淡出，然后才是主界面。播放期间**点击任意处或按任意键即可跳过**。

本插件包里的动画默认就是工作区那份 `550W_ui.html`（《流浪地球》550W 自编译系统界面）。

---

## 一、安装

```powershell
cd D:\DSHProject\DSH-550W\dsh-550w-boot
node install.mjs
```

脚本做三件事，并把每一步都打印出来：

1. 把插件包复制到 `%DSH_HOME%\profiles\node_modules\dsh-550w-boot`（该目录在 profile 的 Node 解析路径上，且不受 profile 内 pnpm 安装的清理影响）；
2. 把 `"dsh-550w-boot"` 加进 `%DSH_HOME%\profiles\desktop\package.json` 的 `dsh.profile.bundles`（**只有这个列表决定哪些插件被加载**），改动前会备份成 `package.json.dsh-550w-boot.bak`；
3. 打印重启步骤和还原命令。

然后**完全退出 DeepSeek Harness**（不是关窗口，要退出进程）再启动，就能看到启动动画。

不想真改可以先看会写什么：`node install.mjs --dry-run`。

## 二、卸载

```powershell
node uninstall.mjs
```

删除已安装的副本，并从 `dsh.profile.bundles` 里移除本插件（改前同样会备份）。重启后启动动画消失。

## 三、换成别的 HTML 动画

任何**能单独在浏览器里打开的** HTML 文件都能当启动动画，不需要改它的代码：

```powershell
node build.mjs ..\某个动画.html      # 嵌入指定的 HTML
node build.mjs                        # 不传参数则用 animation\550W_ui.html
node verify.mjs                       # 校验嵌入结果与源文件逐字节一致
```

`build.mjs` 会把 HTML 原样嵌进 `lib/client.js`，并把它复制一份到 `animation\` 作为存档。换完动画重新跑一次 `node install.mjs`（或手动覆盖已安装副本里的 `lib/client.js`），重启生效。

动画在**独立 iframe** 里运行，所以它自己的 `<style>`、`<script>`、`setTimeout` 时间线都按原样工作，既不会被 DSH 的样式污染，也不会污染 DSH。

## 四、调参

参数都在 `build.mjs` 顶部的 `OPTIONS` 里，改完重新 `node build.mjs` + 重新安装：

| 参数 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 关掉后插件仍在、但不出动画 |
| `durationMs` | `6600` | 动画占据屏幕多久；自带 550W 动画约在 4.5 秒到横幅 |
| `fadeMs` | `700` | 淡出时长（主界面在淡出开始时就已经可见，所以是交叉淡化） |
| `hintDelayMs` | `1400` | 跳过提示出现的时间 |
| `hint` | `550W 正在接入 · 点击任意处跳过` | 提示文字 |
| `skipOnAnyKey` | `true` | 任意键跳过（单独按 Shift/Ctrl/Alt/Win 不算） |
| `timerSlackMs` | `400` | 定时器兜底相对帧调度的余量，见下文 |

## 五、它是怎么工作的

- **为什么没有闪烁。** shell 的启动顺序是 `runPluginBoot()` → `mountApp()`：插件在 React 挂载 `#root` **之前**就被激活了。所以遮罩层早在主界面第一次绘制之前就在页面里了，`dsh.client.immediately: true` 又让 shell 提前预取本插件的 bundle。插件同时给 `#root` 加一条 `visibility:hidden` 的临时样式，遮住 DSH 自己的 "Loading plugins…" 启动页；用 `visibility` 而不是 `display:none`，是为了让主题取色和布局测量拿到的数字和没有本插件时完全一样。
- **为什么用 iframe。** 动画是完整文档，会写 `:root` 变量和 `html,body{overflow:hidden}`；直接内联会改坏 DSH 自己的滚动和配色。iframe 一次性解决双向样式隔离，也不用改写动画源码。
- **为什么遮罩挂在 `document.body` 而不是 `shell.overlay` 插槽。** `shell.overlay` 在 AppFrame 内部（z-index 20），低于 DSH 自己挂在 body 上的对话框/提示（1000/1100）。启动动画要压过一切，所以直接挂 body 并用大 z-index。
- **为什么每个截止时间都排两遍。** `requestAnimationFrame` 在窗口被遮挡/隐藏时会完全停摆，只靠它就意味着"动画没播完 → 主界面一直藏着"。所以帧链和定时器同时武装、先到先算：帧正常时由帧链给出准确的收尾，帧停摆时定时器仍会把主界面放出来。

## 六、排错

- 浏览器控制台（渲染进程 DevTools）里会有一行 `[boot550w] v1.0.0 overlay mounted from ...`，确认插件真的生效；同处还有动画结束后的一行。
- 控制台可用 `__dsh550w.skip()` 立即结束、`__dsh550w.play()` 重播一次、`__dsh550w.reveal()` 只把主界面放出来。
- 启动时若看到 `dsh: skipping profile bundle "dsh-550w-boot": ...`，说明包名解析或 `dsh.bundle.patch` 有问题——插件被跳过而不是让程序启动失败。
- 动画不出现时先确认：`lib/client.js` 存在（`node build.mjs`）、`dsh.profile.bundles` 里确实有 `dsh-550w-boot`、并且是**完全退出后重启**。

## 七、这份代码验证到什么程度

- `verify.mjs`：嵌入的 HTML 与 `animation\` 里的源文件逐字节一致、模板占位符已全部替换、模板读到的每个 `OPTIONS` 键都由构建产出、宿主半可加载、patch 行指向宿主半而不是浏览器半。
- `test\harness-a.html`：真实浏览器、真实时钟跑完整生命周期——遮罩挂载、`#root` 被遮、**iframe 里动画自己的脚本确实运行**（日志行数增长、到达横幅与最终字幕、canvas 完成绘制）、淡出后遮罩被移除、主界面恢复。
- `test\harness-b.html`：用可控时钟确定性地跑 23 项断言——挂载、重复激活不叠层、提示延时、截止时间、淡出移除、插件卸载后不留残留（尤其是遮罩样式）、点击/按键跳过、单独按修饰键不跳过、不残留 rAF 回调。

两个 harness 都可以自己重跑：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --user-data-dir="$env:TEMP\edge-dsh550w" --dump-dom `
  "file:///D:/DSHProject/DSH-550W/dsh-550w-boot/test/harness-b.html"
```

（harness-a 需要加 `--virtual-time-budget=15000`。）

**没有验证到的部分**：插件在真实 DSH 进程里的表现，只能由你重启一次来确认——这也是它需要重启才能生效的原因。若启动后行为不对，把控制台里那两行 `[boot550w]` 日志发给我。

## 八、文件说明

```
dsh-550w-boot/
├─ package.json            dsh.bundle.patch 指向宿主半；dsh.client 声明浏览器半与 immediately
├─ cordis.patch.yml        insert 行：id boot550w → 包名（必须指向宿主半，不能是 /client）
├─ lib/index.js            宿主半：只做可导入 + 打印版本与构建时间，方便判断"跑的是不是盘上的代码"
├─ lib/client.js           浏览器半（构建产物，别手改）
├─ lib/client.template.js  浏览器半源码：遮罩、跳过、双路径调度、清理
├─ build.mjs               把 animation 里的 HTML 嵌进 client.js；OPTIONS 在这里
├─ verify.mjs              构建产物自检
├─ install.mjs             装进 profile
├─ uninstall.mjs           从 profile 卸掉
├─ animation/550W_ui.html  被嵌入的动画源（存档）
└─ test/harness-{a,b}.html 真实浏览器测试页
```

本插件是本地安装的非官方插件，不来自任何注册表；因此 install.mjs 不会写 `dependencies`——那样会让 GUI 里的插件安装在 pnpm 抓取这个不存在的包名时失败。`dsh.profile.bundles` 已经足够让程序加载它。
