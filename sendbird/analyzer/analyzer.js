// Sendbird Partner Analyzer — Pure Functions
// Task 2: ADMM Parser & Channel Classifier
// No imports, no exports, no side effects — browser/bookmarklet safe

// ADMM 메시지에서 예약 상태 정보 추출
// msg: Sendbird 메시지 객체 (type === 'ADMM')
// returns: { status, cancelReason, reservationNo, travelDate, createdAt } or null
function parseAdmm(msg) {
  try {
    const d = JSON.parse(msg.data || '{}');
    if (d.message_event_type !== 'RESERVATION_STATUS_CHANGE') return null;
    if (!d.reservation_status) return null;

    // 파트너 수신 콘텐츠 우선, 없으면 첫 번째 항목
    const targets = d.message?.targetContents || [];
    const target = targets.find(t => t.sendbirdUserId === window._analyzerUserId)
      || targets[0];
    const infoList = target?.content?.[0]?.reservationInfoList || [];

    const get = name => infoList.find(i => i.name === name)?.value ?? null;

    return {
      status: d.reservation_status,           // WAIT_CONFIRM | CONFIRM | CANCEL
      cancelReason: get('취소사유'),           // CANCEL 시만 존재
      reservationNo: get('예약번호'),
      travelDate: get('여행 출발일'),
      createdAt: msg.created_at,
    };
  } catch {
    return null;                               // 파싱 실패 시 무시
  }
}

// 채널의 ADMM 이벤트 배열 → 최종 예약 상태 분류
// admmEvents: parseAdmm() 결과 배열 (null 제외, 시간순)
// returns: { reservations[], finalStatus? }
// 빈 경우: { reservations: [], finalStatus: 'NO_RESERVATION' }
// 예약 있는 경우: { reservations: [{finalStatus, cancelReason, isPostConfirmCancel, reservationNo, travelDate}] }
function classifyChannel(admmEvents) {
  if (!admmEvents.length) return { reservations: [], finalStatus: 'NO_RESERVATION' };

  // 예약번호별로 그룹핑
  const byReservation = {};
  for (const e of admmEvents) {
    const key = e.reservationNo || 'unknown';
    if (!byReservation[key]) byReservation[key] = [];
    byReservation[key].push(e);
  }

  const reservations = Object.values(byReservation).map(events => {
    const statuses = events.map(e => e.status);
    const last = statuses[statuses.length - 1];
    const hadConfirm = statuses.includes('CONFIRM');
    return {
      finalStatus: last,
      cancelReason: events.find(e => e.status === 'CANCEL')?.cancelReason || null,
      isPostConfirmCancel: hadConfirm && last === 'CANCEL',
      reservationNo: events[0].reservationNo,
      travelDate: events[events.length - 1].travelDate,
    };
  });

  return { reservations };
}

