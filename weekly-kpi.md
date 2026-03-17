---
name: weekly-kpi
description: >
  중화권 주간 KPI(GMV, CM, CM%, 확정률, UV, CVR) 테이블을 Redash에서 자동으로 가져와
  Confluence 주간 회의록 '목표 달성 현황' 테이블에 업데이트한다.
  외부유입(utm_source별, 쿼리 19774)·내부유입(유입경로별, 쿼리 22963) 분석과
  상품별 퍼널 이탈률 분석도 함께 제공한다.
  "주간 KPI 업데이트", "위클리 KPI 채워줘", "KPI 테이블 자동 업데이트", "weekly KPI update",
  "이번주 KPI", "KPI 넣어줘", "지표 채워줘", "KPI 뽑아줘" 등의 요청 시 반드시 이 스킬을 사용할 것.
  날짜 기준은 항상 월~일요일 완성 주 기준이며, 오늘 날짜에서 자동 계산한다.
---

# 중화권 주간 KPI 자동 업데이트

오늘 날짜 기준 가장 최근 2개 완성 주(저번주/이번주)의 중화권 KPI를 Redash에서 쿼리하고,
Confluence 주간 회의록 '목표 달성 현황' 테이블을 업데이트한다.

---

## 1단계: 날짜 범위 계산

항상 월(Mon)~일(Sun) 기준 완성 주를 사용한다.

```python
from datetime import date, timedelta

today = date.today()
dow = today.weekday()  # 0=월요일

# 직전 완성 주의 일요일
if dow == 0:
    tw_end = today - timedelta(days=1)   # 어제가 일요일
else:
    tw_end = today - timedelta(days=dow + 1)

tw_start = tw_end - timedelta(days=6)   # 이번주 월요일
lw_end   = tw_start - timedelta(days=1) # 저번주 일요일
lw_start = lw_end - timedelta(days=6)   # 저번주 월요일
```

예: 오늘 2026-03-17(월) → 이번주 2026-03-09~2026-03-15, 저번주 2026-03-02~2026-03-08

---

## 2단계: GMV / CM / 확정률 조회 (Redash 쿼리 19751)

저번주/이번주를 **동시에** 2개 job 실행해 대기 시간을 줄인다.

```
REDASH_KEY = j3cVHlqTLd6zHzzyTCWB830FqL4n4H9g86vKlEmH
CITIES = 'Hong Kong','Macau','Singapore','Taipei','Shanghai','Beijing','Zhangjiajie','Xian','Qingdao','Dalian','Xiamen','Lijiang','Harbin','Chongqing','Shenzhen','Taichung','Gāoxióng','Yanji'
```

**요청 파라미터:**
```json
{
  "parameters": {
    "category_nm": "'ALL'",
    "region/country/city": "<CITIES>",
    "offer_id": "'ALL'",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  },
  "max_age": 0
}
```

**폴링 패턴:**
```
POST /api/queries/19751/results → { job: { id: JOB_ID } }
GET  /api/jobs/JOB_ID          → { job: { status: 3, query_result_id: RESULT_ID } }
  (status: 2=진행중, 3=완료. 15초 간격으로 최대 5분 대기)
GET  /api/query_results/RESULT_ID → rows[0]
```

**사용 컬럼:**
| 컬럼 | 의미 |
|------|------|
| `gmv` | 총 거래액 |
| `margin` | CM 금액 (공헌이익) |
| `CM` | CM% (공헌이익률) |
| `conf_resve_rate` | 확정률 |

---

## 3단계: UV / CVR 조회 (Redash 쿼리 32100)

저번주 시작~이번주 끝을 **1회** 실행하고, basis_dt 주별로 집계한다.

```json
{
  "parameters": {
    "category_nm": "'ALL'",
    "region/country/city": "<CITIES>",
    "offer_id": "'ALL'",
    "start_date": "LW_START",
    "end_date": "TW_END",
    "trunc_by": "WEEK(MONDAY)"
  },
  "max_age": 0
}
```

