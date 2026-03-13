---
name: daily-cm-report
description: 중화권 CM 데일리 리포트 생성. Redash에서 전날 vs 그제 CM DoD를 자동 분석해 도시별 낙폭, 상품별 낙폭 TOP 20, 유형 분류(판매소멸/GMV급감/CM역전), 퍼널 이탈 구간까지 찾아준다. "데일리 리포트", "CM 리포트", "오늘 CM", "어제 CM 빠진거", "CM DoD", "CM 얼마나 빠졌어", "중화권 어제 CM", "오늘 실적" 등을 언급할 때 반드시 이 스킬을 사용할 것.
---

# 중화권 CM 데일리 리포트

## 개요

Redash API를 통해 중화권 전체 도시의 CM DoD(전일 대비)를 자동 분석하고, 슬랙 보고용 요약을 생성한다.

---

## Step 1: 날짜 설정

사용자가 날짜를 지정하지 않으면 **어제 vs 그제** 비교가 기본이다. 날짜를 따로 묻지 말고 바로 어제/그제로 실행.

```python
from datetime import date, timedelta
today = date.today()
target_date = (today - timedelta(days=1)).strftime('%Y-%m-%d')   # 어제 (분석 대상)
prev_date   = (today - timedelta(days=2)).strftime('%Y-%m-%d')   # 그제 (비교 기준)
```

사용자가 "3/11~3/12", "어제", "오늘" 등 날짜를 명시하면 그에 맞게 조정.
- "3/11~3/12" → prev_date=2026-03-11, target_date=2026-03-12
- "오늘" → prev_date=어제, target_date=오늘

---

## Step 2: Redash 쿼리 19787 실행

**Redash API 인증**: `Authorization: Key j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH`

### 2-1. 쿼리 실행 요청

```bash
curl -s -X POST "https://redash.myrealtrip.net/api/queries/19787/results" \
  -H "Authorization: Key j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "start_date": "<prev_date>",
      "end_date": "<target_date>",
      "region/country/city": "'\''Hong Kong'\'','\''Macau'\'','\''Singapore'\'','\''Taipei'\'','\''Shanghai'\'','\''Beijing'\'','\''Xian'\'','\''Qingdao'\'','\''Taichung'\'','\''Gāoxióng'\'','\''Dalian'\'','\''Xiamen'\'','\''Shenzhen'\'','\''Zhangjiajie'\'','\''Lijiang'\'','\''Harbin'\'','\''Chongqing'\''",
      "category_nm": "'\''ALL'\''",
      "trunc_by": "DAY",
      "offer_id": "'\''ALL'\''"
    },
    "max_age": 0
  }'
```

응답에서 `job.id`를 꺼낸다.

### 2-2. Job 폴링

```bash
# STATUS 3이 될 때까지 15~30초 간격으로 반복
curl -s "https://redash.myrealtrip.net/api/jobs/<JOB_ID>" \
  -H "Authorization: Key j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH"
```

`status: 3`이면 `query_result_id`로 결과 조회.

### 2-3. 결과 조회

```bash
curl -s "https://redash.myrealtrip.net/api/query_results/<RESULT_ID>" \
  -H "Authorization: Key j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH"
```

---

## Step 3: CM DoD 계산

핵심 공식:
```
절대 CM = confirm_gmv × CM(%) / 100
CM 낙폭 = target_date 절대 CM - prev_date 절대 CM
```

같은 `PRODUCT_ID`가 두 날짜에 모두 있는 상품만 비교. 한쪽만 있으면 신규/소멸로 별도 표시.

### 도시별 집계

도시별로 절대 CM 합산 후 낙폭 순 정렬 → **낙폭 TOP 5 도시** 추출.

### 상품별 집계

낙폭 기준 정렬 후 **TOP 15** 추출 + 유형 분류:

| 유형 | 조건 | 의미 |
|------|------|------|
| **TYPE A**: 판매 소멸 | target_date 주문 0건 & CM 0원 | 요일 공백 or 재고 없음 |
| **TYPE B**: GMV 급감 | GMV 감소 → CM 감소 | 수요 감소, 유입/전환 이슈 |
| **TYPE C**: CM% 역전 | GMV 올랐는데 CM 음전환 or CM% 역방향 하락 | 원가/TR 구조 문제 ⚠️ |

---

## Step 4: 퍼널 이탈 분석 (TOP 3 자동)

