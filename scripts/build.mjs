import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: watch,
  minify: !watch,
  target: ["chrome120"],
  define: {
    "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production")
  }
};

const builds = [
  {
    entryPoints: [path.join(root, "src/background/index.ts")],
    outfile: path.join(dist, "background.js"),
    format: "esm"
  },
  {
    entryPoints: [path.join(root, "src/content/index.ts")],
    outfile: path.join(dist, "content.js"),
    format: "iife",
    globalName: "YouTubeSkillMakerContent"
  },
  {
    entryPoints: [path.join(root, "src/content/main-world.ts")],
    outfile: path.join(dist, "youtube-main-world.js"),
    format: "iife",
    globalName: "YouTubeSkillMakerMainWorld"
  },
  {
    entryPoints: [path.join(root, "src/popup/main.tsx")],
    outfile: path.join(dist, "popup.js"),
    format: "iife",
    globalName: "YouTubeSkillMakerPopup"
  },
  {
    entryPoints: [path.join(root, "src/options/main.tsx")],
    outfile: path.join(dist, "options.js"),
    format: "iife",
    globalName: "YouTubeSkillMakerOptions"
  }
];

async function copyPublic() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(path.join(root, "public"), dist, { recursive: true });
}

async function buildOnce() {
  await copyPublic();
  await Promise.all(builds.map((entry) => build({ ...common, ...entry })));
}

if (watch) {
  await copyPublic();
  const contexts = await Promise.all(builds.map((entry) => context({ ...common, ...entry })));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching extension files. Re-run this command after changing files in public/.");
} else {
  await buildOnce();
}
