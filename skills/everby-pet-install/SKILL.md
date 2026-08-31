---
name: everby-pet-install
description: 校验、适配并安装 Petdex 桌宠角色(文件夹或 zip 压缩包)到 Everby。当用户下载了 Petdex 桌宠想在 Everby 中使用,或某个角色目录没有通过 Everby 的导入校验时使用。不用于从零生成新角色(用 everby-pet-from-image)。
---

# Everby 桌宠安装

目标:把 Petdex 桌宠包变成 `~/.petdex/pets/` 下能被 Everby 发现的角色目录。格式规范(8×9 网格、pet.json 字段、id 规则)以仓库文档 [docs/pet-format.md](../../docs/pet-format.md) 为准,先读它再动手。

## 流程

1. **定位角色根**:输入是 zip 先解压到临时目录;角色根是含 `pet.json` 的那一层(zip 根目录,或 zip 内唯一顶层文件夹)。解压后留意是否多套了一层同名目录。
2. **校验**:在仓库根目录运行本 skill 自带的校验脚本(脚本从当前目录的 node_modules 解析 sharp,所以 cwd 必须是仓库根):

   ```bash
   node skills/everby-pet-install/scripts/validate-pet.mjs <角色目录>
   ```

   输出 JSON;`ok: false` 时按 `issues` 逐项处理。

3. **可以自动修复的问题**:
   - 缺 `pet.json` → 按格式规范补一个(id 用目录名,`displayName`/`description` 向用户确认后填写)。
   - 图集文件名不符 → 重命名为 `spritesheet.webp` 或 `spritesheet.png`。
   - 目录名不合法(中文、空格等)→ 安装时改用合法 id,先与用户确认新名字。
4. **不要自动修复的问题**:图集尺寸不满足网格要求时停止,报告实测尺寸与网格差距,建议改用 everby-pet-from-image 重切或重制。不要强行拉伸/缩放整张图集——切片按绝对像素坐标取帧,缩放只会让每帧错位。
5. **安装**:把整个角色目录复制到 `~/.petdex/pets/<id>`(Windows 上 `~` 即 `C:\Users\<用户名>`;用户设了 `EVERBY_PETDEX_ROOT` 则以它为准)。目标已存在同名目录时先问用户选择替换还是换 id,不要静默覆盖。
6. **生效**:告诉用户在管理窗口"角色"页点"导入角色"按钮直接选该目录(免重启),或重启 Everby 后在角色页切换。

## 边界

- 只复制文件,不修改用户原始目录里的任何内容。
- 角色包里的 `motions/drag/*.png`、`tray.png` 原样保留即可;拖拽动画目前仅对内置 Daily 生效,这是应用侧限制,不要试图通过改名绕过。
