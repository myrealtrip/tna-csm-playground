---
name: setup
description: "PDP 생성 도구가 정상 작동하기 위한 환경 점검 및 자동 설치. Use when user asks to set up, initialize, or configure the environment."
---

# Setup

> **모든 설치/설정은 Claude가 즉시 자동 실행한다.** 사용자에게 "설치할까요?" 같은 확인을 절대 묻지 않는다.

---

## 체크리스트

| # | 항목 | 점검 명령 | macOS 설치 | Windows (PowerShell) |
|---|------|----------|-----------|---------------------|
| 0 | OS 감지 | `uname -s` / `$env:OS` | `Darwin` | `Windows_NT` |
| 1 | Chrome 브라우저 | macOS: `ls /Applications/Google\ Chrome.app` / Windows: `Get-Command chrome` | 설치 안내만 | 설치 안내만 |
| 2 | Chrome DevTools MCP | `.claude/settings.json` 확인 | npx 기반, 별도 설치 불필요 | 동일 |

이미 설치/설정된 항목은 건너뛴다.

---

## 상세 절차

### Step 0: OS 감지

```bash
uname -s
```

### Step 1: Chrome 브라우저

Chrome DevTools MCP는 로컬 Chrome을 제어하므로 Chrome이 반드시 설치되어 있어야 한다.

```bash
# macOS
ls "/Applications/Google Chrome.app" 2>&1 || echo "NOT_FOUND"
```

```powershell
# Windows
Get-Command "chrome" -ErrorAction SilentlyContinue
if (-not $?) { Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue }
```

미설치 시:
> Chrome 브라우저가 필요해요. https://www.google.com/chrome/ 에서 설치해주세요!

### Step 2: Chrome DevTools MCP

`.claude/settings.json`에 hook 설정이 있는지 확인한다.
Chrome DevTools MCP는 `npx @anthropic-ai/chrome-devtools-mcp@latest` 기반이므로 별도 글로벌 설치가 필요하지 않다.

단, 사용자의 Claude Code에 Chrome DevTools MCP 서버가 등록되어 있어야 한다.

점검 방법: `mcp__chrome-devtools__list_pages` 도구를 호출해본다.
- 정상 응답 → 사용 가능
- 실패 → 안내:
  > Claude Code 설정에서 Chrome DevTools MCP 서버를 추가해주세요.
  > `/mcp` 입력 후 `chrome-devtools` 서버를 등록하면 됩니다.

---

## 최종 검증

모든 항목 점검 후 결과를 표로 출력한다:

| 항목 | 상태 | 비고 |
|------|------|------|
| Chrome 브라우저 | 설치됨 / 미설치 | 버전 |
| Chrome DevTools MCP | 사용 가능 / 설정 필요 | 도구 호출 결과 |
| 현재 디렉토리 | 확인 | PDP_TF/Kiwon |
| 오늘 날짜 | 확인 | YYYY-MM-DD |

---

## 출력 형식

```
## 환경 세팅 완료

| 항목 | 상태 |
|------|------|
| Chrome | ✅ 설치됨 (v131) |
| Chrome DevTools MCP | ✅ 사용 가능 |

`/make-pdp <URL>`로 PDP 생성을 시작할 수 있어요!
```
