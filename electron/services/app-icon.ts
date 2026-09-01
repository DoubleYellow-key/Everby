import { posix, win32 } from "node:path";

export interface AppIconPathOptions {
  appPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
}

export function resolveAppIconPath(options: AppIconPathOptions): string {
  const windows = options.platform === "win32";
  const paths = windows ? win32 : posix;
  const extension = windows ? "ico" : "png";
  return options.isPackaged
    ? paths.join(options.resourcesPath, `app-icon.${extension}`)
    : paths.join(options.appPath, `build/icon.${extension}`);
}
