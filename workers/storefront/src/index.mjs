const redirectStatus = 302;
const defaultReleaseRepo = "pengluai/agentshield-downloads";
const defaultMacAsset = "AgentShield-macos-arm64.dmg";
const defaultWindowsAsset = "AgentShield-windows-x64-setup.exe";

function redirect(url) {
  return Response.redirect(url, redirectStatus);
}

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const macDownloadUrl =
      readEnvString(env.DOWNLOAD_URL_MACOS, "") ||
      buildReleaseAssetUrl(env, readEnvString(env.DOWNLOAD_ASSET_MACOS, defaultMacAsset));
    const windowsDownloadUrl =
      readEnvString(env.DOWNLOAD_URL_WINDOWS, "") ||
      buildReleaseAssetUrl(env, readEnvString(env.DOWNLOAD_ASSET_WINDOWS, defaultWindowsAsset));
    const releasesUrl = readEnvString(
      env.DOWNLOAD_RELEASES_URL,
      `https://github.com/${readEnvString(env.DOWNLOAD_RELEASE_REPO, defaultReleaseRepo)}/releases`,
    );

    if (url.pathname === "/download/macos" || url.pathname === "/download/mac") {
      return redirect(macDownloadUrl || releasesUrl);
    }

    if (url.pathname === "/download/windows" || url.pathname === "/download/win") {
      return redirect(windowsDownloadUrl || releasesUrl);
    }

    if (url.pathname === "/download/releases") {
      return redirect(releasesUrl);
    }

    return env.ASSETS.fetch(request);
  },
};
