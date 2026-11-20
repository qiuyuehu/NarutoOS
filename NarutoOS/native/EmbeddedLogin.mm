#import <AppKit/AppKit.h>
#include <node_api.h>
#include <cstring>
#include <cstdlib>
#include <map>
extern "C" {
void naruto_login_select(uintptr_t);
bool naruto_login_open(void*,const char*,void(*)(const char*,void*),void*);
void naruto_login_close(); void naruto_login_dispose(); void naruto_login_focus();
void naruto_login_hide(bool); void naruto_login_reload(); bool naruto_login_attached();
void naruto_login_credentials(const char*);
bool naruto_login_visible();
}
static std::map<uintptr_t,napi_threadsafe_function> sinks;
static uintptr_t nextId = 0;
static uintptr_t Select(napi_env env,napi_callback_info info) {
  void* data=nullptr; napi_get_cb_info(env,info,nullptr,nullptr,nullptr,&data);
  auto id=reinterpret_cast<uintptr_t>(data); naruto_login_select(id); return id;
}
static void Cleanup(void*) {
  for(auto entry:sinks){naruto_login_select(entry.first);naruto_login_dispose();napi_release_threadsafe_function(entry.second,napi_tsfn_abort);}
  sinks.clear();
}
static void Deliver(napi_env env,napi_value callback,void*,void* data) {
  char* text=(char*)data;
  if(env && callback) { napi_value value,global; napi_create_string_utf8(env,text,NAPI_AUTO_LENGTH,&value); napi_get_global(env,&global); napi_call_function(env,global,callback,1,&value,nullptr); }
  free(text);
}
static void Emit(const char* text,void* context) {
  char* copy=strdup(text); if(napi_call_threadsafe_function((napi_threadsafe_function)context,copy,napi_tsfn_nonblocking)!=napi_ok) free(copy);
}
static napi_value Open(napi_env env,napi_callback_info info) {
  auto id=Select(env,info); napi_threadsafe_function sink=nullptr;
  size_t count=3,length=0; napi_value args[3]; void* bytes=nullptr; bool buffer=false;
  napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  if(count!=3 || !NSThread.isMainThread || sinks.count(id) || napi_is_buffer(env,args[0],&buffer)!=napi_ok || !buffer || napi_get_buffer_info(env,args[0],&bytes,&length)!=napi_ok || length!=sizeof(void*)) {
    napi_throw_error(env,nullptr,"登录视图无法打开"); return nullptr;
  }
  void* pointer=nullptr; memcpy(&pointer,bytes,sizeof pointer); NSView* host=nil;
  for(NSWindow* w in NSApp.windows) if((__bridge void*)w.contentView==pointer) host=w.contentView;
  if(!host) {napi_throw_error(env,nullptr,"主窗口已关闭");return nullptr;}
  size_t size=0; napi_valuetype type;
  if(napi_typeof(env,args[2],&type)!=napi_ok || type!=napi_function || napi_get_value_string_utf8(env,args[1],nullptr,0,&size)!=napi_ok || size>1048576) {napi_throw_error(env,nullptr,"登录参数无效");return nullptr;}
  char* options=(char*)malloc(size+1); napi_get_value_string_utf8(env,args[1],options,size+1,&size);
   napi_value name; napi_create_string_utf8(env,"NarutoEmbeddedLogin",NAPI_AUTO_LENGTH,&name);
  if(napi_create_threadsafe_function(env,args[2],nullptr,name,0,1,nullptr,nullptr,nullptr,Deliver,&sink)!=napi_ok) {free(options);napi_throw_error(env,nullptr,"登录回调无法建立");return nullptr;}
   bool ok=naruto_login_open(pointer,options,Emit,sink);free(options);
  if(!ok) {napi_release_threadsafe_function(sink,napi_tsfn_release);sink=nullptr;napi_throw_error(env,nullptr,"登录视图无法打开");return nullptr;}
  sinks[id]=sink; napi_value result;napi_get_boolean(env,true,&result);return result;
}
static napi_value Close(napi_env env,napi_callback_info info) {Select(env,info);naruto_login_close();return nullptr;}
static napi_value Dispose(napi_env env,napi_callback_info info) {auto id=Select(env,info);naruto_login_dispose();auto it=sinks.find(id);if(it!=sinks.end()){napi_release_threadsafe_function(it->second,napi_tsfn_release);sinks.erase(it);}return nullptr;}
static napi_value Focus(napi_env env,napi_callback_info info) {Select(env,info);naruto_login_focus();return nullptr;}
static napi_value Reload(napi_env env,napi_callback_info info) {Select(env,info);naruto_login_reload();return nullptr;}
static napi_value Credentials(napi_env env,napi_callback_info info) {
  Select(env,info); size_t n=1,size=0; napi_value value; napi_valuetype type;
  napi_get_cb_info(env,info,&n,&value,nullptr,nullptr);
  if(n!=1 || napi_typeof(env,value,&type)!=napi_ok || type!=napi_string || napi_get_value_string_utf8(env,value,nullptr,0,&size)!=napi_ok || size>65536) {
    napi_throw_error(env,nullptr,"登录账号请求无效"); return nullptr;
  }
  char* json=(char*)malloc(size+1);
  if(!json || napi_get_value_string_utf8(env,value,json,size+1,&size)!=napi_ok) { free(json); napi_throw_error(env,nullptr,"登录账号请求失败"); return nullptr; }
  naruto_login_credentials(json); free(json); return nullptr;
}
static napi_value Hide(napi_env env,napi_callback_info info) {Select(env,info);size_t n=1;napi_value v;bool b=false;napi_get_cb_info(env,info,&n,&v,nullptr,nullptr);if(n==1)napi_get_value_bool(env,v,&b);naruto_login_hide(b);return nullptr;}
static napi_value Measure(napi_env env,napi_callback_info info) {Select(env,info);napi_value v;napi_get_boolean(env,naruto_login_attached(),&v);return v;}
static napi_value Windows(napi_env env,napi_callback_info) {napi_value v;napi_create_uint32(env,(uint32_t)NSApp.windows.count,&v);return v;}
static napi_value Visible(napi_env env,napi_callback_info info) {Select(env,info);napi_value v;napi_get_boolean(env,naruto_login_visible(),&v);return v;}
static void Bind(napi_env env,napi_value exports,uintptr_t id) {
  napi_property_descriptor methods[]={{"open",0,Open,0,0,0,napi_default,0},{"close",0,Close,0,0,0,napi_default,0},{"dispose",0,Dispose,0,0,0,napi_default,0},{"focus",0,Focus,0,0,0,napi_default,0},{"hide",0,Hide,0,0,0,napi_default,0},{"reload",0,Reload,0,0,0,napi_default,0},{"attached",0,Measure,0,0,0,napi_default,0},{"respond",0,Credentials,0,0,0,napi_default,0}};
  for(auto& method:methods) method.data=reinterpret_cast<void*>(id);
  napi_define_properties(env,exports,8,methods);
  napi_value fn;napi_create_function(env,"windows",NAPI_AUTO_LENGTH,Windows,nullptr,&fn);napi_set_named_property(env,exports,"windows",fn);
  napi_create_function(env,"visible",NAPI_AUTO_LENGTH,Visible,reinterpret_cast<void*>(id),&fn);napi_set_named_property(env,exports,"visible",fn);}
static napi_value Create(napi_env env,napi_callback_info){napi_value obj;napi_create_object(env,&obj);Bind(env,obj,++nextId);return obj;}
static napi_value Init(napi_env env,napi_value exports){
  if(!NSThread.isMainThread){napi_throw_error(env,nullptr,"登录组件仅支持主线程");return nullptr;}
  napi_add_env_cleanup_hook(env,Cleanup,nullptr);Bind(env,exports,0);
  napi_value fn;napi_create_function(env,"create",NAPI_AUTO_LENGTH,Create,nullptr,&fn);napi_set_named_property(env,exports,"create",fn);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,Init)
