# PDP Maker

MRT 상품 URL 또는 신규 상품 정보로 PDP HTML을 자동 생성하는 Claude Code 에이전트.

## Quick Start

```bash
# 1. 레포 클론 (폴더명 자유)
git clone git@github.com:myrealtrip/tna-csm-playground.git 원하는폴더명
cd 원하는폴더명

# 2. Claude Code 실행 후 setup
claude
/setup

# 3. PDP 생성
/make-pdp https://experiences.myrealtrip.com/products/3442205   # 기존 상품
/make-pdp --new                                                  # 신규 상품
```

## 핵심 원칙

- **읽기 중심**: main 브랜치는 읽기 중심. output/ 폴더에만 생성물을 저장.
- **데이터 날조 금지**: 크롤링에서 얻지 못한 데이터를 임의로 생성하지 않는다. 부족하면 표시.
- **템플릿 원본 보호**: `templates/*.html`, `pilots/*.html`은 절대 수정하지 않는다.
- **자동 동기화**: Claude Code 실행 중 origin/main과 자동 동기화.

## 시스템 구조

| 디렉토리 | 역할 |
|----------|------|
| `.claude/skills/` | setup, make-pdp |
| `.claude/hooks/` | main 자동 동기화 |
| `PDP_TF/Kiwon/templates/` | 6개 카테고리 HTML 템플릿 |
| `PDP_TF/Kiwon/tokens/` | 디자인 토큰, 블록 스키마, 블록 조합 규칙 |
| `PDP_TF/Kiwon/pilots/` | 파일럿 PDP 레퍼런스 (수정 금지) |
| `PDP_TF/Kiwon/output/` | 생성된 PDP HTML + 메타데이터 |

## 카테고리별 템플릿

| 카테고리 | 템플릿 | 예시 |
|----------|--------|------|
| TOUR | tour.html | 가이드 투어, 워킹 투어 |
| TICKET | ticket.html | 입장권, 패스 |
| ACTIVITY | activity.html | 체험, 클래스, 스냅 |
| CONVENIENCE | convenience.html | 유심, 와이파이, 수하물 |
| SEMI_PACKAGE | semi-package.html | 숙박+투어 패키지 |
| PB_EXCLUSIVE | pb-exclusive.html | PB 독점 상품 |

## MCP 도구

Chrome DevTools MCP 서버를 사용하여 상품 페이지를 크롤링한다.
`.mcp.json`에 설정이 포함되어 있으며, `/setup` 스킬로 자동 설치된다.

## 응답 형식

- 두괄식: 결론을 먼저, 근거를 나중에
- 콘텐츠 매핑 결과는 표로 정리 (블록명, 상태, 내용)
- 부족한 블록은 명확히 표시하고 사용자에게 선택권 제공
