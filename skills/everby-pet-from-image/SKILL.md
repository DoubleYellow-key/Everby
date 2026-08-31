---
name: everby-pet-from-image
description: 从角色参考图生成 Everby/Petdex 桌宠(pet.json + 1536×1872 图集),或把任意布局的现有精灵图/帧序列重切成 Everby 的 8×9 网格。当用户想从图片创建新桌宠角色时使用。不用于安装现成的 Petdex 角色包(用 everby-pet-install)。
---

# 从图片生成 Everby 桌宠

目标产物:一个符合仓库文档 [docs/pet-format.md](../../docs/pet-format.md) 的角色目录(`pet.json` + 1536×1872 `spritesheet.webp`,8 列 × 9 行,每格 192×208)。先读格式文档,再按下面选路径。

## 先选路径

- **用户已有精灵图或帧序列**(只是布局/尺寸不符)→ 直接把帧按行整理成 `row<行号>/` 目录,进"组装与校验"。
- **只有角色设定图**(一张或几张立绘)→ 用 imagegen skill 逐行生成动画帧,再组装。

## 逐行生成(imagegen)

每行的动作语义和所需帧数以 docs/pet-format.md 的表格为准(0 待机 6 帧、1/2 行走各 8 帧、3 挥手 4 帧、4 跳跃 5 帧、5 失落 8 帧、6 伸展 6 帧、7 工作 6 帧、8 检查 6 帧)。

- 每次只生成一行:附上用户的角色参考图,要求同一角色、统一画风、纯色幕底(亮绿 `#00ff00` 或品红)全身像,脚底对齐画面底边;生成该行动作的帧序列,保存为 `<工作目录>/row<行号>/<列号,从0开始>.png`。
- 每行生成后给用户看预览,外观或动作不对就重生成该行;一致性靠逐行确认收敛,不要一次生成全部 9 行。
- 抠图清洗用仓库自带脚本:`pnpm tsx scripts/clean-chroma-fringe.ts <输入目录> <输出目录>`(清绿幕/品红溢色,逐个 row 目录跑,在仓库根目录执行)。

## 快速降级路径

用户只想先要个"能呼吸的静态角色"时:只精修第 0 行(待机 6 帧),其余行的帧目录用第 0 行的帧复制占位,角色立即可用;之后随时按行补齐。

## 组装与校验

1. 组装(在仓库根目录运行,脚本从当前目录的 node_modules 解析 sharp):

   ```bash
   node skills/everby-pet-from-image/scripts/assemble-pet.mjs <帧目录> <输出角色目录> --id <petId> --name <显示名> --description <人设描述>
   ```

   脚本逐帧去透明边缘、等比缩放进 192×208 单元格、底部居中对齐(锚点 96,208),合成无损 webp,并按需生成 pet.json。输出里的 `warnings` 会指出缺帧的行——缺帧的动作在桌面上是空白,要么补齐要么明确告知用户。

2. **为角色写 persona 块**:这是生成型 skill 最擅长的一步。根据参考图的气质和用户的描述,为角色撰写默认人设,写进 pet.json(字段与优先级见 docs/pet-format.md 的 persona 节):

   ```json
   "persona": {
     "speakingStyle": "与角色性格一致的语气/口癖/句式偏好,1000 字符以内",
     "userAddress": "角色对用户的称呼,40 字符以内,不贴角色性格就省略",
     "boundaries": "行为边界,2000 字符以内",
     "background": "身份背景;description 已说清就省略"
   }
   ```

   原则:风格要落在具体的说话方式上(例:"句尾常带'呢',兴奋时会重复词语"),而不是复述外观;用户在人设表单里的手动修改永远优先于此默认,所以不必保守求全。

3. 校验产物:`node skills/everby-pet-install/scripts/validate-pet.mjs <输出角色目录>`,`ok: true` 才算完成。

4. 安装:按 everby-pet-install 的流程复制到 `~/.petdex/pets/<id>`,或让用户在管理窗口"角色"页用"导入角色"按钮选输出目录。

## 边界

- 生成的是原创角色资源;参考图如果是第三方 IP,提醒用户确认使用边界,不要代做免责声明以外的承诺。
- 不要修改 `src/core/codex-atlas.ts` 的切片坐标来迁就素材——永远是素材适配网格。
