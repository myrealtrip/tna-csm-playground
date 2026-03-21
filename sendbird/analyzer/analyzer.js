// Sendbird Partner Analyzer — Pure Functions
// No imports, no exports, no side effects — browser/bookmarklet safe
const ANALYZER_VERSION = 3;

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

// 업무시간 내 경과시간 계산 (분 단위)
// startMs, endMs: Unix ms timestamps
// businessStart, businessEnd: 시 (파트너 현지 기준, 기본 9:00–21:00)
// utcOffsetHours: 파트너 시간대 (기본 9 = KST, 예: 파리 동절기 1, 하절기 2)
// 비업무 시간에 보낸 메시지는 다음 업무 시작 시점부터 카운트
function businessMinutes(startMs, endMs, businessStart = 9, businessEnd = 21, utcOffsetHours = 9) {
  if (endMs <= startMs) return 0;
  const TZ_OFFSET = utcOffsetHours * 60; // in minutes

  // ms → 파트너 현지시간 Date 헬퍼
  const toLocal = ms => {
    const d = new Date(ms);
    return new Date(d.getTime() + TZ_OFFSET * 60000);
  };

  // 현지시간 날짜에서 해당 날짜의 업무시작/종료 ms (가상 UTC 기준)
  const dayStart = kst => {
    const d = new Date(kst);
    d.setUTCHours(businessStart, 0, 0, 0);
    return d.getTime();
  };
  const dayEnd = kst => {
    const d = new Date(kst);
    d.setUTCHours(businessEnd, 0, 0, 0);
    return d.getTime();
  };

  // 시작/종료를 KST로 변환
  let s = toLocal(startMs).getTime();
  let e = toLocal(endMs).getTime();

  // 시작 시점이 업무시간 전이면 업무 시작으로 조정
  let sCur = toLocal(startMs);
  if (sCur.getUTCHours() < businessStart) {
    s = dayStart(sCur);
  }
  // 시작 시점이 업무시간 후면 다음 날 업무 시작으로 조정
  if (sCur.getUTCHours() >= businessEnd) {
    sCur.setUTCDate(sCur.getUTCDate() + 1);
    s = dayStart(sCur);
  }

  // 종료 시점이 업무시간 전이면 전날 업무 종료로 조정
  let eCur = toLocal(endMs);
  if (eCur.getUTCHours() < businessStart) {
    eCur.setUTCDate(eCur.getUTCDate() - 1);
    e = dayEnd(eCur);
  }
  // 종료 시점이 업무시간 후면 당일 업무 종료로 조정
  if (eCur.getUTCHours() >= businessEnd) {
    e = dayEnd(eCur);
  }

  if (e <= s) return 0;

  const businessPerDay = (businessEnd - businessStart) * 60; // 분
  const msPerDay = 24 * 60 * 60 * 1000;
  const sDate = new Date(s);
  const eDate = new Date(e);

  // 같은 날이면 단순 차이
  const sDayNum = Math.floor(s / msPerDay);
  const eDayNum = Math.floor(e / msPerDay);

  if (sDayNum === eDayNum) {
    return Math.round((e - s) / 60000);
  }

  // 다른 날: 첫날 잔여 + 중간 날 전체 + 마지막 날
  const firstDayEnd = dayEnd(sDate);
  const lastDayStart = dayStart(eDate);
  const firstDayMin = Math.max(0, Math.round((firstDayEnd - s) / 60000));
  const lastDayMin = Math.max(0, Math.round((e - lastDayStart) / 60000));
  const fullDays = Math.max(0, eDayNum - sDayNum - 1);

  return firstDayMin + fullDays * businessPerDay + lastDayMin;
}

