---
name: sg-hk-weekly
description: 싱가포르·홍콩 주간 위클리 보고서 작성. 매주 위클리 데이터 요청 시 이 스킬을 사용하여 섹션 1~3 데이터를 수집하고 Confluence 페이지를 업데이트한다.
argument-hint: "[sg|hk] [이번주 날짜범위 예: 3/10~3/16]"
---

싱가포르(`sg`) 또는 홍콩(`hk`) 주간 위클리 보고서를 작성한다.
인자: `$ARGUMENTS` (예: `sg 3/10~3/16` 또는 `hk 3/10~3/16`)

---

## 작업 순서

1. **섹션 1 데이터 수집** — [FP&A] 채널별 손익_Month 시트에서 읽기
2. **섹션 2 데이터 수집** — Redash #19780 실행
3. **섹션 3 데이터 수집** — Redash #19774 실행 + Fun.T 시트에서 주요 채널 변화 읽기
4. **ADF JSON 생성** — 로컬 스크립트 실행
5. **Confluence 업데이트** — `updateConfluencePage` 호출

---

## 데이터 소스

### 섹션 1 — [FP&A] 채널별 손익_Month

- **스프레드시트 ID**: `1-_A0JVjNnaZj2pyOIdt5xwVdKCMLrem9GcrNtWmOzZA`
- **SG 행**: 1758 / **HK 행**: 1688
- **읽을 컬럼**:

| 컬럼 | 데이터 |
|------|--------|
| N열 | UV 누적 (월누적) |
| Q열 | CVR% (월누적) |
| U열 | CM% (월누적) |
| Z열 | 확정률 (월누적) |
| AB열 | GMV 달성률 |
| AD열 | CM 달성률 |

- GMV/CM 저번주·이번주 수치는 해당 주차 컬럼 직접 확인 (주간 단위 분리 컬럼)

### 섹션 2 — 카테고리별 GMV/CM/CVR

- **Redash 쿼리**: `#19780`
- **파라미터**: `start_date` / `end_date` / `region` (SG or HK) / `trunc_by` (week)
- 저번주·이번주 각각 1회씩 총 2회 실행하여 WoW 계산

### 섹션 3 — 채널별 UV/CVR

- **Redash 쿼리**: `#19774`
- **파라미터**: `start_date` / `end_date` / `region`
- 저번주·이번주 각각 1회씩 총 2회 실행

### 주요 채널 변화 — Fun.T 시트

- **SG 스프레드시트 ID**: `1EUahpC1f1Zane-IM29SIn7wZRfGaKDmtYV250yRJBRc`
- **HK 스프레드시트 ID**: `1DHScDN8pEdisC19-hi69NFq_vixvNnRsn5bRizIKbh0`
- **탭**: `E_카테고리_WoW`
- **읽을 컬럼**: `issue_channel` (유입 감소 채널) / `issue_inc_channel` (유입 증가 채널) / `issue_CVR` (CVR 감소 채널)

---

## 표기 기준 (2026-03-17 확정)

### 수치 포맷
- **GMV / CM**: 쉼표 구분 전체 수치, 축약 없음 (예: `77,960,520`)
- **CM% WoW / 확정률 WoW**: `%p + 현재값` 형식 (예: `▲1.3%p (7.3%)`)
- **섹션 2 CVR WoW**: `%p + 현재값` 형식 (예: `▼2.3%p (2.8%)`)
- **섹션 3 CVR WoW**: `%p + 현재값` 형식 (예: `▼2.6%p (1.98%)`)
- **GMV WoW / CM WoW / UV WoW**: `%` 형식 (예: `▲104%`, `▼5%`)

### 색상 규칙 (ADF textColor)
- **▲ (상승)**: 빨강 `#FF0000`
- **▼ (하락)**: 파랑 `#0000FF`
- CM WoW는 bold + color 적용 (`wowBold` 함수 사용)

### 이상 신호 플래그
- 섹션 2: UV WoW ▲인데 CVR WoW ▼이면 `🚩` 표시
- 섹션 3: UV WoW ▲인데 CVR WoW ▼이면 이상 신호 컬럼에 `🚩`

### CM 달성률 조건
- **< 90%**: `⚠️ CM 달성률 XX% → 90% 미만이므로 섹션 6 (CM 달성 플랜) 필수 작성` 문구 삽입
- **≥ 90%**: `✅ CM 달성률 XX% → 섹션 6 작성 불필요` 문구 삽입

---

## ADF 생성 스크립트

로컬 스크립트 경로: `c:\Users\User\Documents\my-project\`

```bash
# 싱가포르
node gen_adf.js > sg_adf.json

# 홍콩
node gen_adf_hk.js > hk_adf.json
```

스크립트에서 수집한 데이터로 섹션 1~3 수치를 직접 수정한 후 실행한다.

---

## Confluence 업데이트

| 도시 | 페이지 ID | 제목 |
|------|-----------|------|
| 싱가포르 | `5690818998` | [싱가포르] 주간 위클리 |
| 홍콩 | `5692118885` | [홍콩] 주간 위클리 |

- `updateConfluencePage` 호출 시 `version.number`는 현재 버전 +1
- `representationformat`: `atlas_doc_format`
- `bodyvalue`: 생성한 ADF JSON의 `content` 배열

---

## 참고

- **작성 기준 위키**: https://myrealtrip.atlassian.net/wiki/spaces/TA/pages/5693767717
- **섹션 4~8**: 도담자(담당자)가 직접 작성하는 섹션 — Claude는 채우지 않음
- **MRT_APP 채널**: 섹션 3에서 UV/CVR 데이터가 없는 경우 `—` 처리