// channels: [{ members[], name, messages[], admmEvents[] }] 배열
// returns: { partnerName, productNames[], channelCount, confirm, cancel, total,
//            confirmRate, cancelRate, partnerCancel, customerCancel, otherCancel,
//            postConfirmCancel, avgResponseMinutes, unanswered, preNotice, waitlistCount }
function aggregateStats(channels, userId) {
  let confirm = 0, cancel = 0, partnerCancel = 0, customerCancel = 0;
  let otherCancel = 0, postConfirmCancel = 0;
  let responseTimes = [], unanswered = 0, preNotice = 0, waitlistCount = 0;
  let partnerName = '';
  const productNameSet = new Set();

  for (const ch of channels) {
    // 파트너명 추출 (첫 번째 채널에서)
    if (!partnerName) {
      const partnerMember = (ch.members || []).find(m => m.user_id === userId);
      partnerName = partnerMember?.nickname || userId;
    }
    if (ch.name) productNameSet.add(ch.name);

    // 예약 상태 집계
    const classified = classifyChannel(ch.admmEvents);
    for (const res of classified.reservations || []) {
      if (res.finalStatus === 'CONFIRM') confirm++;
      if (res.finalStatus === 'CANCEL') {
        cancel++;
        if (res.isPostConfirmCancel) postConfirmCancel++;
        const reason = res.cancelReason || '';
        if (/파트너|운영사/.test(reason)) partnerCancel++;
        else if (/여행자|고객/.test(reason)) customerCancel++;
        else otherCancel++;
      }
    }

    // 응답시간: 고객 메시지 → 파트너 첫 답장 시간 차 평균
    const msgs = (ch.messages || []).filter(m => m.type !== 'ADMM');
    let i = 0;
    while (i < msgs.length) {
      if (msgs[i].user?.user_id !== userId) {
        // 고객 메시지 발견 — 이후 파트너 답장 찾기
        const customerTs = msgs[i].created_at;
        let j = i + 1;
        while (j < msgs.length && msgs[j].user?.user_id !== userId) j++;
        if (j < msgs.length) {
          responseTimes.push((msgs[j].created_at - customerTs) / 60000); // 분 단위
        }
        i = j + 1;
      } else {
        i++;
      }
    }

    // 미답변: 마지막 메시지가 고객 발신 AND 채널 상태가 WAIT_CONFIRM 또는 단순 문의(NO_RESERVATION)
    // CONFIRM된 채널은 미답변으로 보지 않음
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      const isWaitOrNoReservation = !classified.reservations?.length ||
        classified.reservations.every(r => r.finalStatus === 'WAIT_CONFIRM');
      if (lastMsg.user?.user_id !== userId && isWaitOrNoReservation) unanswered++;
    }

    // 사전 안내 발송: 파트너 메시지에 '[안내]' 포함
    if (msgs.some(m => m.user?.user_id === userId && m.message?.includes('[안내]'))) {
      preNotice++;
    }

    // 대기 명단 언급: '대기' 또는 '웨이팅' 키워드 포함 채널
    if (msgs.some(m => /대기|웨이팅/.test(m.message || ''))) {
      waitlistCount++;
    }
  }

  const total = confirm + cancel;
  const avgResponseMinutes = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;

  return {
    partnerName,
    productNames: [...productNameSet],
    channelCount: channels.length,
    confirm, cancel, total,
    confirmRate: total ? Math.round(confirm / total * 100) : null,
    cancelRate: total ? Math.round(cancel / total * 100) : null,
    partnerCancel, customerCancel, otherCancel, postConfirmCancel,
    avgResponseMinutes,
    unanswered,
    preNotice,
    waitlistCount,
  };
}

