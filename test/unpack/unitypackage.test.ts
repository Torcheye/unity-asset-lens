import { describe, it, expect } from "vitest";
import {
  parseUnityPackageBuffer,
} from "../../src/unpack/unitypackage.js";
import { buildUnityPackage } from "../helpers/buildPackage.js";

describe("parseUnityPackageBuffer", () => {
  it("reads file pathnames and classifies type buckets", async () => {
    const pkg = await buildUnityPackage([
      { path: "Assets/SFX/UI/UI_Click_01.wav" },
      { path: "Assets/Models/Crate.fbx" },
      { path: "Assets/Scripts/Player.cs" },
    ]);

    const result = await parseUnityPackageBuffer(pkg);

    const paths = result.files.map((f) => f.fullPath).sort();
    expect(paths).toEqual([
      "Assets/Models/Crate.fbx",
      "Assets/SFX/UI/UI_Click_01.wav",
      "Assets/Scripts/Player.cs",
    ]);

    const wav = result.files.find((f) => f.fullPath.endsWith(".wav"))!;
    expect(wav.fileName).toBe("UI_Click_01.wav");
    expect(wav.ext).toBe("wav");
    expect(wav.typeBucket).toBe("audio");
    expect(wav.source).toBe("local");
    expect(result.isWrapper).toBe(false);
  });

  it("skips folder entries (pathname present, no asset blob)", async () => {
    const pkg = await buildUnityPackage([
      { path: "Assets/SFX", isFolder: true },
      { path: "Assets/SFX/click.wav" },
    ]);

    const result = await parseUnityPackageBuffer(pkg);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.fullPath).toBe("Assets/SFX/click.wav");
  });

  it("recursively unpacks a nested wrapper package (tar-in-tar)", async () => {
    // Two render-pipeline packages embedded inside one wrapper (spec §3.3).
    const builtIn = await buildUnityPackage([
      { path: "Toon Temples/BuiltIn/Temple.fbx" },
      { path: "Toon Temples/BuiltIn/Temple.mat" },
    ]);
    const urp = await buildUnityPackage([
      { path: "Toon Temples/URP/Temple.fbx" },
      { path: "Toon Temples/URP/Temple_URP.mat" },
    ]);

    const wrapper = await buildUnityPackage([
      { path: "BuiltIn_Toon Deserted Temples_6000.1.0.unitypackage", asset: builtIn },
      { path: "URP_Toon Deserted Temples_6000.1.0.unitypackage", asset: urp },
      { path: "_ReadFirst.txt" },
    ]);

    const result = await parseUnityPackageBuffer(wrapper);

    expect(result.isWrapper).toBe(true);
    expect(result.nestedPackages.sort()).toEqual([
      "BuiltIn_Toon Deserted Temples_6000.1.0.unitypackage",
      "URP_Toon Deserted Temples_6000.1.0.unitypackage",
    ]);

    const paths = result.files.map((f) => f.fullPath).sort();
    expect(paths).toEqual([
      "Toon Temples/BuiltIn/Temple.fbx",
      "Toon Temples/BuiltIn/Temple.mat",
      "Toon Temples/URP/Temple.fbx",
      "Toon Temples/URP/Temple_URP.mat",
      "_ReadFirst.txt", // the wrapper's own readme is still indexed
    ]);

    // Inner files are tagged with the nested package they came from.
    const builtInFbx = result.files.find(
      (f) => f.fullPath === "Toon Temples/BuiltIn/Temple.fbx",
    )!;
    expect(builtInFbx.nestedPkg).toBe(
      "BuiltIn_Toon Deserted Temples_6000.1.0.unitypackage",
    );
  });

  it("does not recurse when recurse:false (nested pkg kept as a file)", async () => {
    const inner = await buildUnityPackage([{ path: "Inner/thing.fbx" }]);
    const wrapper = await buildUnityPackage([
      { path: "Pipelines/URP_pack.unitypackage", asset: inner },
    ]);

    const result = await parseUnityPackageBuffer(wrapper, { recurse: false });

    expect(result.nestedPackages).toHaveLength(0);
    expect(result.files.map((f) => f.fullPath)).toEqual([
      "Pipelines/URP_pack.unitypackage",
    ]);
    expect(result.files[0]!.typeBucket).toBe("package");
  });

  it("rejects on non-gzip input", async () => {
    await expect(
      parseUnityPackageBuffer(Buffer.from("this is not gzip at all")),
    ).rejects.toThrow();
  });
});
