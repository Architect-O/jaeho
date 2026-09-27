/* ══════════════════════════════════════════════════════════════════════════
   coldChainHold.js — HG(콜드체인) "Lot 보류 제안(C-3)" 탭 (2026-09-27, 대형 로드맵 라운드6-C)
   critical 온도 이탈이 감지되면 그 세션의 pilot_code/doc_ref로 실제 생성된 후보 Lot들을
   보여주고, 담당자가 검토 후 명시적으로 "적용"해야만 실제 보류가 실행된다(자동 실행 아님).
   서버 쪽은 inthub/round6_3way_inta_c3_migration.sql. 근거: claude/모듈_라운드6_구매3way_원료역추적_C3.md

   사용법:
     <script src="./js/coldChainHold.js"></script>
     ColdChainHold.init({ sb, username: myUsername, pw: myPw, isAdmin, onChange: loadAll });
     탭 전환 시: el.innerHTML = '<div id="ccHoldRoot"></div>'; ColdChainHold.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const PILOT_LABEL = { HC: 'HC 유통', HD: 'HD 보세창고', HE: 'HE 무역', HF: 'HF 식품제조' };
    const STATUS_LABEL = { pending: ['badge-warn', '대기(검토 필요)'], applied: ['badge-ok', '적용됨'], dismissed: ['badge-dim', '기각됨'] };

    const S = { cfg: null, status: 'pending', suggestions: [], selectedIds: {}, msg: null };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function num(n) { if (n == null || n === '') return '-'; const v = Number(n); return isNaN(v) ? '-' : v.toLocaleString('ko-KR'); }
    function dt(iso) {
        if (!iso) return '-';
        const d = new Date(iso); if (isNaN(d)) return esc(iso);
        const p = x => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function root() { return document.getElementById('ccHoldRoot'); }
    function setMsg(text, ok) { S.msg = text ? { text, ok: !!ok } : null; }

    async function call(fn, args, admin) {
        const c = S.cfg;
        if (!c.sb) throw new Error('Supabase 연결이 설정되지 않았습니다');
        const payload = admin ? Object.assign({ p_admin_username: c.username, p_admin_password: c.pw }, args || {}) : (args || {});
        const { data, error } = await c.sb.rpc(fn, payload);
        if (error) throw new Error(error.message || String(error));
        return data;
    }
    async function adminAction(fn, args, okText) {
        try {
            const r = await call(fn, args, true);
            if (r && r.success === false) { setMsg(r.message || '처리 실패', false); }
            else { setMsg(okText(r || {}), true); if (typeof S.cfg.onChange === 'function') { try { await S.cfg.onChange(); } catch (e) {} } }
            return r;
        } catch (e) { setMsg('오류: ' + e.message, false); return null; }
    }

    async function loadSuggestions() {
        S.suggestions = await call('cc_get_hold_suggestions', { p_status: S.status || null }) || [];
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            await loadSuggestions();
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">보류 제안 데이터를 불러오지 못했습니다: ${esc(e.message)}<br><span style="font-size:11.5px">Supabase SQL Editor에서 <code>round6_3way_inta_c3_migration.sql</code>을 먼저 실행했는지 확인하세요.</span></div></div>`;
        }
    }

    function suggestionCardHTML(s) {
        const lots = s.candidate_lots || [];
        const chosen = S.selectedIds[s.excursion_id] || {};
        const lotRows = lots.length ? lots.map(l => `<tr>
            <td>${s.lot_hold_status === 'pending' ? `<input type="checkbox" data-act="toggle-lot" data-ex="${esc(s.excursion_id)}" data-lot="${esc(l.lot_id)}" ${chosen[l.lot_id] ? 'checked' : ''}>` : ''}</td>
            <td>${esc(l.lot_no)}</td><td class="num">${num(l.qty)}</td><td class="num">${num(l.held_qty)}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="empty-state">이 전표번호(doc_ref)로 생성된 Lot을 찾지 못했습니다</td></tr>';
        return `
            <div class="card">
                <div class="card-title">
                    <span>🚨 ${dt(s.detected_at)} · ${esc(s.zone_name || s.zone_code)} · ${num(s.temp_value)}℃ (허용 ${num(s.threshold_min)}~${num(s.threshold_max)}℃)</span>
                    <span class="badge ${STATUS_LABEL[s.lot_hold_status] ? STATUS_LABEL[s.lot_hold_status][0] : 'badge-dim'}">${STATUS_LABEL[s.lot_hold_status] ? STATUS_LABEL[s.lot_hold_status][1] : (s.lot_hold_status || '-')}</span>
                </div>
                <p class="so-help">세션 ${esc(s.session_no || '-')} · 연결 파일럿: ${PILOT_LABEL[s.pilot_code] || esc(s.pilot_code) || '(미지정)'} · 참조 전표번호(doc_ref): <b>${esc(s.doc_ref || '-')}</b> · 품목: ${esc(s.item_desc || '-')}</p>
                <div class="table-responsive"><table>
                    <thead><tr><th></th><th>Lot 번호</th><th>가용수량</th><th>기보류수량</th></tr></thead>
                    <tbody>${lotRows}</tbody>
                </table></div>
                ${s.lot_hold_status === 'pending' ? `
                    <div class="form-actions">
                        <button type="button" class="btn btn-danger" data-act="apply" data-id="${esc(s.excursion_id)}">선택한 Lot 보류 적용</button>
                        <button type="button" class="btn btn-secondary" data-act="dismiss" data-id="${esc(s.excursion_id)}">오탐 — 기각</button>
                    </div>` : `<p class="so-help">${s.lot_hold_by ? `처리자: ${esc(s.lot_hold_by)} · ${dt(s.lot_hold_at)}` : ''} ${s.lot_hold_note ? '· ' + esc(s.lot_hold_note) : ''}</p>`}
            </div>`;
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        const filters = [['pending', '대기중'], ['applied', '적용됨'], ['dismissed', '기각됨'], ['', '전체']];
        const filterBar = `<div class="card"><div class="card-title">critical 이탈 → Lot 보류 제안</div>
            <p class="so-help">HG는 파일럿·전표번호를 자유텍스트(느슨한 연결)로만 참조합니다 — 아래 후보 Lot은 참고용 제안이며, <b>자동으로 보류되지 않습니다</b>. 반드시 검토 후 담당자가 직접 적용해야 합니다.</p>
            <div class="row-actions">${filters.map(([k, l]) => `<button type="button" class="btn ${S.status === k ? 'btn-primary' : 'btn-secondary'} btn-small" data-act="filter" data-k="${k}">${l}</button>`).join('')}</div>
        </div>`;
        const cards = S.suggestions.length ? S.suggestions.map(suggestionCardHTML).join('') : '<div class="card"><div class="empty-state">해당 상태의 제안이 없습니다</div></div>';
        el.innerHTML = msgHtml + filterBar + cards;
    }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        const act = b.dataset.act, id = b.dataset.id;

        if (act === 'filter') { S.status = b.dataset.k; setMsg(null); await render(); return; }

        if (act === 'apply') {
            const chosen = S.selectedIds[id] || {};
            const lotIds = Object.keys(chosen).filter(k => chosen[k]);
            if (!lotIds.length) { setMsg('보류할 Lot을 1개 이상 선택하세요', false); draw(); return; }
            if (!confirm(`선택한 ${lotIds.length}개 Lot의 가용 수량 전량을 보류 처리할까요? 이 작업은 되돌리려면 각 파일럿 재고관리 탭에서 별도로 해제해야 합니다.`)) return;
            const reason = prompt('적용 사유(선택):', 'HG 콜드체인 critical 이탈 대응') || '';
            const r = await adminAction('cc_admin_apply_hold_suggestion', { p_excursion_id: id, p_lot_ids: lotIds, p_reason: reason || null },
                r => `${r.applied_count}건 보류 적용${(r.failed || []).length ? `, 실패 ${r.failed.length}건` : ''}`);
            if (r && r.failed && r.failed.length) { setMsg(`일부 실패: ${r.failed.map(f => f.reason).join(', ')}`, false); }
            delete S.selectedIds[id];
            await render(); return;
        }
        if (act === 'dismiss') {
            const note = prompt('기각 사유(선택):', '') || '';
            await adminAction('cc_admin_dismiss_hold_suggestion', { p_excursion_id: id, p_note: note || null }, () => '기각 처리했습니다');
            await render(); return;
        }
    }
    function onChangeEv(ev) {
        const t = ev.target; if (!root() || !root().contains(t)) return;
        if (t.dataset && t.dataset.act === 'toggle-lot') {
            const ex = t.dataset.ex, lot = t.dataset.lot;
            if (!S.selectedIds[ex]) S.selectedIds[ex] = {};
            S.selectedIds[ex][lot] = t.checked;
        }
    }

    const CSS = `
        #ccHoldRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:6px 0 10px}
        #ccHoldRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #ccHoldRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #ccHoldRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('ccHoldStyle')) {
            const st = document.createElement('style'); st.id = 'ccHoldStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) {
            document.addEventListener('click', onClick);
            document.addEventListener('change', onChangeEv);
            S._bound = true;
        }
    }

    global.ColdChainHold = { init, render };
})(window);
