import type { SoulDeskApi } from "../shared/contracts";

declare global { interface Window { souldesk: SoulDeskApi } }
export {};
