import Foundation

struct BatchHistory {
    typealias Batch = [String: Any]

    private let receiptsPath: String
    private static let terminalStates: Set<String> = ["rejected", "cancelled", "interrupted", "closed"]

    init(root: String) throws {
        receiptsPath = root + "/batch-receipts"
        try FileManager.default.createDirectory(atPath: receiptsPath, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
    }

    func boundedBatches(_ candidates: [Batch]) -> [Batch] {
        var result: [Batch] = []
        var ids = Set<String>()
        var bytes = 0
        for batch in candidates.reversed() {
            guard let id = batch["id"] as? String, !ids.contains(id) else { continue }
            let size = (try? json(batch).count) ?? Int.max
            if result.count < 16 && size <= 65_536 - bytes {
                result.insert(batch, at: 0)
                ids.insert(id)
                bytes += size
            }
        }
        return result
    }

    func compactBatches(_ batches: [Batch], recentBatches: [Batch]) throws -> (batches: [Batch], recentBatches: [Batch]) {
        let finished = batches.filter { batch in
            (batch["items"] as! [[String: Any]]).allSatisfy { Self.terminalStates.contains($0["status"] as? String ?? "") }
        }
        guard !finished.isEmpty else { return (batches, recentBatches) }
        // Finish every receipt write before Core replaces either list.
        for batch in finished {
            guard let id = batch["id"] as? String, UUID(uuidString: id) != nil else {
                throw ProtoError.failure(msg("ui.invalid_historical_batch_id_original_records_were"))
            }
            try atomic(batch, receiptPath(id))
        }
        let ids = Set(finished.compactMap { $0["id"] as? String })
        return (batches.filter { !ids.contains($0["id"] as? String ?? "") }, boundedBatches(recentBatches + finished))
    }

    func findBatch(_ id: String, batches: [Batch], recentBatches: [Batch]) throws -> Batch? {
        guard UUID(uuidString: id) != nil else { throw ProtoError.failure(msg("ui.invalid_batch_id")) }
        if let batch = (batches + recentBatches).first(where: { $0["id"] as? String == id }) { return batch }
        let file = receiptPath(id)
        guard FileManager.default.fileExists(atPath: file) else { return nil }
        guard let batch = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: file))) as? Batch,
              batch["id"] as? String == id else {
            throw ProtoError.failure(msg("ui.could_not_read_batch_receipt"))
        }
        return batch
    }

    private func receiptPath(_ id: String) -> String { receiptsPath + "/" + id + ".json" }
}
