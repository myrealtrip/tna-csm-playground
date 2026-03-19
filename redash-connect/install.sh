#!/bin/bash
set -e

SKILL_DIR="$HOME/.claude/skills/redash-connect"
SKILL_URL="https://raw.githubusercontent.com/myrealtrip/tna-csm-playground/main/redash-connect/SKILL.md"

echo "redash-connect 스킬을 설치하는 중..."

mkdir -p "$SKILL_DIR"
curl -fsSL "$SKILL_URL" -o "$SKILL_DIR/SKILL.md"

echo ""
echo "✅ 설치 완료!"
echo "Claude Code를 재시작한 뒤 'Redash 연결해줘'라고 말해보세요."
