import { describe, it, expect } from "vitest";
import { bucketForPath, extOf, baseNameOf } from "../../src/domain/fileType.js";

describe("extOf", () => {
  it("extracts lowercase extension without leading dot", () => {
    expect(extOf("Assets/UI/Click_01.WAV")).toBe("wav");
    expect(extOf("Crate.fbx")).toBe("fbx");
  });

  it("returns empty string for dotfiles and extensionless names", () => {
    expect(extOf("README")).toBe("");
    expect(extOf(".gitignore")).toBe("");
    expect(extOf("trailingdot.")).toBe("");
  });

  it("uses only the final path segment", () => {
    expect(extOf("a.b.c/file")).toBe("");
    expect(extOf("dir.with.dots/song.ogg")).toBe("ogg");
  });
});

describe("bucketForPath", () => {
  it.each([
    ["a/b/click.wav", "audio"],
    ["a/Crate.fbx", "model"],
    ["x/Player.cs", "script"],
    ["x/Brick.png", "texture"],
    ["x/Hero.prefab", "prefab"],
    ["x/Wall.mat", "material"],
    ["x/Level.unity", "scene"],
    ["x/Toon.shader", "shader"],
    ["x/pack.unitypackage", "package"],
    ["x/mystery.xyz", "other"],
  ] as const)("classifies %s as %s", (path, bucket) => {
    expect(bucketForPath(path)).toBe(bucket);
  });
});

describe("baseNameOf", () => {
  it("handles forward and back slashes", () => {
    expect(baseNameOf("Assets/SFX/click.wav")).toBe("click.wav");
    expect(baseNameOf("Assets\\SFX\\click.wav")).toBe("click.wav");
    expect(baseNameOf("noslash")).toBe("noslash");
  });
});
