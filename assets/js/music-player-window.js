(function() {
  "use strict";
  function i18n() {
    return window.wp?.i18n;
  }
  function __(text, domain) {
    const api = i18n();
    return api?.__ ? api.__(text, domain) : text;
  }
  function trackedFetch(input, init, opts) {
    const helper = window.wp?.os?.fetch;
    if (helper) {
      return helper(input, init, opts);
    }
    return window.fetch(input, init);
  }
  const SOURCE = "desktop-mode/music-player";
  function config() {
    const cfg = window.desktopModeMusicPlayerConfig;
    if (!cfg) {
      throw new Error(
        "desktopModeMusicPlayerConfig is missing — config blob did not reach the page. See docs/examples/window-with-config.md."
      );
    }
    return cfg;
  }
  async function request(path, init = {}) {
    const cfg = config();
    const response = await trackedFetch(
      `${cfg.restBase}${path}`,
      {
        ...init,
        credentials: "same-origin",
        headers: {
          "X-WP-Nonce": cfg.restNonce,
          Accept: "application/json",
          ...init.body ? { "Content-Type": "application/json" } : {},
          ...init.headers ?? {}
        }
      },
      { source: SOURCE, windowId: "desktop-mode-music-player" }
    );
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const json = await response.json();
        if (json && typeof json.message === "string") {
          message = json.message;
        }
      } catch {
      }
      throw new Error(message);
    }
    return await response.json();
  }
  function fetchState() {
    return request("/state");
  }
  function fetchToken() {
    return request("/token");
  }
  function fetchNowPlaying() {
    return request("/now-playing");
  }
  function play(deviceId) {
    return request("/play", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  function pause(deviceId) {
    return request("/pause", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  function next(deviceId) {
    return request("/next", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  function previous(deviceId) {
    return request("/previous", {
      method: "POST",
      body: JSON.stringify({})
    });
  }
  function transfer(deviceId, playNow) {
    return request("/transfer", {
      method: "POST",
      body: JSON.stringify({ deviceId, play: playNow })
    });
  }
  function setShuffle(state, deviceId) {
    return request("/shuffle", {
      method: "POST",
      body: JSON.stringify({ state, ...deviceId ? { deviceId } : {} })
    });
  }
  function setRepeat(state, deviceId) {
    return request("/repeat", {
      method: "POST",
      body: JSON.stringify({ state, ...deviceId ? { deviceId } : {} })
    });
  }
  function seek(positionMs, deviceId) {
    return request("/seek", {
      method: "POST",
      body: JSON.stringify({
        positionMs: Math.max(0, Math.round(positionMs)),
        ...deviceId ? { deviceId } : {}
      })
    });
  }
  function setVolume(volumePercent, deviceId) {
    return request("/volume", {
      method: "POST",
      body: JSON.stringify({
        volumePercent: Math.max(0, Math.min(100, Math.round(volumePercent))),
        ...deviceId ? { deviceId } : {}
      })
    });
  }
  function fetchBrowse(section, cursor) {
    const path = cursor ? `/${section}?cursor=${encodeURIComponent(cursor)}` : `/${section}`;
    return request(path);
  }
  function fetchSearch(query, cursor) {
    const c = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return request(
      `/search?q=${encodeURIComponent(query)}${c}`
    );
  }
  function playUri(item, deviceId) {
    const body = deviceId ? { deviceId } : {};
    if (item.isContext) {
      body.contextUri = item.uri;
    } else {
      body.uris = [item.uri];
    }
    return request("/play", { method: "POST", body: JSON.stringify(body) });
  }
  const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
  let sdkPromise = null;
  function loadSdk() {
    if (sdkPromise) {
      return sdkPromise;
    }
    sdkPromise = new Promise((resolve, reject) => {
      if (window.Spotify) {
        resolve();
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const existing = document.querySelector(
        `script[src="${SDK_SRC}"]`
      );
      if (existing) {
        return;
      }
      const script = document.createElement("script");
      script.src = SDK_SRC;
      script.async = true;
      script.addEventListener(
        "error",
        () => reject(new Error("Failed to load the Spotify Web Playback SDK."))
      );
      document.head.appendChild(script);
    });
    return sdkPromise;
  }
  async function createPlaybackDevice(deviceName, handlers = {}) {
    await loadSdk();
    const Spotify = window.Spotify;
    if (!Spotify) {
      throw new Error("Spotify Web Playback SDK is unavailable.");
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const player = new Spotify.Player({
        name: deviceName,
        volume: 0.8,
        getOAuthToken: (cb) => {
          fetchToken().then(({ accessToken }) => cb(accessToken)).catch(() => {
            if (!settled) {
              settled = true;
              reject(new Error("Could not obtain a Spotify access token."));
            }
          });
        }
      });
      player.addListener("ready", (payload) => {
        const { device_id: deviceId } = payload;
        try {
          void player.activateElement?.();
        } catch {
        }
        if (!settled) {
          settled = true;
          resolve({ player, deviceId });
        }
      });
      player.addListener("player_state_changed", (payload) => {
        handlers.onStateChange?.(
          payload ?? null
        );
      });
      for (const errorEvent of [
        "initialization_error",
        "authentication_error",
        "account_error",
        "playback_error"
      ]) {
        player.addListener(errorEvent, (payload) => {
          const { message } = payload;
          handlers.onError?.(message);
          if (!settled && errorEvent !== "playback_error") {
            settled = true;
            reject(new Error(message));
          }
        });
      }
      player.connect().catch(() => {
        if (!settled) {
          settled = true;
          reject(new Error("The Spotify player failed to connect."));
        }
      });
    });
  }
  function holder() {
    const w = window;
    if (!w.__desktopModeMusicPlayerDevice) {
      w.__desktopModeMusicPlayerDevice = {
        device: null,
        accountId: "",
        creating: null
      };
    }
    return w.__desktopModeMusicPlayerDevice;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function ensureSharedDevice(accountId, onError) {
    const shared = holder();
    if (shared.device && shared.accountId === accountId) {
      return shared.device;
    }
    if (shared.creating) {
      return shared.creating;
    }
    if (shared.device && shared.accountId !== accountId) {
      try {
        shared.device.player.disconnect();
      } catch {
      }
      shared.device = null;
      await sleep(1200);
    }
    shared.creating = createPlaybackDevice(
      __("Desktop Mode", "deskbeat-for-desktop-mode"),
      { onError }
    ).then((dev) => {
      shared.device = dev;
      shared.accountId = accountId;
      shared.creating = null;
      return dev;
    }).catch((err) => {
      shared.creating = null;
      throw err;
    });
    return shared.creating;
  }
  async function transferToSharedDevice(deviceId) {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await transfer(deviceId, true);
        return;
      } catch (err) {
        lastError = err;
        await sleep(600);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Could not transfer playback to this device.");
  }
  const SECTIONS = [
    { id: "queue", label: __("Queue", "deskbeat-for-desktop-mode") },
    { id: "library", label: __("Liked", "deskbeat-for-desktop-mode") },
    { id: "top", label: __("Top", "deskbeat-for-desktop-mode") },
    { id: "recently-played", label: __("Recent", "deskbeat-for-desktop-mode") },
    { id: "playlists", label: __("Playlists", "deskbeat-for-desktop-mode") },
    { id: "search", label: __("Search", "deskbeat-for-desktop-mode") }
  ];
  const SCROLL_THRESHOLD_PX = 48;
  const SEARCH_DEBOUNCE_MS = 350;
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== void 0) {
      element.textContent = text;
    }
    return element;
  }
  function renderWidgetBrowse(container, deps) {
    container.replaceChildren();
    container.classList.add("desktop-mode-music-widget__browse");
    const nav = document.createElement("select");
    nav.className = "desktop-mode-music-widget__nav-select";
    nav.setAttribute(
      "aria-label",
      __("Browse section", "deskbeat-for-desktop-mode")
    );
    for (const section of SECTIONS) {
      const opt = document.createElement("option");
      opt.value = section.id;
      opt.textContent = section.label;
      nav.appendChild(opt);
    }
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "desktop-mode-music-widget__search";
    searchInput.placeholder = __("Search songs or artists…", "deskbeat-for-desktop-mode");
    searchInput.hidden = true;
    const list = node("div", "desktop-mode-music-widget__browse-list");
    container.append(nav, searchInput, list);
    let active = "queue";
    let cursor = null;
    let searchQuery = "";
    let loading = false;
    let epoch = 0;
    let searchTimer = null;
    function buildRow(item) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "desktop-mode-music-widget__row";
      row.title = item.name;
      const thumb = node("span", "desktop-mode-music-widget__row-thumb");
      if (item.image) {
        const img = document.createElement("img");
        img.src = item.image;
        img.alt = "";
        thumb.appendChild(img);
      }
      const meta = node("span", "desktop-mode-music-widget__row-meta");
      meta.appendChild(
        node("span", "desktop-mode-music-widget__row-name", item.name)
      );
      if (item.subtitle) {
        meta.appendChild(
          node("span", "desktop-mode-music-widget__row-subtitle", item.subtitle)
        );
      }
      row.append(thumb, meta);
      row.addEventListener("click", () => {
        deps.playItem(item).then(() => {
          if (deps.queueAfterPlay) {
            setTimeout(() => setActive("queue"), 400);
          }
        }).catch((err) => deps.toast(err.message, "error"));
      });
      return row;
    }
    function appendRows(items) {
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        fragment.appendChild(buildRow(item));
      }
      list.appendChild(fragment);
    }
    function showEmpty(message) {
      list.replaceChildren(
        node("p", "desktop-mode-music-widget__browse-empty", message)
      );
    }
    function loadPage(initial) {
      if (!initial && loading) {
        return;
      }
      loading = true;
      const myEpoch = epoch;
      if (initial) {
        list.replaceChildren(
          node(
            "p",
            "desktop-mode-music-widget__browse-empty",
            __("Loading…", "deskbeat-for-desktop-mode")
          )
        );
      }
      const fetcher = active === "search" ? fetchSearch(searchQuery, initial ? void 0 : cursor ?? void 0) : fetchBrowse(active, initial ? void 0 : cursor ?? void 0);
      fetcher.then((page) => {
        if (myEpoch !== epoch) {
          return;
        }
        if (initial) {
          list.replaceChildren();
          if (page.items.length === 0) {
            showEmpty(
              active === "search" ? __("No results.", "deskbeat-for-desktop-mode") : __("Nothing here yet.", "deskbeat-for-desktop-mode")
            );
          }
        }
        appendRows(page.items);
        cursor = page.next;
      }).catch((err) => {
        if (myEpoch !== epoch) {
          return;
        }
        if (initial) {
          showEmpty(
            __("Could not load this list.", "deskbeat-for-desktop-mode") + " " + err.message
          );
        } else {
          deps.toast(err.message, "error");
        }
      }).finally(() => {
        loading = false;
      });
    }
    list.addEventListener("scroll", () => {
      if (!loading && cursor !== null && list.scrollTop + list.clientHeight >= list.scrollHeight - SCROLL_THRESHOLD_PX) {
        loadPage(false);
      }
    });
    function runSearch(query) {
      epoch += 1;
      cursor = null;
      searchQuery = query.trim();
      if (searchQuery === "") {
        showEmpty(__("Type to search songs and artists.", "deskbeat-for-desktop-mode"));
        return;
      }
      loadPage(true);
    }
    searchInput.addEventListener("input", () => {
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
      }
      const value = searchInput.value;
      searchTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
    });
    function setActive(section) {
      active = section;
      cursor = null;
      epoch += 1;
      nav.value = section;
      const isSearch = section === "search";
      searchInput.hidden = !isSearch;
      if (isSearch) {
        runSearch(searchInput.value);
      } else {
        loadPage(true);
      }
    }
    nav.addEventListener("change", () => setActive(nav.value));
    setActive(active);
  }
  const WINDOW_ID = "desktop-mode-music-player";
  function os() {
    return window.wp?.os;
  }
  function toast(message, type = "success") {
    os()?.showToast?.({ message, type });
  }
  function bootstrapConfig() {
    const w = window;
    if (w.desktopModeMusicPlayerConfig) {
      return;
    }
    const fromGetter = os()?.getWindowConfig?.(WINDOW_ID);
    const cfg = fromGetter ?? w.openStationWindowConfig?.[WINDOW_ID];
    if (cfg) {
      w.desktopModeMusicPlayerConfig = cfg;
    }
  }
  function el(tag, className, text) {
    const node2 = document.createElement(tag);
    if (className) {
      node2.className = className;
    }
    if (text !== void 0) {
      node2.textContent = text;
    }
    return node2;
  }
  function iconButton(dashicon, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deskbeat-player__btn";
    button.title = label;
    button.setAttribute("aria-label", label);
    const icon = el("span", `dashicons ${dashicon}`);
    button.appendChild(icon);
    return button;
  }
  function isNoDeviceError(err) {
    return /no active device|device not found/i.test(err.message);
  }
  function handleControlError(err) {
    if (isNoDeviceError(err)) {
      toast(
        __("Nothing is playing — press play to start.", "deskbeat-for-desktop-mode"),
        "error"
      );
      return;
    }
    toast(err.message, "error");
  }
  function formatTime(ms) {
    const total = Math.max(0, Math.round(ms / 1e3));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const POLL_MS = 5e3;
  function renderPlayer(body) {
    bootstrapConfig();
    body.replaceChildren();
    body.classList.add("deskbeat-player");
    let pollTimer = null;
    let tickTimer = null;
    let destroyed = false;
    let isPremium = false;
    let accountId = "";
    let currentDeviceId = "";
    let isPlaying = false;
    let hasTrack = false;
    let shuffleOn = false;
    let repeatMode = "off";
    let durationMs = 0;
    let progressMs = 0;
    let progressAt = 0;
    let suppressVolumeUntil = 0;
    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    let artImg;
    let artBox;
    let trackEl;
    let artistEl;
    let playIcon;
    let shuffleBtn;
    let repeatBtn;
    let seekFill;
    let timeCurEl;
    let timeDurEl;
    let volumeInput;
    function paintProgress() {
      const effective = isPlaying && durationMs > 0 ? Math.min(durationMs, progressMs + (Date.now() - progressAt)) : progressMs;
      const pct = durationMs > 0 ? Math.min(100, effective / durationMs * 100) : 0;
      seekFill.style.width = `${pct}%`;
      timeCurEl.textContent = formatTime(effective);
      timeDurEl.textContent = durationMs > 0 ? formatTime(durationMs) : "0:00";
    }
    async function playItem(item) {
      if (isPremium) {
        const dev = await ensureSharedDevice(accountId, (m) => toast(m, "error"));
        await playUri(item, dev.deviceId);
      } else {
        await playUri(item);
      }
      toast(__("Playing…", "deskbeat-for-desktop-mode"));
      quickRefresh();
    }
    function refresh() {
      return fetchNowPlaying().then((np) => {
        if (!destroyed) {
          paint(np);
        }
      }).catch(() => {
      });
    }
    function quickRefresh() {
      void refresh();
      for (const ms of [250, 800, 1600]) {
        setTimeout(() => {
          if (!destroyed) {
            void refresh();
          }
        }, ms);
      }
    }
    const run = (fn) => () => {
      fn().then(() => quickRefresh()).catch(handleControlError);
    };
    function buildPlayer() {
      body.replaceChildren();
      const inner = el("div", "deskbeat-player__inner");
      const stage = el("div", "deskbeat-player__stage");
      artBox = el("div", "deskbeat-player__art");
      artImg = el("img");
      artImg.alt = "";
      artBox.appendChild(artImg);
      stage.appendChild(artBox);
      const meta = el("div", "deskbeat-player__meta");
      trackEl = el(
        "div",
        "deskbeat-player__track",
        __("Nothing playing", "deskbeat-for-desktop-mode")
      );
      artistEl = el("div", "deskbeat-player__artist");
      meta.append(trackEl, artistEl);
      stage.appendChild(meta);
      inner.appendChild(stage);
      const seekRow = el("div", "deskbeat-player__seek-row");
      timeCurEl = el("span", "deskbeat-player__time", "0:00");
      timeDurEl = el("span", "deskbeat-player__time", "0:00");
      const seekBar = el("div", "deskbeat-player__seek");
      seekBar.setAttribute("role", "slider");
      seekBar.setAttribute("aria-label", __("Seek", "deskbeat-for-desktop-mode"));
      seekFill = el("div", "deskbeat-player__seek-fill");
      seekBar.appendChild(seekFill);
      seekBar.addEventListener("click", (e) => {
        if (durationMs <= 0) {
          return;
        }
        const rect = seekBar.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const positionMs = Math.round(pct * durationMs);
        progressMs = positionMs;
        progressAt = Date.now();
        paintProgress();
        seek(positionMs, currentDeviceId || void 0).then(() => quickRefresh()).catch(handleControlError);
      });
      seekRow.append(timeCurEl, seekBar, timeDurEl);
      inner.appendChild(seekRow);
      const controls = el("div", "deskbeat-player__controls");
      shuffleBtn = iconButton(
        "dashicons-randomize",
        __("Shuffle", "deskbeat-for-desktop-mode")
      );
      const prevBtn = iconButton(
        "dashicons-controls-back",
        __("Previous", "deskbeat-for-desktop-mode")
      );
      const playBtn = iconButton(
        "dashicons-controls-play",
        __("Play/Pause", "deskbeat-for-desktop-mode")
      );
      playBtn.classList.add("is-primary");
      playIcon = playBtn.querySelector(".dashicons");
      const nextBtn = iconButton(
        "dashicons-controls-forward",
        __("Next", "deskbeat-for-desktop-mode")
      );
      repeatBtn = iconButton(
        "dashicons-controls-repeat",
        __("Repeat", "deskbeat-for-desktop-mode")
      );
      shuffleBtn.addEventListener(
        "click",
        run(() => setShuffle(!shuffleOn, currentDeviceId || void 0))
      );
      repeatBtn.addEventListener(
        "click",
        run(() => {
          const nextMode = repeatMode === "off" ? "context" : repeatMode === "context" ? "track" : "off";
          return setRepeat(nextMode, currentDeviceId || void 0);
        })
      );
      prevBtn.addEventListener("click", run(() => previous()));
      nextBtn.addEventListener("click", run(() => next()));
      playBtn.addEventListener("click", () => {
        if (isPlaying) {
          pause().then(() => quickRefresh()).catch(handleControlError);
          return;
        }
        if (hasTrack) {
          play().then(() => quickRefresh()).catch(handleControlError);
          return;
        }
        if (isPremium) {
          ensureSharedDevice(accountId, (m) => toast(m, "error")).then((dev) => transferToSharedDevice(dev.deviceId)).then(() => quickRefresh()).catch(handleControlError);
          return;
        }
        toast(
          __(
            "Start playback in the Spotify app first — a free account can’t play in the browser.",
            "deskbeat-for-desktop-mode"
          ),
          "error"
        );
      });
      controls.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);
      inner.appendChild(controls);
      const volumeRow = el("div", "deskbeat-player__volume-row");
      volumeRow.appendChild(el("span", "dashicons dashicons-controls-volumeon"));
      volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "100";
      volumeInput.step = "1";
      volumeInput.value = "100";
      volumeInput.className = "deskbeat-player__volume";
      let volumeTimer = null;
      volumeInput.addEventListener("input", () => {
        const value = Number(volumeInput.value);
        suppressVolumeUntil = Date.now() + 2e3;
        if (volumeTimer !== null) {
          clearTimeout(volumeTimer);
        }
        volumeTimer = setTimeout(() => {
          setVolume(value, currentDeviceId || void 0).catch(
            (err) => toast(err.message, "error")
          );
        }, 250);
      });
      volumeRow.appendChild(volumeInput);
      inner.appendChild(volumeRow);
      const browse = el("div", "deskbeat-player__browse");
      inner.appendChild(browse);
      renderWidgetBrowse(browse, { playItem, toast, queueAfterPlay: true });
      body.appendChild(inner);
    }
    function paint(np) {
      currentDeviceId = np.device?.id ?? "";
      shuffleOn = Boolean(np.shuffle_state);
      shuffleBtn.classList.toggle("is-active", shuffleOn);
      repeatMode = np.repeat_state ?? "off";
      repeatBtn.classList.toggle("is-active", repeatMode !== "off");
      repeatBtn.classList.toggle("is-one", repeatMode === "track");
      const repeatLabel = repeatMode === "track" ? __("Repeat one", "deskbeat-for-desktop-mode") : repeatMode === "context" ? __("Repeat all", "deskbeat-for-desktop-mode") : __("Repeat", "deskbeat-for-desktop-mode");
      repeatBtn.title = repeatLabel;
      repeatBtn.setAttribute("aria-label", repeatLabel);
      const dev = np.device;
      if (dev && typeof dev.volume_percent === "number" && dev.supports_volume !== false && Date.now() >= suppressVolumeUntil) {
        volumeInput.value = String(dev.volume_percent);
      }
      const item = np.item ?? null;
      if (!item) {
        trackEl.textContent = __("Nothing playing", "deskbeat-for-desktop-mode");
        artistEl.textContent = "";
        artImg.removeAttribute("src");
        artBox.classList.add("is-empty");
        isPlaying = false;
        hasTrack = false;
        playIcon.className = "dashicons dashicons-controls-play";
        durationMs = 0;
        progressMs = 0;
        paintProgress();
        return;
      }
      hasTrack = true;
      trackEl.textContent = item.name;
      artistEl.textContent = (item.artists ?? []).map((a) => a.name).filter(Boolean).join(", ");
      const image = item.album?.images?.[0]?.url;
      if (image) {
        artImg.src = image;
        artBox.classList.remove("is-empty");
      } else {
        artImg.removeAttribute("src");
        artBox.classList.add("is-empty");
      }
      isPlaying = Boolean(np.is_playing);
      playIcon.className = isPlaying ? "dashicons dashicons-controls-pause" : "dashicons dashicons-controls-play";
      durationMs = item.duration_ms || 0;
      progressMs = np.progress_ms ?? 0;
      progressAt = Date.now();
      paintProgress();
    }
    function renderDisconnected(canConfigure, configured) {
      body.replaceChildren();
      const wrap = el("div", "deskbeat-player__gate");
      if (!configured) {
        wrap.appendChild(
          el(
            "p",
            "deskbeat-player__hint",
            canConfigure ? __(
              "Add your Spotify app credentials in the Music widget to get started.",
              "deskbeat-for-desktop-mode"
            ) : __(
              "The music player is not set up yet. Ask an administrator.",
              "deskbeat-for-desktop-mode"
            )
          )
        );
        body.appendChild(wrap);
        return;
      }
      wrap.appendChild(
        el(
          "p",
          "deskbeat-player__hint",
          __("Connect Spotify to control playback here.", "deskbeat-for-desktop-mode")
        )
      );
      const connectBtn = el(
        "button",
        "deskbeat-player__btn deskbeat-player__btn--text is-primary",
        __("Connect Spotify", "deskbeat-for-desktop-mode")
      );
      connectBtn.type = "button";
      connectBtn.addEventListener("click", () => {
        const start = os()?.startOAuth;
        const cfg = window.desktopModeMusicPlayerConfig;
        if (!start || !cfg) {
          toast(__("OAuth is unavailable here.", "deskbeat-for-desktop-mode"), "error");
          return;
        }
        start(cfg.service).then(() => init()).catch((err) => toast(err.message, "error"));
      });
      wrap.appendChild(connectBtn);
      body.appendChild(wrap);
    }
    function init() {
      stopPolling();
      fetchState().then((state) => {
        if (destroyed) {
          return;
        }
        if (!state.connected) {
          renderDisconnected(state.canConfigure, state.configured);
          return;
        }
        isPremium = state.profile?.isPremium ?? false;
        accountId = state.profile?.id ?? "";
        buildPlayer();
        void refresh();
        pollTimer = setInterval(() => void refresh(), POLL_MS);
      }).catch(() => {
        if (!destroyed) {
          renderDisconnected(false, true);
        }
      });
    }
    tickTimer = setInterval(() => {
      if (!destroyed && hasTrack) {
        paintProgress();
      }
    }, 1e3);
    init();
    const observer = new MutationObserver(() => {
      if (!body.isConnected) {
        destroyed = true;
        stopPolling();
        if (tickTimer !== null) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        observer.disconnect();
      }
    });
    if (body.parentNode) {
      observer.observe(body.parentNode, { childList: true });
    }
  }
  const win = window;
  const registry = win.openStationNativeWindows ?? (win.openStationNativeWindows = {});
  registry[WINDOW_ID] = renderPlayer;
})();
