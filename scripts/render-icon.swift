// Deterministic macOS icon layout: original artwork inside a vector silhouette.
import AppKit

guard CommandLine.arguments.count == 3,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fatalError("Expected readable source and output PNG paths")
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill(using: .copy)
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let radius: CGFloat = 185
// Cubic corners ease into the straight edges more gradually than circular arcs.
let outline = NSBezierPath()
outline.move(to: NSPoint(x: tile.minX + radius, y: tile.minY))
outline.line(to: NSPoint(x: tile.maxX - radius, y: tile.minY))
outline.curve(to: NSPoint(x: tile.maxX, y: tile.minY + radius),
  controlPoint1: NSPoint(x: tile.maxX - radius * 0.28, y: tile.minY),
  controlPoint2: NSPoint(x: tile.maxX, y: tile.minY + radius * 0.28))
outline.line(to: NSPoint(x: tile.maxX, y: tile.maxY - radius))
outline.curve(to: NSPoint(x: tile.maxX - radius, y: tile.maxY),
  controlPoint1: NSPoint(x: tile.maxX, y: tile.maxY - radius * 0.28),
  controlPoint2: NSPoint(x: tile.maxX - radius * 0.28, y: tile.maxY))
outline.line(to: NSPoint(x: tile.minX + radius, y: tile.maxY))
outline.curve(to: NSPoint(x: tile.minX, y: tile.maxY - radius),
  controlPoint1: NSPoint(x: tile.minX + radius * 0.28, y: tile.maxY),
  controlPoint2: NSPoint(x: tile.minX, y: tile.maxY - radius * 0.28))
outline.line(to: NSPoint(x: tile.minX, y: tile.minY + radius))
outline.curve(to: NSPoint(x: tile.minX + radius, y: tile.minY),
  controlPoint1: NSPoint(x: tile.minX, y: tile.minY + radius * 0.28),
  controlPoint2: NSPoint(x: tile.minX + radius * 0.28, y: tile.minY))
outline.close()
outline.addClip()
image.draw(in: tile, from: .zero, operation: .sourceOver, fraction: 1,
  respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
NSGraphicsContext.restoreGraphicsState()
guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG export failed") }
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
