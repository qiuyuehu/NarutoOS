import Foundation
import CryptoKit

// MARK: - Download

final class UpdateDownloader: NSObject, URLSessionDataDelegate {
    struct ResultValue {
        let bytes: Int64
        let digest: String
    }

    private let destination: String
    private let expectedSize: Int64
    private let expectedDigest: String
    private let allowLocal: Bool
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var fileHandle: FileHandle?
    private var hasher = SHA256()
    private var received: Int64 = 0
    private var redirects = 0
    private var cancelled = false
    private var failed: UpdateFailure?
    private var completion: ((Result<ResultValue, UpdateFailure>) -> Void)?
    private var progress: ((Int64, Int64) -> Void)?
    private let queue = DispatchQueue(label: "Naruto.Update.Download")

    init(destination: String, expectedSize: Int64, expectedDigest: String, allowLocal: Bool) {
        self.destination = destination
        self.expectedSize = expectedSize
        self.expectedDigest = expectedDigest
        self.allowLocal = allowLocal
        super.init()
    }

    func start(url: URL, progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<ResultValue, UpdateFailure>) -> Void) {
        self.progress = progress
        self.completion = completion
        FileManager.default.createFile(atPath: destination, contents: nil, attributes: [.posixPermissions: 0o600])
        guard let handle = FileHandle(forWritingAtPath: destination) else {
            finish(.failure(updateFailure("update.download_failed")))
            return
        }
        fileHandle = handle
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = UpdateContract.downloadIdleTimeout
        configuration.timeoutIntervalForResource = UpdateContract.downloadTotalTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        if allowLocal { configuration.connectionProxyDictionary = [:] }
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue())
        self.session = session
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("NarutoOS-Update/1", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func cancel() {
        queue.sync { cancelled = true }
        task?.cancel()
    }

    private func finish(_ result: Result<ResultValue, UpdateFailure>) {
        DispatchQueue.main.async {
            let callback = self.completion
            self.completion = nil
            self.task = nil
            self.session?.invalidateAndCancel()
            self.session = nil
            try? self.fileHandle?.close()
            self.fileHandle = nil
            if case .failure = result { try? FileManager.default.removeItem(atPath: self.destination) }
            callback?(result)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        queue.async {
            guard let url = request.url, UpdateURLPolicy.checkRedirectURL(url, allowLocal: self.allowLocal) else {
                self.failed = updateFailure("update.redirect_rejected")
                completionHandler(nil)
                return
            }
            self.redirects += 1
            if self.redirects > UpdateContract.maxRedirects {
                self.failed = updateFailure("update.redirect_rejected")
                completionHandler(nil)
                return
            }
            completionHandler(request)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        queue.async {
            if self.failed != nil { completionHandler(.cancel); return }
            guard let http = response as? HTTPURLResponse else {
                self.failed = updateFailure("update.download_failed")
                completionHandler(.cancel)
                return
            }
            if (300...399).contains(http.statusCode) {
                // A redirect that reached this point was already rejected by the
                // delegate; keep the redirect reason instead of an HTTP status.
                if self.failed == nil { self.failed = updateFailure("update.redirect_rejected") }
                completionHandler(.cancel)
                return
            }
            guard http.statusCode == 200 else {
                self.failed = updateFailure("update.check_http", ["p0": String(http.statusCode)])
                completionHandler(.cancel)
                return
            }
            if http.expectedContentLength > UpdateContract.maxDownloadBytes {
                self.failed = updateFailure("update.asset_size_invalid")
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.async {
            if self.cancelled || self.failed != nil { return }
            if self.received + Int64(data.count) > UpdateContract.maxDownloadBytes {
                self.failed = updateFailure("update.asset_size_invalid")
                dataTask.cancel()
                return
            }
            self.fileHandle?.write(data)
            self.hasher.update(data: data)
            self.received += Int64(data.count)
            let received = self.received
            let expected = self.expectedSize
            DispatchQueue.main.async { self.progress?(received, expected) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.async {
            if self.cancelled {
                self.finish(.failure(updateFailure("update.cancelled")))
                return
            }
            if let failed = self.failed {
                self.finish(.failure(failed))
                return
            }
            if let error = error {
                let code = (error as NSError).code
                if code == NSURLErrorCancelled { self.finish(.failure(updateFailure("update.cancelled"))) }
                else if code == NSURLErrorTimedOut { self.finish(.failure(updateFailure("update.download_timeout"))) }
                else { self.finish(.failure(updateFailure("update.download_failed"))) }
                return
            }
            if self.received != self.expectedSize {
                self.finish(.failure(updateFailure("update.asset_size_mismatch")))
                return
            }
            let digest = self.hasher.finalize().map { String(format: "%02x", $0) }.joined()
            guard digest == self.expectedDigest else {
                self.finish(.failure(updateFailure("update.asset_digest_mismatch")))
                return
            }
            self.finish(.success(ResultValue(bytes: self.received, digest: digest)))
        }
    }
}
