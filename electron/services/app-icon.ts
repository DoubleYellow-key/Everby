import { join } from "node:path";

export interface AppIconPathOptions {
  appPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
}

export function resolveAppIconPath(options: AppIconPathOptions): string {
  const extension = options.platform === "win32" ? "ico" : "png";
  return options.isPackaged
    ? join(options.resourcesPath, `app-icon.${extension}`)
    : join(options.appPath, `build/icon.${extension}`);
}
