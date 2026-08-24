# Daily 日常动作组合

这个示例扩展从 Daily 原始图集重新编排动作帧，包含：

- `daily-cheer-combo`：挥手与跳跃组成的欢呼动作。
- `daily-focus-cycle`：工作与检查组成的循环动作。
- `daily-reset-stretch`：伸展后恢复待机的单次动作。

生成帧并构建可导入文件：

```bash
pnpm motion:example
```

验证成品：

```bash
pnpm motion:validate -- examples/motions/daily-routines.soulmotion
```

生成的 `examples/motions/daily-routines.soulmotion` 可在 Everby 的“设置 → 动作 → 扩展包”中导入。
