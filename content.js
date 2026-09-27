(() => {
  const PLAYER_BADGE_ID = "ytlvc-live-viewer-player-badge";
  const CACHE_KEY = "ytlvc-last-viewer-text";
  const SCAN_INTERVAL_MS = 1500;
  const REMOTE_REFRESH_INTERVAL_MS = 60000;
  const REMOTE_CACHE_TTL_MS = 70000;
  const IS_TOP_FRAME = window.top === window.self;
  const VIEWER_NUMBER = "(?:\\d{1,3}(?:[.,]\\d{3})+|\\d{1,7})(?:\\s*[KM])?";

  const viewerPatterns = [
    new RegExp(`(^|[^\\d.,])(${VIEWER_NUMBER})\\s+(watching now|watching)\\b`, "i"),
    new RegExp(`(^|[^\\d.,])(${VIEWER_NUMBER})\\s*(?:N|nghìn|triệu)?\\s+(người\\s+đang\\s+xem|đang\\s+xem\\s+trực\\s+tiếp|đang\\s+xem|người\\s+xem)\\b`, "i")
  ];

  let lastViewerText = extractViewerText(sessionStorage.getItem(CACHE_KEY)) || "";
  let lastUrl = location.href;
  let queuedScan = false;
  let lastDataScanAt = 0;
  let lastRemoteRefreshAt = 0;
  let remoteRefreshInFlight = false;
  let lastRemoteViewerText = "";
  let embeddedDataCache = [];

  function removeOldUi() {
    document.getElementById("ytlvc-live-viewer-badge")?.remove();
    document.getElementById("ytlvc-live-viewer-chat-pill")?.remove();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^•\s*/, "")
      .trim();
  }

  function isUsefulViewerText(text) {
    return Boolean(extractViewerText(text));
  }

  function extractViewerText(value) {
    const text = normalizeText(value);
    if (!text) return "";
    if (/views?|lượt xem/i.test(text) && !/watching|đang xem|người xem/i.test(text)) return "";

    for (const pattern of viewerPatterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const number = normalizeText(match[2]);
      const label = normalizeText(match[3]);
      const candidate = normalizeText(`${number} ${label}`);
      if (isPlausibleViewerText(candidate)) return candidate;
    }

    return "";
  }

  function isPlausibleViewerText(text) {
    const number = text.match(/^[\d.,]+/)?.[0] || "";
    const digits = number.replace(/\D/g, "");
    if (!digits || digits.length > 9) return false;

    if (/^\d{8,}$/.test(number)) return false;
    if (/[.,]/.test(number) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(number)) return false;

    return true;
  }

  function getBySelectors() {
    const selectors = [
      "yt-formatted-string",
      "#description-inline-expander",
      "#description-inner",
      "#description",
      "#info-text",
      "#info-strings",
      "#count .view-count",
      "ytd-watch-info-text",
      "yt-formatted-string#info"
    ];
    const roots = getPrimaryPageRoots();

    for (const root of roots) {
      for (const selector of selectors) {
        for (const node of root.querySelectorAll(selector)) {
          if (!isPrimaryVideoNode(node)) continue;
          const text = extractViewerText(node.textContent);
          if (text) return text;
        }
      }
    }

    return "";
  }

  function getPrimaryPageRoots() {
    return [
      document.querySelector("ytd-watch-metadata"),
      document.querySelector("#below"),
      document.querySelector("#primary-inner"),
      document.querySelector("#primary")
    ].filter(Boolean);
  }

  function getFromInitialData(sources = getEmbeddedYouTubeData()) {
    const candidates = [];
    for (const source of sources) {
      const primaryText = getFromPrimaryWatchData(source);
      if (primaryText) return primaryText;

      collectViewerTextCandidates(source, [], 0, candidates);
    }

    return pickBestViewerText(candidates);
  }

  function getFromPrimaryWatchData(source) {
    const contents = source?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
    if (!Array.isArray(contents)) return "";

    for (const item of contents) {
      const primaryRenderer = item?.videoPrimaryInfoRenderer || item?.videoSecondaryInfoRenderer;
      if (!primaryRenderer) continue;

      const candidates = [];
      collectViewerTextCandidates(primaryRenderer, ["currentVideoPrimaryColumn"], 0, candidates);
      const text = pickBestViewerText(candidates);
      if (text) return text;
    }

    return "";
  }

  function getPrimaryTextFromSources(sources) {
    for (const source of sources) {
      const text = getFromPrimaryWatchData(source);
      if (text) return text;
    }

    return "";
  }

  function getEmbeddedYouTubeData() {
    const now = Date.now();
    if (now - lastDataScanAt < 5000 && embeddedDataCache.length) {
      return embeddedDataCache;
    }

    lastDataScanAt = now;
    embeddedDataCache = [];

    for (const script of document.scripts) {
      const source = script.textContent || "";
      if (!source.includes("ytInitialData") && !source.includes("ytInitialPlayerResponse")) {
        continue;
      }

      for (const variableName of ["ytInitialData", "ytInitialPlayerResponse"]) {
        const data = parseAssignedObject(source, variableName);
        if (data) embeddedDataCache.push(data);
      }
    }

    return embeddedDataCache;
  }

  function getEmbeddedYouTubeDataFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sources = [];

    for (const script of doc.scripts) {
      const source = script.textContent || "";
      if (!source.includes("ytInitialData") && !source.includes("ytInitialPlayerResponse")) {
        continue;
      }

      for (const variableName of ["ytInitialData", "ytInitialPlayerResponse"]) {
        const data = parseAssignedObject(source, variableName);
        if (data) sources.push(data);
      }
    }

    return sources;
  }

  function getWatchUrlForRefresh() {
    const url = new URL(location.href);
    const videoId =
      url.searchParams.get("v") ||
      location.pathname.match(/^\/live\/([^/?#]+)/)?.[1];

    if (videoId) {
      const watchUrl = new URL("/watch", location.origin);
      watchUrl.searchParams.set("v", videoId);
      watchUrl.searchParams.set("ytlvc_refresh", String(Date.now()));
      return watchUrl.href;
    }

    url.searchParams.set("ytlvc_refresh", String(Date.now()));
    return url.href;
  }

  async function refreshFromNetwork({ force = false } = {}) {
    if (!IS_TOP_FRAME || remoteRefreshInFlight) return "";

    const now = Date.now();
    if (!force && now - lastRemoteRefreshAt < REMOTE_REFRESH_INTERVAL_MS) {
      return lastRemoteViewerText;
    }

    remoteRefreshInFlight = true;
    lastRemoteRefreshAt = now;
    setRefreshingState(true);

    try {
      const response = await fetch(getWatchUrlForRefresh(), {
        cache: "no-store",
        credentials: "include"
      });

      if (!response.ok) return "";

      const html = await response.text();
      const text = getPrimaryTextFromSources(getEmbeddedYouTubeDataFromHtml(html));
      if (text) {
        lastRemoteViewerText = text;
        lastViewerText = text;
        sessionStorage.setItem(CACHE_KEY, text);
        updateUI(text);
      }

      return text;
    } catch {
      return "";
    } finally {
      remoteRefreshInFlight = false;
      setRefreshingState(false);
    }
  }

  function parseAssignedObject(source, variableName) {
    const marker = variableName;
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) return null;

    const braceStart = source.indexOf("{", markerIndex);
    if (braceStart === -1) return null;

    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = braceStart; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(source.slice(braceStart, index + 1));
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  function collectViewerTextCandidates(value, path, depth, candidates) {
    if (!value || depth > 12) return "";

    if (typeof value === "string") {
      const text = extractViewerText(value);
      if (text) {
        candidates.push({
          text,
          path: path.join(".")
        });
      }
      return "";
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        collectViewerTextCandidates(value[index], path.concat(String(index)), depth + 1, candidates);
      }
      return "";
    }

    if (typeof value === "object") {
      const prioritizedKeys = [
        "simpleText",
        "content",
        "accessibilityData",
        "runs",
        "viewCount",
        "watchingCount"
      ];

      for (const key of prioritizedKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          collectViewerTextCandidates(value[key], path.concat(key), depth + 1, candidates);
        }
      }

      for (const key of Object.keys(value)) {
        if (prioritizedKeys.includes(key)) continue;
        collectViewerTextCandidates(value[key], path.concat(key), depth + 1, candidates);
      }
    }

    return "";
  }

  function pickBestViewerText(candidates) {
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreViewerCandidate(candidate.path)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.text || "";
  }

  function scoreViewerCandidate(path) {
    let score = 0;

    if (/currentVideoPrimaryColumn/i.test(path)) {
      score += 250;
    }

    if (/videoPrimaryInfoRenderer|videoViewCountRenderer|videoDescriptionHeaderRenderer/i.test(path)) {
      score += 100;
    }

    if (/watchMetadata|watchNext|primaryInfo|aboveTheFold|description/i.test(path)) {
      score += 40;
    }

    if (/compactVideoRenderer|gridVideoRenderer|richItemRenderer|reelItemRenderer|playlistVideoRenderer|shelfRenderer|secondaryResults|related/i.test(path)) {
      score -= 200;
    }

    if (/liveChat|engagementPanel/i.test(path)) {
      score -= 30;
    }

    return score;
  }

  function getFromVisiblePageText() {
    const roots = getPrimaryPageRoots();

    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!isPrimaryVideoNode(node.parentElement)) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !/watching|đang xem|người xem/i.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let current = walker.nextNode();
      while (current) {
        const text = extractViewerText(current.nodeValue);
        if (text) return text;
        current = walker.nextNode();
      }
    }

    return "";
  }

  function getViewerText() {
    const pageText = getBySelectors() || getFromVisiblePageText();
    if (pageText) return pageText;

    if (lastRemoteViewerText && Date.now() - lastRemoteRefreshAt < REMOTE_CACHE_TTL_MS) {
      return lastRemoteViewerText;
    }

    return getFromInitialData();
  }

  function isExtensionNode(node) {
    return Boolean(node?.closest?.(`#${PLAYER_BADGE_ID}`));
  }

  function isPrimaryVideoNode(node) {
    if (!node || isExtensionNode(node)) return false;
    if (node.closest?.("#secondary, ytd-watch-next-secondary-results-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer")) {
      return false;
    }

    return Boolean(node.closest?.("ytd-watch-metadata, #below, #primary-inner, #primary"));
  }

  function setRefreshingState(isRefreshing) {
    document
      .querySelectorAll(".ytlvc-refresh-button")
      .forEach((button) => button.classList.toggle("is-refreshing", isRefreshing));
  }

  function ensurePlayerBadge() {
    let badge = document.getElementById(PLAYER_BADGE_ID);
    const player = document.querySelector("#movie_player");
    if (!player) return badge;

    if (!badge) {
      badge = document.createElement("div");
      badge.id = PLAYER_BADGE_ID;
      badge.className = "ytlvc-player-badge";
      badge.title = "Số người đang xem live";

      const text = document.createElement("span");
      text.className = "ytlvc-player-badge-text";
      badge.append(text);

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "ytlvc-refresh-button";
      refresh.title = "Cập nhật số mới nhất";
      refresh.textContent = "↻";
      refresh.addEventListener("click", (event) => {
        event.stopPropagation();
        refreshFromNetwork({ force: true });
      });
      badge.append(refresh);

      player.append(badge);
    } else if (badge.parentElement !== player) {
      player.append(badge);
    }

    return badge;
  }

  function updateUI(text) {
    if (IS_TOP_FRAME) {
      const playerBadge = ensurePlayerBadge();
      if (playerBadge) {
        const playerBadgeText = playerBadge.querySelector(".ytlvc-player-badge-text");
        if (playerBadgeText) {
          playerBadgeText.textContent = text || "Đang tìm số người xem...";
        }
      }
    }
  }

  function tick() {
    removeOldUi();

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastViewerText = "";
    }

    const nextText = getViewerText();
    if (nextText && nextText !== lastViewerText) {
      lastViewerText = nextText;
      sessionStorage.setItem(CACHE_KEY, nextText);
    }

    updateUI(lastViewerText);

    if (IS_TOP_FRAME) {
      refreshFromNetwork();
    }
  }

  function scheduleTick() {
    if (queuedScan) return;
    queuedScan = true;
    window.setTimeout(() => {
      queuedScan = false;
      tick();
    }, 500);
  }

  tick();
  setInterval(tick, SCAN_INTERVAL_MS);

  new MutationObserver(scheduleTick).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
})();
