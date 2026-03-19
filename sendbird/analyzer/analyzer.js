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
