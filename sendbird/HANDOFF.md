# Sendbird 파트너 분석기 — 핸드오프 문서

> 작성: 2026-03-20 · 개발 : 시은+Claude Code
> 이 문서는 시은규도시개발 프로젝트 리더를 위한 전체 컨텍스트입니다.

---

## 1. 프로젝트 배경과 목적

### 해결하려는 문제

중화권팀은 현지 파트너의 운영 품질을 모니터링해야 한다. 기존에는:

- Sendbird 대시보드에서 대화를 **하나하나 눈으로 읽으며** 확인
- 확정률, 취소 패턴, 응답 속도 등을 **수작업으로 집계**
- 파트너별 리스크 판단에 **주관적 기준** 적용

이 과정을 자동화하여, 북마클릿 한 번 클릭으로 파트너 분석 리포트를 생성하는 도구를 만들었다.

### 최종 산출물

북마클릿 1개 실행 → 2개 파일 동시 다운로드:

| 파일 | 용도 |
|------|------|
| `sendbird-report-{userId}-{period}-{date}.html` | 수치 기반 자동 분석 리포트 (자체 완결형 HTML) |
| `sendbird-{userId}-{period}-{date}.md` | 대화 원문 (Claude Code 뉘앙스 분석용) |

---

## 2. 설계 의사결정 히스토리

### Phase 1: 어떤 방식으로 만들 것인가

**검토한 선택지:**

| 방식 | 장점 | 탈락 이유 |
|------|------|-----------|
| Sendbird API + 서버 | 자동화, 스케줄링 가능 | API 키 필요, 서버 비용, 인프라 관리 |
| Chrome 확장 프로그램 | 풍부한 UI | 설치/배포 허들, 관리 부담 |
| **북마클릿 + GitHub Pages** | 설치 0초, 비용 0원, CSP 통과 | 브라우저 세션 의존 |

**결정: 북마클릿 방식**

- Sendbird 대시보드(`dashboard.sendbird.com`)에 로그인한 상태에서 `credentials: 'include'`로 세션 쿠키 활용
- CSP 검증 완료: `dashboard.sendbird.com`은 외부 스크립트 로드를 허용함
- GitHub Pages(`myrealtrip.github.io`)에서 `analyzer.js`를 호스팅

### Phase 2: AI 분석을 어디서 할 것인가

**검토한 선택지:**

| 방식 | 장점 | 탈락 이유 |
|------|------|-----------|
| 리포트 내 AI 분석 버튼 | 원클릭 | API 키 노출 위험, 비용 분담 불가 |
| Claude.ai에 붙여넣기 | 간단 | 987KB MD 파일 → 컨텍스트 초과 |
| **Claude Code로 로컬 파일 분석** | 파일 크기 제한 없음, 부분 읽기 지원 | CLI 접근 필요 |

**결정: 2-track 구조**
- Track A: HTML 리포트 — 수치 자동 집계 (즉시 확인)
- Track B: Claude Code + MD — 대화 뉘앙스 심층 분석 (필요 시)

### Phase 3: 도구 통합

초기에는 MD 추출기(index.html)와 분석기(analyzer/)가 별도 북마클릿이었다.
동일한 API를 중복 호출하고 사용자가 2개를 설치해야 하는 불편함이 있어 **1개로 통합**.

---

## 3. 기술 아키텍처

### 2단계 로더 구조

```
[북마클릿 (즐겨찾기 바)]
  │  짧은 JS 코드 (~200자)
  │  <script src="...analyzer.js"> 삽입
  ▼
[analyzer.js (GitHub Pages)]
  │  버전 체크 → 설치 안내
  │  도메인 체크 → 경고 오버레이
  │  User ID 입력 → 대문자 변환
  ▼
[Sendbird Platform API]
  │  GET /channels (members_include_in=userId)
  │  GET /messages (channel별 페이지네이션)
  │  credentials: 'include' (세션 쿠키)
  ▼
[분석 엔진]
  │  parseAdmm → classifyChannel → aggregateStats
  ▼
[출력]
  ├─ renderReport() → HTML Blob → 자동 다운로드
  └─ generateMd()  → MD Blob  → 자동 다운로드 (200ms 딜레이)
```

### 파일 구조

```
sendbird/
├── index.html              # 설치 가이드 페이지 (북마클릿 드래그 설치)
└── analyzer/
    ├── analyzer.js          # 핵심 엔진 (36KB, 함수 10개)
    ├── index.html           # analyzer/ → sendbird/ 리다이렉트
    └── test.html            # 브라우저 단위 테스트 (14개 케이스)
```

