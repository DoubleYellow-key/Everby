import { readFile, writeFile } from "node:fs/promises";

interface Encryptor {
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class SecretStore {
  constructor(private readonly path: string, private readonly encryptor: Encryptor) {}
  async setApiKey(value: string): Promise<void> { await writeFile(this.path, await this.encryptor.encrypt(value), { mode: 0o600 }); }
  async getApiKey(): Promise<string> { try { return await this.encryptor.decrypt(await readFile(this.path)); } catch { return ""; } }
}
