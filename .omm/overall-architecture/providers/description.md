Phone Layer と Voice Layer の具体的な実装。キャリア（phone-*）と音声エンジン（openai-realtime、gemini-live、voice-pipeline）は互いに import しない。共有するものは voice-kit・audio-kit・brain-kit に置く。
