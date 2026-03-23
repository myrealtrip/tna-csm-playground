---
name: make-pdp
description: "MRT 상품 URL 또는 신규 상품 정보 → PDP 상세페이지 HTML 자동 생성. 트리거 키워드: PDP 만들어, 상세페이지 생성, make-pdp, PDP 생성, 상세페이지 만들어줘, PDP HTML"
---

# make-pdp — PDP 상세페이지 자동 생성

MRT 상품 URL 또는 신규 상품 정보로 PDP HTML을 생성한다. 두 가지 모드를 지원한다.

## 사용법

```
# 기존 MRT 상품 (URL 크롤링)
/make-pdp <URL>                        # 자동 판별 → HTML 생성
/make-pdp <URL> --exclusive            # PB Exclusive 카테고리 강제 지정
/make-pdp <URL> --category <카테고리>   # 카테고리 수동 지정
/make-pdp <URL> --images <폴더경로>     # 이미지 폴더 지정

# 신규 상품 (대화형 정보 수집)
/make-pdp --new                        # 대화형 위자드로 PDP 생성
/make-pdp --new --images <폴더경로>     # 이미지 폴더 함께 지정
```

## 워크플로우

### Step 0: 입력 파싱 & 모드 분기

사용자 입력에서 추출:

| 항목 | 필수 | 기본값 |
|------|------|--------|
| URL 또는 --new | 필수 (둘 중 하나) | — |
| --exclusive | 선택 | false |
| --category | 선택 | 자동 판별 |
| --images | 선택 | 없음 (플레이스홀더) |

**모드 분기:**
- `--new` 플래그 → **신규 모드** (Step 1N으로)
- URL 있음 → **크롤링 모드** (Step 1로)
- 둘 다 없음 → "MRT 상품 URL을 입력하거나, --new로 신규 상품을 만들 수 있어요!"

---

## A. 신규 상품 모드 (`--new`)

URL 없이 대화형으로 정보를 수집하여 PDP를 생성한다.

### Step 1N: 카테고리 선택

AskUserQuestion으로 카테고리를 먼저 받는다. 카테고리에 따라 뒤의 질문이 달라지므로 반드시 첫 질문이어야 한다.

```
Q1: "어떤 유형의 상품인가요?"
options:
  - tour (투어/가이드투어) — 코스 기반, 가이드 동행
  - ticket (티켓/입장권) — 시설 입장, 패스
  - activity (액티비티/체험) — 클래스, 스냅, 체험
  - convenience (편의/서비스) — 유심, 와이파이, 수하물
  - semi-package (세미패키지) — 숙박+투어 결합, N박
  - pb-exclusive (PB 자체 기획) — PB 독점 상품
```

### Step 2N: 필수 정보 수집

카테고리 확정 후, 해당 카테고리의 필수 정보를 순서대로 수집한다.

**2N-1. 공통 필수 (전 카테고리)**

AskUserQuestion으로 한 번에 수집:

```
Q2: 다음 정보를 알려주세요.

1. 상품명 (예: 교토 사찰 워킹투어)
2. 지역 (예: 일본, 교토)
3. 가격 (예: 성인 55,000원 / 아동 35,000원)
4. 상품 설명 — 이 상품의 핵심 매력을 2-3줄로 (예: 현지 전문 가이드와 함께 교토의 숨은 사찰을 걸으며...)
```

**2N-2. 카테고리별 추가 필수**

카테고리에 따라 추가 질문을 한다. 한 번의 질문에 해당 카테고리의 추가 필수 항목을 모두 묶는다.

| 카테고리 | 추가 질문 내용 |
|----------|--------------|
| **tour** | 코스/일정 (장소명 + 활동 + 소요시간), 주의사항 |
| **ticket** | 이용 방법/순서, 가격 옵션별 상세, 주의사항 (유효기간/취소 등) |
| **activity** | 체험 흐름 (시간대별 활동), 하이라이트 포인트, 운영 정보 (시간/언어/인원) |
| **convenience** | 이용 절차 (수령/활성화 순서), 가격 옵션별 상세 |
| **semi-package** | Day별 일정, 호텔 정보 (이름/등급/위치), 패키지 구성 요약, 가격표, FAQ 3개 이상 |
| **pb-exclusive** | 가이드 정보 (이름/사진/소개/경력), 프로그램 카드 내용 (8-10개, 사진+제목+시간+설명), 추천 대상 (2-4개), 상세 일정 (시간대별) |