// 채널 전체에서 주요 이벤트(노쇼, 가이드교체, 일정지연) 감지
// returns: [{ type, label, date, snippet, createdAt }] 날짜 역순
function detectEvents(channels, userId) {
  const PATTERNS = {
    noshow:   /노쇼|진행\s*불가|독감|B형|보상|사죄|면목/,
    guide:    /가이드\s*(변경|교체|대체)/,
    delay:    /스케[쥬줄]?[울를]\s*조율|오픈\s*(지연|전)|미오픈/,
  };
  const TYPE_LABEL = { noshow: '노쇼', guide: '가이드 교체', delay: '일정 지연' };

  const events = [];
  for (const ch of channels) {
    const msgs = (ch.messages || []).filter(m => m.type !== 'ADMM' && m.user?.user_id === userId);
    for (const msg of msgs) {
      const text = msg.message || '';
      for (const [type, re] of Object.entries(PATTERNS)) {
        if (re.test(text)) {
          const date = new Date(msg.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
          const snippet = text.slice(0, 60).replace(/\n/g, ' ');
          events.push({ type, label: TYPE_LABEL[type], date, snippet, createdAt: msg.created_at });
          break; // 메시지당 하나의 이벤트 유형만
        }
      }
    }
  }

  // 날짜 역순, 유형+날짜 중복 제거
  const seen = new Set();
  return events
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter(e => {
      const key = `${e.type}-${e.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// stats: return value of aggregateStats()
// period: { userId, label } — e.g. { userId: 'P151883', label: '최근 6개월' }
// returns: complete HTML string (self-contained, no external deps)
function renderReport(stats, period) {
  const pct = n => n != null ? n + '%' : 'N/A';
  const min = m => m != null ? m + '분' : 'N/A';
  const statusIcon = (good, warn) => good ? '✅' : (warn ? '⚠️' : '❌');

  const productLine = stats.productNames.slice(0, 2).join(' · ') || '–';

  const cancelPrompt = [
    `sendbird-${period.userId}.md 파일을 분석해줘.`,
    '',
    `이 파일은 마이리얼트립 파트너 ${stats.partnerName}(${period.userId})의 고객 대화 이력이야.`,
    '수치 집계보다 실제 대화 뉘앙스와 맥락을 중심으로 아래를 분석해줘:',
    '',
    '1. 파트너 응대 태도와 신뢰도 (말투, 문제 처리 방식, 사과/보상 대응)',
    '2. 고객 불만 또는 위험 신호가 있었는지',
    '3. 예약 취소/변경 패턴 — 어떤 상황에서 취소가 발생했는지',
    '4. 운영 상 반복되는 문제나 개선이 필요한 부분',
    '5. MRT 운영팀이 취해야 할 액션',
    '',
    `참고 수치: 확정률 ${pct(stats.confirmRate)} · 취소율 ${pct(stats.cancelRate)} · 평균 응답 ${min(stats.avgResponseMinutes)} · 채널 ${stats.channelCount}개`,
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${stats.partnerName} 파트너 분석 리포트</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; padding: 32px 16px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 2px; }
  .meta-products { font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
  .card { border-radius: 10px; padding: 14px; text-align: center; }
  .card .val { font-size: 22px; font-weight: 700; color: white; }
  .card .lbl { font-size: 9px; color: rgba(255,255,255,0.85); margin-top: 3px; }
  .sections { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .section { background: white; border-radius: 10px; padding: 14px; }
  .section-title { font-size: 11px; font-weight: 700; color: #111; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f0f0f0; font-size: 10px; }
  .row:last-child { border-bottom: none; }
  .row-label { color: #555; }
  .row-value { font-weight: 600; color: #111; }
  .row-status { margin-left: 6px; font-size: 10px; }
  .cancel-section { background: white; border-radius: 10px; padding: 14px; margin-bottom: 12px; display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
  .cancel-item { text-align: center; padding: 10px 8px; background: #f9f9fb; border-radius: 8px; }
  .cancel-item .c-val { font-size: 18px; font-weight: 700; color: #111; }
  .cancel-item .c-lbl { font-size: 9px; color: #888; margin-top: 3px; }
  .data-note { background: #f9f9fb; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
  .data-note-body { font-size: 10px; color: #777; line-height: 1.6; }
  .cc-card { background: white; border-radius: 10px; padding: 18px; margin-bottom: 16px; border: 1.5px solid #e8e0f8; }
  .cc-title { font-size: 13px; font-weight: 700; color: #6e40c9; margin-bottom: 12px; }
  .cc-step { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; font-size: 12px; color: #444; line-height: 1.5; }
  .cc-num { background: #6e40c9; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .cc-code { background: #f0f0f5; border-radius: 4px; padding: 1px 6px; font-family: monospace; font-size: 11px; }
  .cc-btn { display: block; width: 100%; background: #6e40c9; color: white; border: none; border-radius: 8px; padding: 11px; font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 14px; }
  .cc-btn:hover { background: #5a32a3; }
  .cc-hint { font-size: 10px; color: #999; text-align: center; margin-top: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${stats.partnerName} <span style="font-size:13px;font-weight:400;color:#888;">${period.userId}</span></h1>
  <div class="meta-products">${productLine}</div>
  <div class="meta">분석 기간: ${period.label} &nbsp;|&nbsp; 채널 ${stats.channelCount}개</div>

  <div class="cards">
    <div class="card" style="background:#0071e3;">
      <div class="val">${pct(stats.confirmRate)}</div><div class="lbl">확정률</div>
    </div>
    <div class="card" style="background:${(stats.cancelRate ?? 0) > 10 ? '#ff3b30' : '#34c759'};">
      <div class="val">${pct(stats.cancelRate)}</div><div class="lbl">취소율</div>
    </div>
    <div class="card" style="background:${(stats.avgResponseMinutes ?? 0) > 120 ? '#ff9500' : '#34c759'};">
      <div class="val">${min(stats.avgResponseMinutes)}</div><div class="lbl">평균 응답</div>
    </div>
    <div class="card" style="background:${stats.unanswered > 0 ? '#ff9500' : '#34c759'};">
      <div class="val">${stats.unanswered}건</div><div class="lbl">미답변</div>
    </div>
  </div>

  <div class="sections">
    <div class="section">
      <div class="section-title">📋 신뢰도 체크</div>
      <div class="row"><span class="row-label">확정률</span><span class="row-value">${pct(stats.confirmRate)}</span><span class="row-status">${statusIcon(stats.confirmRate >= 90, stats.confirmRate < 90)}</span></div>
      <div class="row"><span class="row-label">파트너 임의취소</span><span class="row-value">${stats.partnerCancel}건</span><span class="row-status">${statusIcon(stats.partnerCancel === 0, stats.partnerCancel > 0)}</span></div>
      <div class="row"><span class="row-label">확정 후 취소</span><span class="row-value">${stats.postConfirmCancel}건</span><span class="row-status">${statusIcon(stats.postConfirmCancel === 0, stats.postConfirmCancel > 0)}</span></div>
      <div class="row"><span class="row-label">미답변 채널</span><span class="row-value">${stats.unanswered}건</span><span class="row-status">${statusIcon(stats.unanswered === 0, stats.unanswered > 0)}</span></div>
    </div>
    <div class="section">
      <div class="section-title">💬 고객 응대 품질</div>
      <div class="row"><span class="row-label">평균 응답시간</span><span class="row-value">${min(stats.avgResponseMinutes)}</span><span class="row-status">${statusIcon((stats.avgResponseMinutes ?? 999) <= 60, (stats.avgResponseMinutes ?? 999) > 60)}</span></div>
      <div class="row"><span class="row-label">사전 안내 발송</span><span class="row-value">${stats.preNotice}채널</span><span class="row-status">📨</span></div>
      <div class="row"><span class="row-label">총 예약</span><span class="row-value">${stats.total}건</span><span class="row-status">–</span></div>
      <div class="row"><span class="row-label">고객 취소</span><span class="row-value">${stats.customerCancel}건</span><span class="row-status">–</span></div>
    </div>
  </div>

  <div class="section" style="margin-bottom:12px;">
    <div class="section-title">📊 취소 분석</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px;">
      <div style="text-align:center;padding:10px 8px;background:#f9f9fb;border-radius:8px;">
        <div style="font-size:18px;font-weight:700;color:#111;">${stats.customerCancel}건</div>
        <div style="font-size:9px;color:#888;margin-top:3px;">고객 취소</div>
      </div>
      <div style="text-align:center;padding:10px 8px;background:#f9f9fb;border-radius:8px;">
        <div style="font-size:18px;font-weight:700;color:${stats.partnerCancel > 0 ? '#ff3b30' : '#111'};">${stats.partnerCancel}건</div>
        <div style="font-size:9px;color:#888;margin-top:3px;">파트너 임의취소</div>
      </div>
      <div style="text-align:center;padding:10px 8px;background:#f9f9fb;border-radius:8px;">
        <div style="font-size:18px;font-weight:700;color:${stats.postConfirmCancel > 0 ? '#ff9500' : '#111'};">${stats.postConfirmCancel}건</div>
        <div style="font-size:9px;color:#888;margin-top:3px;">확정 후 취소</div>
      </div>
      <div style="text-align:center;padding:10px 8px;background:#f9f9fb;border-radius:8px;">
        <div style="font-size:18px;font-weight:700;color:#111;">${stats.otherCancel}건</div>
        <div style="font-size:9px;color:#888;margin-top:3px;">미분류</div>
      </div>
    </div>
    <div style="margin-top:10px;font-size:9px;color:#bbb;">파트너 임의취소는 취소사유 키워드 매칭 기반 — 정확도 중간. 실제 대화 확인 권장.</div>
  </div>

  <div class="data-note">
    <div class="data-note-body">채널 ${stats.channelCount}개 분석 · 총 예약 ${stats.total}건 (확정 ${stats.confirm} / 취소 ${stats.cancel})</div>
  </div>

  <div class="cc-card">
    <div class="cc-title">🤖 Claude Code로 대화 뉘앙스 분석하기</div>
    <div class="cc-step"><div class="cc-num">1</div><div>MD 추출 도구에서 <span class="cc-code">sendbird-${period.userId}.md</span> 다운로드</div></div>
    <div class="cc-step"><div class="cc-num">2</div><div>터미널에서 <span class="cc-code">cd ~/Downloads && claude</span></div></div>
    <div class="cc-step"><div class="cc-num">3</div><div>아래 프롬프트를 붙여넣기 → Claude가 실제 대화를 읽고 뉘앙스 분석</div></div>
    <button class="cc-btn" onclick="copyPrompt()">📋 분석 프롬프트 복사</button>
    <div class="cc-hint">수치 집계가 아닌 실제 대화 원문 기반 분석</div>
  </div>
</div>
<script>
function copyPrompt() {
  const prompt = ${JSON.stringify(cancelPrompt)};
  navigator.clipboard.writeText(prompt).then(() => {
    const btn = document.querySelector('.cc-btn');
    btn.textContent = '✅ 복사됐어요!';
    setTimeout(() => { btn.textContent = '📋 분석 프롬프트 복사'; }, 3000);
  });
}
</script>
</body>
</html>`;
}

// 채널 목록 조회 (기간 필터 포함)
// appId: Sendbird app ID (from window.location.pathname.split('/')[1])
// userId: partner user ID (e.g. 'P151883')
// sinceMs: Unix ms cutoff (0 = no filter, fetch all)
// returns: channel objects array
async function fetchChannels(appId, userId, sinceMs) {
  const BASE = 'https://gate.sendbird.com/platform/v3';
  const H = { 'app-id': appId, 'accept': 'application/json' };

  const channels = [];
  let token = '';
  do {
    const qs = new URLSearchParams({
      members_include_in: userId,
      limit: 100,
      show_member: true,
      token,
    });
    if (token === '') qs.delete('token'); // empty token causes API error
    const res = await fetch(`${BASE}/group_channels?${qs}`, { headers: H, credentials: 'include' });
    if (!res.ok) throw new Error(`채널 조회 실패: HTTP ${res.status}`);
    const data = await res.json();
    const batch = data.channels || [];
    // 기간 필터: last_message.created_at 기준
    const filtered = sinceMs
      ? batch.filter(ch => (ch.last_message?.created_at || 0) >= sinceMs)
      : batch;
    channels.push(...filtered);
    token = data.next || '';
    // 오래된 채널 나오기 시작하면 페이지 순회 중단 (API는 최신순 반환)
    if (sinceMs && batch.length > 0) {
      const lastTs = batch[batch.length - 1]?.last_message?.created_at || 0;
      if (lastTs < sinceMs) break;
    }
  } while (token);

  return channels;
}

// 채널 내 전체 메시지 수집 (ADMM 포함)
// returns: message objects array (oldest first)
async function fetchMessages(appId, channelUrl) {
  const BASE = 'https://gate.sendbird.com/platform/v3';
  const H = { 'app-id': appId, 'accept': 'application/json' };
  const messages = [];
  let messageTs = Date.now();

  while (true) {
    const qs = new URLSearchParams({
      message_ts: messageTs,
      prev_limit: 200,
      next_limit: 0,
      include: true,
    });
    const res = await fetch(
      `${BASE}/group_channels/${encodeURIComponent(channelUrl)}/messages?${qs}`,
      { headers: H, credentials: 'include' }
    );
    if (!res.ok) break; // 오류 시 지금까지 수집한 것만 반환
    const data = await res.json();
    const batch = data.messages || [];
    if (!batch.length) break;
    messages.unshift(...batch);
    messageTs = batch[0].created_at - 1;
    if (batch.length < 200) break; // 마지막 페이지
  }
  return messages;
}

// 분석 중 재미있는 로딩 메시지
const FUN_MESSAGES = [
  '파트너의 진심을 읽는 중... 🔍',
  '대화 뉘앙스 감지 중... 🎯',
  '취소 사유 속 숨은 뜻 해독 중... 🕵️',
  '응대 속도 측정 중... ⏱️',
  '고객 만족도 감 잡는 중... 📊',
  '확정률의 비밀을 파헤치는 중... 🔓',
  '메시지 하나하나 정성껏 읽는 중... 📖',
  '파트너 성적표 작성 중... ✍️',
  '숫자 뒤에 숨은 이야기를 찾는 중... 📚',
  '거의 다 왔어요, 조금만... 🏃',
];

// 진행 상황 패널 생성 (Sendbird 대시보드에 고정 표시)
function createProgressPanel() {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:white;border-radius:14px;padding:18px 22px;box-shadow:0 8px 32px rgba(0,0,0,0.18);font-family:-apple-system,sans-serif;width:300px;border:1.5px solid #e0e0e0;';
  panel.innerHTML = '<div id="_ap_title" style="font-weight:700;font-size:14px;margin-bottom:4px;">📊 파트너 분석 중...</div><div id="_ap_fun" style="font-size:11px;color:#999;margin-bottom:8px;font-style:italic;"></div><div id="_ap_status" style="font-size:12px;color:#555;line-height:1.6;margin-bottom:8px;"></div><div style="background:#f0f0f5;border-radius:99px;height:6px;"><div id="_ap_bar" style="height:6px;border-radius:99px;background:#0071e3;width:0%;transition:width 0.3s;"></div></div>';
  document.body.appendChild(panel);

  let funIdx = 0;
  const funEl = panel.querySelector('#_ap_fun');
  funEl.textContent = FUN_MESSAGES[0];
  const funTimer = setInterval(() => {
    funIdx = (funIdx + 1) % FUN_MESSAGES.length;
    funEl.style.opacity = '0';
    setTimeout(() => { funEl.textContent = FUN_MESSAGES[funIdx]; funEl.style.opacity = '1'; }, 200);
  }, 3000);
  funEl.style.transition = 'opacity 0.2s';

  return {
    update(msg, pct) {
      panel.querySelector('#_ap_status').textContent = msg;
      panel.querySelector('#_ap_bar').style.width = pct + '%';
    },
    done(msg) {
      clearInterval(funTimer);
      const bar = panel.querySelector('#_ap_bar');
      bar.style.background = '#34c759';
      bar.style.width = '100%';
      panel.querySelector('#_ap_status').textContent = msg;
      // 🎉 완료 폭죽
      funEl.style.fontSize = '20px';
      funEl.style.fontStyle = 'normal';
      funEl.textContent = '🎉🎊✨';
      panel.querySelector('#_ap_title').textContent = '분석 완료!';
      setTimeout(() => panel.remove(), 5000);
    },
    error(msg) {
      clearInterval(funTimer);
      funEl.textContent = '😢 이런...';
      funEl.style.fontStyle = 'normal';
      panel.querySelector('#_ap_bar').style.background = '#ff3b30';
      panel.querySelector('#_ap_status').textContent = '❌ ' + msg;
    }
  };
}

// 콘솔 이스터에그
console.log('%c📊 Sendbird Partner Analyzer', 'font-size:18px;font-weight:bold;color:#0071e3;');
console.log('%c파트너의 진짜 실력, 숫자가 말해줍니다.', 'font-size:12px;color:#888;');
console.log('%c─────────────────────────────', 'color:#e0e0e0;');
console.log('%c🙏 Thanks to', 'font-size:11px;font-weight:bold;color:#333;');
console.log('%c   동훈, 수진님 — 새로운 업무 방식을 제안해주신 AI Lab\n   단우님 — 이 놀이터를 마련해주신 분', 'font-size:11px;color:#666;line-height:1.6;');
console.log('%c─────────────────────────────', 'color:#e0e0e0;');
console.log('%cby TNA CSM Playground 🛠️', 'font-size:10px;color:#aaa;');

// MD 대화이력 생성
function generateMd(channels, userId) {
  const dt = ts => new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const statusLabels = { WAIT_CONFIRM: '예약 대기', CONFIRM: '예약 확정', CANCEL: '예약 취소' };
  let md = `# Sendbird 대화이력 — ${userId}\n> 추출: ${dt(Date.now())}\n> 채널: ${channels.length}개\n\n---\n\n`;
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const mb = (ch.members || []).map(m => (m.nickname || m.user_id) + '(' + m.user_id + ')').join(', ');
    md += `## ${i + 1}. ${ch.name || '(이름없음)'}\n- **채널**: \`${ch.channel_url}\`\n- **참여자**: ${mb}\n\n### 대화\n\n`;
    if (!ch.messages.length) {
      md += '_메시지 없음_\n';
    } else {
      for (const m of ch.messages) {
        if (m.type === 'ADMM') {
          try {
            const ad = JSON.parse(m.data || '{}');
            if (ad.message_event_type === 'RESERVATION_STATUS_CHANGE') {
              const st = ad.reservation_status;
              const info = (ad.message?.targetContents?.[0]?.content?.[0]?.reservationInfoList || []);
              const getInfo = n => (info.find(x => x.name === n) || {}).value || '';
              const label = statusLabels[st] || ('예약 상태: ' + st);
              let line = `**[${label}]** \`${dt(m.created_at)}\``;
              const rn = getInfo('예약번호'); if (rn) line += ' · 예약번호: ' + rn;
              const td = getInfo('여행 출발일'); if (td) line += ' · 출발일: ' + td;
              const cr = getInfo('취소사유'); if (cr) line += ' · 취소사유: ' + cr;
              md += line + '\n\n';
            }
          } catch (e) {}
          continue;
        }
        const s = m.user?.nickname || m.user?.user_id || '시스템';
        md += `**${s}** \`${dt(m.created_at)}\`\n${m.message || '[파일]'}\n\n`;
      }
    }
    md += '---\n\n';
  }
  return md;
}

// 북마클릿에서 호출되는 진입점
async function runAnalyzer(appId, userId, monthsBack) {
  if (window._analyzerRunning) {
    alert('현재 분석이 진행 중이에요. 완료 후 다시 시도해주세요.');
    return;
  }
  window._analyzerRunning = true;

  const sinceMs = monthsBack ? Date.now() - monthsBack * 30 * 24 * 3600 * 1000 : 0;
  window._analyzerUserId = userId;

  const panel = createProgressPanel();

  try {
    panel.update('채널 목록 조회 중...', 5);
    let rawChannels;
    try {
      rawChannels = await fetchChannels(appId, userId, sinceMs);
    } catch (e) {
      if (String(e.message).includes('401') || String(e.message).includes('403')) {
        throw new Error('Sendbird 로그인이 필요해요. dashboard.sendbird.com에 먼저 로그인해주세요.');
      }
      throw e;
    }
    if (!rawChannels.length) {
      panel.done(`⚠️ "${userId}"의 채널이 없어요. User ID를 다시 확인해주세요.`);
      return;
    }
    panel.update(`채널 ${rawChannels.length}개 발견 — 메시지 수집 중...`, 10);

    const channels = [];
    for (let i = 0; i < rawChannels.length; i++) {
      const ch = rawChannels[i];
      const shortUrl = ch.channel_url ? ch.channel_url.slice(-12) : String(i);
      panel.update(`[${i + 1}/${rawChannels.length}] ${ch.name || shortUrl}`, 10 + (i / rawChannels.length) * 80);
      const messages = await fetchMessages(appId, ch.channel_url);
      const admmEvents = messages.filter(m => m.type === 'ADMM').map(parseAdmm).filter(Boolean);
      channels.push({ ...ch, messages, admmEvents });
    }

    panel.update('분석 중...', 92);
    const period = {
      userId,
      label: monthsBack ? `최근 ${monthsBack}개월` : '전체',
    };
    const stats = aggregateStats(channels, userId);
    const html = renderReport(stats, period);

    panel.update('리포트 다운로드 중...', 98);
    const today = new Date().toISOString().slice(0, 10);

    const dl = (content, filename, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    dl(html, `sendbird-report-${userId}-${today}.html`, 'text/html');
    await new Promise(r => setTimeout(r, 500));
    dl(generateMd(channels, userId), `sendbird-${userId}.md`, 'text/markdown');

    panel.done(`✅ 완료! 리포트 + 대화이력 MD 저장됨`);
  } catch (err) {
    panel.error(err.message || '알 수 없는 오류');
    throw err;
  } finally {
    window._analyzerRunning = false;
  }
}
