import Foundation
import Security
import CryptoKit

func defaultPreferences()->[String:Any] {
 ["quality":"high","muted":false,"localization":false,"flash":"34","autoClose":true,"theme":"system","titleBarColor":NSNull(),"region":"br","lobbyBackground":NSNull(),"lobbyMotion":true]
}

func validatePreference(_ key:String, _ value:Any) throws {
 switch key {
 case "quality": guard let s=value as? String,["low","medium","high"].contains(s) else {throw ProtoError.failure("画质需为低、中或高")}
 case "flash": guard let s=value as? String,["31","34"].contains(s) else {throw ProtoError.failure("Flash版本无效")}
 case "theme": guard let s=value as? String,["system","light","dark"].contains(s) else {throw ProtoError.failure("主题无效")}
 case "region": guard let s=value as? String,["br","cn"].contains(s) else {throw ProtoError.failure("地区无效")}
 case "autoClose","muted","localization","lobbyMotion": guard let n=value as? NSNumber,CFGetTypeID(n)==CFBooleanGetTypeID() else {throw ProtoError.failure("开关值无效")}
 case "lobbyBackground","titleBarColor": guard value is NSNull || ((value as? String)?.range(of:"^#[0-9a-fA-F]{6}$",options:.regularExpression) != nil) else {throw ProtoError.failure("颜色无效")}
 default: throw ProtoError.failure("设置字段未开放")
 }
}
func checkedName(_ payload:[String:Any]) throws -> (String,String) {
 let name=(payload["name"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
 let note=(payload["serverNote"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
 guard !name.isEmpty,name.count<=40,note.count<=40 else {throw ProtoError.failure("名称需为1–40字，备注最多40字")};return(name,note)
}
final class CoreVault {
 let service:String;let key:SymmetricKey
 init(_ root:String,_ secret:String){service="cn.youye.naruto-os.test.native-core.credentials.\(URL(fileURLWithPath:root).lastPathComponent)";key=SymmetricKey(data:Data(secret.utf8))}
 var query:[String:Any]{[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"vault-v1"]}
 func read() throws -> [[String:Any]] {
  var q=query;q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne;var item:CFTypeRef?
  let status=SecItemCopyMatching(q as CFDictionary,&item);if status==errSecItemNotFound{return []}
  guard status==errSecSuccess,let data=item as? Data,let records=try JSONSerialization.jsonObject(with:data) as? [[String:Any]],records.allSatisfy({$0["id"] is String && $0["origin"] is String && $0["username"] is String && $0["password"] is String}) else {throw ProtoError.failure("密码库读取失败；原内容保留")};return records
 }
 func write(_ records:[[String:Any]]) throws {
  let data=try json(records);var status=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
  if status==errSecItemNotFound {var q=query;q[kSecValueData as String]=data;q[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly;status=SecItemAdd(q as CFDictionary,nil)}
  guard status==errSecSuccess else {throw ProtoError.failure("密码未能保存到钥匙串")}
 }
 func importedDate(_ text:String) throws -> Date {
  let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
  if let date=formatter.date(from:text){return date}
  formatter.formatOptions=[.withInternetDateTime]
  guard let date=formatter.date(from:text) else{throw ProtoError.failure("密码更新时间无效")};return date
 }
 func mergedImport(_ incoming:[[String:Any]]) throws -> (records:[[String:Any]],changed:Int) {
  var records=try read();var changed=0
  for item in incoming {
   guard let id=item["id"] as? String,!id.isEmpty,let origin=item["origin"] as? String,credentialStorageOrigin(origin),let user=item["username"] as? String,!user.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,user.count<=320,let password=item["password"] as? String,!password.isEmpty,password.count<=4096,let updated=item["updatedAt"] as? String else{throw ProtoError.failure("旧密码资料格式无效")}
   let sourceDate=try importedDate(updated)
   var record=item;record["username"]=user.trimmingCharacters(in:.whitespacesAndNewlines)
   if let i=records.firstIndex(where:{$0["origin"] as? String==origin && $0["username"] as? String==record["username"] as? String}) {
    if records[i]["password"] as? String==password {continue}
    let currentDate=try importedDate(records[i]["updatedAt"] as? String ?? "")
    guard sourceDate>currentDate else{continue}
    record["id"]=records[i]["id"];records[i]=record;changed+=1
   }else{
    if records.contains(where:{$0["id"] as? String==id}){record["id"]=UUID().uuidString}
    records.append(record);changed+=1
   }
  }
  return (records,changed)
 }
 func version(_ record:[String:Any])->String {HMAC<SHA256>.authenticationCode(for:(try? json(record)) ?? Data(),using:key).map{String(format:"%02x",$0)}.joined()}
 func metadata(_ record:[String:Any])->[String:Any]{var value=record;value.removeValue(forKey:"password");value["version"]=version(record);return value}
 func manage(_ command:String,_ payload:[String:Any]) throws -> [String:Any] {
  var records=try read()
  if command=="credentials.metadata"{return ["records":records.map(metadata)]}
  if command=="credentials.reveal" {guard let r=records.first(where:{$0["id"] as? String==payload["id"] as? String}) else {throw ProtoError.failure("记录已不存在")};return ["password":r["password"]!]}
  if command=="credentials.remove" {
   guard let i=records.firstIndex(where:{$0["id"] as? String==payload["id"] as? String}) else {return [:]}
   records.remove(at:i);try write(records);return [:]
  }
  let origin:String
  if let site=payload["siteId"] as? String {guard ["br","cn"].contains(site) else {throw ProtoError.failure("站点无效")};origin=site=="br" ? "https://naruto.narutowebgame.com":"https://huoying.qq.com"}
  else {guard let s=payload["origin"] as? String,credentialStorageOrigin(s) else {throw ProtoError.failure("站点无效")};origin=s}
  let user=(payload["username"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines);let password=payload["password"] as? String ?? ""
  guard !user.isEmpty,user.count<=320,!password.isEmpty,password.count<=4096 else {throw ProtoError.failure("账号密码无效")}
  let index=records.firstIndex{r in if let id=payload["id"] as? String{return r["id"] as? String==id && r["origin"] as? String==origin};return r["origin"] as? String==origin && r["username"] as? String==user}
  if index==nil && payload["expected"] != nil {return ["status":"stale"]}
  if index==nil && command=="credentials.edit" {throw ProtoError.failure("记录已删除，请重新打开密码列表")}
  let currentID=index.flatMap{records[$0]["id"] as? String}
  guard !records.contains(where:{$0["origin"] as? String==origin && $0["username"] as? String==user && $0["id"] as? String != currentID}) else{throw ProtoError.failure("该网站已保存同名账号")}

  if let i=index {
   if command=="credentials.edit" {
    guard let expected=payload["expectedVersion"] as? String,expected==version(records[i]) else {throw ProtoError.failure("密码记录已更新，请重新打开编辑后再保存")}
   }
   if records[i]["username"] as? String==user && records[i]["password"] as? String==password {return ["status":"unchanged"]}
   if command=="credentials.addManual" {
    guard let expected=payload["expected"] as? [String:Any],expected["id"] as? String==records[i]["id"] as? String,expected["version"] as? String==version(records[i]) else {return ["status":"confirm-update","id":records[i]["id"]!,"version":version(records[i])]}
   }
   records[i]["username"]=user;records[i]["password"]=password;records[i]["updatedAt"]=ISO8601DateFormatter().string(from:Date())
  }else {records.append(["id":UUID().uuidString,"origin":origin,"username":user,"password":password,"updatedAt":ISO8601DateFormatter().string(from:Date())])}
  try write(records);return ["status":"saved"]
 }
}

func trustedCredentialOrigin(_ origin:String)->Bool {
 guard let url=URLComponents(string:origin),url.scheme=="https",url.user==nil,url.password==nil,url.path.isEmpty,url.query==nil,url.fragment==nil,let host=url.host else{return false}
 return ["naruto.narutowebgame.com","naruto.oasgames.com","passport.oasgames.com","passport.narutowebgame.com"].contains(host) || host.range(of:#"^(?:s[0-9]+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?[0-9]+)?)\.oasgames\.com$"#,options:.regularExpression) != nil
}

func credentialStorageOrigin(_ origin:String)->Bool {
 trustedCredentialOrigin(origin) || origin=="https://huoying.qq.com"
}
