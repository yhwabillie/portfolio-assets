import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROOT_DIR = process.cwd();
const VIDEOS_DIR = path.join(ROOT_DIR, "videos");

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getVideoIndex() {
  const entries = await fs.readdir(VIDEOS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(mp4|webm|mov)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const bySlug = new Map();
  for (const file of files) {
    const parsed = path.parse(file);
    bySlug.set(parsed.name, file);
  }

  return { files, bySlug };
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
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

function renderIndexPage(files) {
  const links = files
    .map((file) => {
      const slug = path.parse(file).name;
      return `<li><a href="/${encodeURIComponent(slug)}">/${escapeHtml(slug)}</a> <span class="meta">→ /videos/${escapeHtml(file)}</span></li>`;
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
    .meta { color: #888; }
  </style>
</head>
<body>
  <h1>영상 재생 경로 목록</h1>
  <p>각 경로는 자동재생 + 무음 + 반복(Loop)으로 동작합니다.</p>
  <ul>${links}</ul>
</body>
</html>`;
}

function renderPlayerPage(slug, videoFile) {
  const safeSlug = escapeHtml(slug);
  const encodedVideoPath = `/videos/${encodeURIComponent(videoFile)}`;
  const safeVideoPath = escapeHtml(encodedVideoPath);

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
  <video autoplay muted loop playsinline preload="auto">
    <source src="${safeVideoPath}" type="video/mp4" />
  </video>
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

  const ext = path.extname(fileName).toLowerCase();
  const contentType =
    ext === ".webm"
      ? "video/webm"
      : ext === ".mov"
        ? "video/quicktime"
        : "video/mp4";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  });

  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  let videoIndex;
  try {
    videoIndex = await getVideoIndex();
  } catch (error) {
    sendHtml(
      res,
      500,
      `<!doctype html><html><body style="background:#000;color:#fff;font-family:monospace;padding:24px;">
      <h1>500</h1>
      <p>Failed to read videos directory.</p>
      <pre>${escapeHtml(String(error))}</pre>
      </body></html>`
    );
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    sendHtml(res, 200, renderIndexPage(videoIndex.files));
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
  const fileForSlug = videoIndex.bySlug.get(slug);
  if (fileForSlug) {
    sendHtml(res, 200, renderPlayerPage(slug, fileForSlug));
    return;
  }

  sendNotFound(res, `Unknown path: ${pathname}`);
});

server.listen(PORT, HOST, () => {
  console.log(`Video server running at http://localhost:${PORT}`);
});
