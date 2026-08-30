var PLUGIN_ID = "henri.timed-shutdown"
var UNIT_NAME = "henri-timed-shutdown"
var MIN_SECONDS = 1
var MAX_SECONDS = 86400
var DEFAULT_SECONDS = 60
var DEFAULT_DISABLE_NOTIFICATIONS = true
var WARN_SECONDS = [60, 10]
var MAX_STATE_BYTES = 4096
var LOAD_STATE_PY = [
  "import os, stat, sys",
  "path = sys.argv[1]",
  "limit = int(sys.argv[2])",
  "flags = os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | getattr(os, 'O_NOFOLLOW', 0)",
  "try:",
  "    fd = os.open(path, flags)",
  "except FileNotFoundError:",
  "    raise SystemExit(0)",
  "except OSError:",
  "    raise SystemExit(2)",
  "try:",
  "    st = os.fstat(fd)",
  "    if (not stat.S_ISREG(st.st_mode)) or st.st_size > limit:",
  "        raise SystemExit(1)",
  "    try:",
  "        data = os.read(fd, limit + 1)",
  "    except BlockingIOError:",
  "        raise SystemExit(1)",
  "    if len(data) > limit:",
  "        raise SystemExit(1)",
  "    sys.stdout.buffer.write(data)",
  "finally:",
  "    os.close(fd)"
].join("\n")

function presets() {
  return [
    { id: "15m", label: "15 min", seconds: 15 * 60 },
    { id: "30m", label: "30 min", seconds: 30 * 60 },
    { id: "1h", label: "1 hour", seconds: 60 * 60 },
    { id: "2h", label: "2 hours", seconds: 2 * 60 * 60 }
  ]
}

function clampSeconds(value) {
  var n = parseInt(String(value === undefined || value === null ? "" : value).trim(), 10)
  if (!isFinite(n)) return 0
  if (n < MIN_SECONDS) return 0
  if (n > MAX_SECONDS) return MAX_SECONDS
  return n
}

var KEYPAD_MODIFIER = 0x20000000
var KEYPAD_MODIFIER_ALT = 0x08000000

function hasKeypadModifier(modifiers) {
  var m = Number(modifiers) || 0
  return (m & KEYPAD_MODIFIER) !== 0 || (m & KEYPAD_MODIFIER_ALT) !== 0
}

function digitFromNavKey(key) {
  var k = Number(key)
  if (k === 0x01000006) return "0" // Insert
  if (k === 0x01000011) return "1" // End
  if (k === 0x01000015) return "2" // Down
  if (k === 0x01000017) return "3" // PageDown
  if (k === 0x01000012) return "4" // Left
  if (k === 0x0100000b) return "5" // Clear
  if (k === 0x01000014) return "6" // Right
  if (k === 0x01000010) return "7" // Home
  if (k === 0x01000013) return "8" // Up
  if (k === 0x01000016) return "9" // PageUp
  return ""
}

function isNumpadScanCode(scan) {
  var s = Number(scan)
  if (!isFinite(s) || s <= 0) return false
  // Linux evdev KEY_KP7..KEY_KP0
  if (s === 71 || s === 72 || s === 73 || s === 75 || s === 76 || s === 77
      || s === 79 || s === 80 || s === 81 || s === 82) return true
  // XKB keycode = evdev + 8 (what Qt Wayland usually reports)
  if (s === 83 || s === 84 || s === 85 || s === 87 || s === 88 || s === 89 || s === 90) return true
  return false
}

function isNumpadEvent(key, modifiers, scanCode) {
  if (hasKeypadModifier(modifiers)) return true
  if (isNumpadScanCode(scanCode)) return true
  var k = Number(key)
  if (k >= 0x01000030 && k <= 0x01000039) return true
  return false
}

function digitFromScanCode(scan, key) {
  var fromNav = digitFromNavKey(key)
  if (fromNav !== "") return fromNav
  var s = Number(scan)
  var evdev = { 82: "0", 79: "1", 80: "2", 81: "3", 75: "4", 76: "5", 77: "6", 71: "7", 72: "8", 73: "9" }
  var xkb = { 90: "0", 87: "1", 88: "2", 89: "3", 83: "4", 84: "5", 85: "6", 79: "7", 80: "8", 81: "9" }
  if (xkb[s] && !(s === 79 || s === 80 || s === 81)) return xkb[s]
  if (evdev[s] && !(s === 79 || s === 80 || s === 81)) return evdev[s]
  var k = Number(key)
  if (k >= 48 && k <= 57) return String.fromCharCode(k)
  if (xkb[s]) return xkb[s]
  if (evdev[s]) return evdev[s]
  return ""
}

