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
// events: return value of detectEvents()
// period: { userId, label } — e.g. { userId: 'P151883', label: '최근 6개월' }
// returns: complete HTML string (self-contained, no external deps)
function renderReport(stats, events, period) {
  const pct = n => n != null ? n + '%' : 'N/A';
  const min = m => m != null ? m + '분' : 'N/A';
  const statusIcon = (good, warn) => good ? '✅' : (warn ? '⚠️' : '❌');

  const noShowEvents = events.filter(e => e.type === 'noshow');
  const guideEvents = events.filter(e => e.type === 'guide');
  const delayEvents = events.filter(e => e.type === 'delay');

  const eventRows = events.map(e => `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:7px;">
      <div style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:3px;background:${e.type === 'noshow' ? '#ff3b30' : '#ff9500'};"></div>
      <div>
        <div style="font-size:9px;color:#888;">${e.date}</div>
        <div style="font-size:10px;font-weight:600;color:#111;">${e.label}: ${e.snippet}</div>
      </div>
    </div>`).join('');

  const productLine = stats.productNames.slice(0, 2).join(' · ') || '–';

  // Claude 분석 프롬프트 (JS 내부에서 문자열 이스케이프 주의)
  const claudePrompt = [
    `다음은 마이리얼트립 파트너 "${stats.partnerName}" (${period.userId})의 Sendbird 대화 분석 결과입니다.`,
    '',
    '## 집계 데이터',
    `- 분석 채널 수: ${stats.channelCount}개`,
    `- 총 예약: ${stats.total}건 (확정 ${stats.confirm}건 / 취소 ${stats.cancel}건)`,
    `- 확정률: ${pct(stats.confirmRate)} / 취소율: ${pct(stats.cancelRate)}`,
    `- 파트너 임의취소: ${stats.partnerCancel}건 / 고객 취소: ${stats.customerCancel}건`,
    `- 평균 응답시간: ${min(stats.avgResponseMinutes)}`,
    `- 미답변 채널: ${stats.unanswered}건`,
    `- 노쇼 이력: ${noShowEvents.length}건`,
    `- 가이드 교체: ${guideEvents.length}건 / 일정 지연: ${delayEvents.length}건`,
    '',
    '## 주요 이벤트',
    events.length ? events.map(e => `- ${e.date} [${e.label}] ${e.snippet}`).join('\n') : '없음',
    '',
    '위 데이터를 바탕으로 다음을 분석해주세요:',
    '1. 파트너 신뢰도 종합 평가',
    '2. 주요 리스크 및 개선 포인트',
    '3. MRT 운영팀이 취해야 할 액션',
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
  h1 { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
  .card { border-radius: 10px; padding: 14px; text-align: center; }
  .card .val { font-size: 22px; font-weight: 700; color: white; }
  .card .lbl { font-size: 9px; color: rgba(255,255,255,0.85); margin-top: 3px; }
  .sections { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .section { background: white; border-radius: 10px; padding: 14px; }
  .section-title { font-size: 11px; font-weight: 700; color: #111; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f0f0f0; font-size: 10px; }
  .row:last-child { border-bottom: none; }
  .row-label { color: #555; }
  .row-value { font-weight: 600; color: #111; }
  .row-status { margin-left: 6px; font-size: 10px; }
  .data-note { background: #f0f6ff; border-left: 3px solid #0071e3; border-radius: 0 10px 10px 0; padding: 14px; margin-bottom: 16px; }
  .data-note-title { font-size: 10px; font-weight: 700; color: #0071e3; margin-bottom: 4px; }
  .data-note-body { font-size: 10px; color: #333; line-height: 1.6; }
  .claude-btn { display: block; width: 100%; background: #6e40c9; color: white; border: none; border-radius: 10px; padding: 12px; font-size: 13px; font-weight: 600; cursor: pointer; margin-bottom: 8px; }
  .claude-btn:hover { background: #5a32a3; }
  .hint { font-size: 10px; color: #999; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${stats.partnerName} <span style="font-size:13px;font-weight:400;color:#888;">${period.userId}</span></h1>
  <div class="meta">${productLine} &nbsp;|&nbsp; 분석 기간: ${period.label} &nbsp;|&nbsp; 채널 ${stats.channelCount}개</div>

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
    <div class="card" style="background:${noShowEvents.length > 0 ? '#ff3b30' : '#34c759'};">
      <div class="val">${noShowEvents.length}건</div><div class="lbl">노쇼 이력</div>
    </div>
  </div>

  <div class="sections">
    <div class="section">
      <div class="section-title">📋 신뢰도 체크</div>
      <div class="row"><span class="row-label">확정률</span><span class="row-value">${pct(stats.confirmRate)}</span><span class="row-status">${statusIcon(stats.confirmRate >= 90, stats.confirmRate < 90)}</span></div>
      <div class="row"><span class="row-label">파트너 임의취소</span><span class="row-value">${stats.partnerCancel}건</span><span class="row-status">${statusIcon(stats.partnerCancel === 0, stats.partnerCancel > 0)}</span></div>
      <div class="row"><span class="row-label">노쇼 이력</span><span class="row-value">${noShowEvents.length}건</span><span class="row-status">${statusIcon(noShowEvents.length === 0, noShowEvents.length > 0)}</span></div>
      <div class="row"><span class="row-label">확정 후 취소</span><span class="row-value">${stats.postConfirmCancel}건</span><span class="row-status">${statusIcon(stats.postConfirmCancel === 0, stats.postConfirmCancel > 0)}</span></div>
    </div>
    <div class="section">
      <div class="section-title">💬 고객 응대 품질</div>
      <div class="row"><span class="row-label">평균 응답시간</span><span class="row-value">${min(stats.avgResponseMinutes)}</span><span class="row-status">${statusIcon((stats.avgResponseMinutes ?? 999) <= 60, (stats.avgResponseMinutes ?? 999) > 60)}</span></div>
      <div class="row"><span class="row-label">미답변 채널</span><span class="row-value">${stats.unanswered}건</span><span class="row-status">${statusIcon(stats.unanswered === 0, stats.unanswered > 0)}</span></div>
      <div class="row"><span class="row-label">사전 안내 발송</span><span class="row-value">${stats.preNotice}채널</span><span class="row-status">📨</span></div>
    </div>
    <div class="section">
      <div class="section-title">📊 최근 운영 동향</div>
      <div class="row"><span class="row-label">대기 명단 언급</span><span class="row-value">${stats.waitlistCount}채널</span><span class="row-status">–</span></div>
      <div class="row"><span class="row-label">일정 오픈 지연</span><span class="row-value">${delayEvents.length}건</span><span class="row-status">${statusIcon(delayEvents.length === 0, delayEvents.length > 0)}</span></div>
      <div class="row"><span class="row-label">가이드 교체</span><span class="row-value">${guideEvents.length}건</span><span class="row-status">${statusIcon(guideEvents.length === 0, guideEvents.length > 0)}</span></div>
      <div class="row"><span class="row-label">고객 취소</span><span class="row-value">${stats.customerCancel}건</span><span class="row-status">–</span></div>
    </div>
    <div class="section">
      <div class="section-title">📅 주요 이벤트</div>
      ${eventRows || '<div style="font-size:10px;color:#999;">감지된 이벤트 없음</div>'}
    </div>
  </div>

  <div class="data-note">
    <div class="data-note-title">데이터 기준</div>
    <div class="data-note-body">채널 ${stats.channelCount}개 분석 · 총 예약 ${stats.total}건 (확정 ${stats.confirm} / 취소 ${stats.cancel}) · 파트너 임의취소 신뢰도: 중간 (키워드 매칭)</div>
  </div>

  <button class="claude-btn" onclick="copyForClaude()">🤖 Claude로 더 분석하기 — 프롬프트 복사</button>
  <div class="hint">복사된 텍스트를 Claude.ai 또는 Claude Code에 붙여넣기하세요</div>
</div>
<script>
function copyForClaude() {
  const prompt = ${JSON.stringify(claudePrompt)};
  navigator.clipboard.writeText(prompt).then(() => {
    const btn = document.querySelector('.claude-btn');
    btn.textContent = '✅ 클립보드에 복사됐어요!';
    setTimeout(() => { btn.textContent = '🤖 Claude로 더 분석하기 — 프롬프트 복사'; }, 3000);
  });
}
</script>
</body>
</html>`;
}