// 채널의 ADMM 이벤트 배열 → 최종 예약 상태 분류
// admmEvents: parseAdmm() 결과 배열 (null 제외, 시간순)
// returns: { reservations[], finalStatus? }
// 빈 경우: { reservations: [], finalStatus: 'NO_RESERVATION' }
// 예약 있는 경우: { reservations: [{finalStatus, cancelReason, isPostConfirmCancel, reservationNo, travelDate}] }
function classifyChannel(admmEvents) {
  if (!admmEvents.length) return { reservations: [], finalStatus: 'NO_RESERVATION' };

  // 예약번호별로 그룹핑
  // 번호 없으면 5분 이내 이벤트를 같은 예약으로 간주
  const byReservation = {};
  let unknownGroup = 0;
  let lastUnknownTs = 0;
  let currentUnknownKey = '';
  for (const e of admmEvents) {
    let key;
    if (e.reservationNo) {
      key = e.reservationNo;
    } else {
      // 이전 unknown 이벤트와 5분 이내면 같은 그룹
      if (currentUnknownKey && Math.abs(e.createdAt - lastUnknownTs) < 300000) {
        key = currentUnknownKey;
      } else {
        key = `_unknown_${unknownGroup++}`;
        currentUnknownKey = key;
      }
      lastUnknownTs = e.createdAt;
    }
    if (!byReservation[key]) byReservation[key] = [];
    byReservation[key].push(e);
  }

  const reservations = Object.values(byReservation).map(events => {
    const statuses = events.map(e => e.status);
    const last = statuses[statuses.length - 1];
    const hadConfirm = statuses.includes('CONFIRM');
    return {
      finalStatus: last,
      cancelReason: [...events].reverse().find(e => e.status === 'CANCEL')?.cancelReason || null,
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
// opts.utcOffset: 파트너 시간대 (기본 9 = KST)
// opts.businessStart/End: 업무시간 (기본 9–21)
function aggregateStats(channels, userId, opts = {}) {
  const utcOffset = opts.utcOffset ?? 9;
  const bizStart = opts.businessStart ?? 9;
  const bizEnd = opts.businessEnd ?? 21;
  let confirm = 0, cancel = 0, waitConfirm = 0, partnerCancel = 0, customerCancel = 0;
  let weatherCancel = 0, minPartyCancel = 0, platformCancel = 0, otherCancel = 0, postConfirmCancel = 0;
  let responseTimes = [], businessResponseTimes = [], customerQuestions = 0, ignoredQuestions = 0;
  let unanswered = 0, preNotice = 0, waitlistCount = 0;
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
      if (res.finalStatus === 'WAIT_CONFIRM') waitConfirm++;
      if (res.finalStatus === 'CONFIRM') confirm++;
      if (res.finalStatus === 'CANCEL') {
        cancel++;
        if (res.isPostConfirmCancel) postConfirmCancel++;
        const reason = res.cancelReason || '';
        // 세부 태그 (메인 카테고리와 별도 — 중복 집계)
        if (/기상|날씨|태풍|우천|폭우|폭설|지진|천재/.test(reason)) weatherCancel++;
        if (/최소\s*인원|인원\s*미달|모객/.test(reason)) minPartyCancel++;
        if (/MRT|마이리얼트립|운영팀|플랫폼/.test(reason)) platformCancel++;
        // 메인 카테고리 (고객 / 파트너 / 미분류 — 합계 = cancel)
        if (/여행자|고객|중복\s*예약|일정\s*변경/.test(reason)) customerCancel++;
        else if (/파트너|운영사|운영\s*불가/.test(reason)) partnerCancel++;
        else otherCancel++;
      }
    }

    // 응답시간: 고객 연속 메시지의 마지막 → 파트너 첫 답장 시간 차
    // user가 없는 시스템 메시지는 제외 (응답시간 왜곡 방지)
    const msgs = (ch.messages || []).filter(m => m.type !== 'ADMM' && m.user?.user_id);
    let i = 0;
    while (i < msgs.length) {
      if (msgs[i].user?.user_id !== userId) {
        // 고객 연속 메시지 그룹의 마지막 타임스탬프
        let lastCustomerTs = msgs[i].created_at;
        let j = i + 1;
        while (j < msgs.length && msgs[j].user?.user_id !== userId) {
          lastCustomerTs = msgs[j].created_at;
          j++;
        }
        customerQuestions++;
        if (j < msgs.length) {
          responseTimes.push((msgs[j].created_at - lastCustomerTs) / 60000);
          businessResponseTimes.push(businessMinutes(lastCustomerTs, msgs[j].created_at, bizStart, bizEnd, utcOffset));
        } else {
          ignoredQuestions++; // 파트너가 끝내 답하지 않은 고객 질문
        }
        i = j + 1;
      } else {
        i++;
      }
    }

    // 미답변: 마지막 메시지가 고객 발신 (예약 상태 무관 — 확정 후 질문 무시도 포함)
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg.user?.user_id !== userId) unanswered++;
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

  const total = confirm + cancel + waitConfirm;
  const avgResponseMinutes = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : null;
  const avgBusinessResponseMinutes = businessResponseTimes.length
    ? Math.round(businessResponseTimes.reduce((a, b) => a + b, 0) / businessResponseTimes.length)
    : null;
  const medianBusinessResponseMinutes = businessResponseTimes.length
    ? (() => { const s = [...businessResponseTimes].sort((a,b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m-1] + s[m]) / 2); })()
    : null;

  // 취소율 분리: 전체 vs 파트너 귀책
  // 시스템 라벨 "파트너 요청으로 취소"도 실제로는 고객 동의 하 정리가 대부분이므로
  // partnerCancelRate는 참고용, 실질 지표는 전체 취소율에서 고객 사유를 뺀 netCancelRate
  const netCancel = cancel - customerCancel; // 고객 자발 취소 제외
  const cancelRate = total ? Math.round(cancel / total * 100) : null;
  const customerCancelRate = total ? Math.round(customerCancel / total * 100) : null;
  const netCancelRate = total ? Math.round(netCancel / total * 100) : null;

  return {
    partnerName,
    productNames: [...productNameSet],
    channelCount: channels.length,
    confirm, cancel, waitConfirm, total,
    confirmRate: total ? Math.round(confirm / total * 100) : null,
    cancelRate,
    customerCancelRate,
    netCancelRate,
    netCancel,
    partnerCancel, customerCancel, weatherCancel, minPartyCancel, platformCancel, otherCancel, postConfirmCancel,
    avgResponseMinutes,
    avgBusinessResponseMinutes,
    medianBusinessResponseMinutes,
    customerQuestions,
    ignoredQuestions,
    responseRate: customerQuestions ? Math.round((customerQuestions - ignoredQuestions) / customerQuestions * 100) : null,
    unanswered,
    preNotice,
    waitlistCount,
  };
}

// HTML 이스케이프 — XSS 방지
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// stats: return value of aggregateStats()
// period: { userId, label } — e.g. { userId: 'P151883', label: '최근 6개월' }
// returns: complete HTML string (self-contained, no external deps)
function renderReport(stats, period) {
  const pct = n => n != null ? n + '%' : 'N/A';
  const min = m => m != null ? m + '분' : 'N/A';
  const statusIcon = (good, warn) => good ? '✅' : (warn ? '⚠️' : '❌');

  const productLine = esc(stats.productNames.slice(0, 2).join(' · ') || '–');
  const partnerNameSafe = esc(stats.partnerName);
  const reportDate = new Date().toISOString().slice(0, 10);

  const cancelPrompt = [
    `~/Downloads/sendbird-${period.userId}-${period.periodTag}-${reportDate}.md 파일을 분석해줘. 파일이 없으면 저장 경로를 물어봐.`,
    '',
    '파일이 크면 "## N." 구분자 기준으로 나눠 읽고, 전체를 종합해서 분석해.',
    '',
    `이 파일은 마이리얼트립 파트너 ${stats.partnerName}(${period.userId})의 고객 대화 이력이야.`,
    '수치 집계보다 실제 대화 뉘앙스와 맥락을 중심으로 아래를 분석해줘:',
    '',
    '1. 파트너 응대 태도와 신뢰도 (말투, 문제 처리 방식, 사과/보상 대응)',
    '2. 고객 불만 또는 위험 신호가 있었는지',
    '3. 예약 취소/변경 패턴 — 어떤 상황에서 취소가 발생했는지',
    '4. 운영 상 반복되는 문제나 개선이 필요한 부분',
    '5. MRT 사업개발팀에서 취해야 할 액션',
    '',
    `참고 수치: 확정률 ${pct(stats.confirmRate)} · 전체 취소율 ${pct(stats.cancelRate)} · 파트너 귀책 취소율 ${pct(stats.netCancelRate)} · 평균 응답(업무시간) ${min(stats.avgBusinessResponseMinutes)} · 중앙값 ${min(stats.medianBusinessResponseMinutes)} · 대화방 ${stats.channelCount}개`,
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${partnerNameSafe} 파트너 분석 리포트</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f7; padding: 40px 20px; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 26px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .meta-products { font-size: 13px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #888; margin-bottom: 28px; }
  .cards { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
  .card { border-radius: 12px; padding: 20px 14px; text-align: center; }
  .card .val { font-size: 28px; font-weight: 700; color: white; }
  .card .lbl { font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 4px; }
  .sections { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; align-items: start; }
  .section { background: white; border-radius: 12px; padding: 20px; }
  .section-title { font-size: 14px; font-weight: 700; color: #111; margin-bottom: 14px; }
  .row { display: grid; grid-template-columns: 1fr auto 28px; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; min-height: 36px; gap: 10px; }
  .row:last-child { border-bottom: none; }
  .row-label { color: #555; }
  .row-value { font-weight: 600; color: #111; text-align: right; }
  .row-status { font-size: 13px; text-align: center; }
  .cancel-section { background: white; border-radius: 12px; padding: 20px; margin-bottom: 14px; display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
  .cancel-item { text-align: center; padding: 14px 8px; background: #f9f9fb; border-radius: 10px; }
  .cancel-item .c-val { font-size: 24px; font-weight: 700; color: #111; }
  .cancel-item .c-lbl { font-size: 12px; color: #888; margin-top: 4px; }
  .data-note { background: #f9f9fb; border-radius: 12px; padding: 18px; margin-bottom: 14px; }
  .data-note-body { font-size: 13px; color: #777; line-height: 1.7; }
  .cc-card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; border: 1.5px solid #e8e0f8; }
  .cc-title { font-size: 16px; font-weight: 700; color: #6e40c9; margin-bottom: 14px; }
  .cc-step { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; font-size: 14px; color: #444; line-height: 1.5; }
  .cc-num { background: #6e40c9; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .cc-code { background: #f0f0f5; border-radius: 4px; padding: 2px 8px; font-family: monospace; font-size: 13px; }
  .cc-btn { display: block; width: 100%; background: #6e40c9; color: white; border: none; border-radius: 10px; padding: 14px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 16px; }
  .cc-btn:hover { background: #5a32a3; }
  .cc-hint { font-size: 12px; color: #999; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${partnerNameSafe} <span style="font-size:13px;font-weight:400;color:#888;">${period.userId}</span></h1>
  <div class="meta-products">${productLine}</div>
  <div class="meta">분석 기간: ${period.label} &nbsp;|&nbsp; 대화방 ${stats.channelCount}개 &nbsp;|&nbsp; ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 생성</div>

  <div class="cards">
    <div class="card" style="background:#0071e3;">
      <div class="val">${pct(stats.confirmRate)}</div><div class="lbl">확정률</div>
    </div>
    <div class="card" style="background:${(stats.netCancelRate ?? 0) > 5 ? '#ff3b30' : '#34c759'};">
      <div class="val">${pct(stats.netCancelRate)}</div><div class="lbl">취소율 (파트너)</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:2px;">전체 ${pct(stats.cancelRate)}</div>
    </div>
    <div class="card" style="background:${(stats.avgBusinessResponseMinutes ?? 0) > 120 ? '#ff9500' : '#34c759'};">
      <div class="val">${min(stats.avgBusinessResponseMinutes)}</div><div class="lbl">평균 응답 (업무)</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.7);margin-top:2px;">중앙값 ${min(stats.medianBusinessResponseMinutes)}</div>
    </div>
    <div class="card" style="background:${stats.unanswered > 0 ? '#ff9500' : '#34c759'};">
      <div class="val">${stats.unanswered}건</div><div class="lbl">미답변</div>
    </div>
  </div>

  <div class="sections">
    <div class="section">
      <div class="section-title">📋 신뢰도 체크</div>
      <div class="row"><span class="row-label">확정률</span><span class="row-value">${pct(stats.confirmRate)}</span><span class="row-status">${stats.confirmRate == null ? '–' : statusIcon(stats.confirmRate >= 90, stats.confirmRate < 90)}</span></div>
      <div class="row"><span class="row-label">파트너 귀책 취소율</span><span class="row-value">${pct(stats.netCancelRate)} <span style="font-size:10px;color:#999;">(${stats.netCancel}건)</span></span><span class="row-status">${statusIcon(stats.netCancelRate === 0, (stats.netCancelRate ?? 0) > 5)}</span></div>
      <div class="row"><span class="row-label">파트너 경유 취소</span><span class="row-value">${stats.partnerCancel}건</span><span class="row-status">${statusIcon(stats.partnerCancel === 0, stats.partnerCancel > 0)}</span></div>
      <div class="row"><span class="row-label">확정 후 취소</span><span class="row-value">${stats.postConfirmCancel}건</span><span class="row-status">${statusIcon(stats.postConfirmCancel === 0, stats.postConfirmCancel > 0)}</span></div>
      <div class="row"><span class="row-label">미답변 대화방</span><span class="row-value">${stats.unanswered}건</span><span class="row-status">${statusIcon(stats.unanswered === 0, stats.unanswered > 0)}</span></div>
    </div>
    <div class="section">
      <div class="section-title">💬 고객 응대 품질</div>
      <div class="row"><span class="row-label">평균 응답 (업무시간)</span><span class="row-value">${min(stats.avgBusinessResponseMinutes)}</span><span class="row-status">${stats.avgBusinessResponseMinutes == null ? '–' : statusIcon(stats.avgBusinessResponseMinutes <= 60, stats.avgBusinessResponseMinutes > 60)}</span></div>
      <div class="row"><span class="row-label">응답 중앙값</span><span class="row-value">${min(stats.medianBusinessResponseMinutes)}</span><span class="row-status">${stats.medianBusinessResponseMinutes == null ? '–' : statusIcon(stats.medianBusinessResponseMinutes <= 30, stats.medianBusinessResponseMinutes > 30)}</span></div>
      <div class="row"><span class="row-label">응답률</span><span class="row-value">${pct(stats.responseRate)}</span><span class="row-status">${stats.responseRate == null ? '–' : statusIcon(stats.responseRate >= 90, stats.responseRate < 90)}</span></div>
      <div class="row"><span class="row-label">사전 안내 발송</span><span class="row-value">${stats.preNotice}건</span><span class="row-status">📨</span></div>
      <div class="row"><span class="row-label">무시된 질문</span><span class="row-value">${stats.ignoredQuestions}건 (${stats.customerQuestions ? Math.round(stats.ignoredQuestions / stats.customerQuestions * 100) : 0}%)</span><span class="row-status">${statusIcon(stats.ignoredQuestions === 0, stats.ignoredQuestions > 0)}</span></div>
    </div>
  </div>

  <div class="section" style="margin-bottom:12px;">
    <div class="section-title">📊 취소 분석 <span style="font-size:9px;font-weight:400;color:#999;">(총 ${stats.cancel}건 · 전체 취소율 ${pct(stats.cancelRate)})</span></div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:4px;">
      <div style="text-align:center;padding:12px 8px;background:#f0faf0;border-radius:8px;border:1px solid #c8e6c9;">
        <div style="font-size:18px;font-weight:700;color:#2e7d32;">${stats.customerCancel}건</div>
        <div style="font-size:9px;color:#666;margin-top:3px;">고객 사유 취소</div>
        <div style="font-size:8px;color:#999;margin-top:2px;">파트너 귀책 아님</div>
      </div>
      <div style="text-align:center;padding:12px 8px;background:${stats.netCancel > 0 ? '#fff5f5' : '#f9f9fb'};border-radius:8px;border:1px solid ${stats.netCancel > 0 ? '#ffcdd2' : '#eee'};">
        <div style="font-size:18px;font-weight:700;color:${stats.netCancel > 0 ? '#ff3b30' : '#111'};">${stats.netCancel}건</div>
        <div style="font-size:9px;color:#666;margin-top:3px;">파트너 귀책 취소</div>
        <div style="font-size:8px;color:#999;margin-top:2px;">파트너 ${stats.partnerCancel} · 미분류 ${stats.otherCancel}</div>
      </div>
    </div>
    <div style="margin-top:8px;padding:8px 12px;background:#f5f5fa;border-radius:6px;font-size:10px;color:#666;line-height:1.5;">
      💡 <strong>파트너 귀책 취소율 ${pct(stats.netCancelRate)}</strong> — 고객 자발 취소(${stats.customerCancel}건)를 제외한 취소율입니다.<br>
      "파트너 경유 취소"(${stats.partnerCancel}건)는 시스템 라벨이며, 실제로는 고객 동의 하 정리 취소일 수 있어 대화 확인이 필요합니다.
    </div>
    ${(stats.weatherCancel || stats.minPartyCancel || stats.platformCancel) ? `
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
      ${stats.weatherCancel ? `<span style="background:#e3f2fd;color:#1565c0;font-size:9px;padding:3px 8px;border-radius:4px;">🌧 기상 ${stats.weatherCancel}건</span>` : ''}
      ${stats.minPartyCancel ? `<span style="background:#fff3e0;color:#e65100;font-size:9px;padding:3px 8px;border-radius:4px;">👥 최소인원 미달 ${stats.minPartyCancel}건</span>` : ''}
      ${stats.platformCancel ? `<span style="background:#f3e5f5;color:#7b1fa2;font-size:9px;padding:3px 8px;border-radius:4px;">🏢 플랫폼 ${stats.platformCancel}건</span>` : ''}
    </div>` : ''}
    ${stats.postConfirmCancel > 0 ? `<div style="margin-top:8px;padding:8px 12px;background:#fff8e6;border-radius:6px;font-size:10px;color:#7a5200;">⚠️ 이 중 <strong>${stats.postConfirmCancel}건</strong>은 확정 후 취소 (사유 무관 별도 집계)</div>` : ''}
    <div style="margin-top:8px;font-size:9px;color:#bbb;">취소사유 키워드 매칭 기반 — 정확도 중간. 실제 대화 확인 권장.</div>
  </div>

  <div class="data-note">
    <div class="data-note-body">대화방 ${stats.channelCount}개 분석 · 예약 발생 ${stats.total}건 (확정 ${stats.confirm} / 취소 ${stats.cancel} / 대기 ${stats.waitConfirm})${stats.channelCount - stats.total > 0 ? ` · 단순 문의 ${stats.channelCount - stats.total}건` : ''}<br>응답시간: 업무시간(UTC+${period.utcOffset ?? 9} ${String(period.businessStart ?? 9).padStart(2,'0')}:00–${String(period.businessEnd ?? 21).padStart(2,'0')}:00) 기준 · 비업무 시간 메시지는 다음 업무 시작부터 카운트</div>
    ${(stats._warnings || []).map(w => `<div style="color:#e65100;font-size:10px;margin-top:6px;">⚠️ ${w}</div>`).join('')}
  </div>

  <div class="cc-card">
    <div class="cc-title">🤖 Claude Code로 대화 뉘앙스 분석하기</div>
    <div class="cc-step"><div class="cc-num">1</div><div>이 리포트와 함께 다운로드된 <span class="cc-code">sendbird-${period.userId}-${period.periodTag}-${reportDate}.md</span> 확인</div></div>
    <div class="cc-step"><div class="cc-num">2</div><div>터미널에서 <span class="cc-code">claude</span> 실행</div></div>
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
  }).catch(() => {
    const btn = document.querySelector('.cc-btn');
    btn.textContent = '⚠️ 복사 실패 — 직접 선택해서 복사해주세요';
    setTimeout(() => { btn.textContent = '📋 분석 프롬프트 복사'; }, 4000);
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
    channels.push(...batch);
    token = data.next || '';
  } while (token);

  // 기간 필터: last_message.created_at 기준 (정렬 순서에 의존하지 않고 전체 순회 후 필터)
  return sinceMs
    ? channels.filter(ch => (ch.last_message?.created_at || 0) >= sinceMs)
    : channels;
}

// 채널 내 전체 메시지 수집 (ADMM 포함)
// returns: message objects array (oldest first)
async function fetchMessages(appId, channelUrl) {
  const BASE = 'https://gate.sendbird.com/platform/v3';
  const H = { 'app-id': appId, 'accept': 'application/json' };
  const messages = [];
  let messageTs = Date.now();
  let prevTs = null;
  const MAX_PAGES = 50; // 최대 10,000 메시지 (200 × 50)

  for (let page = 0; page < MAX_PAGES; page++) {
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
    if (!res.ok) {
      console.warn(`[analyzer] 메시지 수집 중단 (HTTP ${res.status}) — ${messages.length}개 수집됨`);
      break;
    }
    const data = await res.json();
    const batch = data.messages || [];
    if (!batch.length) break;
    messages.unshift(...batch);
    const nextTs = batch[0].created_at;
    if (!Number.isFinite(nextTs)) break; // created_at 없거나 NaN이면 중단
    messageTs = nextTs - 1;
    // 타임스탬프가 전진하지 않으면 무한루프 방지
    if (prevTs !== null && messageTs >= prevTs) break;
    prevTs = messageTs;
    if (batch.length < 200) break;
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
  // 반투명 배경 + 중앙 카드
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.4);';
  document.body.appendChild(backdrop);
  panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:white;border-radius:16px;padding:28px 32px;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:-apple-system,sans-serif;width:340px;';
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
      if (msg) {
        // 메시지가 있으면 패널에 표시하고 5초 후 자동 제거
        funEl.textContent = '';
        panel.querySelector('#_ap_status').textContent = msg;
        panel.querySelector('#_ap_bar').style.width = '100%';
        panel.querySelector('#_ap_bar').style.background = '#34c759';
        setTimeout(() => { panel.remove(); backdrop.remove(); }, 5000);
      } else {
        // 메시지 없으면 패널만 제거, backdrop 유지 (완료 오버레이가 사용)
        panel.remove();
      }
    },
    backdrop,
    error(msg) {
      clearInterval(funTimer);
      funEl.textContent = '😢 이런...';
      funEl.style.fontStyle = 'normal';
      panel.querySelector('#_ap_bar').style.background = '#ff3b30';
      panel.querySelector('#_ap_status').textContent = '❌ ' + msg;
      // 닫기 버튼 + 15초 후 자동 제거
      const closeBtn = document.createElement('div');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;cursor:pointer;font-size:14px;color:#999;';
      closeBtn.onclick = () => { panel.remove(); backdrop.remove(); };
      panel.appendChild(closeBtn);
      setTimeout(() => { if (panel.parentNode) panel.remove(); if (backdrop.parentNode) backdrop.remove(); }, 15000);
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
  let md = `# Sendbird 대화이력 — ${userId}\n> 추출: ${dt(Date.now())}\n> 대화방: ${channels.length}개\n\n---\n\n`;
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const mb = (ch.members || []).map(m => (m.nickname || m.user_id) + '(' + m.user_id + ')').join(', ');
    md += `## ${i + 1}. ${ch.name || '(이름없음)'}\n- **채널**: \`${ch.channel_url}\`\n- **참여자**: ${mb}\n\n### 대화\n\n`;
    if (!ch.messages.length) {
      md += '_메시지 없음_\n';
    } else {
      for (const m of ch.messages) {
        if (m.type === 'ADMM') {
          // parseAdmm 재활용 — 파싱 로직 중복 방지
          const parsed = parseAdmm(m);
          if (parsed) {
            const label = statusLabels[parsed.status] || ('예약 상태: ' + parsed.status);
            let line = `**[${label}]** \`${dt(m.created_at)}\``;
            if (parsed.reservationNo) line += ' · 예약번호: ' + parsed.reservationNo;
            if (parsed.travelDate) line += ' · 출발일: ' + parsed.travelDate;
            if (parsed.cancelReason) line += ' · 취소사유: ' + parsed.cancelReason;
            md += line + '\n\n';
          }
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
// opts: { utcOffset, businessStart, businessEnd } — 파트너 시간대/업무시간 설정
async function runAnalyzer(appId, userId, monthsBack, opts = {}) {
  if (window._analyzerRunning) {
    alert('현재 분석이 진행 중이에요. 완료 후 다시 시도해주세요.');
    return;
  }
  window._analyzerRunning = true;

  const sinceMs = monthsBack ? Date.now() - monthsBack * 30 * 24 * 3600 * 1000 : 0;
  window._analyzerUserId = userId;

  const panel = createProgressPanel();

  try {
    panel.update('대화방 목록 조회 중...', 5);
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
      panel.done(`⚠️ "${userId}"의 대화방이 없어요. User ID를 다시 확인해주세요.`);
      return;
    }
    panel.update(`대화방 ${rawChannels.length}개 발견 — 메시지 수집 중...`, 10);

    const channels = [];
    let truncatedChannels = 0;
    for (let i = 0; i < rawChannels.length; i++) {
      const ch = rawChannels[i];
      const shortUrl = ch.channel_url ? ch.channel_url.slice(-12) : String(i);
      panel.update(`[${i + 1}/${rawChannels.length}] ${ch.name || shortUrl}`, 10 + (i / rawChannels.length) * 80);
      const messages = await fetchMessages(appId, ch.channel_url);
      // 메시지 수가 10,000개(MAX_PAGES × 200) 한도에 도달했으면 잘린 것
      if (messages.length >= 10000) truncatedChannels++;
      const admmEvents = messages.filter(m => m.type === 'ADMM').map(parseAdmm).filter(Boolean);
      channels.push({ ...ch, messages, admmEvents });
    }

    panel.update('분석 중...', 92);
    const periodTag = monthsBack ? `${monthsBack}m` : 'all';
    const period = {
      userId,
      label: monthsBack ? `최근 ${monthsBack}개월` : '전체',
      periodTag,
      utcOffset: opts.utcOffset ?? 9,
      businessStart: opts.businessStart ?? 9,
      businessEnd: opts.businessEnd ?? 21,
    };
    const stats = aggregateStats(channels, userId, opts);
    if (truncatedChannels > 0) {
      stats._warnings = stats._warnings || [];
      stats._warnings.push(`${truncatedChannels}개 대화방에서 메시지가 10,000개 한도로 잘렸어요. 오래된 메시지가 누락될 수 있습니다.`);
    }
    const html = renderReport(stats, period);

    panel.update('리포트 생성 중...', 95);
    const today = new Date().toISOString().slice(0, 10);
    const reportFile = `sendbird-report-${userId}-${periodTag}-${today}.html`;
    const mdFile = `sendbird-${userId}-${periodTag}-${today}.md`;

    let mdContent;
    try { mdContent = generateMd(channels, userId); } catch (e) {
      console.warn('[analyzer] MD 생성 실패, 리포트만 다운로드:', e);
      mdContent = null;
    }

    const reportBlob = new Blob([html], { type: 'text/html' });
    const reportBlobUrl = URL.createObjectURL(reportBlob);
    const mdBlobUrl = mdContent ? URL.createObjectURL(new Blob([mdContent], { type: 'text/markdown' })) : null;

    // 다운로드
    panel.update('다운로드 중...', 98);
    const dlFile = (url, filename) => {
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };
    dlFile(reportBlobUrl, reportFile);
    if (mdContent) {
      await new Promise(r => setTimeout(r, 500));
      dlFile(mdBlobUrl, mdFile);
    }

    // 완료 오버레이 — 새 엘리먼트로 생성
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
    const mdNote = mdContent
      ? `<div style="font-size:13px;color:#6e40c9;line-height:1.6;margin-bottom:8px;">📝 대화 원문: 다운로드 폴더의 <strong>${esc(mdFile)}</strong></div>`
      : '';
    overlay.innerHTML = `<div style="background:white;border-radius:20px;padding:40px 48px;max-width:500px;text-align:center;font-family:-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:48px;margin-bottom:12px;">✅</div>
      <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:20px;">${esc(stats.partnerName)} 분석 완료</div>
      <div style="text-align:left;background:#f5f5f7;border-radius:12px;padding:18px 20px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;font-size:15px;color:#333;padding:6px 0;"><span>확정률</span><strong>${stats.confirmRate != null ? stats.confirmRate + '%' : 'N/A'}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;color:#333;padding:6px 0;border-top:1px solid #e8e8e8;"><span>취소율</span><strong>${stats.cancelRate != null ? stats.cancelRate + '%' : 'N/A'}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;color:#333;padding:6px 0;border-top:1px solid #e8e8e8;"><span>응답률</span><strong>${stats.responseRate != null ? stats.responseRate + '%' : 'N/A'}</strong></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;color:#333;padding:6px 0;border-top:1px solid #e8e8e8;"><span>대화방</span><strong>${stats.channelCount}개</strong></div>
      </div>
      <div style="margin-bottom:16px;">
        <a href="${reportBlobUrl}" target="_blank" style="display:block;background:#0071e3;color:white;text-decoration:none;border-radius:10px;padding:14px;font-size:15px;font-weight:600;text-align:center;">📄 리포트 열기</a>
      </div>
      ${mdNote}
      <div style="font-size:13px;color:#34c759;line-height:1.6;margin-bottom:8px;">✓ ${mdContent ? '두 파일 모두' : '리포트가'} 브라우저 다운로드 폴더에 저장됨</div>
      <div style="font-size:13px;color:#999;line-height:1.6;margin-bottom:18px;">리포트는 새 탭에서 열려요${mdContent ? ' · MD는 Claude Code 분석용' : ''}</div>
      <button id="_analyzer_close" style="background:#f0f0f5;color:#333;border:none;border-radius:10px;padding:12px 36px;font-size:15px;font-weight:600;cursor:pointer;">닫기</button>
    </div>`;

    // 진행 패널 + backdrop 제거 후 오버레이 표시
    panel.done();
    panel.backdrop.remove();
    document.body.appendChild(overlay);
    overlay.querySelector('#_analyzer_close').addEventListener('click', () => overlay.remove());
    // 배경(overlay 자체) 클릭 시만 전파 차단 — 내부 버튼은 정상 동작
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) e.stopPropagation();
    }, true);
  } catch (err) {
    console.error('[analyzer]', err);
    panel.error(err.message || '알 수 없는 오류');
  } finally {
    window._analyzerRunning = false;
  }
}
