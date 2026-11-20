// Electron 11 exposes position but not size. Scale the existing AppKit controls,
// keeping their native targets, tracking, accessibility and full-screen behavior.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <cstring>
#include <cmath>

static char OriginalBounds;
static NSWindow* Window(napi_env env, napi_callback_info info) {
  size_t argc = 1, length = 0; napi_value arg; void* bytes = nullptr; bool buffer = false;
  napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
  if (argc != 1 || ![NSThread isMainThread] || napi_is_buffer(env, arg, &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, arg, &bytes, &length) != napi_ok || length != sizeof(void*)) {
    napi_throw_error(env, nullptr, "无效的原生窗口句柄"); return nil;
  }
  // Compare against windows we own; never dereference an arbitrary pointer.
  void* pointer = nullptr; std::memcpy(&pointer, bytes, sizeof(pointer));
  for (NSWindow* window in NSApp.windows) if ((__bridge void*)window.contentView == pointer) return window;
  napi_throw_error(env, nullptr, "原生窗口已关闭"); return nil;
}
static NSArray<NSButton*>* Buttons(NSWindow* window) {
  NSButton* close = [window standardWindowButton:NSWindowCloseButton];
  NSButton* minimize = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton* zoom = [window standardWindowButton:NSWindowZoomButton];
  return close && minimize && zoom ? @[close, minimize, zoom] : @[];
}
static bool RectNear(NSRect a, NSRect b) {
  // AppKit round-trips through scaled coordinates; tiny floating-point drift
  // must not cause perpetual frame notifications or redraws.
  return std::abs(a.origin.x-b.origin.x)<.01 && std::abs(a.origin.y-b.origin.y)<.01 &&
    std::abs(a.size.width-b.size.width)<.01 && std::abs(a.size.height-b.size.height)<.01;
}
static bool Layout(NSWindow* window) {
    NSArray<NSButton*>* buttons = Buttons(window);
    // Full-screen controls belong to the system's revealed menu bar.
    bool applied = buttons.count == 3 && !(window.styleMask & NSWindowStyleMaskFullScreen);
    if (applied) {
      NSUInteger index = 0;
      for (NSButton* button in buttons) {
        NSValue* original = objc_getAssociatedObject(button, &OriginalBounds);
        if (!original) {
          original = [NSValue valueWithRect:button.bounds];
          objc_setAssociatedObject(button, &OriginalBounds, original, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        }
        NSRect bounds = original.rectValue;
        // Measured Electron 11 widget: 14×16pt bounds, 12pt colored circle.
        // Resize the drawing as well as the frame: changing frame alone leaves
        // the circle at 12pt. Always reuse the original bounds, never compound.
        CGFloat scale = 14.0 / MAX(1.0, bounds.size.width - 2.0);
        NSSize size = NSMakeSize(bounds.size.width * scale, bounds.size.height * scale);
        NSView* content = window.contentView;
        CGFloat centerY = content.isFlipped ? 21 : NSHeight(content.bounds) - 21;
        NSRect frame = NSMakeRect(21 + index * 22 - size.width / 2, centerY - size.height / 2, size.width, size.height);
        NSRect target = [button.superview convertRect:frame fromView:content];
        // Notifications include our own changes; identical geometry must be a no-op.
        if (!RectNear(button.frame, target)) button.frame = target;
        if (!RectNear(button.bounds, bounds)) button.bounds = bounds;
        index++;
      }
    }
    return applied;
}
#ifdef NARUTO_NATIVE_TEST
#define NarutoTrafficLightLayout NarutoTrafficLightLayoutTest
#endif
static char LayoutKeeper;
// AppKit can lay out standard buttons AFTER Electron's focus callback. Observe
// real frame/layout changes rather than racing them with a JavaScript timeout.
@interface NarutoTrafficLightLayout : NSObject
@property(nonatomic, weak) NSWindow* window;
@property(nonatomic, strong) NSMutableArray* tokens;
@property(nonatomic, strong) NSArray<NSView*>* views;
@property(nonatomic) BOOL queued;
@property(nonatomic) BOOL closed;
- (void)observeViews;
- (void)schedule;
@end
@implementation NarutoTrafficLightLayout
- (instancetype)init {
  if ((self = [super init])) _tokens = [NSMutableArray array];
  return self;
}
- (void)observeViews {
  NSMutableArray* views = [NSMutableArray array];
  for (NSButton* button in Buttons(self.window)) {
    [views addObject:button];
    if (button.superview && ![views containsObject:button.superview]) [views addObject:button.superview];
  }
  if ([self.views isEqualToArray:views]) return;
  NSNotificationCenter* center = NSNotificationCenter.defaultCenter;
  for (id token in self.tokens) [center removeObserver:token];
  [self.tokens removeAllObjects]; self.views = views;
  __weak NarutoTrafficLightLayout* weakSelf = self;
  for (NSView* view in views) {
    view.postsFrameChangedNotifications = YES;
    view.postsBoundsChangedNotifications = YES;
    for (NSString* name in @[NSViewFrameDidChangeNotification, NSViewBoundsDidChangeNotification])
      [self.tokens addObject:[center addObserverForName:name object:view queue:nil usingBlock:^(NSNotification* note) { [weakSelf schedule]; }]];
  }
  [self.tokens addObject:[center addObserverForName:NSWindowWillCloseNotification object:self.window queue:nil usingBlock:^(NSNotification* note) {
    NarutoTrafficLightLayout* keeper = weakSelf; if (!keeper) return;
    keeper.closed = YES;
    for (id token in keeper.tokens) [NSNotificationCenter.defaultCenter removeObserver:token];
    [keeper.tokens removeAllObjects]; keeper.views = nil;
  }]];
  for (NSString* name in @[NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification, NSWindowDidResizeNotification, NSWindowDidExitFullScreenNotification])
    [self.tokens addObject:[center addObserverForName:name object:self.window queue:nil usingBlock:^(NSNotification* note) { [weakSelf schedule]; }]];
}
- (void)schedule {
  if (self.queued || self.closed) return;
  self.queued = YES;
  __weak NarutoTrafficLightLayout* weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    NarutoTrafficLightLayout* keeper = weakSelf; if (!keeper || keeper.closed) return;
    keeper.queued = NO;
    NSWindow* window = keeper.window; if (!window || ![NSApp.windows containsObject:window]) return;
    [keeper observeViews]; Layout(window);
  });
}
- (void)dealloc {
  for (id token in self.tokens) [NSNotificationCenter.defaultCenter removeObserver:token];
}
@end
static napi_value Apply(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSWindow* window = Window(env, info); if (!window) return nullptr;
    NarutoTrafficLightLayout* keeper = objc_getAssociatedObject(window, &LayoutKeeper);
    if (!keeper) {
      keeper = [NarutoTrafficLightLayout new]; keeper.window = window;
      objc_setAssociatedObject(window, &LayoutKeeper, keeper, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    [keeper observeViews];
    napi_value result; napi_get_boolean(env, Layout(window), &result); return result;
  }
}
// Main-process diagnostics used by the isolated native regression checks.
static napi_value Measure(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSWindow* window = Window(env, info); if (!window) return nullptr;
    NSMutableArray* rows = [NSMutableArray array];
    for (NSButton* button in Buttons(window)) {
      NSRect frame = [button convertRect:button.bounds toView:window.contentView];
      CGFloat top = window.contentView.isFlipped ? NSMinY(frame) : NSHeight(window.contentView.bounds) - NSMaxY(frame);
      CGFloat scale = NSWidth(frame) / NSWidth(button.bounds);
      NSPoint center = NSMakePoint(NSMidX(frame), NSMidY(frame));
      NSPoint local = [button.superview convertPoint:center fromView:window.contentView];
      [rows addObject:@{@"x":@(NSMinX(frame)), @"y":@(top), @"width":@(NSWidth(frame)), @"height":@(NSHeight(frame)),
        @"circle":@((NSWidth(button.bounds) - 2) * scale), @"action":NSStringFromSelector(button.action) ?: @"",
        @"visible":@(!button.hiddenOrHasHiddenAncestor), @"nativeHit":@([button hitTest:local] == button), @"enabled":@(button.enabled)}];
    }
    NSData* data = [NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];
    napi_value result; napi_create_string_utf8(env, (const char*)data.bytes, data.length, &result); return result;
  }
}
#ifdef NARUTO_NATIVE_TEST
// View-cache captures contain the native alpha masks (not website pixels).
static napi_value Snapshot(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSWindow* window = Window(env, info); if (!window) return nullptr;
    NSView* parent = Buttons(window).firstObject.superview;
    NSRect rect = NSMakeRect(0, 0, MIN(100, NSWidth(parent.bounds)), NSHeight(parent.bounds));
    NSBitmapImageRep* bitmap = [parent bitmapImageRepForCachingDisplayInRect:rect];
    [parent cacheDisplayInRect:rect toBitmapImageRep:bitmap];
    NSData* data = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    napi_value result; napi_create_buffer_copy(env, data.length, data.bytes, nullptr, &result); return result;
  }
}
// Reproduce AppKit resetting positions after an asynchronous activation layout.
static napi_value Relayout(napi_env env, napi_callback_info info) {
  NSWindow* window = Window(env, info); if (!window) return nullptr;
  for (NSButton* button in Buttons(window)) {
    NSRect frame = button.frame; frame.origin.x -= 4; frame.origin.y += 8; button.frame = frame;
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value Click(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t argc = 2; napi_value args[2]; int32_t index = -1;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    void* bytes = nullptr; size_t length = 0; napi_value result; napi_get_undefined(env, &result);
    if (argc != 2 || napi_get_buffer_info(env,args[0],&bytes,&length) != napi_ok || length != sizeof(void*) || napi_get_value_int32(env,args[1],&index) != napi_ok || index < 0 || index > 2) return result;
    void* pointer = nullptr; std::memcpy(&pointer,bytes,sizeof(pointer));
    for(NSWindow* window in NSApp.windows) if((__bridge void*)window.contentView == pointer) { [Buttons(window)[index] performClick:nil]; break; }
    return result;
  }
}
#endif
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"apply", nullptr, Apply, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"measure", nullptr, Measure, nullptr, nullptr, nullptr, napi_default, nullptr},
#ifdef NARUTO_NATIVE_TEST
    {"snapshot", nullptr, Snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"click", nullptr, Click, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"relayout", nullptr, Relayout, nullptr, nullptr, nullptr, napi_default, nullptr},
#endif
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties); return exports;
}
NAPI_MODULE(traffic_lights, Init)
