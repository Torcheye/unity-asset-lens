import type { FileTypeBucket } from "./types.js";

/**
 * Map a file extension to a coarse type bucket (spec §6 `files.ext`, §7 filters).
 * Extension matching is case-insensitive and dot-optional.
 */
const EXT_BUCKETS: ReadonlyMap<string, FileTypeBucket> = new Map(
  Object.entries({
    // audio
    wav: "audio",
    mp3: "audio",
    ogg: "audio",
    aiff: "audio",
    aif: "audio",
    flac: "audio",
    // 3d models
    fbx: "model",
    obj: "model",
    blend: "model",
    dae: "model",
    "3ds": "model",
    gltf: "model",
    glb: "model",
    // prefab / unity object
    prefab: "prefab",
    // textures / images
    png: "texture",
    jpg: "texture",
    jpeg: "texture",
    tga: "texture",
    psd: "texture",
    tif: "texture",
    tiff: "texture",
    exr: "texture",
    hdr: "texture",
    bmp: "texture",
    gif: "texture",
    // scripts
    cs: "script",
    js: "script",
    ts: "script",
    cginc: "script",
    // animation
    anim: "animation",
    controller: "animation",
    fbxanim: "animation",
    // material
    mat: "material",
    // scenes
    unity: "scene",
    // shaders
    shader: "shader",
    shadergraph: "shader",
    compute: "shader",
    // fonts
    ttf: "font",
    otf: "font",
    fontsettings: "font",
    // video
    mp4: "video",
    mov: "video",
    webm: "video",
    // structured data
    json: "data",
    xml: "data",
    txt: "data",
    asset: "data",
    csv: "data",
    md: "data",
    // nested package
    unitypackage: "package",
  }) as ReadonlyArray<readonly [string, FileTypeBucket]>,
);

/** Extract the lowercase extension (no leading dot) from a path or file name. */
export function extOf(pathOrName: string): string {
  const name = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Classify a path/file name into a {@link FileTypeBucket}. */
export function bucketForPath(pathOrName: string): FileTypeBucket {
  return EXT_BUCKETS.get(extOf(pathOrName)) ?? "other";
}

/** The basename (final path segment) for a forward- or back-slash path. */
export function baseNameOf(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1]! : fullPath;
}
