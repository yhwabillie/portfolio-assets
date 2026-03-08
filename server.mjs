import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROOT_DIR = process.cwd();
const VIDEOS_DIR = path.join(ROOT_DIR, "videos");
const CDN_MAP_FILE = path.join(ROOT_DIR, "video-cdn-map.json");
const DEFAULT_CDN_BASE =
  process.env.VIDEO_CDN_BASE ??
  "https://hhgfywdzkbdfwrhfqlbn.supabase.co/storage/v1/object/public/portfolio";
const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "media-src 'self' https:",
].join("; ");
const HTML_SECURITY_HEADERS = {
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

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

async function getVideoIndex(cdnMap) {
  const entries = await fs.readdir(VIDEOS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(mp4|webm|mov)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const bySlug = new Map();
  const videos = [];

  for (const fileName of files) {
    const slug = path.parse(fileName).name;
    const localUrl = `/videos/${encodeURIComponent(fileName)}`;
    const mapped = cdnMap[slug];
    const cdnUrl = typeof mapped === "string" && mapped.trim() ? mapped.trim() : buildDefaultCdnUrl(fileName);

    const data = {
      slug,
      fileName,
      localUrl,
      cdnUrl,
      mimeType: getVideoMimeType(fileName),
    };

    bySlug.set(slug, data);
    videos.push(data);
  }

  return { files, videos, bySlug };
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    ...HTML_SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function sendBadRequest(res, message = "Bad request") {
  sendHtml(
    res,
    400,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>400</title>
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
    <h1>400</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Back to video list</a></p>
  </div>
</body>
</html>`
  );
}

function getPathname(req) {
  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return { error: "Invalid request URL" };
  }

  try {
    return { pathname: decodeURIComponent(requestUrl.pathname) };
  } catch {
    return { error: "Malformed URL encoding" };
  }
}

function sendNotFound(res, message = "Not found") {
  sendHtml(
    res,
    404,
    `<!doctype html>
<html lang="en">
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
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Back to video list</a></p>
  </div>
</body>
</html>`
  );
}

function renderIndexPage(videos) {
  const links = videos
    .map(({ slug, cdnUrl, localUrl }) => {
      return `<li><a href="/${encodeURIComponent(slug)}">/${escapeHtml(slug)}</a> <span class="meta">→ CDN: ${escapeHtml(cdnUrl)} (fallback: ${escapeHtml(localUrl)})</span></li>`;
    })
    .join("");

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
  const safeSlug = escapeHtml(slug);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeSlug}</title>
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

        const fallbackSrc = video.dataset.localSrc;
        if (!fallbackSrc) {
          return;
        }

        source.src = fallbackSrc;
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

async function streamVideo(res, fileName) {
  const filePath = path.join(VIDEOS_DIR, fileName);
  let stat;

  try {
    stat = await fs.stat(filePath);
  } catch {
    sendNotFound(res, `Video not found: ${fileName}`);
    return;
  }

  res.writeHead(200, {
    ...BASE_SECURITY_HEADERS,
    "Content-Type": getVideoMimeType(fileName),
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  });

  createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res) {
  const parsedPath = getPathname(req);
  if ("error" in parsedPath) {
    sendBadRequest(res, parsedPath.error);
    return;
  }
  const { pathname } = parsedPath;

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  let videoIndex;
  try {
    const cdnMap = await loadCdnMap();
    videoIndex = await getVideoIndex(cdnMap);
  } catch (error) {
    console.error("Failed to build video index:", error);
    sendHtml(
      res,
      500,
      `<!doctype html><html><body style="background:#000;color:#fff;font-family:monospace;padding:24px;">
      <h1>500</h1>
      <p>Internal server error.</p>
      </body></html>`
    );
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    sendHtml(res, 200, renderIndexPage(videoIndex.videos));
    return;
  }

  if (pathname.startsWith("/videos/")) {
    const videoFile = pathname.replace(/^\/videos\//, "");
    if (!videoIndex.files.includes(videoFile)) {
      sendNotFound(res, `Unknown video file: ${videoFile}`);
      return;
    }
    await streamVideo(res, videoFile);
    return;
  }

  const slug = pathname.replace(/^\/+|\/+$/g, "");
  const videoData = videoIndex.bySlug.get(slug);
  if (videoData) {
    sendHtml(res, 200, renderPlayerPage(slug, videoData.cdnUrl, videoData.localUrl, videoData.mimeType));
    return;
  }

  sendNotFound(res, `Unknown path: ${pathname}`);
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("Unhandled request error:", error);
    if (res.headersSent) {
      res.end();
      return;
    }

    sendHtml(
      res,
      500,
      `<!doctype html><html><body style="background:#000;color:#fff;font-family:monospace;padding:24px;">
      <h1>500</h1>
      <p>Internal server error.</p>
      </body></html>`
    );
  });
});

server.on("clientError", (error, socket) => {
  console.error("Client connection error:", error.message);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, HOST, () => {
  console.log(`Video server running at http://localhost:${PORT}`);
});
