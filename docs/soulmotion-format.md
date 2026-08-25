# `.soulmotion` 动作扩展

动作扩展是一个 ZIP 归档，扩展名为 `.soulmotion`。根目录必须包含 `motion.json`，动作帧为 `192x208`、带透明通道的 PNG 或 WebP。

```json
{
  "formatVersion": 1,
  "packId": "daily-dance",
  "version": "1.0.0",
  "name": "Daily Dance",
  "targetPetId": "daily",
  "canvas": { "width": 192, "height": 208, "anchorX": 96, "anchorY": 208 },
  "animations": [
    {
      "id": "dance",
      "label": "庆祝舞步",
      "loop": false,
      "weight": 1,
      "intents": ["celebrate", "happy"],
      "frames": [
        { "src": "assets/dance/000.webp", "durationMs": 100 },
        { "src": "assets/dance/001.webp", "durationMs": 100 }
      ]
    }
  ]
}
```

```bash
pnpm motion:build -- ./motion.json ./daily-dance.soulmotion
pnpm motion:validate -- ./daily-dance.soulmotion
```

动作 ID 不能覆盖目标角色的九个基础动作。同一 `packId` 的新版本会替换旧版本；禁用或卸载扩展不会修改角色的基础资源。

`label` 是可选的用户可见名称，最长 80 个字符；省略时设置页显示动作 ID。相同资源帧可以被多个动作或同一动作重复引用，构建器只会在归档中保存一份资源。

导入后可在“设置 → 动作”中预览基础动作和扩展动作，将动作加入常态/休息的权重池、设为专注模式的固定动作，或建立点击、对话语义和提醒事件规则。停用或卸载扩展不会删除引用它的配置；状态模式会自动回退到基础动作，事件规则则显示为“动作不可用”。

仓库提供了可直接导入的 [Daily 日常动作组合](../examples/motions/daily-routines/README.md)，用于验证动作包开发和导入链路。
