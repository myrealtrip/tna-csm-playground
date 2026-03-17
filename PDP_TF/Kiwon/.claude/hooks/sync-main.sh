#!/bin/bash
# main 브랜치 동기화 보장. 10분 이내 체크 이력이 있으면 스킵한다.
# 현재 브랜치가 main이고 작업 트리가 깨끗할 때만 fast-forward sync를 시도한다.

cat > /dev/null  # stdin 소비

REPO_HASH=$(echo "${CLAUDE_PROJECT_DIR:-unknown}" | md5 -q 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-unknown}" | md5sum 2>/dev/null | cut -d' ' -f1)
SYNC_FLAG="/tmp/claude-sync-${REPO_HASH}"
SYNC_INTERVAL=600

# 최근 체크 이력이 있으면 즉시 통과
if [ -f "$SYNC_FLAG" ]; then
  if stat -f %m "$SYNC_FLAG" >/dev/null 2>&1; then
    last=$(stat -f %m "$SYNC_FLAG")
  else
    last=$(stat -c %Y "$SYNC_FLAG" 2>/dev/null || echo 0)
  fi
  now=$(date +%s)
  if [ $(( now - last )) -lt $SYNC_INTERVAL ]; then
    exit 0
  fi
fi

REPO="${CLAUDE_PROJECT_DIR:?CLAUDE_PROJECT_DIR is not set}"
cd "$REPO" 2>/dev/null || exit 0

CURRENT_BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "main" ]; then
  exit 0
fi

# fetch 후 로컬 vs 리모트 비교
git fetch origin main --quiet 2>/dev/null || exit 0

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)

if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
  touch "$SYNC_FLAG"
  exit 0
fi

if [ "$LOCAL" != "$REMOTE" ]; then
  if ! git diff --quiet --ignore-submodules HEAD -- 2>/dev/null; then
    echo "[sync] main에 로컬 변경사항이 있어 자동 동기화를 건너뜁니다." >&2
    touch "$SYNC_FLAG"
    exit 0
  fi

  if git merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
    if git pull --ff-only origin main --quiet 2>/dev/null; then
      echo "[sync] main 브랜치를 origin/main 최신 커밋으로 동기화했습니다." >&2
    fi
  else
    echo "[sync] 로컬 main이 origin/main과 fast-forward 관계가 아니어서 자동 동기화를 건너뜁니다." >&2
  fi
fi

touch "$SYNC_FLAG"
exit 0