**집계:**
```python
from collections import defaultdict
by_week = defaultdict(lambda: {'uv': 0, 'cvr_num': 0})

for row in rows:
    dt = row['basis_dt'][:10]
    by_week[dt]['uv']      += row.get('OFFER_DETAIL_UV', 0) or 0
    by_week[dt]['cvr_num'] += row.get('CHECKOUT_COMPLETE_UV', 0) or 0

# CVR = cvr_num / uv * 100
```

> 쿼리 32100은 완료까지 1~3분 소요. 2단계 job들과 동시에 제출해 병렬 대기.

---

## 4단계: WoW 계산

```python
def wow_pct(tw, lw):
    if not lw: return '-'
    return "%+.1f%%" % ((tw - lw) / lw * 100)

def wow_pp(tw, lw):
    return "%+.2f%%p" % (tw - lw)
```

---

## 5단계: Confluence 페이지 업데이트

### 5-1. 페이지 찾기

**페이지 계층:**
```
[중화권] 주간 회의록 (5418911454)
  └─ 2026. 1Q (5422940297)
       └─ [중화권] 주간 회의록  2026-03-17  ← 이번 주 페이지
       └─ [중화권] 주간 회의록  2026-03-10  ← 저번 주
       ...
```

1Q 2026 폴더(ID: `5422940297`)의 최신 자식 페이지 = 이번 주 주간 회의록.

```bash
TOKEN=$(cat ~/.mcp.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); \
   print(d['mcpServers']['atlassian']['env']['CONFLUENCE_API_TOKEN'])")
AUTH=$(echo -n "jiyea.yun@myrealtrip.com:$TOKEN" | base64)

# 최신 자식 페이지 조회
curl -s -H "Authorization: Basic $AUTH" -H "Accept: application/json" \
  "https://myrealtrip.atlassian.net/wiki/api/v2/pages/5422940297/children?sort=-created-date&limit=1"
# → results[0].id = 최신 주간 회의록 페이지 ID
# → results[0].title = "[중화권] 주간 회의록  2026-03-17" 형식
```

반환된 `id`로 본문(storage format) 조회:
```bash
curl -s -H "Authorization: Basic $AUTH" -H "Accept: application/json" \
  "https://myrealtrip.atlassian.net/wiki/api/v2/pages/{PAGE_ID}?body-format=storage"
```

현재 `version.number`를 기억해둔다 (업데이트 시 +1 필요).

### 5-2. 테이블 셀 업데이트 (regex)

페이지 본문에서 행 레이블(GMV, CM, CM%, 확정률, UV, CVR)을 기준으로 다음 3개 셀(저번주/이번주/WoW)을 교체한다. local-id는 페이지마다 달라지므로 사용하지 않는다.

```python
import re

def update_kpi_row(body, label, lw_val, tw_val, wow_val):
    """레이블 셀 다음 3개 td 셀을 저번주/이번주/WoW 값으로 교체."""
    label_match = re.search(
        r'<p[^>]*>' + re.escape(label) + r'</p></td>', body
    )
    if not label_match:
        print(f"  WARNING: '{label}' 행을 찾지 못했습니다.")
        return body

    pos = label_match.end()
    for new_val in [str(lw_val), str(tw_val), str(wow_val)]:
        # 값 있는 셀
        m = re.search(
            r'(<td[^>]*><p[^>]*>)[^<]*(</p></td>)', body[pos:]
        )
        # 빈 셀 (<p ... />)
        m_empty = re.search(
            r'(<td[^>]*>)(<p[^>]*)\s*/>(</td>)', body[pos:]
        )

        if m and (not m_empty or m.start() < m_empty.start()):
            s = pos + m.start()
            e = pos + m.end()
            body = body[:s] + m.group(1) + new_val + m.group(2) + body[e:]
            pos = s + len(m.group(1)) + len(new_val) + len(m.group(2))
        elif m_empty:
            s = pos + m_empty.start()
            e = pos + m_empty.end()
            replacement = m_empty.group(1) + m_empty.group(2) + '>' + new_val + '</p>' + m_empty.group(3)
            body = body[:s] + replacement + body[e:]
            pos = s + len(replacement)
        else:
            print(f"  WARNING: '{label}' 행의 셀을 찾지 못했습니다.")
            break

    return body


rows_to_update = [
    ('GMV',  '%.2f억' % lw['gmv'],  '%.2f억' % tw['gmv'],  wow_pct(tw['gmv'], lw['gmv'])),
    ('CM',   '%.2f억' % lw['cm'],   '%.2f억' % tw['cm'],   wow_pct(tw['cm'], lw['cm'])),
    ('CM%',  '%.1f%%' % lw['cm_pct'], '%.1f%%' % tw['cm_pct'], wow_pp(tw['cm_pct'], lw['cm_pct'])),
    ('확정률', '%.1f%%' % lw['cr'],  '%.1f%%' % tw['cr'],   wow_pp(tw['cr'], lw['cr'])),
    ('UV',   '%d' % lw['uv'],       '%d' % tw['uv'],        wow_pct(tw['uv'], lw['uv'])),
    ('CVR',  '%.2f%%' % lw['cvr'],  '%.2f%%' % tw['cvr'],  wow_pp(tw['cvr'], lw['cvr'])),
]

for label, lw_val, tw_val, wow_val in rows_to_update:
    body = update_kpi_row(body, label, lw_val, tw_val, wow_val)
```

