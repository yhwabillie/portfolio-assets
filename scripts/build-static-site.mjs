import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const VIDEOS_DIR = path.join(ROOT_DIR, "videos");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const DIST_VIDEOS_DIR = path.join(DIST_DIR, "videos");
const CDN_MAP_FILE = path.join(ROOT_DIR, "video-cdn-map.json");
const DEFAULT_CDN_BASE =
  process.env.VIDEO_CDN_BASE ??
  "https://hhgfywdzkbdfwrhfqlbn.supabase.co/storage/v1/object/public/portfolio";
const ALLOWED_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getVideoMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".webm") {
    return "video/webm";
  }
  if (ext === ".mov") {
    return "video/quicktime";
  }
  return "video/mp4";
}

function buildDefaultCdnUrl(fileName) {
  const base = DEFAULT_CDN_BASE.replace(/\/+$/g, "");
  return `${base}/${encodeURIComponent(fileName)}`;
}

async function loadCdnMap() {
  try {
    const raw = await fs.readFile(CDN_MAP_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("video-cdn-map.json must be an object map of slug to URL");
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function renderIndexPage(entries) {
  const links = entries
    .map(({ slug, cdnUrl, localUrl }) => {
      return `<li><a href="/${encodeURIComponent(slug)}">/${escapeHtml(slug)}</a> <span class="meta">→ CDN: ${escapeHtml(cdnUrl)} (fallback: ${escapeHtml(localUrl)})</span></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Video Paths</title>
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; min-height: 100%; background: #000; color: #fff; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 24px;
      line-height: 1.45;
    }
    h1 { margin: 0 0 16px; font-size: 20px; }
    p { margin: 0 0 12px; color: #ccc; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 10px 0; }
    a { color: #86b7ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #888; word-break: break-all; }
  </style>
</head>
<body>
  <h1>영상 재생 경로 목록</h1>
  <p>각 경로는 자동재생 + 무음 + 반복(Loop)으로 동작합니다.</p>
  <ul>${links}</ul>
</body>
</html>`;
}

function renderPlayerPage(slug, cdnUrl, localUrl, mimeType) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(slug)}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    video {
      max-width: 100vw;
      max-height: 100vh;
      width: auto;
      height: auto;
      object-fit: contain;
      background: #000;
      display: block;
    }
  </style>
</head>
<body>
  <video autoplay muted loop playsinline preload="auto" data-cdn-src="${escapeHtml(cdnUrl)}" data-local-src="${escapeHtml(localUrl)}">
    <source src="${escapeHtml(cdnUrl)}" type="${mimeType}" />
  </video>
  <script>
    const video = document.querySelector("video");
    const source = video?.querySelector("source");

    if (video && source) {
      let fallbackApplied = false;

      const applyFallback = () => {
        if (fallbackApplied) {
          return;
        }
        fallbackApplied = true;

        const localSrc = video.dataset.localSrc;
        if (!localSrc) {
          return;
        }

        source.src = localSrc;
        video.load();
        video.play().catch(() => {
          // Some browsers may still block autoplay despite muted attr.
        });
      };

      video.addEventListener("error", applyFallback);
      source.addEventListener("error", applyFallback);

      video.play().catch(() => {
        // Some browsers may still block autoplay despite muted attr.
      });
    }
  </script>
</body>
</html>`;
}

function renderNotFoundPage() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404</title>
  <style>
    :root { color-scheme: dark; }
    html, body { height: 100%; margin: 0; background: #000; color: #fff; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    body { display: grid; place-items: center; }
    .card { max-width: 720px; padding: 24px; border: 1px solid #333; border-radius: 10px; }
    a { color: #86b7ff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>404</h1>
    <p>요청한 경로를 찾지 못했습니다.</p>
    <p><a href="/">Back to video list</a></p>
  </div>
</body>
</html>`;
}

async function main() {
  const cdnMap = await loadCdnMap();

  const entries = await fs.readdir(VIDEOS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();

  const slugSet = new Set();
  const videoEntries = files.map((fileName) => {
    const slug = path.parse(fileName).name;
    if (slugSet.has(slug)) {
      throw new Error(`Duplicate slug detected: ${slug}`);
    }
    slugSet.add(slug);

    const localUrl = `/videos/${encodeURIComponent(fileName)}`;
    const cdnUrl = cdnMap[slug] ?? buildDefaultCdnUrl(fileName);

    return {
      slug,
      fileName,
      mimeType: getVideoMimeType(fileName),
      localUrl,
      cdnUrl,
    };
  });

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_VIDEOS_DIR, { recursive: true });

  for (const { fileName } of videoEntries) {
    await fs.copyFile(path.join(VIDEOS_DIR, fileName), path.join(DIST_VIDEOS_DIR, fileName));
  }

  await fs.writeFile(path.join(DIST_DIR, "index.html"), renderIndexPage(videoEntries), "utf8");
  await fs.writeFile(path.join(DIST_DIR, "404.html"), renderNotFoundPage(), "utf8");

  for (const { slug, cdnUrl, localUrl, mimeType } of videoEntries) {
    await fs.writeFile(path.join(DIST_DIR, `${slug}.html`), renderPlayerPage(slug, cdnUrl, localUrl, mimeType), "utf8");
  }

  console.log(`Built ${videoEntries.length} video pages into ${DIST_DIR} (CDN primary + local fallback)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
