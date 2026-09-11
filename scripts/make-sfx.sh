#!/usr/bin/env sh
# Synthesizes the sound effects used by video/battle2.html with sox (no downloads, no samples):
# handset ringback, pickup/hang-up clicks, six keystroke variants, an Enter key, room tone, a soft tick.
set -e
out=${1:-video/.work/sfx}; mkdir -p "$out"; cd "$out"
sox -n -r 48000 -c 1 ringtone.wav synth 1.0 sine 400 sine 384 remix - fade t 0.02 1.0 0.05 gain -22 sinc 300-3400
sox -n -r 48000 -c 1 pickup.wav synth 0.04 whitenoise fade t 0.002 0.04 0.03 gain -26 sinc 400-5000
sox -n -r 48000 -c 1 click.wav synth 0.012 whitenoise fade t 0.001 0.012 0.01 gain -24
sox -n -r 48000 -c 1 gap.wav trim 0 0.09
sox click.wav gap.wav click.wav hangup.wav
for i in 1 2 3 4 5 6; do f=$((900+i*137)); sox -n -r 48000 -c 1 key$i.wav synth 0.028 brownnoise fade t 0.001 0.028 0.02 gain -19 sinc 200-$((f*4)); done
sox -n -r 48000 -c 1 enter.wav synth 0.045 brownnoise fade t 0.001 0.045 0.03 gain -16 sinc 150-2500
sox -n -r 48000 -c 1 room.wav synth 90 brownnoise gain -62
sox -n -r 48000 -c 1 tick.wav synth 0.09 sine 1320 fade t 0.004 0.09 0.06 gain -30
rm -f gap.wav
echo "sfx written to $out"