예시 (tour):
```
Q3: 투어 코스를 알려주세요.
    각 장소별로 장소명, 활동 내용, 소요시간을 적어주세요.

    예시:
    1. 기요미즈데라 (30분) — 본당 참배 및 전망대에서 교토 시내 조망
    2. 니넨자카 (20분) — 전통 골목 산책, 포토스팟
    3. ...

    주의사항도 함께 알려주세요.
    (예: 걷기 편한 신발 필수, 우천 시 정상 진행 등)
```

**2N-3. 포함/불포함**

```
Q4: 포함/불포함 사항을 알려주세요.

포함: (예: 한국어 가이드, 입장료, 간식)
불포함: (예: 교통비, 개인 경비, 식사)
```

### Step 3N: 추가 정보 (선택)

필수 정보 수집 후, 선택 블록 추가 여부를 묻는다.

```
Q5: "필수 정보는 다 모았어요! (진행률 표시)"

1. 바로 생성
2. 추가 정보 입력 (리뷰, FAQ, 추천 대상, 하이라이트 등)
3. 메모/이메일/카톡 내용 붙여넣기 — 추가 정보를 자동 추출할게요
```

사용자가 2번 선택 시 → multiSelect로 추가할 블록 선택:
- □ 고객 리뷰 (customerReview)
- □ FAQ (faqAccordion)
- □ 추천 대상 (recommendBox)
- □ 하이라이트 포인트 (highlightCallout)
- □ 가이드 소개 (guideProfile) — tour/pb-exclusive가 아닌 경우

사용자가 3번 선택 시 → 자유입력으로 비정형 텍스트를 받아 파싱:
- 텍스트에서 추출 가능한 정보를 자동 매핑
- 추출 결과를 표로 보여주고 확인

### Step 3N-이미지: 이미지 수집

```
Q: "이미지는 어떻게 할까요?"
options:
  - 폴더 경로 지정 (로컬 이미지)
  - 나중에 추가 (플레이스홀더로 생성)
```

폴더 지정 시 → `--images` 옵션과 동일하게 처리 (Step 4로).

### Step 3N-확인: 매핑 결과 확인

수집된 데이터를 종합하여 블록 매핑 결과를 보여준다:

```
## 콘텐츠 매핑 결과

| 블록 | 상태 | 내용 미리보기 |
|------|------|-------------|
| heroImage | 🔲 플레이스홀더 | — |
| introSection | ✅ | 교토 사찰 워킹투어 |
| numberedList | ✅ | 5단계 코스 |
| includeExclude | ✅ | 포함 3 / 불포함 2 |
| notice | ✅ | 주의사항 4개 |
| guideProfile | 🔲 없음 | — |

"이대로 생성할까요?"
1. 생성
2. 수정할 항목 선택
```

확인 후 → **Step 3 (콘텐츠 매핑)**으로 합류. 이후 Step 5 (HTML 생성) → Step 6 (Lighthouse) → Step 7 (프리뷰)은 크롤링 모드와 동일.

### 신규 모드 메타데이터

신규 모드로 생성된 PDP의 meta.json은 URL 대신 source를 기록한다:

```json
{
  "productId": null,
  "productName": "교토 사찰 워킹투어",
  "source": "manual",
  "category": "TOUR",
  "template": "tour.html",
  "generatedAt": "2026-03-23T15:00:00+09:00"
}
```

---

## B. 크롤링 모드 (기존 MRT 상품 URL)

URL 형식 검증:
- `experiences.myrealtrip.com/products/{id}` 형태인지 확인
- 아니면: "MRT 상품 URL을 입력해주세요 (예: https://experiences.myrealtrip.com/products/3442205)"

### Step 1: 크롤링 & 데이터 추출

Chrome DevTools MCP로 상품 페이지를 열고 데이터를 추출한다.

**1-1. 페이지 로드**

```
mcp__chrome-devtools__new_page(url=<URL>)
```

페이지 로드 실패 시:
- 404 → "상품을 찾을 수 없습니다. URL을 확인해주세요."
- 타임아웃 → 1회 재시도 후 실패 시 안내

**1-2. __NEXT_DATA__ 추출**

아래 스크립트로 상품 메타데이터 + 콘텐츠를 한번에 추출한다:

```javascript
() => {
  const el = document.querySelector('#__NEXT_DATA__');
  if (!el) return { error: 'no_next_data' };
  const data = JSON.parse(el.textContent);
  const queries = data?.props?.pageProps?.dehydratedState?.queries;
  if (!queries) return { error: 'no_queries' };

  const header = queries.find(q => q.queryKey?.[1] === 'header');
  const item = queries.find(q => q.queryKey?.[1] === 'item');
  const headerData = header?.state?.data?.data;
  const itemData = item?.state?.data?.data;

  return {
    logMeta: headerData?.logMeta,
    title: headerData?.title,
    region: headerData?.region,
    images: headerData?.images,
    reviewScore: headerData?.reviewScore,
    reviewCount: headerData?.reviewCountDescription,
    displayTags: headerData?.displayTags,
    sectionTabs: headerData?.sectionTabs,
    partitions: itemData?.partitions
  };
}
```

**1-3. 상세 콘텐츠 추출**

페이지 DOM에서 추가 텍스트 콘텐츠를 추출한다:

```javascript
() => {
  const sections = {};
  // 상품 설명
  const desc = document.querySelector('[class*="description"], [class*="content"]');
  if (desc) sections.description = desc.innerText;
  // 포함/불포함
  const includes = document.querySelectorAll('[class*="include"]');
  sections.includes = Array.from(includes).map(el => el.innerText);
  // 코스/일정
  const course = document.querySelectorAll('[class*="course"], [class*="schedule"], [class*="itinerary"]');
  sections.course = Array.from(course).map(el => el.innerText);
  // 주의사항
  const notice = document.querySelectorAll('[class*="notice"], [class*="caution"], [class*="warning"]');
  sections.notice = Array.from(notice).map(el => el.innerText);
  // FAQ
  const faq = document.querySelectorAll('[class*="faq"], [class*="question"]');
  sections.faq = Array.from(faq).map(el => el.innerText);
  // 리뷰
  const reviews = document.querySelectorAll('[class*="review"]');
  sections.reviews = Array.from(reviews).slice(0, 5).map(el => el.innerText);

  return sections;
}
```

`__NEXT_DATA__`가 없는 경우 (구형 상품):
- DOM 텍스트만으로 콘텐츠 수집
- 카테고리는 Step 2에서 키워드 추론

### Step 2: 카테고리 판별

**2-1. --exclusive 플래그 체크**

`--exclusive` 있으면 → `pb-exclusive.html` 즉시 확정. Step 2-2 건너뜀.

**2-2. --category 플래그 체크**

수동 지정 있으면 → 해당 템플릿 즉시 확정. Step 2-3 건너뜀.

**2-3. logMeta 룩업 테이블**

`logMeta.firstStandardCategoryCode` + `secondStandardCategoryCode`로 판별:

| 1차 분류 | 2차 분류 | 템플릿 |
|----------|---------|--------|
| TOUR | PACKAGE_TOUR | semi-package.html |
| TOUR | GUIDE_TOUR 등 | tour.html |
| ACTIVITY | * | activity.html |
| CLASS | * | activity.html |
| TICKET | * | ticket.html |
| CONVENIENCE | * | convenience.html |

**2-4. 폴백 (logMeta 없음)**

페이지 텍스트에서 키워드 기반 추론:
- "패키지", "호텔", "N박" → semi-package
- "투어", "가이드", "코스" → tour
- "체험", "클래스", "스냅" → activity
- "입장권", "패스", "티켓" → ticket
- "유심", "와이파이", "수하물" → convenience

추론 결과를 사용자에게 확인:
> "TOUR (가이드 투어)로 판별했습니다. tour.html 템플릿을 사용할게요. 맞나요?"

### Step 3: 콘텐츠 매핑

**3-1. 템플릿 읽기**

확정된 카테고리의 템플릿을 읽는다:

```
Read: docs/pdp-tf/templates/{category}.html
```

**3-2. 데이터 매핑**

크롤링 데이터를 템플릿의 `{{placeholder}}`에 매핑한다. 매핑 규칙:

