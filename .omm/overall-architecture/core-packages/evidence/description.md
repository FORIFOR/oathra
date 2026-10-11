LLM を使わない決定論的な完了判定。normalize.ts が日時・価格・電話番号・数量・シリアルを解析し、extract.ts が発話から主張を抜き出し、EvidenceEngine（engine.ts）が証拠グラフを作り、evaluate()（evaluate.ts）が完了を判定する。proof.ts は実世界の行動に対する証明の段階を定義する。
