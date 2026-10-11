tick() が約5秒ごとに claimNext() で依頼を取り、run() で通話する。inbox / outbox / alert のキューも処理する。途中で止まった通話は UNKNOWN にして自動で再発信しない。
