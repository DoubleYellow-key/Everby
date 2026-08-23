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
