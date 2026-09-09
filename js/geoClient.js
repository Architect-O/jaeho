/* ══════════════════════════════════════════════
   geoClient.js
   로그인/가입 시 감사기록(IP·기기·브라우저·국가)에 쓰이는 정보 수집 헬퍼.
   ⚠️ 국가값은 클라이언트가 외부 API로 조회해 서버에 "보고"하는 방식입니다.
      진짜 강력한 보안 차단이 아니라 내부 팀 도구 수준의 억제책입니다.
══════════════════════════════════════════════ */

/* IP와 국가코드를 무료 조회 서비스(ipapi.co)에서 가져옵니다.
   실패해도 로그인 자체는 계속 진행되도록 null을 반환합니다. */
async function fetchGeoInfo() {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (!res.ok) return { ip: null, country: null };
    const data = await res.json();
    return { ip: data.ip || null, country: data.country_code || null };
  } catch (e) {
    console.warn('위치정보 조회 실패 (로그인은 계속 진행됩니다):', e);
    return { ip: null, country: null };
  }
}

/* navigator.userAgent에서 간단히 기기/브라우저 이름을 뽑아냅니다 (완벽하지 않은 근사치). */
function detectDeviceAndBrowser() {
  const ua = navigator.userAgent;
  let device = 'Desktop';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
  else if (/Macintosh/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows PC';
  else if (/Linux/i.test(ua)) device = 'Linux PC';

  let browser = 'Unknown';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/OPR\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/OPR\//i.test(ua)) browser = 'Opera';

  return { device, browser };
}

/* 로그인/가입 시점에 필요한 메타데이터를 한 번에 모아 반환 */
async function collectLoginMeta() {
  const geo = await fetchGeoInfo();
  const { device, browser } = detectDeviceAndBrowser();
  return { ip: geo.ip, country: geo.country, device, browser };
}
