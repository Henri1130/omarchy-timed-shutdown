const test = require("node:test")
const assert = require("node:assert/strict")
const Model = require("../Model.js")

test("presets cover 15 minutes, 30 minutes, 1 hour, and 2 hours", () => {
  assert.deepEqual(Model.presets().map((item) => item.seconds), [900, 1800, 3600, 7200])
})

test("clampSeconds rejects empty values and caps at 24 hours", () => {
  assert.equal(Model.clampSeconds(""), 0)
  assert.equal(Model.clampSeconds("0"), 0)
  assert.equal(Model.clampSeconds(-5), 0)
  assert.equal(Model.clampSeconds("90"), 90)
  assert.equal(Model.clampSeconds(86401), 86400)
})

test("formatRemaining uses seconds, mm:ss, then h:mm:ss", () => {
  assert.equal(Model.formatRemaining(0), "0s")
  assert.equal(Model.formatRemaining(9), "9s")
  assert.equal(Model.formatRemaining(15 * 60), "15:00")
  assert.equal(Model.formatRemaining(90), "1:30")
  assert.equal(Model.formatRemaining(3600), "1:00:00")
  assert.equal(Model.formatRemaining(2 * 3600 + 5), "2:00:05")
})

test("formatDuration spells out preset and custom lengths", () => {
  assert.equal(Model.formatDuration(1), "1 second")
  assert.equal(Model.formatDuration(90), "1 minute 30 seconds")
  assert.equal(Model.formatDuration(15 * 60), "15 minutes")
  assert.equal(Model.formatDuration(3600), "1 hour")
  assert.equal(Model.formatDuration(2 * 3600), "2 hours")
})

test("deadline math rounds remaining seconds up", () => {
  const now = 1_000_000
  assert.equal(Model.deadlineFromNow(90, now), now + 90_000)
  assert.equal(Model.remainingFromDeadline(now + 1500, now), 2)
  assert.equal(Model.remainingFromDeadline(now - 1, now), 0)
})

test("warnings fire once when the countdown crosses 60s and 10s", () => {
  assert.equal(Model.shouldWarn(61, 60, 60), true)
  assert.equal(Model.shouldWarn(60, 59, 60), false)
  assert.equal(Model.shouldWarn(11, 10, 10), true)
  assert.equal(Model.shouldWarn(10, 9, 10), false)
  assert.equal(Model.shouldWarn(5, 4, 10), false)
})

test("state round-trips and ignores a deadline that has already passed", () => {
  const raw = Model.serializeState({
    deadlineMs: 123,
    durationSec: 900,
    lastDurationSec: 90
  })
  assert.deepEqual(Model.parseState(raw), {
    deadlineMs: 123,
    durationSec: 900,
    lastDurationSec: 90
  })
  assert.equal(Model.parseState("not-json").lastDurationSec, 60)
  assert.ok(raw.length < Model.MAX_STATE_BYTES)
  assert.equal(Model.parseState("x".repeat(Model.MAX_STATE_BYTES + 1)).lastDurationSec, 60)
})

