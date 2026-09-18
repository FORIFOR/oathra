import Foundation
import Security
import SwiftUI

struct APIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
enum Value: Codable, Hashable {
    case string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else { self = .string(try c.decode(String.self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .string(let x): try c.encode(x); case .number(let x): try c.encode(x); case .bool(let x): try c.encode(x); case .null: try c.encodeNil() }
    }
    var text: String { switch self { case .string(let s): return s; case .number(let n): return String(n); case .bool(let b): return b ? "はい" : "いいえ"; case .null: return "未確認" } }
}
struct Product: Codable, Identifiable { let id: String; let name: String; let facts: String; let forbidden: String? }
struct Contact: Codable, Identifiable { let id: String; let name: String; let phone: String; let email: String? }
struct Account: Decodable { let consentVersion: String?; let verifiedPhone: String? }
struct Configuration: Decodable { let mode: String; let liveReady: Bool; let missing: [String]; let consentVersion: String; let maxSeconds: Double; let maxCallUsd: Double }
struct Bootstrap: Decodable { let account: Account; let configuration: Configuration; let products: [Product]; let contacts: [Contact]; let missions: [Mission] }
struct Evidence: Decodable { let quote: String; let field: String; let confirmedProposal: String? }
struct Result: Decodable { let verified: [String: Value]?; let missing: [String]?; let evidence: [Evidence]?; let caveat: String? }
struct Turn: Decodable, Identifiable { let id: String; let source: String; let text: String }
struct Mission: Decodable, Identifiable {
    let id: String; let revision: Int; let status: String; let mode: String; let target: Contact; let product: Product
    let request: String; let goal: String; let callerId: String; let maxSeconds: Double; let maxUsd: Double; let estimatedMaximumUsd: Double
    let result: Result?; let transcript: [Turn]?; let error: String?; let carrierSid: String?
    var final: Bool { ["COMPLETED", "INCOMPLETE", "DECLINED", "FAILED", "CANCELLED", "UNKNOWN"].contains(status) }
    var statusLabel: String {
        ["DRAFT":"確認待ち", "QUEUED":"発信待ち", "DIALING":"発信中", "ACTIVE":"通話中", "COMPLETED":"目的の合意を会話で確認", "INCOMPLETE":"未確定", "DECLINED":"辞退・連絡停止", "FAILED":"実行失敗", "CANCELLED":"キャンセル", "CANCEL_REQUESTED":"終了処理中", "UNKNOWN":"回線状態の照合が必要", "HANDOFF_PENDING":"担当者への接続待ち", "HANDOFF_ACTIVE":"担当者に接続済み"][status] ?? status
    }
}
struct Review: Decodable, Identifiable { let mission: Mission; let approvalToken: String; var id: String { mission.id } }
struct Empty: Decodable {}
struct ImportedProduct: Decodable { let source: String; let content: String }
struct LinkMessage: Decodable { let message: String }
struct Credentials: Codable { let url: String; let token: String }

/// Provider secrets never leave the gateway. Only this account's revocable gateway token is stored.
enum Keychain {
    static let service = "com.reachmade.oathra.gateway"
    static func load() -> Credentials? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }
    static func save(_ value: Credentials) throws {
        clear()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "operator", kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecValueData as String: try JSONEncoder().encode(value)]
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw APIError(message: "接続情報をKeychainに保存できませんでした。") }
    }
    static func clear() { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
@MainActor final class API: ObservableObject {
    @Published var state: Bootstrap?
    @Published var message: String?
    @Published var connecting = false
    private var credentials: Credentials?
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
    var serverURL: String { credentials?.url ?? "" }
    func connect(url: String, token: String) async {
        connecting = true; defer { connecting = false }
        do {
            let clean = url.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            guard let parsed = URL(string: clean), parsed.scheme == "https", parsed.host != nil, parsed.user == nil, parsed.password == nil, parsed.query == nil, parsed.fragment == nil, parsed.path.isEmpty else { throw APIError(message: "HTTPSのGateway URLを入力してください。例: https://oathra.example.com") }
            let candidate = Credentials(url: clean, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
            guard candidate.token.count >= 32 else { throw APIError(message: "Gatewayトークンを確認してください。") }
            credentials = candidate
            try await refresh()
            try Keychain.save(candidate)
        } catch { credentials = nil; state = nil; message = error.localizedDescription }
    }
    func restore() async { if let saved = Keychain.load() { await connect(url: saved.url, token: saved.token) } }
    func logout() { credentials = nil; state = nil; Keychain.clear() }
    func refresh() async throws { state = try await request("/bootstrap") }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil, idempotencyKey: String? = nil) async throws -> T {
        guard let c = credentials, let url = URL(string: c.url + "/v1" + path) else { throw APIError(message: "Gatewayに接続してください。") }
        var req = URLRequest(url: url); req.httpMethod = method; req.timeoutInterval = 30
        req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let idempotencyKey { req.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let problem = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw APIError(message: problem?["error"] as? String ?? "通信に失敗しました。再操作の前に実行状況を確認してください。")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func run(_ operation: () async throws -> Void) async { do { try await operation() } catch { message = error.localizedDescription } }
}