### 핵심 함수 맵

```
parseAdmm(msg)              # ADMM 메시지 → {status, cancelReason, ...}
classifyChannel(admmEvents)  # 이벤트 배열 → 최종 예약 상태
aggregateStats(channels)     # 전체 채널 → KPI 집계
renderReport(stats, period)  # 집계 결과 → self-contained HTML
generateMd(channels, userId) # 전체 채널 → 대화 원문 마크다운
createProgressPanel()        # 진행 상태 중앙 오버레이
runAnalyzer(appId, userId, monthsBack)  # 메인 진입점
```

### 데이터 흐름: ADMM 메시지

Sendbird의 시스템 메시지(`type: 'ADMM'`)에 예약 상태 변경 정보가 JSON으로 들어있다.

```
msg.data (JSON string)
  ├── message_event_type: "RESERVATION_STATUS_CHANGE"
  ├── reservation_status: "WAIT_CONFIRM" | "CONFIRM" | "CANCEL"
  └── message.targetContents[].content[].reservationInfoList[]
       ├── {name: "예약번호", value: "EXP-xxx"}
       ├── {name: "여행 출발일", value: "2026년 4월 15일"}
       └── {name: "취소사유", value: "여행자 개인 사정"}
```

---

## 4. 분석 로직 상세

### 4.1 확정률 / 취소율

- **분모**: `CONFIRM + CANCEL + WAIT_CONFIRM` (예약이 발생한 건만)
- **단순 문의** (NO_RESERVATION): 분모에서 제외 — 전환 실패가 아님
- 확정률 = `confirm / total * 100`
- 취소율 = `cancel / total * 100`

### 4.2 취소 사유 분류

| 카테고리 | 매칭 키워드 | 비고 |
|----------|-------------|------|
| 고객 사유 | 여행자, 고객, 중복 예약, 일정 변경 | |
| 파트너 사유 | 파트너, 운영사, 운영 불가 | |
| 미분류 | 위 패턴에 해당 없음 | |
| 기상/천재지변 (태그) | 기상, 날씨, 태풍, 우천, 폭우, 폭설, 지진, 천재 | 별도 집계 |
| 최소인원 미달 (태그) | 최소 인원, 인원 미달, 모객 | 별도 집계 |
| 플랫폼 이슈 (태그) | MRT, 마이리얼트립, 운영팀, 플랫폼 | 별도 집계 |

- **확정 후 취소**: CONFIRM → CANCEL 이력이 있는 건. 사유와 무관하게 별도 집계.
- **키워드 매칭 한계**: 정확도 중간. 실제 대화 확인 권장 (리포트에 면책 문구 포함).

### 4.3 응답시간

- 고객 연속 메시지 그룹의 **마지막** 타임스탬프 → 파트너 **첫** 답장 타임스탬프
- 시스템 메시지(ADMM, user 없는 메시지) 제외
- **응답률** = 파트너가 답한 질문 / 전체 고객 질문
- **무응답 건**: 평균에 포함하지 않음 (왜곡 방지). 별도 `ignoredQuestions`로 집계.

### 4.4 미답변

- 대화방의 마지막 메시지가 고객 발신이면 미답변 1건
- **확정 후 질문 무시도 미답변으로 카운트** (예약 상태 무관)

---

## 5. 시행착오 기록

### 실패한 시도들

| 시도 | 왜 실패했는지 | 교훈 |
|------|-------------|------|
| 키워드 기반 "운영 동향" 섹션 | 미리 정한 키워드로 노쇼, 일정변경 등을 탐지 → false positive/negative 다수 | 키워드 매칭으로 뉘앙스를 잡으려 하지 말 것 |
| 키워드 기반 "주요 이벤트" 섹션 | 위와 동일. 1건만 매칭되는 경우 의미 없음 | 삭제하고 취소 분석으로 대체 |
| HTML 리포트 내 Claude 분석 버튼 | 리포트 데이터만 전달 → 대화 뉘앙스 없이 수치만 재해석 | 원문 기반 분석이 필수 |
| 단일 Claude.ai 프롬프트 | 987KB MD 파일 → 컨텍스트 초과 | Claude Code의 부분 읽기 활용 |
| MD 추출기와 분석기 분리 운영 | 동일 API 2번 호출, 북마클릿 2개 관리 | 통합이 답 |

