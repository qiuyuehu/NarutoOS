import AppKit

// MARK: - Progress panel

final class UpdateProgressPanel: NSObject {
    private let window: NSWindow
    private let titleLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(labelWithString: "")
    private let progress = NSProgressIndicator()
    private let cancelButton = NSButton()
    var onCancel: (() -> Void)?

    override init() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 168),
                          styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        super.init()
        window.title = UpdateContract.applicationName
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 168))
        window.contentView = content
        titleLabel.frame = NSRect(x: 24, y: 118, width: 432, height: 22)
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        detailLabel.frame = NSRect(x: 24, y: 64, width: 432, height: 44)
        detailLabel.font = .systemFont(ofSize: 12)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.maximumNumberOfLines = 2
        progress.frame = NSRect(x: 24, y: 46, width: 432, height: 12)
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 1
        cancelButton.frame = NSRect(x: 360, y: 12, width: 96, height: 26)
        cancelButton.bezelStyle = .rounded
        cancelButton.target = self
        cancelButton.action = #selector(cancelTapped)
        content.addSubview(titleLabel)
        content.addSubview(detailLabel)
        content.addSubview(progress)
        content.addSubview(cancelButton)
    }

    @objc private func cancelTapped() {
        onCancel?()
    }

    func show(title: String, detail: String, determinate: Bool, cancelVisible: Bool) {
        titleLabel.stringValue = title
        detailLabel.stringValue = detail
        progress.isIndeterminate = !determinate
        if determinate {
            progress.doubleValue = 0
        } else {
            progress.startAnimation(nil)
        }
        cancelButton.isHidden = !cancelVisible
        cancelButton.isEnabled = cancelVisible
        cancelButton.title = localized(msg("update.cancel_button"))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func setTitle(_ title: String) {
        titleLabel.stringValue = title
    }

    func setDetail(_ detail: String) {
        detailLabel.stringValue = detail
    }

    func setProgress(_ value: Double) {
        progress.isIndeterminate = false
        progress.doubleValue = min(1, max(0, value))
    }

    func setDeterminate(_ determinate: Bool) {
        progress.isIndeterminate = !determinate
        if determinate { progress.stopAnimation(nil) } else { progress.startAnimation(nil) }
    }

    func setCancelEnabled(_ enabled: Bool) {
        cancelButton.isHidden = !enabled
        cancelButton.isEnabled = enabled
    }

    func close() {
        progress.stopAnimation(nil)
        window.orderOut(nil)
    }
}