### 5-3. 페이지 PUT

```bash
curl -s -X PUT "https://myrealtrip.atlassian.net/wiki/api/v2/pages/{PAGE_ID}" \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"{PAGE_ID}\",
    \"status\": \"current\",
    \"title\": \"{TITLE}\",
    \"version\": {\"number\": CURRENT_VERSION_PLUS_1},
    \"body\": {\"representation\": \"storage\", \"value\": ESCAPED_BODY}
  }"
```

---

## 6단계: Google Sheets 도시별 대시보드 읽기

`ReadMcpResourceTool`로 시트 읽기:
- server: `gdrive`
- uri: `gdrive:///1_tHpqEiZTCbBRwE1QwTAD7WoOC3ZklMA4F1h1ecLKrU`

이 시트는 도시별·카테고리별 GMV, 예약수, UV, ASP, WoW 변화를 담고 있다.
읽기 실패 시 이 단계부터 8단계까지 건너뛰고 9단계로 이동.

---

## 7단계: CM 액션 분석

아래 3가지를 분석한다. **목표 수준: 팀장 overall 페이지용 — 방향 + 근거 + 담당자 명시. 상세 나열 금지.**

### ① 핵심 역설 파악

- 2단계에서 구한 CM% WoW와 GMV WoW를 비교한다.
- **CM%가 개선됐는데 GMV는 빠진 경우**: 시트에서 가장 크게 감소한 카테고리를 찾는다. 그 카테고리가 저ASP(<20,000원)거나 알려진 저CM 상품(예: 디즈니, 교통패스, 유심)이면 "저CM 대형상품 감소 → CM% 개선 기여"로 설명.
- **중요**: 디즈니처럼 앵커 역할 하는 상품은 "빠지면 좋다"가 아니라 "디즈니 물량은 올리면서 고CM 상품을 cross-sell로 붙여야 진짜 CM 개선"임을 반드시 언급.
- 역설이 없으면 이 항목 생략 가능.

### ② 저CM 구조 상품군 (ASP 기반)

시트에서 아래 기준으로 저CM 상품군을 식별한다:
- ASP 20,000원 미만 + 이번 주 예약수 10건 이상
- 대표 카테고리: 유심/와이파이, 교통패스, AEL, 피크트램, 빅버스, 옥토퍼스

각 상품에 대해 "이 UV를 고CM 상품으로 cross-sell 유도하는 방향"을 제안.
3~5개만 표에 담는다 (전수 나열 금지).

### ③ UV 있는데 GMV 0인 카테고리 — 즉시 소싱 기회

