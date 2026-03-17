# PDP 자동 생성 도구

MRT 상품 URL을 입력하면 카테고리를 자동 판별하고, 템플릿에 데이터를 채워 PDP HTML을 생성하는 Claude Code 에이전트.

## Quick Start

```bash
git clone git@github.com:myrealtrip/tna-csm-playground.git
cd tna-csm-playground/PDP_TF/Kiwon
/setup          # 환경 세팅 (1회)
/make-pdp <URL> # PDP 생성
```

## 프로젝트 구조

```
PDP_TF/Kiwon/
├── .claude/
│   ├── rules/          # 응답 형식, 자동 설치 규칙
│   ├── skills/
│   │   ├── make-pdp/   # 핵심 스킬: URL → PDP HTML
│   │   └── setup/      # 환경 세팅 스킬
│   ├── hooks/          # 자동 업데이트 (sync-main)
│   └── settings.json   # MCP 서버 설정
├── templates/          # 6개 카테고리 HTML 템플릿 (수정 금지)
├── tokens/             # 디자인 토큰, 블록 스키마, 조합 규칙
├── pilots/             # 파일럿 예시 = 골든 샘플 (수정 금지)
├── output/             # 생성된 PDP (자동 생성, .gitignore)
├── CLAUDE.md           # 이 파일
└── README.md           # 사용 매뉴얼
```

## 핵심 원칙

- **읽기 중심**: templates/, pilots/ 원본은 절대 수정하지 않는다. 항상 복사 후 치환.
- **정확성 >> 속도**: 크롤링에서 얻지 못한 데이터를 임의로 생성하지 않는다.
- **자동 업데이트**: main 브랜치에서 작업 시 10분마다 origin/main과 자동 동기화.

## 스킬

| 스킬 | 트리거 | 설명 |
|------|--------|------|
| `/setup` | 최초 1회 | Chrome, Chrome DevTools MCP 점검 |
| `/make-pdp <URL>` | PDP 만들어, 상세페이지 생성 | URL → 크롤링 → 카테고리 판별 → HTML 생성 |

## 참조 파일

| 파일 | 용도 |
|------|------|
| `tokens/pdp-assembly.json` | 카테고리별 블록 조합 규칙 |
| `tokens/pdp-blocks.json` | 21개 블록 스키마 (props, style, layout) |
| `tokens/pdp-tokens.json` | 디자인 토큰 |
| `templates/*.html` | 6개 카테고리 HTML 템플릿 |
| `pilots/*.html` | 파일럿 예시 (골든 샘플) |

## 안티패턴 (하지 말 것)

- 골든 샘플(`pilots/*.html`) 수정 금지
- 템플릿(`templates/*.html`) 직접 수정 금지
- 이미지-텍스트 연결이 불확실하면 플레이스홀더로 유지
- 데이터 날조 금지: 부족하면 부족하다고 표시
