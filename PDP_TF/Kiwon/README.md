# PDP Maker — Claude Code 에이전트

MRT 상품 URL을 입력하면 카테고리를 자동 판별하고, 템플릿 기반으로 PDP 상세페이지 HTML을 생성하는 도구.

## 요구 사항

| 항목 | 버전 |
|------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 최신 |
| Node.js | 18+ |
| Google Chrome | 최신 |

## 시작하기

### 1. 레포 클론

```bash
git clone git@github.com:myrealtrip/tna-csm-playground.git
cd tna-csm-playground/PDP_TF/Kiwon
```

### 2. Claude Code 실행

```bash
claude
```

> Chrome 브라우저를 먼저 열어두세요. Chrome DevTools MCP가 자동으로 연결됩니다.

### 3. 환경 세팅 (최초 1회)

```
/setup
```

Node.js, Chrome 연결, GitHub CLI 등을 자동으로 점검하고 설치합니다.

### 4. PDP 생성

```
/make-pdp https://experiences.myrealtrip.com/products/3442205
```

## 사용법

### 기본 — 자동 카테고리 판별

```
/make-pdp <MRT 상품 URL>
```

상품 페이지의 `logMeta.firstStandardCategoryCode`를 읽어 자동으로 판별합니다.

### 카테고리 수동 지정

```
/make-pdp <URL> --category tour
/make-pdp <URL> --category ticket
/make-pdp <URL> --category activity
/make-pdp <URL> --category convenience
/make-pdp <URL> --category semi-package
```

### PB Exclusive 지정

```
/make-pdp <URL> --exclusive
```

### 이미지 폴더 지정

```
/make-pdp <URL> --images ./my-images/
```

## 프로젝트 구조

```
PDP_TF/Kiwon/
├── .claude/              # Claude Code 설정
│   ├── settings.json     # hooks 설정 (자동 동기화)
│   ├── hooks/            # sync-main.sh
│   └── skills/           # setup, make-pdp
├── .mcp.json             # Chrome DevTools MCP 서버
├── CLAUDE.md             # 에이전트 행동 규칙
├── templates/            # 6개 카테고리 HTML 템플릿 (수정 금지)
│   ├── tour.html
│   ├── ticket.html
│   ├── activity.html
│   ├── convenience.html
│   ├── semi-package.html
│   └── pb-exclusive.html
├── tokens/               # 디자인 토큰 + 블록 스키마
│   ├── pdp-assembly.json
│   ├── pdp-blocks.json
│   └── pdp-tokens.json
├── pilots/               # 파일럿 PDP 레퍼런스 (수정 금지)
└── output/               # 생성된 PDP (*.html + *.meta.json)
```

## 카테고리별 템플릿

| 카테고리 | 템플릿 | MRT 분류 코드 | 예시 |
|----------|--------|--------------|------|
| 투어 | `tour.html` | TOUR > GUIDE_TOUR | 워킹 투어, 데이 투어 |
| 입장권 | `ticket.html` | TICKET > * | 디즈니랜드, 테마파크 |
| 액티비티 | `activity.html` | ACTIVITY, CLASS | 쿠킹 클래스, 스냅 촬영 |
| 편의 | `convenience.html` | CONVENIENCE | 유심, 와이파이, 수하물 |
| 세미패키지 | `semi-package.html` | TOUR > PACKAGE_TOUR | 숙박+투어 결합 |
| PB 독점 | `pb-exclusive.html` | (수동 지정) | PB Exclusive 상품 |

## 자동 동기화

main 브랜치에서 작업 시, 10분 간격으로 `origin/main`과 자동 동기화됩니다.

- 로컬 변경사항이 있으면 동기화를 건너뜁니다 (안전)
- fast-forward 가능한 경우만 자동 pull
- 별도 설정 없이 Claude Code 실행만 하면 동작

## 업데이트

### 템플릿/토큰 업데이트

main 브랜치에 푸시하면 모든 사용자가 자동 동기화로 받습니다.

```bash
# 템플릿 수정 후
git add templates/ tokens/
git commit -m "update: tour.html 레이아웃 개선"
git push origin main
```

### 스킬 업데이트

```bash
git add .claude/skills/
git commit -m "update: make-pdp 스킬 이미지 매핑 개선"
git push origin main
```

### 출력물 공유

생성한 PDP를 팀에 공유하려면:

```bash
git add output/
git commit -m "add: 파리 디즈니랜드 PDP"
git push origin main
```

## 주의사항

- `templates/` 폴더의 원본 템플릿은 직접 수정하지 마세요
- `pilots/` 폴더의 파일럿 PDP는 레퍼런스용이며 수정 금지입니다
- 크롤링에서 얻지 못한 데이터를 임의로 만들지 않습니다 — 부족하면 표시합니다