### 코드 리뷰에서 발견한 주요 버그 (수정 완료)

| 버그 | 영향도 | 원인 |
|------|--------|------|
| `fetchMessages` 무한루프 가능 | 크리티컬 | API가 빈 결과 반환하지 않을 때 종료 조건 없음 |
| XSS 취약점 | 높음 | 파트너명, 상품명을 escape 없이 innerHTML에 삽입 |
| `pct is not a function` | 블로킹 | renderReport 로컬 함수를 runAnalyzer에서 참조 |
| `periodTag` 초기화 전 접근 | 블로킹 | 변수 선언 순서 오류 |
| 취소 카드 합계 불일치 | 혼란 유발 | 확정 후 취소를 별도 배지로 뺐는데 총 건수에는 포함 |
| 응답시간에 무응답 포함 | 데이터 왜곡 | 무응답을 별도 분리하지 않아 평균이 낙관적 |
| ADMM 이중 파싱 | 비효율 | generateMd에서 parseAdmm 대신 직접 JSON.parse |

---

## 6. 방어 로직 목록

| 상황 | 대응 |
|------|------|
| Sendbird 대시보드 외 사이트에서 실행 | 중앙 오버레이 경고 + 설치 가이드 링크 |
| 로그인하지 않은 상태 | "로그인 후 다시 시도" 안내 |
| User ID 소문자 입력 | 자동 `.toUpperCase()` 변환 |
| 북마클릿 중복 클릭 | `window._analyzerRunning` 가드 |
| 채널 0건 | "해당 유저의 대화방을 찾을 수 없습니다" 안내 |
| 메시지 수집 무한루프 | 200회 반복 제한 |
| 버전 불일치 | 완료 오버레이에 재설치 안내 표시 |
| HTML/MD 동시 다운로드 차단 | 200ms 딜레이 |
| 완료 오버레이 바깥 클릭 | 이벤트 전파 차단 (닫히지 않음) |

---

## 7. 향후 개선 포인트

### 우선순위 높음

| 개선 | 기대 효과 | 난이도 |
|------|----------|--------|
| **다중 파트너 비교 뷰** | 여러 파트너를 한 화면에서 비교. 운영팀이 가장 요구하는 기능 | 중 |
| **기간별 추이 차트** | 월별 확정률/응답시간 변화를 시각화. 파트너 개선 여부 추적 | 중 |
| **취소 사유 고도화** | 키워드 대신 ADMM `data` 필드의 정형 태그 활용. MRT 백엔드 팀과 협의 필요 | 하 |
| **응답시간 분포 히스토그램** | 평균만으로는 이상치가 가려짐. 1h/4h/24h 구간 분포 표시 | 하 |
| **test.html 테스트 케이스 보강** | 새로 추가된 함수(응답률, 무시된 질문 등) 커버리지 부족 | 하 |

### 우선순위 중간

| 개선 | 기대 효과 | 난이도 |
|------|----------|--------|
| **대시보드 모드** | 리포트를 다운로드 대신 브라우저 내에서 바로 렌더링 | 중 |
| **Slack 알림 연동** | 확정률 임계치 이하 파트너 자동 알림 | 상 |
| **캐싱 레이어** | 같은 파트너 재분석 시 API 호출 최소화 | 중 |
| **CSV/Excel 내보내기** | 리포트 데이터를 스프레드시트로 가공 | 하 |

### 우선순위 낮음 (아이디어)

| 개선 | 설명 | 협업 |
|------|------|------|
| **파트너 등급 자동 산정** | 확정률 + 응답시간 + 취소 패턴 → A/B/C 등급. 파트너 성장지원팀에서 이미 등급 체계를 운영 중이므로 기존 기준과 연동하면 시너지가 큼 | 파트너 성장지원팀(지선님) — 등급 기준 정의 + 검증 |
| 이상 탐지 알림 | 갑작스러운 취소율 급증, 응답 지연 패턴 감지 | |
| 다국어 리포트 | 파트너에게 직접 공유할 수 있도록 영어/일어/중국어 버전 | |

---

## 8. 보안 점검

### 현재 안전한 부분

