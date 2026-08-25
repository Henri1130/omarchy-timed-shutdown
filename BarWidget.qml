import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "henri.timed-shutdown"

  property int serviceNonce: 0

  readonly property var shutdownService: {
    var _ = root.serviceNonce
    var host = bar && bar.shell
    return host && typeof host.serviceFor === "function"
      ? host.serviceFor(root.moduleName)
      : null
  }
  readonly property bool timerActive: shutdownService ? shutdownService.active === true : false
  readonly property int remainingSeconds: shutdownService ? shutdownService.remainingSeconds : 0
  readonly property bool timerUrgent: shutdownService ? shutdownService.urgent === true : false
  readonly property string remainingLabel: shutdownService ? shutdownService.remainingLabel : ""

  readonly property string label: {
    if (!root.timerActive) return "󰔟"
    if (root.vertical) return "󰔟"
    return root.remainingLabel + " 󰔟"
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: root.timerActive && !root.vertical ? button.glyphPaintedWidth : 0

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
    else if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Timer {
    interval: 200
    repeat: true
    running: root.shutdownService === null
    onTriggered: root.serviceNonce++
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "henri.timed-shutdown.panel"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.label
    active: root.timerUrgent
    tooltipText: root.timerActive
      ? "Shutting down in " + root.remainingLabel
      : "Timed shutdown"
    slotSize: {
      if (root.vertical || !root.timerActive) return Style.bar.iconSlot
      return Style.bar.iconSlot * (root.remainingSeconds >= 3600 ? 3.6 : 2.6)
    }

    onPressed: function(mouseButton) {
      if (mouseButton === Qt.RightButton) {
        if (root.shutdownService && root.timerActive) root.shutdownService.cancel()
        else root.togglePanel()
        return
      }
      root.togglePanel()
    }
  }
}
