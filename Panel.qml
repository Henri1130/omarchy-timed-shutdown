import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "henri.timed-shutdown"
  ipcTarget: "henri.timed-shutdown.panel"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  property int cursorIndex: 0
  property bool cursorActive: false
  property int customSeconds: Model.DEFAULT_SECONDS
  property bool customFocused: false
  property bool customTyping: false
  property string customDraft: ""
  property string lastTypedDigit: ""
  property double lastTypedAt: 0

  property int serviceNonce: 0
  readonly property var shutdownService: {
    var _ = root.serviceNonce
    var host = bar && bar.shell
    return host && typeof host.serviceFor === "function"
      ? host.serviceFor(root.moduleName)
      : null
  }

  readonly property bool timerActive: shutdownService ? shutdownService.active === true : false
  readonly property bool timerUrgent: shutdownService ? shutdownService.urgent === true : false
  readonly property int remainingSeconds: shutdownService ? shutdownService.remainingSeconds : 0
  readonly property string remainingLabel: shutdownService ? shutdownService.remainingLabel : "—"
  readonly property string durationLabel: shutdownService ? shutdownService.durationLabel : ""
  readonly property string activePresetId: shutdownService ? shutdownService.presetId : ""
  readonly property string lastError: shutdownService ? String(shutdownService.lastError || "") : ""
  readonly property bool disableNotifications: shutdownService
    ? shutdownService.disableNotifications === true
    : Model.DEFAULT_DISABLE_NOTIFICATIONS
  readonly property var presetItems: Model.presets()
  readonly property int startIndex: presetItems.length
  readonly property int notifyIndex: startIndex + 1
  readonly property int cancelIndex: notifyIndex + 1
  readonly property int itemCount: cancelIndex + 1
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  function open() {
    root.controller.show()
    root.cursorActive = false
    root.cursorIndex = 0
    root.stopCustomTyping()
    root.syncCustomSeconds()
  }

  function openFromHotkey() { root.open() }
  function close() {
    root.customFocused = false
    root.stopCustomTyping()
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function syncCustomSeconds() {
    if (root.customFocused || root.customTyping) return
    var last = shutdownService ? shutdownService.lastDurationSec : Model.DEFAULT_SECONDS
    root.customSeconds = Model.clampSeconds(last) || Model.DEFAULT_SECONDS
    root.customDraft = ""
  }

  function stopCustomTyping() {
    root.customTyping = false
    root.customDraft = ""
  }

  function applyCustomDraft(draft) {
    root.customDraft = String(draft || "")
    var n = Model.secondsFromDraft(root.customDraft, root.customSeconds)
    root.customSeconds = n > 0 ? n : 0
  }

  function typeCustomDigit(digit) {
    var now = Date.now()
    if (digit === root.lastTypedDigit && now - root.lastTypedAt < 50) return
    root.lastTypedDigit = digit
    root.lastTypedAt = now
    var next = Model.nextCustomDraft(root.customDraft, root.customTyping, digit)
    if (next === "") return
    root.cursorActive = true
    root.cursorIndex = root.startIndex
    root.customTyping = true
    root.applyCustomDraft(next)
  }

  function backspaceCustom() {
    if (!root.customTyping) {
      root.customTyping = true
      root.customDraft = String(root.customSeconds)
    }
    root.cursorActive = true
    root.cursorIndex = root.startIndex
    root.applyCustomDraft(Model.backspaceCustomDraft(root.customDraft))
  }

  function nudgeCustom(delta) {
    root.stopCustomTyping()
    var n = (customField.field ? customField.field.value : root.customSeconds) + delta
    if (n < Model.MIN_SECONDS) n = Model.MIN_SECONDS
    if (n > Model.MAX_SECONDS) n = Model.MAX_SECONDS
    root.customSeconds = n
    root.cursorActive = true
    root.cursorIndex = root.startIndex
  }

  function digitFromKey(event) {
    if (!event) return ""
    return Model.digitFromInput(event.key, event.text, event.modifiers, event.nativeScanCode)
  }

  function handleCustomKey(event) {
    if (!event) return false

    var numpad = Model.isNumpadEvent(event.key, event.modifiers, event.nativeScanCode)
    var digit = root.digitFromKey(event)
    if (digit !== "") {
      if (event.isAutoRepeat) return true
      root.typeCustomDigit(digit)
      return true
    }

    var onCustom = root.customTyping || (root.cursorActive && root.cursorIndex === root.startIndex)
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      if (!onCustom && !root.customTyping) return false
      root.startCustom()
      return true
    }
    if (event.key === Qt.Key_Backspace || event.key === Qt.Key_Delete) {
      if (!onCustom && !root.customTyping) return false
      root.backspaceCustom()
      return true
    }
    if (event.key === Qt.Key_Escape && root.customTyping) {
      root.stopCustomTyping()
      root.syncCustomSeconds()
      return true
    }

    // Numpad 2/4/6/8 must never fall through as cursor or spinbox arrows.
    if (numpad) return true
    if (root.customTyping && (event.key === Qt.Key_Up || event.key === Qt.Key_Down
        || event.key === Qt.Key_Left || event.key === Qt.Key_Right)) {
      return true
    }
    return false
  }

  function moveCursor(delta) {
    root.cursorActive = true
    root.cursorIndex = Math.max(0, Math.min(root.itemCount - 1, root.cursorIndex + delta))
  }

  function startSeconds(seconds) {
    if (!shutdownService || typeof shutdownService.start !== "function") return
    shutdownService.start(seconds)
    root.syncCustomSeconds()
  }

  function startCustom() {
    var n = root.customSeconds
    root.stopCustomTyping()
    root.startSeconds(n)
  }

  function cancelTimer() {
    if (!shutdownService || typeof shutdownService.cancel !== "function") return
    shutdownService.cancel()
  }

  function toggleDisableNotifications() {
    if (!shutdownService || typeof shutdownService.setDisableNotifications !== "function") return
    shutdownService.setDisableNotifications(!root.disableNotifications)
  }

  function activateCursor() {
    if (!root.cursorActive) return
    if (root.cursorIndex < root.presetItems.length) {
      root.startSeconds(root.presetItems[root.cursorIndex].seconds)
      return
    }
    if (root.cursorIndex === root.startIndex) {
      root.startCustom()
      return
    }
    if (root.cursorIndex === root.notifyIndex) {
      root.toggleDisableNotifications()
      return
    }
    if (root.cursorIndex === root.cancelIndex) {
      if (root.timerActive) root.cancelTimer()
    }
  }

  onOpenedChanged: {
    if (opened) {
      root.cursorIndex = 0
      root.cursorActive = false
      root.syncCustomSeconds()
      Qt.callLater(function() { if (keyRoot) keyRoot.forceActiveFocus() })
    }
  }

  onTimerActiveChanged: {
    if (root.cursorIndex >= root.itemCount)
      root.cursorIndex = Math.max(0, root.itemCount - 1)
  }

  Timer {
    interval: 200
    repeat: true
    running: root.shutdownService === null
    onTriggered: root.serviceNonce++
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: false
    focusTarget: keyRoot
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight)

    Item {
      id: keyRoot
      anchors.fill: parent
      focus: true
      Keys.priority: Keys.BeforeItem
      Keys.forwardTo: [keyCatcher]
      Keys.onPressed: function(event) {
        if (root.handleCustomKey(event)) event.accepted = true
      }

      PanelKeyCatcher {
        id: keyCatcher
        anchors.fill: parent
        focus: false
        blocked: root.customTyping
        onMoveRequested: function(dx, dy) {
          if (root.customTyping) return
          if (dy !== 0) root.moveCursor(dy)
        }
      onActivateRequested: root.activateCursor()
      onCloseRequested: {
        if (root.customTyping) {
          root.stopCustomTyping()
          root.syncCustomSeconds()
          return
        }
        root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: contentColumn
        width: parent.width
        spacing: Style.space(14)

        PanelHero {
          title: "Timed Shutdown"
          meta: root.timerActive ? "Shutting down in" : "Idle"
          detail: root.timerActive ? root.remainingLabel : ""
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              text: "󰔟"
              color: root.timerUrgent ? root.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        Text {
          visible: root.timerActive
          width: parent.width
          text: root.remainingLabel
          color: root.timerUrgent ? root.urgent : root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.displayLarge
          font.bold: true
          horizontalAlignment: Text.AlignHCenter
        }

        Text {
          visible: root.timerActive
          width: parent.width
          text: "Total " + root.durationLabel
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          horizontalAlignment: Text.AlignHCenter
        }

        Text {
          visible: root.lastError !== ""
          width: parent.width
          text: root.lastError
          color: root.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        PanelSeparator { foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: "PRESETS"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Grid {
            id: presetGrid
            width: parent.width
            columns: 2
            columnSpacing: Style.space(6)
            rowSpacing: Style.space(6)

            Repeater {
              model: root.presetItems

              Button {
                required property var modelData
                required property int index
                width: (presetGrid.width - presetGrid.columnSpacing) / 2
                text: String(modelData.label)
                fontFamily: root.fontFamily
                fontSize: Style.font.bodySmall
                foreground: root.foreground
                bordered: true
                active: root.activePresetId === modelData.id
                hasCursor: root.cursorActive && root.cursorIndex === index
                onClicked: root.startSeconds(modelData.seconds)
                onHovered: function(hovered) {
                  if (hovered) {
                    root.cursorActive = true
                    root.cursorIndex = index
                  }
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: "CUSTOM SECONDS"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Text {
            width: parent.width
            text: root.customTyping && root.customDraft === ""
              ? "Type a duration in seconds"
              : Model.formatDuration(root.customSeconds)
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Row {
            width: parent.width
            spacing: Style.space(8)

            NumberField {
              id: customField
              label: ""
              value: root.customSeconds
              from: 0
              to: Model.MAX_SECONDS
              stepSize: 1
              fieldWidth: Style.space(140)
              foreground: root.foreground
              fontFamily: root.fontFamily
              hasCursor: (root.cursorActive && root.cursorIndex === root.startIndex) || root.customTyping
              onModified: function(value) {
                root.stopCustomTyping()
                root.customSeconds = value < Model.MIN_SECONDS ? Model.MIN_SECONDS : value
              }
              onHovered: function(hovered) {
                if (hovered) {
                  root.cursorActive = true
                  root.cursorIndex = root.startIndex
                }
              }
            }

            Button {
              text: "Start"
              iconText: "󰐥"
              fontFamily: root.fontFamily
              fontSize: Style.font.body
              foreground: root.foreground
              bordered: true
              selected: true
              hasCursor: root.cursorActive && root.cursorIndex === root.startIndex && !root.customFocused
              onClicked: root.startCustom()
              onHovered: function(hovered) {
                if (hovered) {
                  root.cursorActive = true
                  root.cursorIndex = root.startIndex
                }
              }
            }
          }
        }

        PanelSeparator { foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: "OPTIONS"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Toggle {
            width: parent.width
            label: "Disable notifications"
            description: "Skip start, warning, and cancel alerts."
            checked: root.disableNotifications
            hasCursor: root.cursorActive && root.cursorIndex === root.notifyIndex
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.toggleDisableNotifications()
            onHovered: function(hovered) {
              if (hovered) {
                root.cursorActive = true
                root.cursorIndex = root.notifyIndex
              }
            }
          }
        }

        Button {
          width: parent.width
          text: "Cancel shutdown"
          iconText: "󰜺"
          fontFamily: root.fontFamily
          fontSize: Style.font.body
          foreground: root.timerActive ? root.urgent : root.dim
          bordered: true
          enabled: root.timerActive
          hasCursor: root.cursorActive && root.cursorIndex === root.cancelIndex
          onClicked: root.cancelTimer()
          onHovered: function(hovered) {
            if (hovered) {
              root.cursorActive = true
              root.cursorIndex = root.cancelIndex
            }
          }
        }
      }
    }
    }
  }

  Connections {
    target: customField.field
    function onActiveFocusChanged() {
      root.customFocused = customField.field.activeFocus
      if (customField.field.activeFocus) {
        root.cursorActive = true
        root.cursorIndex = root.startIndex
      }
    }
  }
}