function digitFromInput(key, text, modifiers, scanCode) {
  var t = String(text || "")
  var numpad = isNumpadEvent(key, modifiers, scanCode)
  if (!numpad && t.length === 1 && t >= "0" && t <= "9") return t

  var k = Number(key)
  if (k >= 48 && k <= 57) return String.fromCharCode(k)
  if (k >= 0x01000030 && k <= 0x01000039) return String(k - 0x01000030)

  if (numpad) {
    if (t.length === 1 && t >= "0" && t <= "9") return t
    var fromNav = digitFromNavKey(k)
    if (fromNav !== "") return fromNav
    var fromScan = digitFromScanCode(scanCode, k)
    if (fromScan !== "") return fromScan
  }
  return ""
}

function nextCustomDraft(draft, typing, digit) {
  var d = String(digit || "")
  if (d.length !== 1 || d < "0" || d > "9") return typing ? String(draft || "") : ""
  if (!typing || String(draft || "") === "" || String(draft || "") === "0") return d
  var current = String(draft)
  if (current.length >= 5) return current
  var next = current + d
  var n = parseInt(next, 10)
  if (isFinite(n) && n > MAX_SECONDS) return String(MAX_SECONDS)
  return next
}

function backspaceCustomDraft(draft) {
  var current = String(draft || "")
  if (current.length <= 1) return ""
  return current.slice(0, -1)
}

function secondsFromDraft(draft, fallback) {
  var text = String(draft || "").trim()
  if (text === "") {
    var fb = parseInt(String(fallback === undefined || fallback === null ? "" : fallback), 10)
    return isFinite(fb) && fb > 0 ? clampSeconds(fb) || DEFAULT_SECONDS : DEFAULT_SECONDS
  }
  var n = parseInt(text, 10)
  if (!isFinite(n) || n <= 0) return 0
  if (n > MAX_SECONDS) return MAX_SECONDS
  return n
}

function pad2(n) {
  var v = Math.max(0, Math.floor(n))
  return (v < 10 ? "0" : "") + String(v)
}

function formatRemaining(seconds) {
  var n = Math.max(0, Math.floor(Number(seconds) || 0))
  if (n < 60) return n + "s"
  var hours = Math.floor(n / 3600)
  var minutes = Math.floor((n % 3600) / 60)
  var secs = n % 60
  if (hours > 0) return hours + ":" + pad2(minutes) + ":" + pad2(secs)
  return minutes + ":" + pad2(secs)
}

function formatDuration(seconds) {
  var n = Math.max(0, Math.floor(Number(seconds) || 0))
  if (n <= 0) return "0 seconds"
  if (n < 60) return n === 1 ? "1 second" : n + " seconds"

  var hours = Math.floor(n / 3600)
  var minutes = Math.floor((n % 3600) / 60)
  var secs = n % 60
  var parts = []
  if (hours > 0) parts.push(hours === 1 ? "1 hour" : hours + " hours")
  if (minutes > 0) parts.push(minutes === 1 ? "1 minute" : minutes + " minutes")
  if (secs > 0 && hours === 0) parts.push(secs === 1 ? "1 second" : secs + " seconds")
  return parts.join(" ")
}

