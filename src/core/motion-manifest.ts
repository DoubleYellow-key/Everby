import { z } from "zod";
import { ACTION_INTENTS } from "../shared/contracts";

const safeId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const safePath = z.string().min(1).refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/") &&
    !/^[a-zA-Z]:/.test(normalized) &&
    !normalized.split("/").some((part) => part === ".." || part.length === 0) &&
    !/\.(exe|dll|bat|cmd|ps1|js|mjs|cjs|vbs|scr)$/i.test(normalized);
}, "资源路径不安全");

const motionManifestSchema = z.object({
  formatVersion: z.literal(1),
  packId: safeId,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().trim().min(1).max(120),
  targetPetId: safeId,
  canvas: z.object({
    width: z.literal(192),
    height: z.literal(208),
    anchorX: z.literal(96),
    anchorY: z.literal(208)
  }),
  animations: z.array(z.object({
    id: safeId,
    loop: z.boolean(),
    weight: z.number().positive().max(100).default(1),
    intents: z.array(z.enum(ACTION_INTENTS)).min(1),
    frames: z.array(z.object({
      src: safePath,
      durationMs: z.number().int().min(20).max(60_000)
    })).min(1).max(1_000)
  })).min(1).max(64)
}).superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const [index, animation] of manifest.animations.entries()) {
    if (ids.has(animation.id)) context.addIssue({ code: "custom", path: ["animations", index, "id"], message: "动作 ID 重复" });
    ids.add(animation.id);
  }
});

export type MotionManifest = z.infer<typeof motionManifestSchema>;

export function parseMotionManifest(input: unknown): MotionManifest {
  const result = motionManifestSchema.safeParse(input);
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join("；"));
  return result.data;
}
