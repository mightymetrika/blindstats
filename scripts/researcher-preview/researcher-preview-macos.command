#!/bin/sh
# blindstats Researcher Preview - macOS
# Offline; requires only POSIX sh and awk (both are standard on this OS).
# Usage:
#   sh ./researcher-preview-macos.command generate
#   sh ./researcher-preview-macos.command analyze "/path/to/synthetic_study_blinded.csv"
set -eu
LC_ALL=C
export LC_ALL
umask 077
MODE="${1:-generate}"
OUT_DIR="${BLINDSTATS_PREVIEW_DIR:-$HOME/blindstats-preview-files}"
mkdir -p "$OUT_DIR"
if [ "$MODE" = "generate" ]; then
  awk 'BEGIN {
    print "participant_id,group,baseline_score,outcome_score"
    for (i=1;i<=48;i++) {
      group = (i % 2 == 0 ? "Program" : "Reference")
      baseline = 42 + ((i * 11) % 24)
      improvement = 4 + ((i * 7) % 9) + (i % 2 == 0 ? 3 : 0)
      printf "P%03d,%s,%d,%d\n", i, group, baseline, baseline + improvement
    }
  }' > "$OUT_DIR/synthetic_study.csv"
  printf 'Created synthetic dataset: %s\n' "$OUT_DIR/synthetic_study.csv"
  printf '%s\n' 'In blindstats, blind the group column and download the blinded CSV.'
  printf '%s\n' 'Keep the unblinding secret separate from the blinded analyst.'
  exit 0
fi
if [ "$MODE" != "analyze" ]; then
  printf '%s\n' 'Usage: generate | analyze /path/to/synthetic_study_blinded.csv' >&2
  exit 2
fi
INPUT="${2:-}"
if [ ! -f "$INPUT" ]; then
  printf 'Blinded CSV not found: %s\n' "$INPUT" >&2
  exit 2
fi
case "$INPUT" in
  *_blinded.csv) ;;
  *) printf '%s\n' 'Provide the *_blinded.csv downloaded from blindstats, not the source CSV.' >&2; exit 2 ;;
esac
TMP="$OUT_DIR/analysis_artifact.tmp"
if ! awk -F, '
  NR==1 {
    sub(/\r$/, "", $0)
    if ($0 != "participant_id,group,baseline_score,outcome_score") {
      print "Unexpected columns: use the supplied source CSV and blind group." > "/dev/stderr"
      exit 2
    }
    next
  }
  {
    sub(/\r$/, "", $0)
    if (NF != 4 || $1 !~ /^P[0-9][0-9][0-9]$/ || $2 !~ /^Group_[A-Z]+$/ ||
        $3 !~ /^[0-9]+([.][0-9]+)?$/ || $4 !~ /^[0-9]+([.][0-9]+)?$/) {
      print "Unexpected data: confirm synthetic input and blinded group." > "/dev/stderr"
      exit 2
    }
    if (!seen[$2]++) {
      order[++groupCount]=$2
    }
    n[$2]++
    total[$2]+=$4
    sq[$2]+=$4*$4
    count++
  }
  END {
    if (count != 48 || groupCount != 2) {
      print "Expected 48 rows in two blinded groups." > "/dev/stderr"
      exit 2
    }
    print "blindstats synthetic blinded analysis (descriptive only)"
    print "Input: synthetic blinded CSV; original group identities intentionally unknown"
    printf "Rows: %d\nOutcome: outcome_score\n\n", count
    for (j=1;j<=groupCount;j++) {
      name=order[j]
      mean[j]=total[name]/n[name]
      variance=(n[name]>1 ? (sq[name]-total[name]*total[name]/n[name])/(n[name]-1) : 0)
      if (variance<0) variance=0
      printf "%s: n=%d, mean=%.2f, sample SD=%.2f\n", name, n[name], mean[j], sqrt(variance)
    }
    printf "Difference in means (%s minus %s): %.2f\n", order[2], order[1], mean[2]-mean[1]
    print "Exploratory synthetic example only; no real participants and no inferential claims."
  }
' "$INPUT" > "$TMP"; then
  rm -f "$TMP"
  exit 1
fi
mv -f "$TMP" "$OUT_DIR/analysis_artifact.txt"
printf 'Created blinded analysis artifact: %s\n' "$OUT_DIR/analysis_artifact.txt"
printf '%s\n' 'Use THIS file for Analysis lock in blindstats.'
