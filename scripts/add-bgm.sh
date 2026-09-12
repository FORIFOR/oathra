#!/usr/bin/env bash
# Lay a music bed under an already-mixed battle video without re-rendering frames.
#   scripts/add-bgm.sh ja [video/bgm/soft-circuit.m4a]
# Reads  video/.work/oathra-battle-<lang>-mix.wav (voice + sfx, -16 LUFS) and docs/media/oathra-battle-<lang>.mp4 (video stream),
# writes docs/media/oathra-battle-<lang>.mp4 and -square.mp4 with the bed ducked under speech (sidechain), lifted on the end card.
set -euo pipefail
lang=${1:?lang}; bgm=${2:-video/bgm/soft-circuit.m4a}
mix=video/.work/oathra-battle-$lang-mix.wav; src=docs/media/oathra-battle-$lang.mp4; work=video/.work
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mix")
LIFT_AT=55.7   # hang-up: the card that follows gets the music
ffmpeg -y -loglevel error -i "$mix" -stream_loop 1 -i "$bgm" -filter_complex "
  [1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:$dur,afade=t=in:st=0:d=1.5,afade=t=out:st=$(echo "$dur-2.2"|bc):d=2.2,volume=-12dB,volume='if(gt(t,$LIFT_AT),1.0+min((t-$LIFT_AT)/1.2,1)*0.78,1.0)':eval=frame[bgm];
  [0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[v][key];
  [bgm][key]sidechaincompress=threshold=0.06:ratio=3:attack=60:release=900:makeup=1:level_sc=1.0[duck];
  [v][duck]amix=inputs=2:normalize=0:dropout_transition=0[m]" -map "[m]" -t "$dur" "$work/oathra-battle-$lang-bgm-raw.wav"
lufs=$(ffmpeg -nostats -i "$work/oathra-battle-$lang-bgm-raw.wav" -af ebur128 -f null - 2>&1 | grep -o "I: -\?[0-9.]* LUFS" | tail -1 | awk '{print $2}')
ffmpeg -y -loglevel error -i "$work/oathra-battle-$lang-bgm-raw.wav" -af "volume=$(echo "-16 - $lufs"|bc)dB,alimiter=limit=0.85:attack=5:release=60" "$work/oathra-battle-$lang-bgm-mix.wav"
tmp=$work/oathra-battle-$lang-bgm.mp4
ffmpeg -y -loglevel error -i "$src" -i "$work/oathra-battle-$lang-bgm-mix.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -ac 2 -shortest -movflags +faststart "$tmp"
mv "$tmp" "$src"
ffmpeg -y -loglevel error -i "$src" -vf "crop=1080:1080:420:0" -c:v libx264 -preset slow -crf 20 -c:a copy -movflags +faststart "docs/media/oathra-battle-$lang-square.mp4"
echo "wrote $src (+square) bed=$bgm raw=$lufs LUFS"
