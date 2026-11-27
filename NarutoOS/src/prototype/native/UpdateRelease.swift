import Foundation

// MARK: - URL policy

enum UpdateURLPolicy {
    static func isLocalHost(_ host: String) -> Bool {
        host == "127.0.0.1" || host == "::1" || host == "localhost"
    }

    static func allowedDownloadHost(_ host: String, allowLocal: Bool) -> Bool {
        if UpdateContract.downloadHosts.contains(host) { return true }
        return allowLocal && isLocalHost(host)
    }

    static func checkMetadataURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && host == "api.github.com" && url.port == nil && url.query == nil
    }

    static func checkAssetURL(_ url: URL, assetName: String, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        guard scheme == "https", host == "github.com", url.port == nil else { return false }
        guard url.path.hasPrefix("/" + UpdateContract.repository + "/releases/download/") else { return false }
        let last = url.path.split(separator: "/").last.map(String.init) ?? ""
        return last == assetName
    }

    static func checkMetadataRedirectURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && host == "api.github.com" && url.port == nil
    }

    static func checkRedirectURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && allowedDownloadHost(host, allowLocal: false)
    }
}

// MARK: - Digest

func parseSHA256Digest(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard text.hasPrefix("sha256:") else { return nil }
    let hex = String(text.dropFirst("sha256:".count))
    guard hex.count == 64, hex.allSatisfy({ $0.isHexDigit && $0.isASCII }) else { return nil }
    return hex
}

// MARK: - Release payload

struct UpdateReleaseAsset {
    let id: Int64
    let name: String
    let size: Int64
    let digest: String
    let downloadURL: URL
}

struct UpdateReleaseHeader {
    let releaseID: Int64
    let tag: String
    let version: ReleaseVersion
    let notes: String
}

struct UpdateReleasePayload {
    let header: UpdateReleaseHeader
    let object: [String: Any]
}

struct UpdateRelease {
    let releaseID: Int64
    let tag: String
    let version: ReleaseVersion
    let notes: String
    let asset: UpdateReleaseAsset
}

