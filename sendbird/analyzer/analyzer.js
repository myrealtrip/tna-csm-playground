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
