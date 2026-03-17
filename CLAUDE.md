# TNA CSM Playground

PDP TF의 Claude Code 에이전트 공유 레포.

## 스킬

| 스킬 | 설명 |
|------|------|
| `/setup` | 환경 세팅 (Node, Chrome DevTools MCP, GitHub CLI) |
| `/make-pdp <URL>` | MRT 상품 URL → PDP HTML 자동 생성 |

## PDP Maker 사용법

```bash
claude          # Claude Code 실행 (Chrome 먼저 열기)
/setup          # 최초 1회 환경 세팅
/make-pdp https://experiences.myrealtrip.com/products/상품ID
```

상세 매뉴얼: `PDP_TF/Kiwon/README.md`

## 핵심 원칙

- **자동 동기화**: main 브랜치에서 작업 시 origin/main과 10분 간격 자동 동기화
- **템플릿 보호**: `PDP_TF/Kiwon/templates/*.html`, `pilots/*.html`은 수정 금지
- **데이터 날조 금지**: 크롤링에서 얻지 못한 데이터를 임의 생성하지 않음

## 디렉토리 구조

```
PDP_TF/Kiwon/
├── templates/    # 6개 카테고리 HTML 템플릿
├── tokens/       # 디자인 토큰, 블록 스키마
├── pilots/       # 파일럿 PDP 레퍼런스
└── output/       # 생성된 PDP
```
