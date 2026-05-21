# 漫画自动分格工具

`comic_panel_splitter.py` 会按漫画页的 gutter / 背景色自动找面板矩形，输出每格裁切图和 `manifest.json`。

常用命令：

```bash
python3 tools/comic_panel_splitter.py page.png \
  --output-dir panel_output \
  --background auto \
  --debug-overlay panel_output/debug.png
```

如果想用浏览器界面，直接打开：

```text
tools/comic_panel_splitter.html
```

HTML 入口是纯本地文件：上传图片后会在浏览器里显示红色检测框、裁切预览，并提供每格图片、`manifest.json` 和 `panels.zip` 打包下载。

HTML 工具必须和 Python CLI 保持同一套默认裁切规则。每次改 `comic_panel_splitter.py` 的资料卡过滤、文本条过滤、面积阈值或默认参数后，都要用一张代表性控制页在 `comic_panel_splitter.html` 里复测数量；否则会出现命令行裁切和浏览器界面结果不一致。

- `--background dark`：适合黑色 gutter、浅色边框的黑白漫画页，类似雨夜战斗页。
- `--background light`：适合白色 gutter 的普通漫画页。
- `--background auto`：从图片边缘自动判断背景，默认值。
- 默认规则采用本项目这批深色历史漫画页的调参：`--background auto --separator-ratio 0.9 --background-tolerance 8 --min-panel-area 5000 --padding 0`，并开启左侧资料卡过滤和二阶段文本条过滤。
- `--separator-ratio`：某一行/列有多少比例像背景时才当作分隔线；复杂页面可在 `0.70` 到 `0.90` 之间调。
- `--min-panel-area`：过滤太小的碎片或文字块。
- 左侧资料卡过滤会在宽幅“资料卡 + 右侧漫画区”控制页上默认丢弃左侧资料卡；如需保留，可加 `--keep-profile-card`。
- 二阶段文本条过滤会在完成 gutter 定位后，过滤超矮横向字幕条、极窄竖向文字条和面积过小的装饰碎片；如需保留所有候选框，可加 `--keep-text-strips`。
- `--debug-overlay`：输出检测框，方便判断参数是否需要调整。
- `--debug-candidates-overlay`：输出过滤前候选框，便于对比过滤前后是否误删。

输出：

```text
panel_output/
  manifest.json
  panel_001.png
  panel_002.png
  ...
  debug.png
```
