import type { EverbyApi } from "../shared/contracts";

declare global { interface Window { everby: EverbyApi } }
export {};
