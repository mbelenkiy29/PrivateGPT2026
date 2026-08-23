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
  var root = null;

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
        (parts.find(function (part) {
          return part.type === "hour";
        }) || {}).value
      );
      var minute = Number(
        (parts.find(function (part) {
          return part.type === "minute";
        }) || {}).value
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

  function injectStyles() {
    if (document.getElementById("anythingllm-smb-styles")) return;
    var style = document.createElement("style");
    style.id = "anythingllm-smb-styles";
    style.textContent =
      "#anythingllm-smb-root{position:fixed;z-index:2147483000;pointer-events:none;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}" +
      "#anythingllm-smb-root *{box-sizing:border-box;}" +
      ".allm-smb-banner,.allm-smb-badge,.allm-smb-lead{pointer-events:auto;}" +
      ".allm-smb-banner{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:#111827;color:#f9fafb;border-radius:12px 12px 0 0;font-size:12px;line-height:1.3;box-shadow:0 4px 14px rgba(0,0,0,.25);}" +
      ".allm-smb-copy{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}" +
      ".allm-smb-pill{display:inline-flex;align-items:center;border-radius:9999px;padding:2px 8px;font-size:10px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;}" +
      ".allm-smb-pill.open{background:#065f46;color:#d1fae5;}" +
      ".allm-smb-pill.closed{background:#7f1d1d;color:#fee2e2;}" +
      ".allm-smb-btn{border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:12px;font-weight:600;padding:6px 10px;cursor:pointer;}" +
      ".allm-smb-btn:disabled{opacity:.6;cursor:not-allowed;}" +
      ".allm-smb-btn.ghost{background:transparent;color:#dbeafe;text-decoration:underline;padding:0;}" +
      ".allm-smb-badge{position:absolute;right:0;bottom:72px;background:#111827;color:#f9fafb;border-radius:9999px;padding:4px 10px;font-size:11px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25);}" +
      ".allm-smb-lead{position:absolute;left:0;right:0;top:0;bottom:0;background:rgba(17,24,39,.92);color:#f9fafb;padding:20px 16px;display:flex;flex-direction:column;gap:10px;border-radius:16px;}" +
      ".allm-smb-lead h2{margin:0;font-size:16px;}" +
      ".allm-smb-lead p{margin:0;font-size:12px;color:#d1d5db;}" +
      ".allm-smb-lead label{display:flex;flex-direction:column;gap:4px;font-size:12px;}" +
      ".allm-smb-lead input{border:1px solid #374151;background:#1f2937;color:#f9fafb;border-radius:8px;padding:8px 10px;font-size:13px;}" +
      ".allm-smb-msg{font-size:12px;color:#a7f3d0;}";
    document.head.appendChild(style);
  }

  function ensureRoot() {
    root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
    return root;
  }

  function lastUserQuestion() {
    var nodes = document.querySelectorAll(".allm-anything-llm-user-message");
    if (!nodes.length) return null;
    var text = nodes[nodes.length - 1].textContent;
    return text ? text.trim() : null;
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

  function render() {
    injectStyles();
    var host = ensureRoot();
    host.innerHTML = "";

    var chat = document.getElementById("anything-llm-chat");
    var launcher = document.getElementById(
      "anything-llm-embed-chat-button-container"
    );
    var hours = hoursStatus(config && config.business_hours);
    var showDisclosure = !!(config && config.ai_disclosure);
    var showHandoff = !!(config && config.show_handoff);
    var showLead =
      !!(config && config.lead_capture) &&
      !window.sessionStorage.getItem(LEAD_KEY);

    if (chat) {
      var rect = chat.getBoundingClientRect();
      host.style.left = rect.left + "px";
      host.style.top = Math.max(rect.top - 40, 8) + "px";
      host.style.width = rect.width + "px";
      host.style.height = rect.height + 40 + "px";

      if (showDisclosure || hours || showHandoff) {
        var banner = document.createElement("div");
        banner.className = "allm-smb-banner";
        var copy = document.createElement("div");
        copy.className = "allm-smb-copy";
        if (showDisclosure) {
          var disclosure = document.createElement("span");
          disclosure.textContent = "You are talking to AI";
          copy.appendChild(disclosure);
        }
        if (hours) {
          var pill = document.createElement("span");
          pill.className = "allm-smb-pill " + (hours.open ? "open" : "closed");
          pill.textContent = hours.open ? "Open" : "Closed";
          copy.appendChild(pill);
        }
        banner.appendChild(copy);
        if (showHandoff) {
          var handoffBtn = document.createElement("button");
          handoffBtn.type = "button";
          handoffBtn.className = "allm-smb-btn";
          handoffBtn.textContent = "Talk to a human";
          handoffBtn.addEventListener("click", function () {
            handoffBtn.disabled = true;
            postJson("/handoff", { session_id: sessionId() })
              .then(function () {
                handoffBtn.textContent = "Request sent";
              })
              .catch(function () {
                handoffBtn.disabled = false;
                handoffBtn.textContent = "Try again";
              });
          });
          banner.appendChild(handoffBtn);
        }
        host.appendChild(banner);
      }

      if (showLead) {
        var lead = document.createElement("form");
        lead.className = "allm-smb-lead";
        lead.style.top = showDisclosure || hours || showHandoff ? "40px" : "0";
        lead.innerHTML =
          "<h2>Before we start</h2>" +
          "<p>Leave your details so we can follow up.</p>" +
          '<label>Name<input name="name" type="text" autocomplete="name"></label>' +
          '<label>Email<input name="email" type="email" autocomplete="email" required></label>' +
          '<button type="submit" class="allm-smb-btn">Continue to chat</button>';
        lead.addEventListener("submit", function (event) {
          event.preventDefault();
          var submit = lead.querySelector('button[type="submit"]');
          submit.disabled = true;
          var form = new FormData(lead);
          postJson("/lead", {
            name: String(form.get("name") || "").trim() || null,
            email: String(form.get("email") || "").trim() || null,
            last_question: lastUserQuestion(),
            session_id: sessionId(),
          })
            .then(function () {
              window.sessionStorage.setItem(LEAD_KEY, "1");
              lead.remove();
            })
            .catch(function () {
              submit.disabled = false;
              submit.textContent = "Try again";
            });
        });
        host.appendChild(lead);
      }
      return;
    }

    if (launcher && hours) {
      var launcherRect = launcher.getBoundingClientRect();
      host.style.left = launcherRect.left + "px";
      host.style.top = launcherRect.top + "px";
      host.style.width = Math.max(launcherRect.width, 88) + "px";
      host.style.height = launcherRect.height + 80 + "px";
      var badge = document.createElement("div");
      badge.className = "allm-smb-badge";
      badge.textContent = hours.open ? "Open now" : "Closed";
      host.appendChild(badge);
      return;
    }

    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
  }

  function watch() {
    var scheduled = null;
    function schedule() {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(function () {
        scheduled = null;
        render();
      });
    }
    var observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    setInterval(schedule, 15000);
  }

  fetch(apiUrl("/smb-config"))
    .then(function (res) {
      if (!res.ok) throw new Error("smb-config failed");
      return res.json();
    })
    .then(function (payload) {
      config = payload || {};
      render();
      watch();
    })
    .catch(function () {
      // Fail closed: leave the core widget untouched if SMB extras cannot load.
    });
})();
