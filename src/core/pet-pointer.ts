export const PET_DRAG_THRESHOLD = 8;

export type PetPointerIntent = "interact" | "drag" | "chat";

export function shouldStartPetDrag(button: number, distance: number): boolean {
  return button === 0 && distance >= PET_DRAG_THRESHOLD;
}

export function classifyPetPointer(button: number, distance: number): PetPointerIntent | null {
  if (button === 2) return "chat";
  if (button !== 0) return null;
  return shouldStartPetDrag(button, distance) ? "drag" : "interact";
}