test("loadStateCommand bounds the restore path to a small nonblocking regular file", () => {
  const fs = require("node:fs")
  const os = require("node:os")
  const path = require("node:path")
  const { spawnSync } = require("node:child_process")

  const command = Model.loadStateCommand("/run/user/1000/henri.timed-shutdown.json")
  assert.deepEqual(command.slice(0, 6), [
    "/usr/bin/timeout",
    "--signal=KILL",
    "1",
    "/usr/bin/python3",
    "-I",
    "-c"
  ])
  assert.match(command[6], /O_NONBLOCK/)
  assert.match(command[6], /O_NOFOLLOW/)
  assert.match(command[6], /S_ISREG/)
  assert.equal(command[8], String(Model.MAX_STATE_BYTES))
  assert.deepEqual(Model.loadStateCommand(""), [])

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timed-shutdown-state-"))
  const run = (target) => {
    const cmd = Model.loadStateCommand(target)
    return spawnSync(cmd[0], cmd.slice(1), { encoding: "buffer", timeout: 2000 })
  }
  try {
    const good = path.join(dir, "good.json")
    const huge = path.join(dir, "huge.json")
    const fifo = path.join(dir, "fifo.json")
    const link = path.join(dir, "link.json")
    const missing = path.join(dir, "missing.json")
    const payload = Model.serializeState({
      deadlineMs: 123,
      durationSec: 900,
      lastDurationSec: 90
    }) + "\n"
    fs.writeFileSync(good, payload)
    fs.writeFileSync(huge, "x".repeat(Model.MAX_STATE_BYTES + 1))
    const fifoMade = spawnSync("mkfifo", [fifo], { encoding: "utf8" })
    assert.equal(fifoMade.status, 0, fifoMade.stderr)
    fs.symlinkSync(good, link)

    const ok = run(good)
    assert.equal(ok.status, 0)
    assert.deepEqual(Model.parseState(ok.stdout.toString("utf8")), {
      deadlineMs: 123,
      durationSec: 900,
      lastDurationSec: 90
    })

    assert.notEqual(run(huge).status, 0)
    assert.notEqual(run(fifo).status, 0)
    assert.notEqual(run(link).status, 0)
    assert.notEqual(run(dir).status, 0)

    const miss = run(missing)
    assert.equal(miss.status, 0)
    assert.equal(miss.stdout.length, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("number-row and keypad digits build a custom duration, replacing on the first key", () => {
  assert.equal(Model.digitFromInput(0, "7"), "7")
  assert.equal(Model.digitFromInput(48, ""), "0")
  assert.equal(Model.digitFromInput(0x01000039, ""), "9")
  assert.equal(Model.digitFromInput(50, "2", Model.KEYPAD_MODIFIER), "2")
  assert.equal(Model.digitFromInput(0x01000015, "", Model.KEYPAD_MODIFIER), "2")
  assert.equal(Model.digitFromInput(0x01000013, "", Model.KEYPAD_MODIFIER), "8")
  assert.equal(Model.digitFromInput(0x01000015, "", 0), "")
  assert.equal(Model.digitFromInput(0x01000015, "", 0, 88), "2")
  assert.equal(Model.isNumpadEvent(0x01000015, 0, 80), true)
  assert.equal(Model.nextCustomDraft("900", false, "1"), "1")
  assert.equal(Model.nextCustomDraft("1", true, "5"), "15")
  assert.equal(Model.nextCustomDraft("86400", true, "1"), "86400")
  assert.equal(Model.backspaceCustomDraft("90"), "9")
  assert.equal(Model.secondsFromDraft("90"), 90)
  assert.equal(Model.secondsFromDraft(""), 60)
})

test("disableNotifications is on by default and only false when explicitly disabled", () => {
  assert.equal(Model.DEFAULT_DISABLE_NOTIFICATIONS, true)
  assert.equal(Model.disableNotificationsFrom(undefined), true)
  assert.equal(Model.disableNotificationsFrom(true), true)
  assert.equal(Model.disableNotificationsFrom(false), false)
  assert.equal(Model.disableNotificationsFrom("false"), false)
})

test("systemd backup commands stay inside the user session and call omarchy-system-shutdown", () => {
  const start = Model.startTimerCommand(900)
  assert.equal(start[0], "sh")
  assert.match(start[2], /systemd-run --user/)
  assert.match(start[2], /unit='henri-timed-shutdown'/)
  assert.match(start[2], /--on-active=900s/)
  assert.match(start[2], /omarchy-system-shutdown/)
  assert.match(start[2], /daemon-reload/)
  assert.match(Model.cancelTimerCommand()[2], /systemctl --user stop/)
  assert.deepEqual(Model.shutdownCommand(), ["omarchy-system-shutdown"])
})

function takeBackupAction(ops) {
  const action = Model.nextBackupAction(ops)
  if (action.action === "schedule")
    return { ops: Model.markBackupStarted(ops, "schedule"), action }
  if (action.action === "cancel")
    return { ops: Model.markBackupStarted(ops, "cancel"), action }
  return { ops, action }
}

test("cancel waits for every scheduler generation to exit before the unit stop", () => {
  let ops = Model.requestBackupStart(Model.emptyBackupOps(), 90)
  let step = takeBackupAction(ops)
  assert.equal(step.action.action, "schedule")
  assert.equal(step.action.seconds, 90)
  ops = step.ops
  assert.equal(Model.nextBackupAction(ops).action, "wait")

  ops = Model.requestBackupStop(ops)
  assert.equal(Model.nextBackupAction(ops).action, "wait")
  assert.notEqual(Model.nextBackupAction(ops).action, "cancel")

  ops = Model.markScheduleExited(ops)
  step = takeBackupAction(ops)
  assert.equal(step.action.action, "cancel")
  ops = Model.markCancelExited(step.ops)
  assert.equal(Model.nextBackupAction(ops).action, "idle")
})

test("stale schedule completions cannot retain a timer while inactive", () => {
  let ops = Model.requestBackupStart(Model.emptyBackupOps(), 30)
  ops = takeBackupAction(ops).ops
  ops = Model.requestBackupStop(ops)
  ops = Model.markScheduleExited(ops)
  assert.equal(ops.wantTimer, false)
  assert.notEqual(ops.appliedGen, ops.wantGen)
  const action = Model.nextBackupAction(ops)
  assert.equal(action.action, "cancel")
  assert.notEqual(action.action, "idle")

  ops = takeBackupAction(ops).ops
  ops = Model.markCancelExited(ops)
  assert.equal(Model.nextBackupAction(ops).action, "idle")
  assert.equal(ops.wantTimer, false)
})

test("a new start is not undone by an older cancellation", () => {
  let ops = Model.requestBackupStart(Model.emptyBackupOps(), 90)
  ops = takeBackupAction(ops).ops
  ops = Model.markScheduleExited(ops)
  assert.equal(Model.nextBackupAction(ops).action, "idle")

  ops = Model.requestBackupStop(ops)
  let step = takeBackupAction(ops)
  assert.equal(step.action.action, "cancel")
  ops = step.ops

  ops = Model.requestBackupStart(ops, 60)
  assert.equal(Model.nextBackupAction(ops).action, "wait")
  assert.notEqual(Model.nextBackupAction(ops).action, "schedule")

  ops = Model.markCancelExited(ops)
  step = takeBackupAction(ops)
  assert.equal(step.action.action, "schedule")
  assert.equal(step.action.seconds, 60)
  ops = Model.markScheduleExited(step.ops)
  assert.equal(Model.nextBackupAction(ops).action, "idle")
  assert.equal(ops.wantTimer, true)
  assert.equal(ops.wantSeconds, 60)
})

test("reschedule waits for the older generation then starts the newer one", () => {
  let ops = Model.requestBackupStart(Model.emptyBackupOps(), 90)
  ops = takeBackupAction(ops).ops
  ops = Model.requestBackupStart(ops, 15)
  assert.equal(Model.nextBackupAction(ops).action, "wait")
  assert.notEqual(Model.nextBackupAction(ops).action, "schedule")

  ops = Model.markScheduleExited(ops)
  const step = takeBackupAction(ops)
  assert.equal(step.action.action, "schedule")
  assert.equal(step.action.seconds, 15)
})

test("a start that supersedes cancel while a scheduler is in flight skips the stale stop", () => {
  let ops = Model.requestBackupStart(Model.emptyBackupOps(), 90)
  ops = takeBackupAction(ops).ops
  ops = Model.requestBackupStop(ops)
  ops = Model.requestBackupStart(ops, 60)
  assert.equal(Model.nextBackupAction(ops).action, "wait")

  ops = Model.markScheduleExited(ops)
  const step = takeBackupAction(ops)
  assert.equal(step.action.action, "schedule")
  assert.equal(step.action.seconds, 60)
  assert.notEqual(step.action.action, "cancel")
})
