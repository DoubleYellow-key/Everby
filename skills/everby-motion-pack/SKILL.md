---
name: everby-motion-pack
description: 为 Everby 桌宠角色构建 .soulmotion 动作扩展包(设计动作语义、整理 192×208 透明帧、生成 motion.json、构建并校验打包)。当用户想给已有角色添加新动作、制作或修复动作扩展包时使用。不用于创建整个角色(用 everby-pet-from-image)或安装角色包(用 everby-pet-install)。
---

# 构建 Everby 动作扩展包

目标产物:一个可直接导入的 `.soulmotion` 文件(ZIP 归档,根目录 `motion.json` + 帧资源)。先读格式规范 [docs/soulmotion-format.md](../../docs/soulmotion-format.md),完整示例参考 `examples/motions/daily-routines/`,再按下面流程做。

## 1. 设计动作

- 每个动作必须声明语义意图 `intents`,从固定词表选:`idle`(待机)、`greet`(打招呼)、`happy`(开心)、`encourage`(鼓励)、`think`(思考)、`work`(工作)、`wait`(等待)、`celebrate`(庆祝)、`tired`(疲惫)、`confused`(困惑)。意图决定 ActionDirector 在什么对话/事件语境下选中该动作,至少填一个。
- 动作 ID 规则:以字母或数字开头,只能含字母、数字、`_`、`-`,最长 80 字符;**不能覆盖 10 个基础动作**:`idle`、`run-right`、`run-left`、`wave`、`jump`、`failed`、`stretch`、`working`、`review`、`drag`。
- `loop: true` 用于状态长动作(专注工作、休息);`false` 用于一次性反馈(欢呼、伸展)。`weight` 默认 1,越大越容易被选为常态背景动作。
- 帧时长 20–60000ms。节奏参考:待机/工作循环 220–360ms,欢快动作 150–260ms,关键姿势可短暂停留(如 650ms)。
- 一个包 ≤ 64 个动作,每个动作 ≤ 1000 帧;同一帧文件可被多个动作或同一动作重复引用,归档只保存一份。

## 2. 准备帧

- 每帧是 **192×208、带透明通道** 的 PNG 或 WebP,角色脚底中心对齐画布锚点 (96, 208)。
- 从零绘制:用 imagegen skill 逐帧生成(附上角色参考图,要求同一角色、统一画风、纯色幕底全身像、脚底对齐画面底边),再用仓库脚本清洗溢色:`pnpm tsx scripts/clean-chroma-fringe.ts <输入目录> <输出目录>`(在仓库根目录执行)。与 everby-pet-from-image 的逐行生成是同一套方法,只是这里按动作分目录组织。
- 也可以从角色 8×9 图集里取相近帧做起点改姿势(用 sharp 裁出 192×208 单元格再改绘)。
- 目录组织:`<工作目录>/<动作id>/000.png、001.png……`,帧按文件名顺序播放,建议三位数零填充;motion.json 将生成在该工作目录里。

## 3. 生成 motion.json

```bash
node skills/everby-motion-pack/scripts/scaffold-motion.mjs <工作目录> --pack-id <包id> --pet <目标角色id> --name <显示名>
```

脚本把每个含图片的子目录变成一个动作草稿(占位 `intents: ["idle"]`)。**之后必须逐个动作把 `intents`、`loop`、`label` 和帧时长改成第 1 步的设计值**——脚手架只保证路径和结构正确,不理解语义。

## 4. 构建与校验(在仓库根目录)

```bash
pnpm motion:build -- <工作目录>/motion.json <输出.soulmotion>
pnpm motion:validate -- <输出.soulmotion>
```

`motion:validate` 会真实走一遍安装管线:清单 schema、资源路径安全、动作 ID 与基础动作冲突、每帧 192×208 且带透明通道,全部通过才算完成。

## 5. 交付

让用户在管理窗口「动作 → 扩展包 → 导入 .soulmotion」安装;装好后在「动作库」里逐个预览,再把动作加入状态模式权重池或建立点击/对话/提醒事件规则。同 `packId` 的新版本导入会替换旧版本;停用或卸载扩展不会修改角色的基础资源。

## 边界

- 构建通过 ≠ 动作好看:提醒用户导入后在桌面上预览确认效果。
- 不要修改 `src/core/codex-atlas.ts` 或角色的基础图集来迁就素材——扩展包永远是追加。
- 帧素材涉及第三方 IP 时,提醒用户确认使用边界。
