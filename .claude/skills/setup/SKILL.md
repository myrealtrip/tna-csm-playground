---
name: setup
description: PDP Maker 에이전트가 정상 작동하기 위한 도구 설치 및 환경 설정을 자동 수행한다. Use when user asks to set up, initialize, or configure the agent environment.
---

# Setup

> **모든 설치/설정은 Claude가 즉시 자동 실행한다.** 사용자에게 "설치할까요?", "진행할까요?" 같은 확인을 절대 묻지 않는다.
> 미설치/미인증 항목을 발견하면 발견 즉시 설치를 시작한다.

---

## 체크리스트

| # | 항목 | 점검 명령 | macOS | Windows (PowerShell) |
|---|------|----------|-------|---------------------|
| 0 | OS 감지 | `uname -s` / `$env:OS` | `Darwin` | `Windows_NT` |
| 1 | Node.js (18+) | `node --version` | `brew install node` | `winget.exe install OpenJS.NodeJS.LTS` |
| 2 | npm | `npm --version` | Node와 함께 설치 | Node와 함께 설치 |
| 3 | Google Chrome | 실행 확인 | 수동 설치 안내 | 수동 설치 안내 |
| 4 | Chrome DevTools MCP | `.mcp.json` 확인 | npx 자동 실행 | npx 자동 실행 |
| 5 | GitHub CLI | `which gh` / `Get-Command gh` | `brew install gh` | `winget.exe install GitHub.cli` |
| 6 | GitHub 인증 | `gh auth status` | `gh auth login` | `gh auth login` |

이미 설치/인증된 항목은 건너뛴다.

---

## 상세 절차

### Step 0: OS 감지

```bash
uname -s
```

### Step 1-2: Node.js + npm

```bash
# macOS
node --version 2>&1 || brew install node
npm --version 2>&1

# Windows (PowerShell)
node --version 2>&1
if (-not $?) { winget.exe install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements }
```

### Step 3: Google Chrome

Chrome이 설치되어 있는지 확인:

```bash
# macOS
ls "/Applications/Google Chrome.app" 2>&1 || echo "NOT_INSTALLED"

# Windows
Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

미설치 시:
> Chrome 브라우저가 필요해요. https://www.google.com/chrome/ 에서 설치해주세요!

### Step 4: Chrome DevTools MCP

`.mcp.json` 파일이 프로젝트 루트에 이미 포함되어 있다. Chrome을 열어둔 상태에서 Claude Code를 시작하면 자동으로 연결된다.

테스트:
```
mcp__chrome-devtools__list_pages 호출하여 연결 확인
```

연결 실패 시:
> Chrome 브라우저를 열고, Claude Code를 재시작해주세요!

### Step 5-6: GitHub CLI + 인증

```bash
which gh 2>&1 || brew install gh
gh auth status 2>&1 || gh auth login --web
```

---

## 최종 검증

모든 항목 점검 후 결과를 표로 출력:

| 항목 | 상태 | 상세 |
|------|------|------|
| Node.js | 정상 / 미설치 | 버전 |
| npm | 정상 / 미설치 | 버전 |
| Chrome | 정상 / 미설치 | 경로 |
| Chrome DevTools MCP | 연결됨 / 연결 필요 | 페이지 수 |
| GitHub CLI | 정상 / 미설치 | 버전 |
| GitHub 인증 | 정상 / 필요 | 계정 |
| 오늘 날짜 | 확인 | YYYY-MM-DD |

---

## 출력 형식

> 모든 세팅이 완료되었어요! `/make-pdp <URL>`로 PDP를 생성해보세요.
