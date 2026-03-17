const defaultReleaseRepo = "pengluai/agentshield-downloads";
const defaultMacAsset = "AgentShield-macos-arm64.dmg";
const defaultWindowsAsset = "AgentShield-windows-x64-setup.exe";

function readEnvString(value, fallback = "") {
  const normalized = String(value ?? fallback).trim();
  return normalized.length ? normalized : fallback;
}

function buildReleaseAssetUrl(env, assetName) {
  const repo = readEnvString(env.DOWNLOAD_RELEASE_REPO, defaultReleaseRepo);
  const tag = readEnvString(env.DOWNLOAD_RELEASE_TAG, "");
  if (!tag) {
    return "";
  }
  return `https://github.com/${repo}/releases/download/${tag}/${assetName}`;
}

/**
 * Proxy the GitHub release download so we can set the correct filename.
 * GitHub CDN redirects to objects.githubusercontent.com with a UUID path,
 * which causes browsers to save the file with a UUID name.
 */
async function proxyDownload(githubUrl, filename, contentType) {
  if (!githubUrl) {
    return new Response("Download not available", { status: 404 });
  }
  const upstream = await fetch(githubUrl, {
    redirect: "follow",
    headers: { "User-Agent": "AgentShield-Storefront/1.0" },
  });
  if (!upstream.ok) {
    return new Response("Download temporarily unavailable. Please try the GitHub releases page.", {
      status: 502,
    });
  }
  const headers = new Headers(upstream.headers);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Content-Type", contentType);
  headers.delete("Content-Security-Policy");
  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const macAsset = readEnvString(env.DOWNLOAD_ASSET_MACOS, defaultMacAsset);
    const winAsset = readEnvString(env.DOWNLOAD_ASSET_WINDOWS, defaultWindowsAsset);
    const macDownloadUrl =
      readEnvString(env.DOWNLOAD_URL_MACOS, "") || buildReleaseAssetUrl(env, macAsset);
    const windowsDownloadUrl =
      readEnvString(env.DOWNLOAD_URL_WINDOWS, "") || buildReleaseAssetUrl(env, winAsset);
    const releasesUrl = readEnvString(
      env.DOWNLOAD_RELEASES_URL,
      `https://github.com/${readEnvString(env.DOWNLOAD_RELEASE_REPO, defaultReleaseRepo)}/releases`,
    );

    if (url.pathname === "/download/macos" || url.pathname === "/download/mac") {
      return proxyDownload(macDownloadUrl, macAsset, "application/x-apple-diskimage");
    }

    if (url.pathname === "/download/windows" || url.pathname === "/download/win") {
      return proxyDownload(windowsDownloadUrl, winAsset, "application/x-msdownload");
    }

    if (url.pathname === "/download/releases") {
      return Response.redirect(releasesUrl, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
