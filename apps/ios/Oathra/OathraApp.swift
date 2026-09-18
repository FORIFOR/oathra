import SwiftUI

@main struct OathraApp: App {
    @StateObject private var api = API()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group {
                if api.state == nil { ConnectionView() }
                else {
                    TabView {
                        NavigationStack { ComposerView() }.tabItem { Label("お願い", systemImage: "phone.arrow.up.right") }
                        NavigationStack { MissionListView() }.tabItem { Label("進行・結果", systemImage: "checkmark.bubble") }
                        NavigationStack { SettingsView() }.tabItem { Label("準備", systemImage: "slider.horizontal.3") }
                    }
                }
            }
            .tint(Color(red: 0.19, green: 0.33, blue: 0.24))
            .environmentObject(api)
            .alert("Oathra", isPresented: Binding(get: { api.message != nil }, set: { if !$0 { api.message = nil } })) { Button("閉じる") { api.message = nil } } message: { Text(api.message ?? "") }
            .task { await api.restore() }
            .onChange(of: phase) { _, value in if value == .active, api.state != nil { Task { await api.run { try await api.refresh() } } } }
        }
    }
}
struct ConnectionView: View {
    @EnvironmentObject var api: API
    @State private var url = "", token = ""
    var body: some View {
        NavigationStack { ScrollView { VStack(alignment: .leading, spacing: 26) {
            Text("oathra.").font(.system(size: 32, weight: .bold, design: .rounded))
            Text("電話の、\nその先まで。").font(.system(size: 48, weight: .medium)).tracking(-2)
            Text("お願いを伝える。内容を確かめる。\n決まったことを、相手の言葉で受け取る。").foregroundStyle(.secondary)
            TextField("https://あなたのGateway", text: $url).textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Gatewayアクセストークン", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button { Task { await api.connect(url: url, token: token); token = "" } } label: { Text(api.connecting ? "接続中…" : "ワークスペースを開く").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent).disabled(api.connecting)
            Text("トークンはこの端末のKeychainに保存します。電話会社やAIのAPIキーを入力する必要はありません。").font(.footnote).foregroundStyle(.secondary)
        }.textFieldStyle(.roundedBorder).padding(28).padding(.top, 36) } }
    }
}
struct ComposerView: View {
    @EnvironmentObject var api: API
    @State private var request = "", productId = "", contactId = "", goal = "meeting", slots = ""
    @State private var selfTest = false, seconds = 180.0, budget = 10.0, working = false
    @State private var review: Review?, started: Mission?
    var body: some View {
        Form {
            Section {
                Text("次の電話を、任せる。").font(.title).fontWeight(.medium)
                Text(api.state?.configuration.mode == "simulator" ? "模擬モードです。実際には発信しません。" : "発信前に相手・内容・料金を確認します。").font(.footnote).foregroundStyle(.secondary)
                if api.state?.configuration.mode == "live" && api.state?.configuration.liveReady != true { Text("実電話用のサーバー設定が未完了です。").foregroundStyle(.orange) }
            }
            Section("どんな電話を任せますか？") { TextEditor(text: $request).frame(minHeight: 100).accessibilityLabel("電話の依頼内容") }
            Section {
                Picker("商品", selection: $productId) { Text("選択してください").tag(""); ForEach(api.state?.products ?? []) { Text($0.name).tag($0.id) } }
                Toggle("まず自分に電話して試す", isOn: $selfTest)
                if !selfTest { Picker("相手", selection: $contactId) { Text("選択してください").tag(""); ForEach(api.state?.contacts ?? []) { Text($0.name).tag($0.id) } } }
                Picker("目的", selection: $goal) { Text("商談日程の合意").tag("meeting"); Text("資料送付の了承").tag("materials"); Text("商品説明").tag("introduce") }
            }
            Section("上限と候補日時") {
                Stepper("通話上限: \(Int(seconds))秒", value: $seconds, in: 30...(api.state?.configuration.maxSeconds ?? 300), step: 30)
                HStack { Text("費用上限 USD"); TextField("上限", value: $budget, format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing) }
                TextField("候補日時（任意・1行1件）", text: $slots, axis: .vertical).textInputAutocapitalization(.never)
                Text("例: 2026-10-01T15:00:00+09:00。時差を含めて入力します。").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Button(working ? "準備中…" : "電話の内容を確認する") { Task { working = true; defer { working = false }; await api.run {
                    let m: Mission = try await api.request("/missions/draft", method: "POST", body: ["request": request, "productId": productId, "contactId": contactId, "testOnMe": selfTest, "goal": goal, "maxSeconds": seconds, "maxUsd": budget, "candidateSlots": slots.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }])
                    review = try await api.request("/missions/\(m.id)/review", method: "POST", body: [:]); try await api.refresh()
                } } }.disabled(working || request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || productId.isEmpty || (!selfTest && contactId.isEmpty))
                Text("この操作では、まだ電話はかかりません。").font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("お願いする")
        .sheet(item: $review) { r in ReviewView(review: r) { m in review = nil; started = m } }
        .navigationDestination(item: $started) { m in MissionDetailView(id: m.id) }
        .task { if let p = api.state?.products.first { productId = p.id }; budget = min(10, api.state?.configuration.maxCallUsd ?? 10) }
    }
}
// Navigation identity deliberately ignores changing status; canonical state is fetched by ID.
extension Mission: Hashable {
    static func == (lhs: Mission, rhs: Mission) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
struct ReviewView: View {
    @EnvironmentObject var api: API
    @Environment(\.dismiss) var dismiss
    let review: Review
    var onStarted: (Mission) -> Void
    @State private var approved = false, busy = false
    @State private var key = UUID().uuidString
    var body: some View {
        NavigationStack { Form {
            Section("電話する相手") { Text(review.mission.target.name).font(.headline); Text(review.mission.target.phone); LabeledContent("発信元", value: review.mission.callerId) }
            Section("今回の内容") { Text(review.mission.request); Text(review.mission.product.facts); Text(review.mission.product.forbidden ?? "値引き・契約確定・支払い不可").font(.footnote).foregroundStyle(.secondary) }
            Section("時間と費用") { Text("上限 \(Int(review.mission.maxSeconds))秒 / $\(review.mission.maxUsd, specifier: "%.2f")"); Text("設定単価による推定最大 $\(review.mission.estimatedMaximumUsd, specifier: "%.2f")").font(.footnote); if review.mission.mode == "simulator" { Text("模擬実行です。実電話はかかりません。").foregroundStyle(.orange) } }
            Section("データの送信") { Text("Twilioと設定されたOpenAI音声モデルへ会話が渡り、文字起こし・結果を依頼者に共有します。相手にもAIと文字起こしについて案内します。").font(.footnote); Toggle("相手・内容・上限・データ利用を確認し、この1件を承認する", isOn: $approved) }
            Section { Button(busy ? "処理中…" : review.mission.mode == "simulator" ? "承認して模擬実行する" : "承認して電話する") { Task {
                busy = true; defer { busy = false }
                await api.run { let m: Mission = try await api.request("/missions/\(review.id)/start", method: "POST", body: ["approvalToken": review.approvalToken, "acknowledged": true], idempotencyKey: key); try await api.refresh(); onStarted(m); dismiss() }
            } }.disabled(!approved || busy) }
        }.navigationTitle("発信前の確認").toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } } }
    }
}
struct MissionListView: View {
    @EnvironmentObject var api: API
    @Environment(\.scenePhase) private var phase
    var body: some View {
        List {
            if api.state?.missions.isEmpty != false { ContentUnavailableView("まだ依頼はありません", systemImage: "phone", description: Text("商品と連絡先を準備し、最初の電話を任せてみましょう。")) }
            ForEach(api.state?.missions ?? []) { m in NavigationLink { MissionDetailView(id: m.id) } label: { VStack(alignment: .leading, spacing: 7) { Text(m.target.name).font(.headline); Text((m.mode == "simulator" ? "模擬 · " : "") + m.statusLabel).font(.subheadline).foregroundStyle(.secondary); Text(m.request).font(.caption).lineLimit(2) }.padding(.vertical, 6) } }
        }.navigationTitle("進行と結果").refreshable { await api.run { try await api.refresh() } }
        .task { while !Task.isCancelled { if phase == .active { try? await api.refresh() }; do { try await Task.sleep(for: .seconds(5)) } catch { break } } }
    }
}
struct MissionDetailView: View {
    @EnvironmentObject var api: API
    @Environment(\.scenePhase) private var phase
    let id: String
    @State private var mission: Mission?, review: Review?, handoff = false
    var body: some View {
        List {
            if let m = mission {
                Section { Text(m.target.name).font(.title2); Text(m.statusLabel).foregroundStyle(.secondary); Text(m.request); if m.mode == "simulator" { Text("模擬結果 — 実電話・実音声モデルの品質評価ではありません").font(.caption).foregroundStyle(.orange) } }
                if m.status == "DRAFT" { Button("発信内容を確認") { Task { await api.run { review = try await api.request("/missions/\(id)/review", method: "POST", body: [:]) } } } }
                if !m.final && m.status != "DRAFT" { Button("電話を終了する", role: .destructive) { Task { await api.run { let _: Mission = try await api.request("/missions/\(id)/cancel", method: "POST", body: [:]); try await reload() } } } }
                if m.mode == "live" && m.status == "ACTIVE" { Button("自分に交代する") { handoff = true } }
                if m.carrierSid != nil && m.status == "UNKNOWN" { Button("回線の状態を照合") { Task { await api.run { let _: Mission = try await api.request("/missions/\(id)/reconcile", method: "POST", body: ["acknowledged": true]); try await reload() } } } }
                if let result = m.result {
                    Section("確認できたこと") {
                        ForEach((result.verified ?? [:]).keys.sorted(), id: \.self) { key in LabeledContent(key, value: result.verified?[key]?.text ?? "未確認") }
                        if result.verified?.isEmpty != false { Text("確定した項目はありません。").foregroundStyle(.secondary) }
                    }
                    Section("相手の言葉") { ForEach(Array((result.evidence ?? []).enumerated()), id: \.offset) { _, e in VStack(alignment: .leading, spacing: 8) { Text("「\(e.quote)」"); if let p = e.confirmedProposal { Text("確認した提案: \(p)").font(.caption).foregroundStyle(.secondary) } } } }
                    if let caveat = result.caveat { Section { Text(caveat).font(.footnote).foregroundStyle(.secondary) } }
                }
                if let error = m.error { Section("確認が必要です") { Text(error).font(.footnote) } }
                Section("文字起こし") { ForEach(m.transcript ?? []) { t in VStack(alignment: .leading, spacing: 6) { Text(t.source == "callee" ? "相手" : "Oathra").font(.caption).foregroundStyle(.secondary); Text(t.text) } } }
            } else { ProgressView() }
        }.navigationTitle("電話の記録").refreshable { await api.run { try await reload() } }
        .sheet(item: $review) { r in ReviewView(review: r) { m in mission = m; review = nil } }
        .confirmationDialog("確認済みの自分の番号へ接続します。追加回線分の料金が発生します。", isPresented: $handoff, titleVisibility: .visible) { Button("接続を依頼する") { Task { await api.run { let _: Empty = try await api.request("/missions/\(id)/handoff", method: "POST", body: ["acknowledged": true]); try await reload() } } } }
        .task { while !Task.isCancelled { if phase == .active { await api.run { try await reload() } }; do { try await Task.sleep(for: .seconds(3)) } catch { break } } }
    }
    func reload() async throws { mission = try await api.request("/missions/\(id)") }
}
struct SettingsView: View {
    @EnvironmentObject var api: API
    @State private var productName = "", url = "", facts = "", reviewed = false
    @State private var name = "", phone = "", email = "", basis = "", relationship = "inquiry"
    @State private var myPhone = "", code = "", verifyConsent = false, linkMessage = "", busy = false
    var body: some View {
        Form {
            Section("会話データの取り扱い") {
                Text("実電話はTwilioと設定されたOpenAI音声モデルに音声・文字起こしが渡ります。LINE音声もOpenAIで文字起こしします。結果をサーバーと依頼元のLINE・Slackに保存・通知します。生音声の録音保存はせず、会話記録は標準30日で削除します。").font(.footnote)
                Text("相手にもAIと文字起こしを案内し、続ける操作を求めます。第三者への送信を了承したうえでご利用ください。").font(.footnote)
                Button(api.state?.account.consentVersion == api.state?.configuration.consentVersion ? "現在の取り扱いに同意済み" : "内容を確認して同意する") { Task { await api.run { let _: Empty = try await api.request("/consent", method: "POST", body: ["version": api.state?.configuration.consentVersion ?? ""]); try await api.refresh() } } }
            }
            Section("自分の番号を確認") {
                Text(api.state?.account.verifiedPhone ?? "未確認").font(.footnote)
                TextField("+8190…", text: $myPhone).keyboardType(.phonePad)
                TextField("SMS確認コード（初回は空欄）", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                Toggle("自分の番号への確認SMSと料金を承認", isOn: $verifyConsent)
                Button("SMS送信 / コードを確認") { Task { await api.run { let _: Empty = try await api.request("/phone/verify", method: "POST", body: ["phone": myPhone, "code": code, "acknowledged": true]); try await api.refresh(); api.message = code.isEmpty ? "確認SMSを送りました。" : "番号を確認しました。" } } }.disabled(!verifyConsent)
            }
            Section("紹介する商品") {
                TextField("商品URL（任意）", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("URLの内容を取り込む") { Task { busy = true; defer { busy = false }; await api.run { let r: ImportedProduct = try await api.request("/products/import", method: "POST", body: ["url": url]); facts = r.content; reviewed = false } } }.disabled(busy || url.isEmpty)
                TextField("商品名", text: $productName)
                TextEditor(text: $facts).frame(minHeight: 140).accessibilityLabel("説明してよい事実")
                Toggle("説明してよい事実であることを確認した", isOn: $reviewed)
                Button("商品を保存") { Task { await api.run { let _: Product = try await api.request("/products", method: "POST", body: ["name": productName, "facts": facts, "source": url, "reviewed": true]); try await api.refresh(); api.message = "商品を保存しました。" } } }.disabled(!reviewed || facts.isEmpty || productName.isEmpty)
            }
            Section("連絡先") {
                TextField("相手の名前", text: $name)
                TextField("+81…", text: $phone).keyboardType(.phonePad)
                TextField("メール（任意）", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Picker("関係", selection: $relationship) { Text("問い合わせの折り返し").tag("inquiry"); Text("既存顧客").tag("customer"); Text("連絡了承済み").tag("consented") }
                TextField("連絡してよい根拠", text: $basis, axis: .vertical)
                Button("連絡先を保存") { Task { await api.run { let _: Contact = try await api.request("/contacts", method: "POST", body: ["name": name, "phone": phone, "email": email, "relationship": relationship, "basis": basis]); try await api.refresh(); api.message = "連絡先を保存しました。" } } }.disabled(name.isEmpty || phone.isEmpty || basis.isEmpty)
            }
            Section("LINE / Slack") {
                Text("連携メッセージをBotとの個別チャットに送ってください。5分間・1回だけ有効です。").font(.footnote)
                Button("連携メッセージを作る") { Task { await api.run { let r: LinkMessage = try await api.request("/links", method: "POST", body: [:]); linkMessage = r.message } } }
                if !linkMessage.isEmpty { Text(linkMessage).font(.caption.monospaced()).textSelection(.enabled); ShareLink("メッセージを共有", item: linkMessage) }
            }
            Section { Text(api.serverURL).font(.footnote); Text("外部連携の送信・登録と詳細管理はWebワークスペースから行えます。").font(.footnote); Button("ログアウト", role: .destructive) { api.logout() } }
        }.navigationTitle("最初の準備")
    }
}
