---
name: redash-connect
description: Use when a user wants to connect Redash to their MCP server through Claude Code conversation. Triggered by phrases like "Redash 연결", "Redash 설정", "connect Redash", "Redash 쓰고 싶어".
---

# Redash MCP 연결

## Overview

대화만으로 누구의 MCP 서버에도 Redash 연동을 추가한다.
코드 생성 → 툴 등록 → 자격증명 설정 → 빌드까지 Claude가 직접 수행한다.

## 실행 흐름

### Step 1 — MCP 서버 디렉토리 탐색

`~/.claude/mcp_server_configs.json`을 읽어 등록된 MCP 서버의 `args` 경로를 추출한다.

```
args 예시: ["/Users/alice/my-mcp/dist/index.js"]
→ 역산: /Users/alice/my-mcp
```

| 상황 | 동작 |
|---|---|
| 후보 1개 | 바로 진행 |
| 후보 여러 개 | "어떤 MCP 서버에 연결할까요?" 번호 선택지 제시 |
| 후보 없음 | "MCP 서버 디렉토리 경로를 직접 알려주세요" |

### Step 2 — 기존 코드 구조 파악

MCP 서버 `src/` 디렉토리를 읽어 다음을 확인한다:
- 메인 파일 (보통 `index.ts` 또는 `server.ts`)
- 언어/프레임워크 (TypeScript / JavaScript / Python 등)
- 툴 등록 방식 (`server.setRequestHandler`, `server.tool()` 등)
- 기존 `.env` 로딩 방식

### Step 3 — Redash 연동 코드 생성

기존 코드 스타일에 맞게 Redash 클라이언트 파일을 생성한다.

포함해야 할 기능:
- `loadRedashConfig()` — `.env`에서 `REDASH_BASE_URL`, `REDASH_API_KEY` 로드
- `listRedashQueries()` — 쿼리 목록 조회 (최근 N일, 키워드 필터)
- `getRedashQuery()` — 쿼리 상세 + 파라미터 스펙 조회
- `runRedashQuery()` — 쿼리 실행 (파라미터 없으면 캐시 GET, 있으면 POST + job 폴링)

폴링 타임아웃: 300초, 간격: 2초.
결과는 기본 50행 제한 (전체 필요 시 `maxRows: Infinity`).

### Step 4 — 메인 파일에 툴 등록

기존 툴 등록 패턴을 따라 3개 툴을 추가한다:

| 툴 이름 | 설명 |
|---|---|
| `list_redash_queries` | 최근 쿼리 목록 조회 |
| `get_redash_query` | 쿼리 상세 + 파라미터 확인 |
| `run_redash_query` | 쿼리 실행 + 결과 반환 |

각 툴 핸들러에서 `loadRedashConfig()`를 호출해 설정이 없으면 명확한 에러 메시지를 반환한다.

### Step 5 — 자격증명 요청

```
Redash URL이 무엇인가요? (예: https://redash.example.com)

Redash API 키를 입력해주세요.
(Redash 우상단 프로필 → Edit Profile → API Key)
```

`.env`에 추가 (없으면 생성):
```
REDASH_BASE_URL=<입력값>
REDASH_API_KEY=<입력값>
```

이미 존재하는 항목은 덮어쓰기 전에 사용자 확인.

### Step 6 — 빌드 및 완료

```bash
cd <mcp-directory> && npm run build
```

Python 서버 등 빌드가 필요 없는 경우 건너뛴다.

완료 후:
```
설정이 완료됐어요!
Claude Code를 재시작하면 Redash 툴 3개를 사용할 수 있어요.

재시작 후 "Redash 쿼리 목록 보여줘"로 동작을 확인해보세요.
```

## 주의사항

- API 키는 민감 정보 — 대화창에 출력하거나 로그에 남기지 않는다
- 기존 코드를 먼저 읽고, 해당 프로젝트의 코딩 스타일에 맞게 코드를 생성한다
- MCP 서버가 등록되어 있지 않으면 먼저 등록부터 안내한다
