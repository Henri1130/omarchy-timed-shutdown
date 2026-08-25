import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: String(Quickshell.env("OMARCHY_PATH") || "/usr/share/omarchy")

  property bool active: false
  property bool firing: false
  property int remainingSeconds: 0
  property int durationSeconds: 0
  property double deadlineMs: 0
  property int lastDurationSec: Model.DEFAULT_SECONDS
  property bool stateReady: false
  property bool restoring: false
  property string lastError: ""
  property bool disableNotifications: Model.DEFAULT_DISABLE_NOTIFICATIONS
  property bool scheduleAborting: false

  readonly property string runtimeDir: String(Quickshell.env("XDG_RUNTIME_DIR") || "")
  readonly property string shutdownBin: (root.omarchyPath || "/usr/share/omarchy") + "/bin/omarchy-system-shutdown"
  readonly property string stateFilePath: Model.statePath(runtimeDir)
  readonly property string remainingLabel: Model.formatRemaining(remainingSeconds)
  readonly property string durationLabel: Model.formatDuration(durationSeconds || lastDurationSec)
  readonly property string presetId: Model.presetIdForSeconds(durationSeconds)
  readonly property bool urgent: active && remainingSeconds > 0 && remainingSeconds <= 60

  function statusPayload() {
    return JSON.stringify({
      active: root.active,
      remainingSeconds: root.remainingSeconds,
      durationSeconds: root.durationSeconds,
      deadlineMs: root.deadlineMs,
      lastDurationSec: root.lastDurationSec,
      disableNotifications: root.disableNotifications
    })
  }

  function entrySettings() {
    if (!root.shell || !root.shell.barConfig || !root.shell.barConfig.layout) return null
    var layout = root.shell.barConfig.layout
    var sections = ["left", "center", "right"]
    for (var s = 0; s < sections.length; s++) {
      var entries = Array.isArray(layout[sections[s]]) ? layout[sections[s]] : []
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i]
        if (!entry || String(entry.id || "") !== Model.PLUGIN_ID) continue
        var result = ({})
        for (var key in entry) if (key !== "id") result[key] = entry[key]
        return result
      }
    }
    return null
  }

  function syncSettings() {
    var settings = root.entrySettings()
    if (!settings || settings.disableNotifications === undefined) {
      root.disableNotifications = Model.DEFAULT_DISABLE_NOTIFICATIONS
      return
    }
    root.disableNotifications = Model.disableNotificationsFrom(settings.disableNotifications)
  }

  function setDisableNotifications(value) {
    root.disableNotifications = value === true
    var entry = { id: Model.PLUGIN_ID }
    var current = root.entrySettings() || ({})
    for (var key in current) entry[key] = current[key]
    entry.disableNotifications = root.disableNotifications
    if (root.shell && typeof root.shell.updateEntryInline === "function")
      root.shell.updateEntryInline(Model.PLUGIN_ID, entry)
  }

  function sendNotification(command) {
    if (root.disableNotifications) return
    Quickshell.execDetached(command)
  }

  function start(seconds) {
    var n = Model.clampSeconds(seconds)
    if (n <= 0) {
      root.lastError = "Enter a duration between 1 and 86400 seconds."
      return "invalid"
    }
    if (root.firing) return "firing"

    root.lastError = ""
    root.firing = false
    root.lastDurationSec = n
    root.durationSeconds = n
    root.deadlineMs = Model.deadlineFromNow(n, Date.now())
    root.remainingSeconds = n
    root.active = true
    root.persistState()
    root.scheduleBackup(n)
    root.sendNotification(Model.notifyStartCommand(Model.formatDuration(n)))
    return "ok"
  }

  function cancel() {
    var wasActive = root.active
    root.clearTimer(true)
    if (wasActive) root.sendNotification(Model.notifyCancelCommand())
    return wasActive ? "ok" : "idle"
  }

  function clearTimer(keepLastDuration) {
    root.active = false
    root.firing = false
    root.remainingSeconds = 0
    root.durationSeconds = 0
    root.deadlineMs = 0
    if (!keepLastDuration) root.lastDurationSec = Model.DEFAULT_SECONDS
    root.persistState()
    root.stopBackup()
  }

  function tick() {
    if (!root.active || root.firing) return

    var previous = root.remainingSeconds
    var remaining = Model.remainingFromDeadline(root.deadlineMs, Date.now())
    root.remainingSeconds = remaining

    var warns = Model.WARN_SECONDS
    for (var i = 0; i < warns.length; i++) {
      if (Model.shouldWarn(previous, remaining, warns[i])) {
        root.sendNotification(Model.notifyWarningCommand(Model.formatDuration(remaining)))
      }
    }

    if (remaining <= 0) root.fire()
  }

  function fire() {
    if (root.firing) return
    root.firing = true
    root.active = false
    root.remainingSeconds = 0
    root.deadlineMs = 0
    root.persistState()
    root.stopBackup()
    shutdownProc.command = Model.shutdownCommand(root.shutdownBin)
    shutdownProc.startDetached()
    root.firing = false
  }

  function persistState() {
    if (!root.stateReady || root.stateFilePath === "") return
    stateFile.setText(Model.serializeState({
      deadlineMs: root.active ? root.deadlineMs : 0,
      durationSec: root.active ? root.durationSeconds : 0,
      lastDurationSec: root.lastDurationSec
    }) + "\n")
  }

  function applyState(raw) {
    var parsed = Model.parseState(raw)
    root.lastDurationSec = parsed.lastDurationSec
    var remaining = Model.remainingFromDeadline(parsed.deadlineMs, Date.now())
    if (parsed.deadlineMs <= 0 || remaining <= 0) {
      root.active = false
      root.remainingSeconds = 0
      root.durationSeconds = 0
      root.deadlineMs = 0
      return
    }

    root.durationSeconds = parsed.durationSec || remaining
    root.deadlineMs = parsed.deadlineMs
    root.remainingSeconds = remaining
    root.active = true
    root.ensureBackup()
  }

  function scheduleBackup(seconds) {
    if (scheduleProc.running) {
      root.scheduleAborting = true
      scheduleProc.running = false
    }
    scheduleProc.command = Model.startTimerCommand(seconds, root.shutdownBin)
    scheduleProc.running = true
  }

  function stopBackup() {
    if (cancelProc.running) return
    cancelProc.command = Model.cancelTimerCommand()
    cancelProc.running = true
  }

  function ensureBackup() {
    if (!root.active || probeProc.running) return
    probeProc.command = Model.timerActiveCommand()
    probeProc.running = true
  }

  IpcHandler {
    target: "henri.timed-shutdown"

    function start(seconds: string): string {
      return root.start(seconds)
    }

    function cancel(): string {
      return root.cancel()
    }

    function status(): string {
      return root.statusPayload()
    }
  }

  Connections {
    target: root.shell
    function onBarConfigChanged() { root.syncSettings() }
  }

  FileView {
    id: stateFile
    path: root.stateFilePath
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: {
      if (!root.stateReady) {
        root.applyState(text())
        root.stateReady = true
      }
    }
    onLoadFailed: {
      root.stateReady = true
    }
    onFileChanged: reload()
  }

  Process {
    id: scheduleProc
    stderr: StdioCollector { id: scheduleErr; waitForEnd: true }
    onExited: function(exitCode) {
      if (root.scheduleAborting) {
        root.scheduleAborting = false
        return
      }
      if (exitCode !== 0)
        console.warn("timed-shutdown backup timer failed:", String(scheduleErr.text || "").trim())
    }
  }

  Process {
    id: cancelProc
  }

  Process {
    id: probeProc
    onExited: function(exitCode) {
      if (root.active && exitCode !== 0)
        root.scheduleBackup(Math.max(Model.MIN_SECONDS, root.remainingSeconds))
    }
  }

  Process {
    id: shutdownProc
  }

  Timer {
    interval: 250
    repeat: true
    running: root.active
    onTriggered: root.tick()
  }

  onShellChanged: root.syncSettings()

  Component.onCompleted: {
    root.syncSettings()
    if (root.stateFilePath !== "") stateFile.reload()
    else root.stateReady = true
  }

  Component.onDestruction: {
    // Leave the systemd backup running so a shell reload does not lose the
    // shutdown. The next service instance restores the countdown from disk.
  }
}