CM 낙폭 절대값 기준 상위 3개 상품 중 **TYPE B, C**에 해당하는 상품을 대상으로 퍼널 분석.
(TYPE A는 판매 0건이므로 퍼널 분석 의미 없음 — 스킵)

### 쿼리 31779 실행

```bash
curl -s -X POST "https://redash.myrealtrip.net/api/queries/31779/results" \
  -H "Authorization: Key j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH" \
  -H "Content-Type: application/json" \
  -d '{
    "parameters": {
      "direction": "forward",
      "platform": ["aos", "ios"],
      "페이지뷰 개수": 20,
      "start_date": "<prev_date>",
      "end_date": "<target_date>",
      "offer_id": "'\''<PRODUCT_ID>'\''"
    },
    "max_age": 0
  }'
```

### 퍼널 이탈 판독

`e1 = offer_detail`인 행 기준으로 다음 화면(e2) 집계:

- **offer_detail → option_detail 비율**: 상세→옵션 전환율
- **option_detail 도달 후 checkout 비율**: 옵션 이탈 여부
- **checkout → checkout_complete**: 최종 결제 이탈

주요 이탈 신호:
- `union_search`, `main`으로 이탈 많음 → 가격/경쟁 이탈
- option_detail 도달 후 막힘 → 날짜 재고 없음 가능성
- checkout에서 이탈 → 가격 저항 or UX 이슈

---

## Step 5: 슬랙 보고용 출력

아래 형식으로 최종 출력. 슬랙 mrkdwn 문법 사용.

```
📊 *중화권 CM DoD | {prev_date} → {target_date}*
전체 CM {target_date}: *{전체CM:,.0f}원* ({DoD%} vs 전일)

───────────────────────
*📍 도시별 낙폭*
🔴 Shanghai  -xxx,xxx원 (▼xx%)
🔴 Taipei    -xxx,xxx원 (▼xx%)
🔴 Macau     -xxx,xxx원 (▼xx%)
(상위 5개 도시만, 이하 생략)

───────────────────────
*📦 상품별 낙폭 TOP 15*

*[TYPE A] 판매 소멸* — 요일 공백 가능, 모니터링 수준
• [도시] 상품명 | -xxx,xxx원

*[TYPE B] GMV 급감* — 수요/유입 이슈
• [도시] 상품명 | GMV xxx→xxx원 | 낙폭 -xxx,xxx원

*[TYPE C] ⚠️ CM% 역전* — 원가/TR 구조 문제, 긴급 확인
• [도시] 상품명 | GMV↑ but CM% xx%→xx% | 낙폭 -xxx,xxx원

───────────────────────
*🔍 퍼널 이탈 분석* (TYPE B·C 상위 상품)

*[상품명]* (PID: xxxxxxx)
• Detail UV: xxx → xxx ({diff})
• Detail→Option: xx% | Option→Checkout: xx% | Checkout→완료: xx%
• 주요 이탈: {이탈 화면} → {판단: 재고없음 / 가격이탈 / 전환저조}

───────────────────────
*✅ Next Action*
• *P0 (즉시)* — TYPE C 상품 원가·TR 구조 확인: [상품명]
• *P1 (오늘중)* — TYPE B 상품 유입 경로 및 재고 오픈 여부 확인
• *P2 (이번주)* — TYPE A 패턴 반복 시 파트너 일정 재고 관리 협의
```

**슬랙 출력 원칙:**
- 숫자는 천 단위 쉼표 필수
- TYPE C가 있으면 맨 위에 강조 (`⚠️`)
- Next Action은 반드시 담당자 없어도 P0/P1/P2 구분해서 작성
- 길이가 너무 길면 TYPE A는 요약 (건수만 표기)해도 됨

---

## 주의사항

- Redash 쿼리 실행은 시간이 걸린다 (15~90초). 폴링 간격은 15초로 시작, 응답 없으면 30초로 늘린다.
- `CM` 컬럼은 CM% (공헌이익률). 절대값은 반드시 `confirm_gmv × CM / 100`으로 계산.
- TYPE C (CM% 역전) 상품은 단순 수요 문제가 아닌 **원가/TR 구조 이슈**일 수 있으므로 별도 강조.
- 퍼널 분석은 `forward` 방향만 사용. `backward`는 유입 경로 분석용으로 다른 목적.
- 도시명 `Gāoxióng`은 특수문자 포함 — URL 인코딩 주의.
