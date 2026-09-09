/* ══════════════════════════════════════════════
   supabaseClient.js
   Supabase 프로젝트 연결 설정 — 이 파일 한 곳만 수정하면
   index.html / menu.html / users.html 전체에 반영됩니다.
══════════════════════════════════════════════ */

// ⬇️ Supabase 대시보드 → Project Settings → API 에서 복사해서 아래 두 값만 채우세요.
const SUPABASE_URL = 'https://plkhnbasurjxnquqtptf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsa2huYmFzdXJqeG5xdXF0cHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MDQ4NDEsImV4cCI6MjEwNDQ4MDg0MX0.z73M94n-smg7Z_V-F8rOjPQjgLsLvh8IX7gFL7W-uow';

let _sb = null;
function getSupabase() {
  if (SUPABASE_URL.includes('YOUR-PROJECT-ID')) {
    return null; // 아직 설정 전
  }
  if (!_sb) {
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
}

/* 설정 안 됐을 때 화면에 안내 배너를 띄우는 공통 함수 */
function showSupabaseNotConfigured(containerEl) {
  const div = document.createElement('div');
  div.style.cssText = 'max-width:520px;margin:40px auto;padding:16px 20px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:13px;line-height:1.6;';
  div.innerHTML = '⚠️ Supabase 연결이 아직 설정되지 않았습니다.<br>' +
    '<code>js/supabaseClient.js</code> 파일을 열어 <b>SUPABASE_URL</b>과 <b>SUPABASE_ANON_KEY</b> 값을 ' +
    'Supabase 프로젝트 값으로 채워주세요.';
  containerEl.appendChild(div);
}