시트에서 UV ≥ 50인데 GMV = 0인 카테고리를 찾는다.
**마사지, 스파, 미식, 크루즈** 등 고CM 가능성 높은 카테고리 우선 표시.
이는 수요는 있지만 공급이 없는 상태 → 소싱 우선순위.

### 담당자 매핑

| 도시 | 담당 |
|------|------|
| 홍콩, 싱가포르 | 유현경 |
| 상하이 | 장현욱 |
| 마카오, 대만(타이베이·타이중·가오슝) | 조이린 |
| 칭다오, 베이징, 시안 + 중국 신규도시 | 김시은 |

---

## 8단계: CM 액션 포인트 섹션 Confluence 추가

5단계에서 업데이트한 같은 페이지에 CM 액션 포인트 섹션을 추가한다.

### 삽입 위치

`역할 분리 한눈에 보기` h2 태그 **바로 앞**에 삽입한다:
```python
insert_marker = '<h2 local-id="'
# "역할 분리" h2를 찾아 그 앞에 삽입
idx = body.find('역할 분리 한눈에 보기')
# idx 기준으로 앞쪽 <h2 로 역추적해 삽입 위치 결정
```

역할분리 섹션이 없으면 `</ac:layout-cell>` 마지막 태그 앞에 삽입.

### 삽입할 Storage Format 구조

```xml
<h2>🔍 CM 액션 포인트</h2>
<ac:structured-macro ac:name="warning" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>핵심 역설</strong>: [①에서 도출한 1~2줄 설명. 없으면 이 매크로 생략]</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>① 저CM 구조 상품군</h3>
<table><tbody>
  <tr><th><p>카테고리</p></th><th><p>주요 도시</p></th><th><p>ASP</p></th>
      <th><p>특징</p></th><th><p>액션 방향</p></th></tr>
  <!-- 3~5행 -->
</tbody></table>

<h3>② UV 있는데 GMV 0 → 즉시 소싱 필요</h3>
<table><tbody>
  <tr><th><p>도시</p></th><th><p>카테고리</p></th><th><p>UV</p></th>
      <th><p>GMV</p></th><th><p>왜 중요한가</p></th></tr>
  <!-- 해당 항목만 -->
</tbody></table>

<h3>③ Next Action</h3>
<table><tbody>
  <tr><th><p>우선순위</p></th><th><p>액션</p></th>
      <th><p>담당</p></th><th><p>CM 임팩트</p></th></tr>
  <tr><td><p><strong>P0</strong></p></td><td>...</td><td>...</td><td>...</td></tr>
  <tr><td><p><strong>P1</strong></p></td><td>...</td><td>...</td><td>...</td></tr>
  <!-- P2는 필요한 경우만 -->
</tbody></table>
```

**작성 원칙:**
- 팀장 overall 페이지 수준: 방향 + 근거 + 담당자. 상세 나열 금지.
- P0: UV 있는데 GMV 0 → 즉각 소싱 가능한 것
- P1: cross-sell 설계, 하락 중인 고CM 상품 방어
- P2: 구조적 CM 개선 (TR 협상, 디즈니 cross-sell 등)
- 섹션 전체가 5~10줄 테이블 3개로 끝나야 정상. 길면 줄여라.

---

## 9단계: 외부유입 분석 (Redash 쿼리 19774)

utm_source별 유입을 MONTH 기준으로 조회해 주요 채널 WoW 변화를 확인한다.

**요청 파라미터:**
```json
{
  "parameters": {
    "category_nm": "'ALL'",
    "date_by": "MONTH",
    "end_date": "TW_END",
    "group_by": "[\"utm_source\"]",
    "offer_id": "'ALL'",
    "platform": "[\"web\",\"ios_mweb\",\"aos_mweb\",\"aos\",\"ios\"]",
    "region/country/city": "<CITIES>",
    "데이터 기준": "유저별 첫 유입 소스만 확인"
  },
  "max_age": 0
}
```

**폴링 패턴:** 2단계와 동일 (POST → job 폴링 → GET result)

**분석 포인트:**
- utm_source별 UV WoW 변화 → 하락 채널 파악
- 상위 5개 소스 기준 저번주 vs 이번주 비교
- 특정 소스 급락 시 해당 채널 이슈 플래그 (🚩)

