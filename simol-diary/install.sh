#!/bin/bash
# SIMOL Diary — 한 줄 설치 스크립트
# 사용법: bash <(curl -sS https://raw.githubusercontent.com/myrealtrip/tna-csm-playground/main/simol-diary/install.sh)

set -e

REPO="https://raw.githubusercontent.com/myrealtrip/tna-csm-playground/main/simol-diary"
INSTALL_DIR="$HOME/simol-diary"

echo ""
echo "  SIMOL Diary 설치"
echo "  ================"
echo ""

# 1. 디렉토리 생성
mkdir -p "$INSTALL_DIR/entries"
mkdir -p "$INSTALL_DIR/reviews"

# 2. HTML 다운로드
echo "  다운로드 중..."
curl -sS "$REPO/index.html" -o "$INSTALL_DIR/index.html"

echo "  설치 완료!"
echo ""
echo "  위치: $INSTALL_DIR/index.html"
echo "  실행: open $INSTALL_DIR/index.html"
echo ""

# 3. 바로 열기
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "$INSTALL_DIR/index.html"
elif command -v xdg-open &>/dev/null; then
  xdg-open "$INSTALL_DIR/index.html"
fi

echo "  사용법:"
echo "  1. 모닝/데이/이브닝 탭에서 하루를 기록"
echo "  2. 자동 저장됨 (첫 저장 시 entries/ 폴더 선택)"
echo "  3. 히스토리 탭에서 과거 기록 조회"
echo "  4. 가이드 탭에서 상세 사용법 확인"
echo ""
echo "  Claude Code 연동 (선택):"
echo "  mkdir -p .claude/skills/ai-review"
echo "  curl -sL https://gist.githubusercontent.com/nowik-oes/9547c5822e18f9bb80e5d0bc24ff0c07/raw/SKILL.md -o .claude/skills/ai-review/SKILL.md"
echo ""