function remainingFromDeadline(deadlineMs, nowMs) {
  var deadline = Number(deadlineMs)
  var now = Number(nowMs)
  if (!isFinite(deadline) || !isFinite(now)) return 0
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

function deadlineFromNow(seconds, nowMs) {
  var n = clampSeconds(seconds)
  if (n <= 0) return 0
  var now = Number(nowMs)
  if (!isFinite(now)) now = Date.now()
  return now + n * 1000
}

function shouldWarn(previousSeconds, currentSeconds, threshold) {
  var prev = Number(previousSeconds)
  var curr = Number(currentSeconds)
  var mark = Number(threshold)
  if (!isFinite(prev) || !isFinite(curr) || !isFinite(mark)) return false
  if (mark <= 0 || curr <= 0) return false
  return prev > mark && curr <= mark
}

function presetIdForSeconds(seconds) {
  var n = clampSeconds(seconds)
  var list = presets()
  for (var i = 0; i < list.length; i++) {
    if (list[i].seconds === n) return list[i].id
  }
  return ""
}

function disableNotificationsFrom(value) {
  if (value === false || value === 0 || value === "0") return false
  if (typeof value === "string" && value.trim().toLowerCase() === "false") return false
  return true
}

function emptyState(lastDurationSec) {
  return {
    deadlineMs: 0,
    durationSec: 0,
    lastDurationSec: clampSeconds(lastDurationSec) || DEFAULT_SECONDS
  }
}

function parseState(raw) {
  var fallback = emptyState(DEFAULT_SECONDS)
  var text = String(raw || "")
  if (text.length > MAX_STATE_BYTES) return fallback
  text = text.trim()
  if (text === "") return fallback
  try {
    var parsed = JSON.parse(text)
  } catch (e) {
    return fallback
  }
  if (!parsed || typeof parsed !== "object") return fallback
  return {
    deadlineMs: Math.max(0, Number(parsed.deadlineMs) || 0),
    durationSec: clampSeconds(parsed.durationSec),
    lastDurationSec: clampSeconds(parsed.lastDurationSec) || DEFAULT_SECONDS
  }
}

function serializeState(state) {
  var next = state && typeof state === "object" ? state : {}
  return JSON.stringify({
    deadlineMs: Math.max(0, Number(next.deadlineMs) || 0),
    durationSec: clampSeconds(next.durationSec),
    lastDurationSec: clampSeconds(next.lastDurationSec) || DEFAULT_SECONDS
  })
}

function statePath(runtimeDir) {
  var dir = String(runtimeDir || "").replace(/\/+$/, "")
  if (dir === "") return ""
  return dir + "/" + PLUGIN_ID + ".json"
}

function loadStateCommand(path) {
  var p = String(path || "")
  if (p === "") return []
  return [
    "/usr/bin/timeout",
    "--signal=KILL",
    "1",
    "/usr/bin/python3",
    "-I",
    "-c",
    LOAD_STATE_PY,
    p,
    String(MAX_STATE_BYTES)
  ]
}

var SHUTDOWN_BIN = "/usr/share/omarchy/bin/omarchy-system-shutdown"
var SHUTDOWN_BIN_ALT = "/usr/bin/omarchy-system-shutdown"

function resolvedShutdownBin(shutdownBin) {
  var cmd = String(shutdownBin || "").trim()
  if (cmd === SHUTDOWN_BIN || cmd === SHUTDOWN_BIN_ALT) return cmd
  return SHUTDOWN_BIN
}

function startTimerCommand(seconds, shutdownBin) {
  var n = clampSeconds(seconds)
  if (n <= 0) return []
  return [
    "systemd-run",
    "--user",
    "--collect",
    "--quiet",
    "--unit=" + UNIT_NAME,
    "--on-active=" + n + "s",
    "--timer-property=AccuracySec=1s",
    resolvedShutdownBin(shutdownBin)
  ]
}

function cancelTimerCommand() {
  return [
    "systemctl",
    "--user",
    "stop",
    UNIT_NAME + ".timer",
    UNIT_NAME + ".service"
  ]
}

function timerActiveCommand() {
  return ["systemctl", "--user", "is-active", "--quiet", UNIT_NAME + ".timer"]
}

function emptyBackupOps() {
  return {
    wantTimer: false,
    wantSeconds: 0,
    wantGen: 0,
    appliedGen: 0,
    scheduleInFlight: false,
    cancelInFlight: false,
    inFlightGen: 0,
    scheduleToken: 0,
    cancelToken: 0,
    maybeArmed: false
  }
}

function copyBackupOps(ops) {
  var src = ops && typeof ops === "object" ? ops : emptyBackupOps()
  return {
    wantTimer: src.wantTimer === true,
    wantSeconds: clampSeconds(src.wantSeconds),
    wantGen: Math.max(0, Math.floor(Number(src.wantGen) || 0)),
    appliedGen: Math.max(0, Math.floor(Number(src.appliedGen) || 0)),
    scheduleInFlight: src.scheduleInFlight === true,
    cancelInFlight: src.cancelInFlight === true,
    inFlightGen: Math.max(0, Math.floor(Number(src.inFlightGen) || 0)),
    scheduleToken: Math.max(0, Math.floor(Number(src.scheduleToken) || 0)),
    cancelToken: Math.max(0, Math.floor(Number(src.cancelToken) || 0)),
    maybeArmed: src.maybeArmed === true
  }
}

function requestBackupStart(ops, seconds) {
  var n = clampSeconds(seconds)
  var next = copyBackupOps(ops)
  if (n <= 0) return next
  next.wantTimer = true
  next.wantSeconds = n
  next.wantGen += 1
  return next
}

function requestBackupStop(ops) {
  var next = copyBackupOps(ops)
  next.wantTimer = false
  next.wantSeconds = 0
  next.wantGen += 1
  return next
}

function nextBackupAction(ops) {
  var s = copyBackupOps(ops)
  if (s.scheduleInFlight || s.cancelInFlight)
    return { action: "wait" }
  if (s.wantTimer && s.appliedGen === s.wantGen)
    return { action: "idle" }
  if (!s.wantTimer && !s.maybeArmed && s.appliedGen === s.wantGen)
    return { action: "idle" }
  if (!s.wantTimer)
    return { action: "cancel" }
  if (s.maybeArmed)
    return { action: "cancel" }
  return { action: "schedule", seconds: s.wantSeconds }
}

function markBackupStarted(ops, kind) {
  var next = copyBackupOps(ops)
  next.inFlightGen = next.wantGen
  if (kind === "schedule") {
    next.scheduleInFlight = true
    next.maybeArmed = true
    next.scheduleToken += 1
  } else if (kind === "cancel") {
    next.cancelInFlight = true
    next.cancelToken += 1
  }
  return next
}

function markScheduleExited(ops, token) {
  var next = copyBackupOps(ops)
  if (!next.scheduleInFlight) return next
  if (token !== undefined && token !== null && String(token) !== "" && Number(token) !== next.scheduleToken)
    return next
  next.scheduleInFlight = false
  next.maybeArmed = true
  if (next.wantTimer && next.wantGen === next.inFlightGen)
    next.appliedGen = next.inFlightGen
  next.inFlightGen = 0
  return next
}

function markCancelExited(ops, token) {
  var next = copyBackupOps(ops)
  if (!next.cancelInFlight) return next
  if (token !== undefined && token !== null && String(token) !== "" && Number(token) !== next.cancelToken)
    return next
  next.cancelInFlight = false
  next.maybeArmed = false
  if (!next.wantTimer)
    next.appliedGen = next.wantGen
  next.inFlightGen = 0
  return next
}

function shutdownCommand(shutdownBin) {
  return [resolvedShutdownBin(shutdownBin)]
}

function notifyStartCommand(durationLabel) {
  return [
    "omarchy-notification-send",
    "-g",
    "󰔟",
    "-u",
    "normal",
    "Timed shutdown",
    "This computer will shut down in " + String(durationLabel || "")
  ]
}

function notifyWarningCommand(remainingLabel) {
  return [
    "omarchy-notification-send",
    "-g",
    "󰐥",
    "-u",
    "critical",
    "Timed shutdown",
    "Shutting down in " + String(remainingLabel || "")
  ]
}

function notifyCancelCommand() {
  return [
    "omarchy-notification-send",
    "-g",
    "󰔛",
    "Timed shutdown",
    "Shutdown cancelled"
  ]
}

if (typeof module !== "undefined") {
  module.exports = {
    PLUGIN_ID: PLUGIN_ID,
    UNIT_NAME: UNIT_NAME,
    MIN_SECONDS: MIN_SECONDS,
    MAX_SECONDS: MAX_SECONDS,
    DEFAULT_SECONDS: DEFAULT_SECONDS,
    DEFAULT_DISABLE_NOTIFICATIONS: DEFAULT_DISABLE_NOTIFICATIONS,
    WARN_SECONDS: WARN_SECONDS,
    disableNotificationsFrom: disableNotificationsFrom,
    presets: presets,
    KEYPAD_MODIFIER: KEYPAD_MODIFIER,
    hasKeypadModifier: hasKeypadModifier,
    isNumpadEvent: isNumpadEvent,
    digitFromNavKey: digitFromNavKey,
    digitFromInput: digitFromInput,
    nextCustomDraft: nextCustomDraft,
    backspaceCustomDraft: backspaceCustomDraft,
    secondsFromDraft: secondsFromDraft,
    clampSeconds: clampSeconds,
    formatRemaining: formatRemaining,
    formatDuration: formatDuration,
    remainingFromDeadline: remainingFromDeadline,
    deadlineFromNow: deadlineFromNow,
    shouldWarn: shouldWarn,
    presetIdForSeconds: presetIdForSeconds,
    emptyState: emptyState,
    parseState: parseState,
    serializeState: serializeState,
    statePath: statePath,
    MAX_STATE_BYTES: MAX_STATE_BYTES,
    loadStateCommand: loadStateCommand,
    SHUTDOWN_BIN: SHUTDOWN_BIN,
    resolvedShutdownBin: resolvedShutdownBin,
    startTimerCommand: startTimerCommand,
    cancelTimerCommand: cancelTimerCommand,
    timerActiveCommand: timerActiveCommand,
    emptyBackupOps: emptyBackupOps,
    requestBackupStart: requestBackupStart,
    requestBackupStop: requestBackupStop,
    nextBackupAction: nextBackupAction,
    markBackupStarted: markBackupStarted,
    markScheduleExited: markScheduleExited,
    markCancelExited: markCancelExited,
    shutdownCommand: shutdownCommand,
    notifyStartCommand: notifyStartCommand,
    notifyWarningCommand: notifyWarningCommand,
    notifyCancelCommand: notifyCancelCommand
  }
}