---

## 10단계: 내부유입 분석 (Redash 쿼리 22963)

내부 유입경로(랭킹섹션, 통합검색, 홈 등)별 UV를 MONTH 기준으로 조회한다.

**요청 파라미터:**
```json
{
  "parameters": {
    "category_nm": "'ALL'",
    "start_date": "LW_START",
    "end_date": "TW_END",
    "offer_id": "'ALL'",
    "platform": "[\"web\"]",
    "region/country/city": "<CITIES>",
    "trunc_by": "MONTH"
  },
  "max_age": 0
}
```

**분석 포인트:**
- 유입경로별 UV WoW 변화 → 랭킹섹션 / 통합검색 / 홈 등 경로별 이상 신호 확인
- 내부유입 전체 합계 WoW 계산
- 평소 대비 빠진 경로 식별 → 어떤 유입점으로 보강할지 제안

---

## 11단계: 상품별 퍼널 이탈률 분석 (Redash 쿼리 31780)

**퍼널 단계:** Detail UV → Option UV → Checkout UV → Complete UV

**요청 파라미터:**
```json
{
  "parameters": {
    "category_nm": "'ALL'",
    "start_date": "LW_START",
    "end_date": "TW_END",
    "offer_id": "'ALL'",
    "region/country/city": "<CITIES>"
  },
  "max_age": 0
}
```

> `end_date`는 `d_yesterday` 대신 실제 날짜(TW_END)로 치환해 요청한다.

**이탈률 계산:**
```python
detail_to_option     = (1 - option_uv / detail_uv) * 100
option_to_checkout   = (1 - checkout_uv / option_uv) * 100
checkout_to_complete = (1 - complete_uv / checkout_uv) * 100
```

**분석 포인트:**
- Detail UV 상위 20개 상품 기준 단계별 이탈률 비교
- 병목 단계(이탈률 가장 높은 구간) 식별 → UX 개선 or 상품 정보 보완 액션 제안
- 저번주 vs 이번주 이탈률 WoW 비교 — 악화된 상품 플래그 (🚩)

---

## 12단계: 결과 출력

```
✅ Confluence 업데이트 완료 (페이지: TITLE, 버전: N)

| 지표    | 저번주 (MM/DD~MM/DD) | 이번주 (MM/DD~MM/DD) | WoW      |
|--------|--------------------:|--------------------:|:--------:|
| GMV    | X.XX억              | X.XX억              | +X.X%    |
| CM     | X.XX억              | X.XX억              | +X.X%    |
| CM%    | X.X%                | X.X%                | +X.X%p   |
| 확정률  | XX.X%               | XX.X%               | -X.X%p   |
| UV     | XXX,XXX             | XXX,XXX             | -X.X%    |
| CVR    | X.XX%               | X.XX%               | -X.XX%p  |

📝 월 목표 / 월 달성률은 직접 입력해주세요.

🔍 CM 액션 포인트 섹션도 추가했어요. 확인 후 팀장 판단 내용(역설 맥락, 담당자 확인 등)은 직접 수정해주세요.
```

---

## 주의사항

- 쿼리 19751 두 개 + 쿼리 32100을 동시에 제출하면 전체 대기 시간이 줄어든다 (병렬 실행 권장)
- 쿼리 19751: 30~60초 × 2, 쿼리 32100: 1~3분
- Confluence 버전 충돌 방지: 항상 GET으로 현재 버전 확인 후 +1
- 월 목표 / 월 달성률 셀은 사용자가 입력하므로 이 스킬에서 건드리지 않는다
- 분기 변경 시 폴더 ID(`5422940297`) 업데이트 필요 (현재: 1Q 2026)
- `Gāoxióng` 표기 주의 — 도시 목록에 포함 여부는 쿼리 파라미터 확인
- CM 액션 포인트 섹션은 Google Sheets 접근 가능한 경우에만 생성. AI가 도출한 방향이므로 팀장이 반드시 검토 후 확정.
