/**
 * Companion overlay for the AnythingLLM embed widget.
 * Reads public SMB config and paints disclosure, hours, handoff, and lead capture
 * around the existing minified chat widget. Does not modify anythingllm-chat-widget.min.js.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    document.querySelector('script[src*="anythingllm-widget-smb.js"]') ||
    document.querySelector("script[data-embed-id][data-base-api-url]");
  if (!script) return;

  var embedId = script.getAttribute("data-embed-id");
  var baseApiUrl = script.getAttribute("data-base-api-url");
  if ((!embedId || !baseApiUrl) && script !== document.currentScript) {
    var widgetScript = document.querySelector(
      'script[data-embed-id][src*="anythingllm-chat-widget"]'
    );
    if (widgetScript) {
      embedId = embedId || widgetScript.getAttribute("data-embed-id");
      baseApiUrl =
        baseApiUrl || widgetScript.getAttribute("data-base-api-url");
    }
  }
  if (!embedId || !baseApiUrl) return;

  var SESSION_KEY = "allm_" + embedId + "_session_id";
  var LEAD_KEY = "allm_" + embedId + "_lead_submitted";
  var ROOT_ID = "anythingllm-smb-root";
  var DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var config = null;
  var nodes = null;
  var lastFingerprint = "";
  var chatInert = false;

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function sessionId() {
    var existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    var id = uuid();
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  }

  function apiUrl(path) {
    return String(baseApiUrl).replace(/\/$/, "") + "/" + embedId + path;
  }

  function weekdayKey(date, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: timeZone || "UTC",
      }).formatToParts(date);
      var weekday = parts.find(function (part) {
        return part.type === "weekday";
      });
      var name = (weekday && weekday.value ? weekday.value : "")
        .slice(0, 3)
        .toLowerCase();
      return DAY_KEYS.indexOf(name) === -1 ? null : name;
    } catch (_e) {
      return DAY_KEYS[date.getUTCDay()];
    }
  }

  function clockMinutes(date, timeZone) {
    try {
      var parts = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: timeZone || "UTC",
      }).formatToParts(date);
      var hour = Number(
        (
          parts.find(function (part) {
            return part.type === "hour";
          }) || {}
        ).value
      );
      var minute = Number(
        (
          parts.find(function (part) {
            return part.type === "minute";
          }) || {}
        ).value
      );
      if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
      return hour * 60 + minute;
    } catch (_e) {
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    }
  }

  function parseHHMM(value) {
    var match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function hoursStatus(hours) {
    if (!hours || !Array.isArray(hours.days) || !hours.days.length) return null;
    var tz = hours.timezone || "UTC";
    var now = new Date();
    var day = weekdayKey(now, tz);
    var nowMin = clockMinutes(now, tz);
    if (day == null || nowMin == null) return { open: false };
    var today = hours.days.find(function (row) {
      return row && row.day === day;
    });
    if (!today) return { open: false };
    var open = parseHHMM(today.open);
    var close = parseHHMM(today.close);
    if (open == null || close == null) return { open: false };
    return { open: nowMin >= open && nowMin < close };
  }

  function isVisibleBox(el) {
    if (!el) return false;
    var container =
      document.getElementById("anything-llm-embed-chat-container") || el;
    if (window.getComputedStyle(container).display === "none") return false;
    if (window.getComputedStyle(el).display === "none") return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function injectStyles() {
    if (document.getElementById("anythingllm-smb-styles")) return;
    var style = document.createElement("style");
    style.id = "anythingllm-smb-styles";
    style.textContent =
      "#anythingllm-smb-root{position:fixed;z-index:2147483000;pointer-events:none;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}" +
      "#anythingllm-smb-root *{box-sizing:border-box;}" +
      ".allm-smb-banner,.allm-smb-badge,.allm-smb-lead{pointer-events:auto;}" +
      ".allm-smb-banner{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:#111827;color:#f9fafb;border-radius:12px 12px 0 0;font-size:12px;line-height:1.3;box-shadow:0 4px 14px rgba(0,0,0,.25);}" +
      ".allm-smb-banner[hidden],.allm-smb-badge[hidden],.allm-smb-lead[hidden],.allm-smb-pill[hidden],.allm-smb-btn[hidden]{display:none !important;}" +
      ".allm-smb-copy{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}" +
      ".allm-smb-pill{display:inline-flex;align-items:center;border-radius:9999px;padding:2px 8px;font-size:10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;}" +
      ".allm-smb-pill.open{background:#065f46;color:#d1fae5;}" +
      ".allm-smb-pill.closed{background:#7f1d1d;color:#fee2e2;}" +
      ".allm-smb-btn{border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:600;padding:6px 10px;cursor:pointer;}" +
      ".allm-smb-btn:disabled{opacity:.6;cursor:not-allowed;}" +
      ".allm-smb-badge{position:absolute;right:0;bottom:72px;background:#111827;color:#f9fafb;border-radius:9999px;padding:4px 10px;font-size:11px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25);}" +
      ".allm-smb-lead{position:absolute;left:0;right:0;top:0;bottom:0;background:rgba(17,24,39,.92);color:#f9fafb;padding:20px 16px;display:flex;flex-direction:column;gap:10px;border-radius:16px;}" +
      ".allm-smb-lead h2{margin:0;font-size:16px;}" +
      ".allm-smb-lead p{margin:0;font-size:12px;color:#d1d5db;}" +
      ".allm-smb-lead label{display:flex;flex-direction:column;gap:4px;font-size:12px;}" +
      ".allm-smb-lead input{border:1px solid #374151;background:#1f2937;color:#f9fafb;border-radius:8px;padding:8px 10px;font-size:13px;}";
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function postJson(path, body) {
    return fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error("Request failed");
      return res.json().catch(function () {
        return { success: true };
      });
    });
  }

  function setChatInert(chat, shouldInert) {
    if (!chat) {
      chatInert = false;
      return;
    }
    if (shouldInert === chatInert && chat.hasAttribute("inert") === shouldInert)
      return;
    chatInert = shouldInert;
    if (shouldInert) {
      chat.setAttribute("inert", "");
      chat.style.pointerEvents = "none";
    } else {
      chat.removeAttribute("inert");
      chat.style.pointerEvents = "";
    }
  }

  function bindHandoff(button) {
    button.addEventListener("click", function () {
      button.disabled = true;
      postJson("/handoff", { session_id: sessionId() })
        .then(function () {
          button.textContent = "Request sent";
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = "Try again";
        });
    });
  }

  function bindLead(form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      var data = new FormData(form);
      postJson("/lead", {
        name: String(data.get("name") || "").trim() || null,
        email: String(data.get("email") || "").trim() || null,
        last_question: "",
        session_id: sessionId(),
      })
        .then(function () {
          window.sessionStorage.setItem(LEAD_KEY, "1");
          form.hidden = true;
          setChatInert(document.getElementById("anything-llm-chat"), false);
          lastFingerprint = "";
          tick();
        })
        .catch(function () {
          submit.disabled = false;
          submit.textContent = "Try again";
        });
    });
  }

  function buildUi() {
    if (nodes) return nodes;
    injectStyles();
    var host = document.getElementById(ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = ROOT_ID;
      document.body.appendChild(host);
    }

    var banner = el("div", "allm-smb-banner");
    var copy = el("div", "allm-smb-copy");
    var disclosure = el("span", null, "You are talking to AI");
    var pill = el("span", "allm-smb-pill");
    copy.appendChild(disclosure);
    copy.appendChild(pill);
    var handoffBtn = el("button", "allm-smb-btn", "Talk to a human");
    handoffBtn.type = "button";
    bindHandoff(handoffBtn);
    banner.appendChild(copy);
    banner.appendChild(handoffBtn);

    var badge = el("div", "allm-smb-badge");

    var lead = el("form", "allm-smb-lead");
    lead.appendChild(el("h2", null, "Before we start"));
    lead.appendChild(
      el("p", null, "Leave your details so we can follow up.")
    );
    var nameLabel = el("label", null, "Name");
    var nameInput = document.createElement("input");
    nameInput.name = "name";
    nameInput.type = "text";
    nameInput.autocomplete = "name";
    nameLabel.appendChild(nameInput);
    var emailLabel = el("label", null, "Email");
    var emailInput = document.createElement("input");
    emailInput.name = "email";
    emailInput.type = "email";
    emailInput.autocomplete = "email";
    emailInput.required = true;
    emailLabel.appendChild(emailInput);
    var continueBtn = el("button", "allm-smb-btn", "Continue to chat");
    continueBtn.type = "submit";
    lead.appendChild(nameLabel);
    lead.appendChild(emailLabel);
    lead.appendChild(continueBtn);
    bindLead(lead);

    host.appendChild(banner);
    host.appendChild(badge);
    host.appendChild(lead);

    nodes = {
      host: host,
      banner: banner,
      disclosure: disclosure,
      pill: pill,
      handoffBtn: handoffBtn,
      badge: badge,
      lead: lead,
    };
    return nodes;
  }

  function collapse(host) {
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
  }

  function snapshot() {
    var chat = document.getElementById("anything-llm-chat");
    var launcher = document.getElementById(
      "anything-llm-embed-chat-button-container"
    );
    var open = isVisibleBox(chat);
    var hours = hoursStatus(config && config.business_hours);
    var showLead =
      !!(config && config.lead_capture) &&
      !window.sessionStorage.getItem(LEAD_KEY);
    var target = open ? chat : launcher;
    var rect = target
      ? target.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    return {
      chat: chat,
      launcher: launcher,
      open: open,
      hours: hours,
      showDisclosure: !!(config && config.ai_disclosure),
      showHandoff: !!(config && config.show_handoff),
      showLead: showLead,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function fingerprint(state) {
    return [
      state.open ? "open" : "closed",
      state.left,
      state.top,
      state.width,
      state.height,
      state.hours ? (state.hours.open ? "1" : "0") : "x",
      state.showLead ? "1" : "0",
      state.showDisclosure ? "1" : "0",
      state.showHandoff ? "1" : "0",
    ].join(":");
  }

  function sync(state) {
    var ui = buildUi();
    var showBanner =
      state.open && (state.showDisclosure || state.hours || state.showHandoff);
    var showBadge = !state.open && !!state.launcher && !!state.hours;
    var showLead = state.open && state.showLead;

    ui.banner.hidden = !showBanner;
    ui.disclosure.hidden = !state.showDisclosure;
    ui.pill.hidden = !state.hours;
    ui.handoffBtn.hidden = !state.showHandoff;
    ui.lead.hidden = !showLead;
    ui.badge.hidden = !showBadge;

    if (state.hours) {
      ui.pill.className =
        "allm-smb-pill " + (state.hours.open ? "open" : "closed");
      ui.pill.textContent = state.hours.open ? "Open" : "Closed";
      ui.badge.textContent = state.hours.open ? "Open now" : "Closed";
    }

    if (state.open && state.chat && state.width > 0) {
      var bannerH = showBanner ? 40 : 0;
      ui.host.style.left = state.left + "px";
      ui.host.style.top = Math.max(state.top - bannerH, 8) + "px";
      ui.host.style.width = state.width + "px";
      ui.host.style.height = state.height + bannerH + "px";
      ui.lead.style.top = bannerH + "px";
    } else if (showBadge) {
      ui.host.style.left = state.left + "px";
      ui.host.style.top = state.top + "px";
      ui.host.style.width = Math.max(state.width, 88) + "px";
      ui.host.style.height = state.height + 80 + "px";
    } else {
      collapse(ui.host);
    }

    setChatInert(state.chat, showLead);
  }

  function tick() {
    if (!config) return;
    var state = snapshot();
    var next = fingerprint(state);
    if (next === lastFingerprint && nodes) {
      // React may remount the chat node; re-apply inert without rebuilding our form.
      setChatInert(state.chat, state.open && state.showLead);
      return;
    }
    lastFingerprint = next;
    sync(state);
  }

  function mutationIsOurs(mutation) {
    if (!nodes || !nodes.host) return false;
    var target = mutation.target;
    if (target === nodes.host || nodes.host.contains(target)) return true;
    if (mutation.type === "attributes" && target && target.id === "anything-llm-chat") {
      return mutation.attributeName === "inert" || mutation.attributeName === "style";
    }
    return false;
  }

  function watch() {
    var scheduled = null;
    function schedule() {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(function () {
        scheduled = null;
        tick();
      });
    }

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (!mutationIsOurs(mutations[i])) {
          schedule();
          return;
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    setInterval(schedule, 15000);

    document.addEventListener(
      "keydown",
      function (event) {
        if (!nodes || !nodes.lead || nodes.lead.hidden) return;
        var chat = document.getElementById("anything-llm-chat");
        if (chat && chat.contains(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  }

  fetch(apiUrl("/smb-config"))
    .then(function (res) {
      if (!res.ok) throw new Error("smb-config failed");
      return res.json();
    })
    .then(function (payload) {
      config = payload || {};
      tick();
      watch();
    })
    .catch(function () {
      // Fail closed: leave the core widget untouched if SMB extras cannot load.
    });
})();
