# Everby / Petdex 角色格式

Everby 的桌宠角色与 Petdex 生态共享同一目录格式。本文档是应用导入校验（`electron/services/pet-installer.ts`）与仓库内角色处理 skills 的共同依据。

## 目录结构

一个角色就是一个文件夹，文件夹名即角色 id：

```
<角色id>/
├── pet.json            # 必需,角色元数据
├── spritesheet.webp    # 必需,动画图集;或 spritesheet.png
├── tray.png            # 可选,托盘图标
└── motions/drag/*.png  # 可选,拖拽逐帧(当前仅内置 Daily 生效)
```

角色 id（文件夹名）约束：以字母或数字开头，只能包含字母、数字、`_`、`-`，最长 80 字符（`SAFE_ID`）。

## pet.json

必须是合法 JSON，不超过 128 KB。Everby 实际读取的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `displayName` | string | 界面显示名，缺省用 id |
| `description` | string | 角色描述，最长 500 字符，注入 agent 人设上下文 |

`id`、`spritesheetPath`、`kind`、`origin`、`vibes`、`tags`、`motions` 等字段属于 Petdex 生态元数据，Everby 不解析，可以保留。

## 动画图集

- 尺寸 **1536 × 1872**,即 8 列 × 9 行网格，每格 **192 × 208**，透明背景。
- 格式：`spritesheet.webp`（无损优先）或 `spritesheet.png`。
- 导入校验要求宽是 192 的倍数且 ≥ 8 列、高是 208 的倍数且 ≥ 9 行；但动画按绝对像素坐标切片（`x = 列×192, y = 行×208`)，超出标准网格的部分永远不会被用到，务必严格按 8×9 绘制。
- 画布锚点：角色脚部中心在单元格的 (96, 208)。

每行的动作语义（切片坐标硬编码于 `src/core/codex-atlas.ts`):

| 行 | 动作 | 帧数 | 说明 |
| --- | --- | --- | --- |
| 0 | 待机 idle | 6 | 循环;"点头确认"复用此行 |
| 1 | 向右走 run-right | 8 | 循环,播放时宠物向右移动 |
| 2 | 向左走 run-left | 8 | 循环,播放时宠物向左移动 |
| 3 | 挥手 wave | 4 | "双手回应"复用此行 |
| 4 | 开心跳跃 jump | 5 | "互动回应"部分复用 0/3/4 行 |
| 5 | 失落 failed | 8 | "不耐烦"复用此行 |
| 6 | 伸展 stretch | 6 | |
| 7 | 专注工作 working | 6 | 循环 |
| 8 | 思考检查 review | 6 | 循环;"深度检查"复用此行 |

## 安全约束

- 扫描与导入都拒绝符号链接；`pet.json` 超过 128 KB 直接忽略。
- `.zip` 导入经过加固解压（`electron/services/zip-extract.ts`)：拒绝绝对路径、`..` 穿越、符号链接与可执行文件扩展名，条目数 ≤ 2000，解压总量 ≤ 100 MB。
- 同名角色已存在时导入会被拒绝，不会覆盖。

## 导入途径

1. 管理窗口"角色"页的"导入角色"按钮（文件夹或 `.zip`，导入后自动切换，无需重启）。
2. 手动复制角色目录到 `~/.petdex/pets/`（可用 `EVERBY_PETDEX_ROOT` 改路径），重启生效。
3. 仓库自带的 agent skills:[`skills/everby-pet-install`](../skills/everby-pet-install/SKILL.md)（适配安装下载的角色包）与 [`skills/everby-pet-from-image`](../skills/everby-pet-from-image/SKILL.md)（从参考图生成新角色）。把它们复制或链接到 `~/.zcode/skills/`（用户级）或仓库 `.zcode/skills/`（工作区级）即可被 ZCode 发现。
