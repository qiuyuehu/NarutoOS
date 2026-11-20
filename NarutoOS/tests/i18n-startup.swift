import Foundation
import Darwin
@main struct CheckStartupLanguage {
 static func main() throws {
  var rejected=false
  do {try validatePreference("language","invalid")}catch{rejected=true}
  var disconnectedCode=""
  do {let fd=try connectSocket((ProcessInfo.processInfo.environment["NARUTO_C_ROOT"] ?? "/tmp")+"/absent-i18n-core");close(fd)}
  catch {if case ProtoError.failure(let detail)=error{disconnectedCode=messageCode(detail)}}
  let value:[String:Any] = ["disconnectedCode":disconnectedCode,"language":startupLanguage(),"title":localized(msg("ui.naruto_os_could_not_start")),"detail":localized(msg("error.coreDisconnected")),"default":defaultPreferences()["language"] ?? "","rejectsInvalid":rejected]
  print(String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)!)
 }
}
