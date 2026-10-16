# 外部歌词

LinkLine 提供桌面歌词、灵动岛歌词、任务栏歌词三个独立窗口，可以同时开启。点击播放栏的歌词按钮选择窗口，也可进入「设置与偏好 → 外部歌词」配置。

功能和选项参考 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next)，审阅版本为 [`0223b4e67218a252903c2bebb18ded273d05a463`](https://github.com/SPlayer-Dev/SPlayer-Next/tree/0223b4e67218a252903c2bebb18ded273d05a463)。主要参考设置项、默认值和窗口交互表现；LinkLine 使用已有 Electron 窗口、消息通道和 LX 歌词格式独立实现，不引入 SPlayer-Next 的歌词渲染库、原生模块或应用运行时。原项目及其代码保留原项目的版权和许可。

## 配置对应关系

三个窗口的开关分别对应上游 `isDesktopLyricOpen`、`isDynamicIslandOpen`、`isTaskbarLyricOpen`。其余字段保留上游字段名：

| 上游配置前缀 | LinkLine 配置前缀 |
| --- | --- |
| `system.desktopLyric` | `externalLyric.desktop` |
| `system.dynamicIsland` | `externalLyric.island` |
| `system.taskbarLyric` | `externalLyric.taskbar` |

以下共 52 个选项，其中 3 个字体选项在上游字体设置中维护。窗口位置与桌面窗口尺寸另外保存，不占设置项数量。默认值以审阅版本 `shared/defaults/settings.ts` 为准；上游桌面歌词颜色的实际默认值与设置页面的重置声明不同，此处采用实际默认值。

### 桌面歌词：20 个选项

| 字段 | 默认值 | 实际行为 |
| --- | --- | --- |
| `enabled` | `false` | 打开或关闭独立桌面歌词窗口。 |
| `fontSize` | `24` | 调整歌词字号，并匹配窗口内容高度。 |
| `fontWeight` | `600` | 设置歌词字重，范围 100–900。 |
| `fontFamily` | 空 | 设置字体；空值使用系统默认字体。 |
| `doubleLine` | `true` | 无翻译副行时显示下一句。 |
| `align` | `center` | 左、中央、右对齐，或按行号交错左右对齐。 |
| `wordByWord` | `true` | 按逐字时间推进文字颜色。 |
| `autoGenerateWordByWord` | `true` | 普通逐行歌词按行时长分配字词时间；关闭后只对有逐字时间的歌词启用逐字高亮。 |
| `showTranslation` | `true` | 有翻译时显示翻译副行；优先于下一句，独立于双行开关。 |
| `playedColor` | `rgb(254, 121, 113)` | 已播放文字颜色。 |
| `unplayedColor` | `rgb(255, 255, 255)` | 未播放文字和副行颜色。 |
| `strokeColor` | `rgba(0, 0, 0, 0.5)` | 文字周围的轮廓阴影颜色。 |
| `backgroundMask` | `false` | 给文字添加独立的半透明背景。 |
| `backgroundMaskColor` | `rgba(0, 0, 0, 0.3)` | 设置文字背景颜色，支持透明度。 |
| `alwaysShowSongInfo` | `false` | 鼠标移出后仍显示歌曲名和歌手。 |
| `animation` | `true` | 开启歌词行切换时的位移和淡入淡出动画。 |
| `limitBounds` | `false` | 拖动和调整尺寸时限制在屏幕可见范围。 |
| `alwaysOnTop` | `true` | 设置窗口置顶。 |
| `locked` | `false` | 禁止拖动和调整尺寸，并让鼠标穿透；解锁按钮保留交互。 |
| `useCSSDrag` | `false` | 改用系统原生拖动区域。 |

### 灵动岛歌词：16 个选项

| 字段 | 默认值 | 实际行为 |
| --- | --- | --- |
| `enabled` | `false` | 打开或关闭独立灵动岛窗口。 |
| `scale` | `1` | 按 0.5–2 倍缩放字号、封面、间距和窗口内容。 |
| `fontWeight` | `500` | 设置歌词字重，范围 100–900。 |
| `fontFamily` | 空 | 设置字体并重新测量内容宽度。 |
| `wordByWord` | `true` | 按逐字时间推进颜色；普通逐行歌词按时长分配字词时间。 |
| `transition` | `bounce` | 弹性模式先收缩再展开；平滑模式滚动切换歌词。 |
| `doubleLine` | `false` | 无翻译副行时显示下一句。 |
| `showTranslation` | `false` | 优先显示当前句翻译副行。 |
| `playedColor` | `rgba(255, 255, 255, 1)` | 已播放文字颜色。 |
| `unplayedColor` | `rgba(255, 255, 255, 0.5)` | 未播放文字和副行颜色。 |
| `backgroundColor` | `rgba(0, 0, 0, 1)` | 胶囊背景颜色，支持透明度。 |
| `alwaysOnTop` | `true` | 设置窗口置顶。 |
| `notchFusion` | `false` | 仅 macOS：贴合屏幕顶部并预留刘海区域。 |
| `snapCentered` | `true` | 顶部吸附时水平居中。 |
| `nonOcclusive` | `false` | 鼠标穿透，悬停时隐藏窗口内容；可从设置页关闭。 |
| `useCSSDrag` | `false` | 改用系统原生拖动区域。 |

### 任务栏歌词：16 个选项

| 字段 | 默认值 | 实际行为 |
| --- | --- | --- |
| `enabled` | `false` | 在 Windows 任务栏中打开或关闭歌词。 |
| `position` | `auto` | 自动选择空闲侧，或优先选择左侧、右侧。 |
| `autoMaxWidth` | `true` | 根据任务栏按钮、组件和托盘计算可用宽度。 |
| `autoAdjustOccupiedSpace` | `false` | 在可用范围内按歌词与悬浮控件宽度收缩实际占用区域。 |
| `maxWidth` | `400` | 关闭自动宽度后限制最大宽度，范围 200–800 像素。 |
| `leftMargin` | `0` | 从可用空间左侧留出指定像素。 |
| `rightMargin` | `0` | 从可用空间右侧留出指定像素。 |
| `colorMode` | `taskbar` | 跟随任务栏主题、反向跟随，或固定浅色、深色主题。浅色主题使用深色文字。 |
| `showBackground` | `false` | 鼠标悬停时显示与主题配合的半透明背景。 |
| `fontSize` | `14` | 调整字号，范围 12–20 像素。 |
| `fontWeight` | `400` | 设置歌词字重，范围 100–900。 |
| `fontFamily` | 空 | 设置歌词字体。 |
| `showCover` | `true` | 显示当前歌曲封面，加载失败时显示音乐图标。 |
| `wordByWord` | `true` | 按逐字时间推进颜色；普通逐行歌词按时长分配字词时间。 |
| `doubleLine` | `true` | 显示第二行歌词；关闭时同时使用单行歌曲信息。 |
| `showTranslation` | `true` | 双行模式下优先显示翻译，否则显示下一句。 |

## 保存、恢复与兼容

设置修改通过主进程同步到已打开的窗口。三个窗口共享当前歌曲、歌词、播放位置、播放速度和手动歌词偏移，各自保持显示偏好。双击灵动岛或任务栏歌词返回主窗口，右键进入外部歌词设置。

「恢复默认设置」只重置当前模式的显示和交互偏好，保留开启状态及窗口位置。「找回窗口」开启对应窗口、解除妨碍操作的状态并恢复可见位置。桌面窗口额外恢复宽 800、高 200 像素。

旧 `desktopLyric.enable` 与新的桌面歌词开关保持兼容，因此原有桌面歌词快捷键和托盘开关继续有效。新备份保留全部外部歌词设置、桌面窗口尺寸、桌面及灵动岛窗口坐标。导入旧备份时，启用、锁定、置顶、边界限制、字体、字号、对齐、文字颜色及窗口位置尺寸会映射到对应的新字段；新字段已有值时优先采用新字段。旧歌词阴影色映射为新的文字轮廓色。

## 平台说明

桌面歌词和灵动岛沿用 Electron 透明窗口。原生拖动会受操作系统拖动循环影响，拖动时动画可能暂时停止。灵动岛刘海融合仅在 macOS 显示设置项。

任务栏歌词仅在 Windows 可用，通过系统自带 PowerShell、.NET 和 Win32 接口将歌词窗口放入任务栏。宿主依据任务栏与托盘布局重新计算可用空间；竖向任务栏或空间不足时隐藏歌词。任务栏恢复或退出应用时，宿主恢复被调整的传统任务栏区域。此实现不使用 SPlayer-Next 的原生二进制扩展。