| 플레이스홀더 | 데이터 소스 |
|-------------|-----------|
| `{{product_title}}` | headerData.title |
| `{{meta_description}}` | 상품 설명 첫 문장 (150자 이내) |
| `{{intro_title}}` | 상품명에서 핵심 카피 추출 |
| `{{intro_body}}` | 상품 설명 요약 (2~3줄) |
| `{{hero_image_file}}` | images[0] URL 또는 플레이스홀더 |
| `{{schedule_items}}` | 코스/일정 데이터 → 각 step |
| `{{included_items}}` | 포함 사항 목록 |
| `{{excluded_items}}` | 불포함 사항 목록 |
| `{{notice_items}}` | 주의사항 목록 |
| `{{faq_items}}` | FAQ Q&A 쌍 |
| `{{review_*}}` | 리뷰 데이터 |

**3-3. 부족 블록 표시**

데이터가 부족한 블록을 정리하여 사용자에게 보여준다:

```
## 콘텐츠 매핑 결과

| 블록 | 상태 | 내용 |
|------|------|------|
| heroImage | ✅ | 메인 이미지 1장 |
| introSection | ✅ | 제목 + 설명 |
| numberedList | ✅ | 8단계 코스 |
| guideIntro | 🔲 부족 | 가이드 정보 없음 |
| imageGrid | 🔲 부족 | 이미지 2장 부족 |

부족한 블록을 자동 생성할까요, 아니면 비워둘까요?
```

사용자 선택:
- "자동 생성" → 크롤링 데이터 기반으로 최대한 채움
- "비워두기" → 플레이스홀더로 유지
- 직접 내용 입력도 가능

### Step 4: 이미지 매핑

**4-1. 이미지 수집**

```javascript
() => {
  const images = [];
  // 상품 메인 이미지
  document.querySelectorAll('img[src*="cloudfront"], img[src*="myrealtrip"]').forEach(img => {
    if (img.naturalWidth > 200) {
      images.push({ src: img.src, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt });
    }
  });
  return images;
}
```

**4-2. --images 옵션 처리**

폴더가 지정되면 해당 폴더의 이미지 파일 목록을 읽어 추가 매핑 대상으로 포함.

```bash
ls {images_folder}/*.{jpg,jpeg,png,webp}
```

**4-3. 배치 제안**

수집된 이미지를 블록별로 배치 제안한다:

```
## 이미지 배치 제안

| 블록 | 이미지 | 상태 |
|------|--------|------|
| heroImage | [1] 메인 배너 (390x458) | ✅ 매핑 |
| step 1 | [2] 코스 사진 | ✅ 매핑 |
| step 2 | — | 🔲 부족 |
| imageGrid | [5~8] 후기 사진 | ✅ 매핑 |

부족한 3장은 플레이스홀더로 유지합니다. 이미지 업로드하시겠어요?
```

이미지 URL이 있는 경우 `background-image: url(...)` 스타일로 직접 삽입.
없는 경우 gradient 플레이스홀더 유지.

### Step 5: HTML 생성

**5-1. 파일명 결정**

```
상품명에서 영문/한글 슬러그 생성:
- "오사카 주유패스 2일권" → "osaka-pass-2day"
- 특수문자 제거, 공백은 하이픈
```

**5-2. CSS 처리 (비용 최적화)**

pb-exclusive 템플릿 사용 시, 인라인 `<style>` 블록 대신 외부 CSS 파일을 참조한다.
공유 CSS 파일이 이미 존재: `docs/pdp-tf/output/pb-exclusive.css`

```html
<link rel="stylesheet" href="pb-exclusive.css">
```

이렇게 하면 HTML 출력에서 ~400줄의 인라인 CSS가 제거되어 생성 토큰이 ~45% 절감된다.
다른 카테고리 템플릿은 기존대로 인라인 CSS를 유지한다 (추후 분리 예정).

**5-3. HTML 조립**

템플릿의 `{{placeholder}}`를 매핑된 데이터로 치환한다.

치환 규칙:
- `{{variable}}` → 단일 값 치환
- `<!-- {{#each collection}} -->...<!-- {{/each}} -->` → 반복 블록 확장
- `<!-- {{#if condition}} -->...<!-- {{/if}} -->` → 조건부 포함/제거
- 이미지 URL이 있는 블록: `style="background-image:url(...);"` 삽입
- 이미지 없는 블록: gradient 플레이스홀더 유지

**5-4. 파일 저장**

```
Write: docs/pdp-tf/output/{slug}.html
```

**5-5. 메타데이터 저장**

