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
    const helper = window.wp?.desktop?.fetch;
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
  function saveSettings(clientId, clientSecret) {
    return request("/settings", {
      method: "POST",
      body: JSON.stringify({ clientId, clientSecret })
    });
  }
  function disconnect() {
    return request("/disconnect", { method: "POST" });
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
      __("Desktop Mode", "music-player-for-desktop-mode"),
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
  function pauseSharedDevice() {
    const shared = holder();
    if (shared.device) {
      try {
        void shared.device.player.pause();
      } catch {
      }
    }
  }
  const SECTIONS = [
    { id: "queue", label: __("Queue", "music-player-for-desktop-mode") },
    { id: "library", label: __("Liked", "music-player-for-desktop-mode") },
    { id: "top", label: __("Top", "music-player-for-desktop-mode") },
    { id: "recently-played", label: __("Recent", "music-player-for-desktop-mode") },
    { id: "playlists", label: __("Playlists", "music-player-for-desktop-mode") },
    { id: "search", label: __("Search", "music-player-for-desktop-mode") }
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
    const nav = node("div", "desktop-mode-music-widget__browse-nav");
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "desktop-mode-music-widget__search";
    searchInput.placeholder = __("Search songs or artists…", "music-player-for-desktop-mode");
    searchInput.hidden = true;
    const list = node("div", "desktop-mode-music-widget__browse-list");
    container.append(nav, searchInput, list);
    let active = "queue";
    let cursor = null;
    let searchQuery = "";
    let loading = false;
    let epoch = 0;
    let searchTimer = null;
    const chips = /* @__PURE__ */ new Map();
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
        deps.playItem(item).catch((err) => deps.toast(err.message, "error"));
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
            __("Loading…", "music-player-for-desktop-mode")
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
              active === "search" ? __("No results.", "music-player-for-desktop-mode") : __("Nothing here yet.", "music-player-for-desktop-mode")
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
            __("Could not load this list.", "music-player-for-desktop-mode") + " " + err.message
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
        showEmpty(__("Type to search songs and artists.", "music-player-for-desktop-mode"));
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
      for (const [id, chip] of chips) {
        chip.classList.toggle("is-active", id === section);
      }
      const isSearch = section === "search";
      searchInput.hidden = !isSearch;
      if (isSearch) {
        runSearch(searchInput.value);
      } else {
        loadPage(true);
      }
    }
    for (const section of SECTIONS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "desktop-mode-music-widget__chip";
      chip.classList.toggle("is-active", section.id === active);
      chip.textContent = section.label;
      chip.addEventListener("click", () => setActive(section.id));
      chips.set(section.id, chip);
      nav.appendChild(chip);
    }
    setActive(active);
  }
  const WIDGET_ID = "desktop-mode/music-player";
  const POLL_MS = 5e3;
  function toast(message, type = "success") {
    desktopApi()?.showToast?.({ message, type });
  }
  function desktopApi() {
    return window.wp?.desktop;
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
    button.className = "desktop-mode-music-widget__btn";
    button.title = label;
    button.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = `dashicons ${dashicon}`;
    button.appendChild(icon);
    return button;
  }
  function isNoDeviceError(err) {
    return /no active device|device not found/i.test(err.message);
  }
  function handleControlError(err) {
    if (isNoDeviceError(err)) {
      toast(__("Nothing is playing — press play to start.", "music-player-for-desktop-mode"));
      return;
    }
    toast(err.message, "error");
  }
  function mount(container) {
    container.classList.add("desktop-mode-music-widget");
    let timer = null;
    let destroyed = false;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    let isPremium = false;
    let accountId = "";
    let currentDeviceId = "";
    let suppressVolumeUntil = 0;
    function renderConnect(canConfigure, configured) {
      container.replaceChildren();
      const wrap = el("div", "desktop-mode-music-widget__connect");
      if (!configured) {
        if (!canConfigure) {
          wrap.appendChild(
            el(
              "p",
              "desktop-mode-music-widget__hint",
              __(
                "The music player is not set up yet. Ask an administrator.",
                "music-player-for-desktop-mode"
              )
            )
          );
          container.appendChild(wrap);
          return;
        }
        const cfg = config();
        wrap.appendChild(
          el(
            "p",
            "desktop-mode-music-widget__hint",
            __(
              "Create an app in the Spotify Developer Dashboard, then paste its Client ID and Secret.",
              "music-player-for-desktop-mode"
            )
          )
        );
        const redirect = el("div", "desktop-mode-music-widget__redirect");
        redirect.append(
          el(
            "span",
            "desktop-mode-music-widget__redirect-label",
            __("Redirect URI to register:", "music-player-for-desktop-mode")
          ),
          el("code", void 0, cfg.redirectUri)
        );
        wrap.appendChild(redirect);
        const dash = document.createElement("a");
        dash.href = cfg.dashboardUrl;
        dash.target = "_blank";
        dash.rel = "noreferrer";
        dash.className = "desktop-mode-music-widget__dashboard";
        dash.textContent = __("Open Spotify Dashboard ↗", "music-player-for-desktop-mode");
        wrap.appendChild(dash);
        const idInput = document.createElement("input");
        idInput.type = "text";
        idInput.className = "desktop-mode-music-widget__field";
        idInput.placeholder = __("Client ID", "music-player-for-desktop-mode");
        idInput.autocomplete = "off";
        const secretInput = document.createElement("input");
        secretInput.type = "password";
        secretInput.className = "desktop-mode-music-widget__field";
        secretInput.placeholder = __("Client Secret", "music-player-for-desktop-mode");
        secretInput.autocomplete = "off";
        wrap.append(idInput, secretInput);
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "desktop-mode-music-widget__btn desktop-mode-music-widget__btn--text is-primary";
        saveBtn.textContent = __("Save credentials", "music-player-for-desktop-mode");
        saveBtn.addEventListener("click", () => {
          const clientId = idInput.value.trim();
          const clientSecret = secretInput.value.trim();
          if (!clientId || !clientSecret) {
            toast(__("Enter both the Client ID and Secret.", "music-player-for-desktop-mode"), "error");
            return;
          }
          saveSettings(clientId, clientSecret).then(() => {
            toast(__("Spotify credentials saved.", "music-player-for-desktop-mode"));
            init();
          }).catch((err) => toast(err.message, "error"));
        });
        wrap.appendChild(saveBtn);
        container.appendChild(wrap);
        return;
      }
      wrap.appendChild(
        el(
          "p",
          "desktop-mode-music-widget__hint",
          __("Connect Spotify to see what you are playing.", "music-player-for-desktop-mode")
        )
      );
      const connectBtn = document.createElement("button");
      connectBtn.type = "button";
      connectBtn.className = "desktop-mode-music-widget__btn desktop-mode-music-widget__btn--text is-primary";
      connectBtn.textContent = __("Connect Spotify", "music-player-for-desktop-mode");
      connectBtn.addEventListener("click", () => {
        const start = desktopApi()?.startOAuth;
        if (!start) {
          toast(__("OAuth is unavailable here.", "music-player-for-desktop-mode"), "error");
          return;
        }
        start(config().service).then(() => {
          toast(__("Connected to Spotify.", "music-player-for-desktop-mode"));
          init();
        }).catch((err) => toast(err.message, "error"));
      });
      wrap.appendChild(connectBtn);
      container.appendChild(wrap);
    }
    let trackEl;
    let artistEl;
    let artImg;
    let artBox;
    let playIcon;
    let volumeBtn = null;
    let volumeWrap = null;
    let volumeInput = null;
    let isPlaying = false;
    let hasTrack = false;
    let built = false;
    function buildPlayer() {
      container.replaceChildren();
      built = true;
      const card = el("div", "desktop-mode-music-widget__card");
      artBox = el("div", "desktop-mode-music-widget__art");
      artImg = el("img");
      artImg.alt = "";
      artBox.appendChild(artImg);
      card.appendChild(artBox);
      const meta = el("div", "desktop-mode-music-widget__meta");
      trackEl = el(
        "div",
        "desktop-mode-music-widget__track",
        __("Nothing playing", "music-player-for-desktop-mode")
      );
      artistEl = el("div", "desktop-mode-music-widget__artist");
      meta.append(trackEl, artistEl);
      card.appendChild(meta);
      const browseBtn = iconButton(
        "dashicons-list-view",
        __("Browse your library", "music-player-for-desktop-mode")
      );
      browseBtn.classList.add("desktop-mode-music-widget__open");
      browseBtn.addEventListener("click", showBrowse);
      const disconnectBtn = iconButton(
        "dashicons-exit",
        __("Disconnect Spotify", "music-player-for-desktop-mode")
      );
      disconnectBtn.classList.add("desktop-mode-music-widget__open");
      disconnectBtn.addEventListener("click", () => {
        void (async () => {
          const ok = await (desktopApi()?.confirm?.({
            title: __("Disconnect Spotify?", "music-player-for-desktop-mode"),
            message: __(
              "The desktop will forget your Spotify connection. You can reconnect any time.",
              "music-player-for-desktop-mode"
            ),
            confirmLabel: __("Disconnect", "music-player-for-desktop-mode"),
            danger: true
          }) ?? Promise.resolve(true));
          if (!ok) {
            return;
          }
          stop();
          pauseSharedDevice();
          try {
            await disconnect();
          } catch (err) {
            toast(err.message, "error");
          }
          toast(__("Disconnected from Spotify.", "music-player-for-desktop-mode"));
          init();
        })();
      });
      card.append(browseBtn, disconnectBtn);
      container.appendChild(card);
      const controls = el("div", "desktop-mode-music-widget__controls");
      const prevBtn = iconButton(
        "dashicons-controls-back",
        __("Previous", "music-player-for-desktop-mode")
      );
      const playBtn = iconButton(
        "dashicons-controls-play",
        __("Play/Pause", "music-player-for-desktop-mode")
      );
      playBtn.classList.add("is-primary");
      playIcon = playBtn.querySelector(".dashicons");
      const nextBtn = iconButton(
        "dashicons-controls-forward",
        __("Next", "music-player-for-desktop-mode")
      );
      const run = (fn) => () => {
        fn().then(() => quickRefresh()).catch(handleControlError);
      };
      const volBtn = iconButton(
        "dashicons-controls-volumeon",
        __("Volume", "music-player-for-desktop-mode")
      );
      volumeBtn = volBtn;
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
            "music-player-for-desktop-mode"
          )
        );
      });
      controls.append(prevBtn, playBtn, nextBtn, volBtn);
      container.appendChild(controls);
      const vWrap = el("div", "desktop-mode-music-widget__volume-wrap");
      const vInput = document.createElement("input");
      vInput.type = "range";
      vInput.min = "0";
      vInput.max = "100";
      vInput.step = "1";
      vInput.value = "100";
      vInput.className = "desktop-mode-music-widget__volume";
      vWrap.appendChild(vInput);
      vWrap.hidden = true;
      container.appendChild(vWrap);
      volumeWrap = vWrap;
      volumeInput = vInput;
      volBtn.addEventListener("click", () => {
        vWrap.hidden = !vWrap.hidden;
        volBtn.classList.toggle("is-primary", !vWrap.hidden);
      });
      let volumeTimer = null;
      vInput.addEventListener("input", () => {
        const value = Number(vInput.value);
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
    }
    function paint(np) {
      currentDeviceId = np.device?.id ?? "";
      if (volumeBtn && volumeWrap && volumeInput) {
        const dev = np.device;
        if (dev && typeof dev.volume_percent === "number") {
          const supports = dev.supports_volume !== false;
          volumeBtn.hidden = !supports;
          if (!supports) {
            volumeWrap.hidden = true;
          } else if (Date.now() >= suppressVolumeUntil) {
            volumeInput.value = String(dev.volume_percent);
          }
        } else {
          volumeBtn.hidden = true;
          volumeWrap.hidden = true;
        }
      }
      const item = np.item ?? null;
      if (!item) {
        trackEl.textContent = __("Nothing playing", "music-player-for-desktop-mode");
        artistEl.textContent = "";
        artImg.removeAttribute("src");
        artBox.classList.add("is-empty");
        isPlaying = false;
        hasTrack = false;
        playIcon.className = "dashicons dashicons-controls-play";
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
    }
    function refresh() {
      return fetchNowPlaying().then((np) => {
        if (!destroyed && built) {
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
    function resumeNow() {
      buildPlayer();
      quickRefresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    }
    function showBrowse() {
      stop();
      container.replaceChildren();
      const header = el("div", "desktop-mode-music-widget__browse-header");
      const backBtn = iconButton(
        "dashicons-arrow-left-alt2",
        __("Back", "music-player-for-desktop-mode")
      );
      backBtn.addEventListener("click", resumeNow);
      header.append(
        backBtn,
        el(
          "span",
          "desktop-mode-music-widget__browse-title",
          __("Browse", "music-player-for-desktop-mode")
        )
      );
      const body = el("div", "desktop-mode-music-widget__browse-body");
      container.append(header, body);
      renderWidgetBrowse(body, { playItem, toast });
    }
    async function playItem(item) {
      if (isPremium) {
        const dev = await ensureSharedDevice(
          accountId,
          (m) => toast(m, "error")
        );
        await playUri(item, dev.deviceId);
      } else {
        await playUri(item);
      }
      toast(__("Playing…", "music-player-for-desktop-mode"));
      resumeNow();
    }
    function init() {
      stop();
      fetchState().then((state) => {
        if (destroyed) {
          return;
        }
        if (!state.connected) {
          renderConnect(state.canConfigure, state.configured);
          return;
        }
        isPremium = state.profile?.isPremium ?? false;
        accountId = state.profile?.id ?? "";
        buildPlayer();
        void refresh();
        timer = setInterval(() => void refresh(), POLL_MS);
      }).catch(() => {
        if (!destroyed) {
          renderConnect(false, true);
        }
      });
    }
    init();
    return () => {
      destroyed = true;
      stop();
    };
  }
  const widgets = window.desktopModeWidgets ?? (window.desktopModeWidgets = {});
  widgets[WIDGET_ID] = mount;
})();
