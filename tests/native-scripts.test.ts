import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);

describe("native simulator scripts", () => {
  it.each([
    ["ios:release", "run-ios-simulator.sh"],
    ["android:release", "run-android-emulator.sh"],
    ["simulators:release", "run-simulators.sh"],
  ])("exposes %s through %s", (command, script) => {
    expect(packageJson.scripts[command]).toBe(`bash scripts/${script}`);
    expect(() => readFileSync(resolve(root, "scripts", script))).not.toThrow();
  });

  it("braces shell variables before full-width punctuation", () => {
    for (const script of [
      "run-ios-simulator.sh",
      "run-android-emulator.sh",
      "run-simulators.sh",
    ]) {
      const source = readFileSync(resolve(root, "scripts", script), "utf8");
      expect(source).not.toMatch(/\$[A-Za-z_][A-Za-z0-9_]*[：，。！？；]/u);
    }
  });
});
