import AppKit
import Foundation

let outputPath = CommandLine.arguments.count > 1
  ? CommandLine.arguments[1]
  : "src-tauri/icons/icon.png"

let canvasSize: CGFloat = 1024
let image = NSImage(size: NSSize(width: canvasSize, height: canvasSize))
image.lockFocus()

let context = NSGraphicsContext.current!.cgContext
context.setFillColor(NSColor.clear.cgColor)
context.fill(CGRect(x: 0, y: 0, width: canvasSize, height: canvasSize))

let cardInset: CGFloat = 62
let cardRect = NSRect(
  x: cardInset,
  y: cardInset,
  width: canvasSize - cardInset * 2,
  height: canvasSize - cardInset * 2
)
let cardPath = NSBezierPath(roundedRect: cardRect, xRadius: 210, yRadius: 210)

let gradient = NSGradient(colors: [
  NSColor(calibratedRed: 0.03, green: 0.21, blue: 0.63, alpha: 1.0),
  NSColor(calibratedRed: 0.02, green: 0.67, blue: 0.92, alpha: 1.0),
])!
gradient.draw(in: cardPath, angle: -42)

let glossRect = NSRect(
  x: cardRect.minX + 70,
  y: cardRect.maxY - 280,
  width: cardRect.width - 140,
  height: 170
)
let glossPath = NSBezierPath(roundedRect: glossRect, xRadius: 80, yRadius: 80)
NSColor(calibratedWhite: 1.0, alpha: 0.16).setFill()
glossPath.fill()

let shield = NSBezierPath()
shield.move(to: NSPoint(x: 512, y: 740))
shield.curve(
  to: NSPoint(x: 692, y: 650),
  controlPoint1: NSPoint(x: 575, y: 728),
  controlPoint2: NSPoint(x: 653, y: 700)
)
shield.line(to: NSPoint(x: 692, y: 490))
shield.curve(
  to: NSPoint(x: 512, y: 300),
  controlPoint1: NSPoint(x: 692, y: 418),
  controlPoint2: NSPoint(x: 622, y: 332)
)
shield.curve(
  to: NSPoint(x: 332, y: 490),
  controlPoint1: NSPoint(x: 402, y: 332),
  controlPoint2: NSPoint(x: 332, y: 418)
)
shield.line(to: NSPoint(x: 332, y: 650))
shield.curve(
  to: NSPoint(x: 512, y: 740),
  controlPoint1: NSPoint(x: 371, y: 700),
  controlPoint2: NSPoint(x: 449, y: 728)
)
shield.lineCapStyle = .round
shield.lineJoinStyle = .round
shield.lineWidth = 54
NSColor(calibratedRed: 0.89, green: 0.98, blue: 1.0, alpha: 1.0).setStroke()
shield.stroke()

image.unlockFocus()

guard
  let tiffData = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffData),
  let pngData = bitmap.representation(
    using: .png,
    properties: [.compressionFactor: 1.0]
  )
else {
  fputs("[generate-brand-icon] failed to encode PNG\n", stderr)
  exit(1)
}

let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
  at: outputURL.deletingLastPathComponent(),
  withIntermediateDirectories: true,
  attributes: nil
)
try pngData.write(to: outputURL)
print("[generate-brand-icon] wrote \(outputPath)")