```json
{
  "productId": 3442205,
  "productName": "퍼핑빌리 투어",
  "url": "https://experiences.myrealtrip.com/products/3442205",
  "category": "TOUR",
  "template": "tour.html",
  "generatedAt": "2026-03-12T18:00:00+09:00",
  "blocks": {
    "total": 11,
    "filled": 8,
    "missing": ["guideIntro", "imageGrid", "customerReview"]
  },
  "images": {
    "total": 24,
    "mapped": 6,
    "placeholder": 18
  }
}
```

```
Write: docs/pdp-tf/output/{slug}.meta.json
```

### Step 6: Lighthouse 자동 검증 & 수정

HTML 생성 직후, Lighthouse로 품질을 자동 검증하고 미달 항목을 즉시 수정한다.

**6-1. Lighthouse 실행**

```bash
npx lighthouse "file:///Users/kiwon-seo/Documents/PBrain/docs/pdp-tf/output/{slug}.html" \
  --output=json --output-path=/tmp/lh-{slug}.json \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=accessibility,best-practices,seo --quiet
```

**6-2. 점수 확인 & 자동 수정**

```
모든 카테고리 90점 이상? ─── Yes → Step 7로
                        └── No  → 실패 audit 추출 → 패턴 매칭 수정
```

**자동 수정 패턴** (루프 없이 한 번에 처리):

| 실패 audit | 수정 방법 |
|-----------|----------|
| `color-contrast` | 대비 부족 색상을 WCAG AA 기준으로 조정 (예: `--c-gray-500` → `--c-gray-600`) |
| `image-alt` | `alt=""` → 맥락에 맞는 설명 텍스트 추가 |
| `heading-order` | heading 레벨 순서 정리 (h1→h2→h3) |
| `meta-description` | `<meta name="description">` 추가 (상품 설명 첫 문장) |
| `document-title` | `<title>` 태그 추가/보완 |
| `link-name` | 링크에 `aria-label` 또는 텍스트 추가 |
| `favicon` | `<link rel="icon" href="data:,">` 추가 |

**6-3. 재검증**

수정 후 Lighthouse를 한 번 더 실행하여 점수 확인.
여전히 미달이면 경고와 함께 사용자에게 안내 (autoresearch 루프 제안):

> ⚠️ Accessibility `82`점 — 자동 수정 범위를 초과합니다.
> `/autoresearch pdp-lighthouse target=docs/pdp-tf/output/{slug}.html`로 심층 최적화할 수 있어요.

### Step 7: 프리뷰

Chrome DevTools로 생성된 HTML을 연다:

```
mcp__chrome-devtools__new_page(url=file:///Users/kiwon-seo/Documents/PBrain/docs/pdp-tf/output/{slug}.html)
```

사용자에게 결과 안내:

```
## PDP 생성 완료

- **파일**: docs/pdp-tf/output/{slug}.html
- **카테고리**: TOUR (가이드 투어)
- **블록**: 11개 중 8개 채움
- **이미지**: 24개 중 6개 매핑
- **Lighthouse**: ♿ 100 · ⚡ 100 · 🔍 100

브라우저에서 프리뷰를 열었습니다. 수정할 부분이 있으면 알려주세요!
```

## 안티패턴 (하지 말 것)

- **억지 이미지 매핑 금지**: 이미지-텍스트 연결이 불확실하면 플레이스홀더로 둔다
- **카테고리 추측 금지**: logMeta가 없고 키워드도 애매하면 반드시 사용자에게 확인
- **골든 샘플 수정 금지**: `pilot-*.html` 파일은 절대 수정하지 않는다
- **템플릿 직접 수정 금지**: `templates/*.html` 원본을 건드리지 않는다. 항상 복사 후 치환
- **데이터 날조 금지**: 크롤링에서 얻지 못한 데이터를 임의로 생성하지 않는다. 부족하면 표시

## 참조 파일

| 파일 | 용도 |
|------|------|
| `docs/pdp-tf/pdp-assembly.json` | 카테고리별 블록 조합 규칙 |
| `docs/pdp-tf/pdp-blocks.json` | 21개 블록 스키마 (props, style, layout) |
| `docs/pdp-tf/pdp-tokens.json` | 디자인 토큰 |
| `docs/pdp-tf/templates/*.html` | 6개 카테고리 HTML 템플릿 |
| `docs/pdp-tf/specs/make-pdp-spec.md` | 설계 스펙 문서 |
