import { describe, expect, it } from "vitest";
import { classifyPetPointer, shouldStartPetDrag } from "./pet-pointer";

describe("pet pointer gestures", () => {
  it("maps a short left click to interaction and right click to chat", () => {
    expect(classifyPetPointer(0, 2)).toBe("interact");
    expect(classifyPetPointer(2, 0)).toBe("chat");
    expect(classifyPetPointer(1, 0)).toBeNull();
  });

  it("starts drag only after the left pointer crosses the movement threshold", () => {
    expect(shouldStartPetDrag(0, 7.99)).toBe(false);
    expect(shouldStartPetDrag(0, 8)).toBe(true);
    expect(shouldStartPetDrag(2, 20)).toBe(false);
    expect(classifyPetPointer(0, 8)).toBe("drag");
  });
});
