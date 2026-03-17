#!/bin/bash
# 원본 레포 자동 동기화. 10분 이내 체크 이력이 있으면 스킵.
# CLAUDE_PROJECT_DIR이 git 하위 폴더여도 git root를 자동으로 찾는다.

cat > /dev/null  # stdin 소비

# git root 찾기 (PDP_TF/Kiwon에서 실행해도 레포 루트로 이동)
GIT_ROOT=$(cd "${CLAUDE_PROJECT_DIR:-.}" && git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$GIT_ROOT" ]; then
  exit 0
fi

REPO_HASH=$(echo "$GIT_ROOT" | md5 -q 2>/dev/null || echo "$GIT_ROOT" | md5sum 2>/dev/null | cut -d' ' -f1)
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

cd "$GIT_ROOT" 2>/dev/null || exit 0

CURRENT_BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "main" ]; then
  exit 0
fi

git fetch origin main --quiet 2>/dev/null || exit 0

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)

if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
  touch "$SYNC_FLAG"
  exit 0
fi

if [ "$LOCAL" != "$REMOTE" ]; then
  if ! git diff --quiet --ignore-submodules HEAD -- 2>/dev/null; then
    echo "[sync] 로컬 변경사항이 있어 자동 동기화를 건너뜁니다." >&2
    touch "$SYNC_FLAG"
    exit 0
  fi

  if git merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
    if git pull --ff-only origin main --quiet 2>/dev/null; then
      echo "[sync] origin/main 최신 커밋으로 동기화했습니다." >&2
    fi
  fi
fi

touch "$SYNC_FLAG"
exit 0
