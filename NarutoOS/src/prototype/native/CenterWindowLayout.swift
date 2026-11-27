import AppKit

@MainActor enum CenterWindowLayout {
    private static let buttons: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]

    static func initialContentRect(small: Bool) -> NSRect {
        let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1000, height: 732)
        return NSRect(x: 0, y: 0,
                      width: min(small ? 700 : 1000, area.width),
                      height: min(small ? 490 : 700, max(300, area.height - 32)))
    }

    static func fitWindow(_ window: NSWindow) {
        guard let screen = window.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let titleHeight = window.frame.height - (window.contentView?.frame.height ?? 0)
        window.setContentSize(NSSize(width: min(1000, area.width), height: min(700, max(200, area.height - titleHeight))))
        var frame = window.frame
        frame.origin.x = min(max(frame.minX, area.minX), max(area.minX, area.maxX - frame.width))
        frame.origin.y = min(max(frame.minY, area.minY), max(area.minY, area.maxY - frame.height))
        window.setFrame(frame, display: true)
    }

    static func alignTrafficLights(in window: NSWindow) {
        guard let content = window.contentView else { return }
        for (index, type) in buttons.enumerated() {
            guard let button = window.standardWindowButton(type), let parent = button.superview else { continue }
            let size = button.frame.size
            let y = content.isFlipped ? CGFloat(21) : content.bounds.height - 21
            let frame = parent.convert(NSRect(x: 21 + CGFloat(index) * 22 - size.width / 2, y: y - size.height / 2,
                                              width: size.width, height: size.height), from: content)
            if abs(button.frame.minX - frame.minX) > 0.1 || abs(button.frame.minY - frame.minY) > 0.1 {
                button.setFrameOrigin(frame.origin)
            }
        }
    }

    static func trafficLightCenters(in window: NSWindow) -> [CGFloat] {
        guard let content = window.contentView else { return [] }
        return buttons.compactMap { type in
            guard let button = window.standardWindowButton(type), let parent = button.superview else { return nil }
            let frame = content.convert(button.frame, from: parent)
            return content.isFlipped ? frame.midY : content.bounds.height - frame.midY
        }
    }
}
