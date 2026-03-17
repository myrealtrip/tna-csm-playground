# PDP 자동 생성 도구

MRT 상품 URL을 입력하면 **카테고리 자동 판별 → 템플릿 매핑 → PDP HTML 생성**까지 Claude Code가 자동으로 처리합니다.

---

## 1. 시작하기

### 사전 준비

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 설치
- [Chrome 브라우저](https://www.google.com/chrome/) 설치
- Claude Code에 **Chrome DevTools MCP** 서버 등록
  - Claude Code에서 `/mcp` 입력 → `Add MCP Server` → `chrome-devtools` 추가

### 클론 및 설정

```bash
# 1. 레포 클론
git clone git@github.com:myrealtrip/tna-csm-playground.git
cd tna-csm-playground/PDP_TF/Kiwon

# 2. Claude Code 실행
claude

# 3. 환경 점검 (최초 1회)
/setup
```

---

## 2. PDP 생성

### 기본 사용법

```
/make-pdp https://experiences.myrealtrip.com/products/3442205
```

Claude가 자동으로:
1. 상품 페이지를 Chrome으로 열어 데이터를 크롤링합니다
2. 카테고리를 자동 판별합니다 (TOUR, TICKET, ACTIVITY 등)
3. 해당 템플릿에 데이터를 매핑합니다
4. `output/` 폴더에 HTML 파일을 생성합니다
5. 브라우저에서 프리뷰를 열어줍니다

### 옵션

```
/make-pdp <URL> --exclusive            # PB Exclusive 카테고리 강제 지정
/make-pdp <URL> --category tour        # 카테고리 수동 지정
/make-pdp <URL> --images ./my-images   # 이미지 폴더 지정
```

### 지원 카테고리

| 카테고리 | 템플릿 | 예시 상품 |
|----------|--------|----------|
| tour | `templates/tour.html` | 가이드 투어, 워킹 투어 |
| ticket | `templates/ticket.html` | 입장권, 패스 |
| activity | `templates/activity.html` | 체험, 클래스, 스냅 |
| convenience | `templates/convenience.html` | 유심, 와이파이, 수하물 |
| semi-package | `templates/semi-package.html` | 호텔+투어 패키지 |
| pb-exclusive | `templates/pb-exclusive.html` | PB 독점 상품 |

---

## 3. 프로젝트 구조

```
PDP_TF/Kiwon/
├── .claude/                # Claude Code 에이전트 설정
│   ├── rules/              # 응답 형식, 자동 설치 규칙
│   ├── skills/
│   │   ├── make-pdp/       # 핵심: URL → PDP HTML 생성
│   │   └── setup/          # 환경 세팅
│   ├── hooks/
│   │   └── sync-main.sh    # main 자동 동기화 (10분 간격)
│   └── settings.json       # Hook 설정
├── templates/              # HTML 템플릿 (6개, 수정 금지)
├── tokens/                 # 디자인 토큰, 블록 스키마
│   ├── pdp-assembly.json   # 카테고리별 블록 조합 규칙
│   ├── pdp-blocks.json     # 21개 블록 스키마
│   └── pdp-tokens.json     # 디자인 토큰
├── pilots/                 # 골든 샘플 (수정 금지)
├── output/                 # 생성된 PDP HTML
├── CLAUDE.md               # Claude Code 프로젝트 컨텍스트
└── README.md               # 이 파일
```

---

## 4. 자동 업데이트

### main 브랜치 자동 동기화

`.claude/hooks/sync-main.sh`가 **10분 간격**으로 자동 실행됩니다:

- main 브랜치에서 작업 중일 때만 동작
- 로컬 변경사항이 있으면 건너뜀 (안전)
- fast-forward 가능할 때만 `pull`
- 별도 조작 없이 항상 최신 템플릿/스킬을 유지

### 수동 업데이트

```bash
git pull origin main
```

### 템플릿/토큰 업데이트 시

템플릿이나 토큰이 업데이트되면 main에 커밋됩니다. 자동 동기화 hook이 10분 내에 반영하지만, 즉시 반영하려면:

```bash
git pull origin main
```

---

## 5. 생성 결과물 관리

| 파일 | Git 추적 | 설명 |
|------|----------|------|
| `output/*.html` | O | 생성된 PDP HTML (공유용) |
| `output/*.meta.json` | X | 메타데이터 (로컬 참조용) |
| `output/pb-exclusive.css` | O | 공유 CSS |

### 생성된 PDP 공유하기

```bash
git add output/my-product.html
git commit -m "feat: MY-PRODUCT PDP 생성"
git push origin main
```

---

## 6. 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| `/make-pdp` 실행 시 Chrome 관련 에러 | Chrome DevTools MCP 미등록 | `/mcp` → `chrome-devtools` 서버 추가 |
| 카테고리 판별 실패 | MRT 페이지 구조 변경 | `--category` 옵션으로 수동 지정 |
| 이미지가 모두 플레이스홀더 | 크롤링 시 이미지 로드 지연 | `--images` 옵션으로 로컬 이미지 폴더 지정 |
| 템플릿 블록이 비어있음 | 상품 페이지에 해당 정보 없음 | 정상 동작. 부족 블록은 수동으로 채우거나 비워둠 |

---

## 7. 기여하기

### 템플릿 수정

`templates/*.html`을 직접 수정하지 마세요. 변경이 필요하면:

1. 별도 브랜치 생성
2. 수정 후 PR
3. 기존 pilots/ 골든 샘플과 비교 검증

### 새 카테고리 추가

1. `templates/`에 새 HTML 템플릿 추가
2. `tokens/pdp-assembly.json`에 블록 조합 규칙 추가
3. `make-pdp/SKILL.md`의 룩업 테이블에 매핑 추가
4. 파일럿 예시를 `pilots/`에 추가