func parseReleaseHeader(_ object: [String: Any]) throws -> UpdateReleaseHeader {
    if object["draft"] as? Bool == true || object["prerelease"] as? Bool == true {
        throw updateFailure("update.release_not_stable")
    }
    guard let tag = object["tag_name"] as? String, let version = ReleaseVersion.parse(tag) else {
        throw updateFailure("update.release_invalid")
    }
    guard let releaseID = (object["id"] as? NSNumber)?.int64Value else {
        throw updateFailure("update.release_invalid")
    }
    let notes = ((object["body"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return UpdateReleaseHeader(releaseID: releaseID, tag: tag, version: version, notes: notes)
}

func parseReleaseAsset(_ object: [String: Any], version: ReleaseVersion, allowLocal: Bool,
                       channel: UpdateChannel = .current) throws -> UpdateReleaseAsset {
    guard let assets = object["assets"] as? [[String: Any]] else {
        throw updateFailure("update.asset_missing")
    }
    let expected = expectedAssetName(for: version, channel: channel)
    let matches = assets.filter { ($0["name"] as? String) == expected && ($0["state"] as? String ?? "uploaded") == "uploaded" }
    guard matches.count == 1 else { throw updateFailure("update.asset_missing") }
    let entry = matches[0]
    guard let assetID = (entry["id"] as? NSNumber)?.int64Value else { throw updateFailure("update.release_invalid") }
    guard let size = (entry["size"] as? NSNumber)?.int64Value, size > 0, size <= UpdateContract.maxDownloadBytes else {
        throw updateFailure("update.asset_size_invalid")
    }
    guard let digestRaw = entry["digest"] as? String, let digest = parseSHA256Digest(digestRaw) else {
        throw updateFailure("update.asset_digest_missing")
    }
    guard let urlText = entry["browser_download_url"] as? String,
          let url = URL(string: urlText),
          UpdateURLPolicy.checkAssetURL(url, assetName: expected, allowLocal: allowLocal) else {
        throw updateFailure("update.asset_url_invalid")
    }
    return UpdateReleaseAsset(id: assetID, name: expected, size: size, digest: digest, downloadURL: url)
}

// The asset is only validated after the version is known to be newer: an older
// release with a non-conforming asset name must not turn "up to date" into an error.
func parseReleasePayload(_ object: [String: Any], allowLocal: Bool,
                         channel: UpdateChannel = .current) throws -> UpdateRelease {
    let header = try parseReleaseHeader(object)
    let asset = try parseReleaseAsset(object, version: header.version, allowLocal: allowLocal, channel: channel)
    return UpdateRelease(releaseID: header.releaseID, tag: header.tag, version: header.version, notes: header.notes, asset: asset)
}

// MARK: - Metadata

final class UpdateMetadataClient: NSObject, URLSessionTaskDelegate {
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var completion: ((Result<UpdateReleasePayload, UpdateFailure>) -> Void)?
    private var redirectFailure: UpdateFailure?
    private var redirects = 0
    private let allowLocal: Bool
    private let metadataURL: URL?

    init(allowLocal: Bool, metadataURL: URL? = nil) {
        self.allowLocal = allowLocal
        self.metadataURL = metadataURL
        super.init()
    }

    func fetch(completion: @escaping (Result<UpdateReleasePayload, UpdateFailure>) -> Void) {
        self.completion = completion
        perform(direct: false)
    }

    // The system proxy is the normal path. A shared proxy exit can be rate limited
    // (GitHub returns 403/429 for the shared IP) or unreachable; retry once without
    // the proxy so an update check is not blocked by that environment.
    private func perform(direct: Bool) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = UpdateContract.metadataTimeout
        configuration.timeoutIntervalForResource = UpdateContract.metadataTimeout * 2
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        // Local test servers must not be reached through the user's system proxy.
        if allowLocal || direct { configuration.connectionProxyDictionary = [:] }
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        guard let url = metadataURL ?? URL(string: UpdateContract.metadataURL) else {
            finish(.failure(updateFailure("update.release_invalid")))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("NarutoOS-Update/1", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            if let failure = self.redirectFailure {
                self.finish(.failure(failure))
                return
            }
            if let error = error {
                let code = (error as NSError).code
                if code == NSURLErrorCancelled { self.finish(.failure(updateFailure("update.cancelled"))); return }
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_network")))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.release_invalid")))
                return
            }
            if http.statusCode == 403 || http.statusCode == 429 {
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_http", ["p0": String(http.statusCode)])))
                return
            }
            guard http.statusCode == 200 else {
                if http.statusCode >= 500, self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_http", ["p0": String(http.statusCode)])))
                return
            }
            if let finalURL = http.url, !UpdateURLPolicy.checkMetadataURL(finalURL, allowLocal: self.allowLocal) {
                self.finish(.failure(updateFailure("update.check_network")))
                return
            }
            guard let data = data, let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                self.finish(.failure(updateFailure("update.release_invalid")))
                return
            }
            do {
                let header = try parseReleaseHeader(object)
                self.finish(.success(UpdateReleasePayload(header: header, object: object)))
            } catch let failure as UpdateFailure {
                self.finish(.failure(failure))
            } catch {
                self.finish(.failure(updateFailure("update.release_invalid")))
            }
        }
        self.task = task
        task.resume()
    }

    private func canRetryDirect(_ direct: Bool) -> Bool {
        !direct && !allowLocal
    }

    private func retryDirect() {
        redirectFailure = nil
        redirects = 0
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        perform(direct: true)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, UpdateURLPolicy.checkMetadataRedirectURL(url, allowLocal: allowLocal) else {
            redirectFailure = updateFailure("update.redirect_rejected")
            completionHandler(nil)
            return
        }
        redirects += 1
        if redirects > UpdateContract.maxMetadataRedirects {
            redirectFailure = updateFailure("update.redirect_rejected")
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    private func finish(_ result: Result<UpdateReleasePayload, UpdateFailure>) {
        DispatchQueue.main.async {
            let callback = self.completion
            self.completion = nil
            self.task = nil
            self.session?.invalidateAndCancel()
            self.session = nil
            callback?(result)
        }
    }
}