| 항목 | 상태 |
|------|------|
| 데이터 전송 | 외부 서버로 전송 없음. 모든 데이터 로컬 다운로드 |
| API 키 노출 | 없음. Sendbird 대시보드 세션 쿠키만 사용 |
| XSS | `escapeHtml()` 적용 — 파트너명, 상품명 등 사용자 입력 이스케이프 |
| 민감 정보 하드코딩 | 없음 |
| 접근 범위 | Sendbird 대시보드 로그인 사용자의 기존 권한 범위와 동일 |

### 주의 사항

**공급망 위험**: `analyzer.js`가 GitHub Pages에 호스팅되어 있어, 레포에 push 권한이 있는 사람이 악성 코드를 삽입하면 북마클릿 사용자의 Sendbird 세션으로 데이터 유출 가능.

- **현실적 위험도는 낮음**: `myrealtrip` 조직 내부 멤버만 push 가능하고, 대상 데이터(파트너 대화)는 외부 공격 동기가 낮음
- **CODEOWNERS 설정 완료**: `sendbird/` 변경 시 리뷰어 지정 (`@nowik-oes`)
- **branch protection 미적용**: 레포 admin이 설정해야 함. CODEOWNERS 강제를 위해 권장

### 다운로드 파일 취급

`sendbird-*.md` 파일에는 **고객 개인정보**(이름, 연락처, 예약번호)가 포함될 수 있음.
- 분석 후 로컬 파일 삭제 권장
- 공유 드라이브/메신저로 전송 시 주의

### 권장 조치 (레포 admin 대상)

```
Settings → Branches → Branch protection rules → Add rule
- Branch name pattern: main
- ✅ Require a pull request before merging
- ✅ Require approvals (1명)
- ✅ Require review from Code Owners
```

---

## 9. 로컬 개발 가이드

### 빠른 시작

```bash
# 1. 레포 클론
git clone https://github.com/myrealtrip/tna-csm-playground.git
cd tna-csm-playground

# 2. 로컬 서버 (어떤 것이든)
npx serve .
# 또는
python3 -m http.server 8000

# 3. 브라우저에서 테스트 페이지 열기
open http://localhost:3000/sendbird/analyzer/test.html
```

### 실제 데이터로 테스트

1. `dashboard.sendbird.com`에 로그인
2. 개발자 도구 Console에서 직접 실행:
   ```js
   const s = document.createElement('script');
   s.src = 'http://localhost:3000/sendbird/analyzer/analyzer.js';
   document.head.appendChild(s);
   // 로드 후
   runAnalyzer('YOUR_APP_ID', 'P8282', 1);
   ```
3. `appId`는 대시보드 URL에서 확인: `dashboard.sendbird.com/APP_ID/...`

### 배포

GitHub Pages로 자동 배포. `main` 브랜치에 push하면 1-3분 후 반영.

```bash
git push origin main
# 반영 확인: https://myrealtrip.github.io/tna-csm-playground/sendbird/
```

**주의**: 사용자 브라우저에 analyzer.js가 캐시될 수 있음.
`ANALYZER_VERSION` 상수를 올리면 버전 불일치 시 재설치 안내가 표시됨.

---

## 10. 커밋 히스토리 요약

총 40개 커밋 (2026-03-19 ~ 03-20), 주요 마일스톤:

| 단계 | 커밋 수 | 내용 |
|------|---------|------|
| MD 추출기 | 1 | Sendbird 대화 내보내기 |
| 분석 엔진 코어 | 5 | parseAdmm, classifyChannel, aggregateStats, renderReport |
| 설치/배포 | 3 | GitHub Pages, 북마클릿 로더, 가이드 페이지 |
| 도구 통합 | 2 | MD + 분석기 1개로 합침 |
| 방어 로직 | 4 | 도메인 체크, 대문자 변환, 중복 방지, 빈 결과 |
| 코드 리뷰 수정 | 9 | 3라운드 리뷰 (타임아웃 → 보안/정합성 → 에이전트 병렬) |
| UX 개선 | 12 | 완료 오버레이, 폰트 확대, 레이아웃 grid, 이스터에그 |
| 설계 판단 반영 | 4 | 응답률, 미답변, 취소 세분화, 무시된 질문 |

---

## 부록: 관련 리소스

- **설치 페이지**: https://myrealtrip.github.io/tna-csm-playground/sendbird/
- **GitHub 레포**: https://github.com/myrealtrip/tna-csm-playground
- **Sendbird 대시보드**: https://dashboard.sendbird.com
- **중화권팀 Confluence**: https://myrealtrip.atlassian.net/wiki/spaces/TA
