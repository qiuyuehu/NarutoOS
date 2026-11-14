import AppKit
let input=CommandLine.arguments[1],output=CommandLine.arguments[2]
guard let image=NSImage(contentsOfFile:input),let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:1024,pixelsHigh:1024,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0),let context=NSGraphicsContext(bitmapImageRep:bitmap) else {fatalError("图标读取失败")}
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=context
image.draw(in:NSRect(x:0,y:0,width:1024,height:1024))
NSColor(calibratedRed:0.14,green:0.16,blue:0.15,alpha:1).setFill()
NSBezierPath(ovalIn:NSRect(x:692,y:72,width:250,height:250)).fill()
NSColor.white.setStroke()
let pad=NSBezierPath(roundedRect:NSRect(x:737,y:146,width:160,height:101),xRadius:32,yRadius:32);pad.lineWidth=12;pad.stroke()
let cross=NSBezierPath();cross.move(to:NSPoint(x:760,y:196));cross.line(to:NSPoint(x:801,y:196));cross.move(to:NSPoint(x:780,y:176));cross.line(to:NSPoint(x:780,y:217));cross.lineWidth=10;cross.lineCapStyle = .round;cross.stroke()
NSColor.white.setFill();NSBezierPath(ovalIn:NSRect(x:849,y:196,width:15,height:15)).fill();NSBezierPath(ovalIn:NSRect(x:870,y:174,width:15,height:15)).fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output))
