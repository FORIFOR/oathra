/** Editable purpose starters, not completed calls or real recipient data. */
export const PHONE_PURPOSE_TEMPLATES = [
  {
    id: "chat", conversationMode: "chat",
    title: { ja: "雑談", en: "Casual chat" },
    instruction: {
      ja: "AIの話し相手として、近況や趣味、食べ物、休日の話題で自然に雑談してください。相手の返答に合わせて会話を続け、ニュースを聞かれたら日付・出典付きの最新情報を確認して答えてください。相手の情報を聞き出して、悩みがあればカウンセリングして下さい。ですますではなくタメ口で、「今日、どうした」「最近、調子どう」のようなフランクな感じで接して下さい。同意は大事です。相手の話を待たずにあなたから話しかけて下さい。",
      en: "Chat naturally as an AI conversation partner about their day, hobbies, food or weekend plans. Follow their interests and keep the conversation going. When asked about news, check current information and mention its date and source.",
    },
  },
  {id:'friend-check-in',title:{ja:'友人に近況を聞く',en:'Check in with a friend'},instruction:{ja:'{{相手に伝える自分の名前}}のAI代理として、今少し話せるか確認し、最近の様子を聞いてください。話せない場合は都合のよい折り返し時間を聞いて終了してください。',en:'As the AI assistant for {{your name}}, ask whether this is a good time and how they have been. If busy, ask for a suitable callback time and end the call.'}},
  {id:'meetup',title:{ja:'待ち合わせを相談',en:'Discuss a meetup'},instruction:{ja:'{{自分の名前}}の代理として、{{候補日時}}に{{場所}}で会えるか聞いてください。難しい場合は相手の都合のよい候補を聞き、確認した内容をまとめてください。',en:'On behalf of {{your name}}, ask whether {{proposed time}} at {{place}} works for a meetup. If not, ask for an alternative and summarize the response.'}},
  {id:'late',title:{ja:'遅れることを連絡',en:'Let someone know you are late'},instruction:{ja:'{{自分の名前}}の代理として、{{約束の内容}}に{{遅れる時間}}ほど遅れると伝えて謝ってください。待ち合わせの変更が必要か聞いてください。',en:'On behalf of {{your name}}, apologize that you will be {{delay}} late for {{appointment}} and ask whether plans need to change.'}},
  {id:'callback',title:{ja:'折り返しを依頼',en:'Request a callback'},instruction:{ja:'{{自分の名前}}の代理として、{{用件}}について折り返し話したいと伝えてください。{{連絡方法と都合のよい時間}}を伝え、相手の都合も確認してください。',en:'On behalf of {{your name}}, request a callback about {{topic}}. Share {{contact method and availability}} and ask when they are available.'}},
  {id:'thanks',title:{ja:'お礼を伝える',en:'Say thank you'},instruction:{ja:'{{自分の名前}}の代理として、{{お礼を伝えたいこと}}への感謝を{{伝えたい言葉}}と伝えてください。追加の約束や依頼はせず、相手の返答を確認して終了してください。',en:'On behalf of {{your name}}, thank them for {{reason}} with the message {{your words}}. Do not make additional commitments; listen to their response and end the call.'}},
  {id:'opening-hours',title:{ja:'営業時間を確認',en:'Check opening hours'},instruction:{ja:'{{利用予定日}}の営業時間と、{{確認したいサービス}}が利用できる時間を確認してください。予約や購入はしないでください。',en:'Ask about opening hours on {{date}} and when {{service}} is available. Do not make a booking or purchase.'}},
  {id:'availability',title:{ja:'予約の空きを確認',en:'Ask about availability'},instruction:{ja:'{{希望日時}}に{{人数やサービス内容}}で利用できる空きがあるか、料金と予約条件を聞いてください。空き状況の問い合わせのみで、予約は確定しないでください。',en:'Ask about availability for {{party size or service}} at {{date and time}}, including price and booking conditions. Ask only; do not finalize a booking.'}},
  {id:'stock',title:{ja:'在庫を問い合わせ',en:'Ask about stock'},instruction:{ja:'{{商品名と型番・サイズ等}}の在庫、価格、店頭受け取りの可否を聞いてください。購入や取り置きは確約しないでください。',en:'Ask about stock, price and pickup options for {{product, model and size}}. Do not purchase or commit to a reservation.'}},
  {id:'change-policy',title:{ja:'予約変更の方法を聞く',en:'Ask how to change a booking'},instruction:{ja:'{{予約の種類}}について変更できる条件、手順、費用を聞いてください。変更や取消そのものは実行しないでください。',en:'Ask about the process, conditions and fees for changing {{type of booking}}. Do not change or cancel the booking.'}},
  {id:'lost-property',title:{ja:'忘れ物を確認',en:'Ask about lost property'},instruction:{ja:'{{利用した日時と場所}}で{{忘れ物の特徴}}の届出があるか聞いてください。見つかった場合は保管期限と受け取り方法を確認してください。',en:'Ask whether {{item description}} was found at {{place and time}}. If found, ask about the holding period and collection procedure.'}},
  {id:'delivery',title:{ja:'配送状況を確認',en:'Check a delivery'},instruction:{ja:'{{問い合わせ可能な注文番号等}}について配送状況と到着見込みを聞いてください。住所変更や追加支払いは行わないでください。',en:'Ask about delivery status and expected arrival for {{order reference you may share}}. Do not change the address or make any payment.'}},
  {id:'business-contact',title:{ja:'担当窓口を確認',en:'Find the right contact'},instruction:{ja:'{{問い合わせたい内容}}を相談できる担当部署と連絡方法、受付時間を聞いてください。営業の約束や契約、費用の支払いは行わないでください。',en:'Ask which department handles {{topic}}, how to contact it and its opening hours. Do not make sales commitments, contracts or payments.'}},
] as const;
