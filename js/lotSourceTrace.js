/* ══════════════════════════════════════════════════════════════════════════
   lotSourceTrace.js — 원료 역추적(INT-a 확장) 통합 조회·태깅 화면 (2026-09-27, 대형 로드맵 라운드6-B)
   HC/HD/HE/HF 4개 파일럿의 Lot에 "이 Lot은 다른 파일럿의 어떤 전표에서 비롯됐다"를
   태깅하고, 태깅된 출처 + 파일럿 경계를 넘는 전체 체인(INT-a int_trace_doc)을 조회한다.
   서버 쪽은 inthub/round6_3way_inta_c3_migration.sql. 근거: claude/모듈_라운드6_구매3way_원료역추적_C3.md

   ⚠️ 이 화면은 특정 파일럿에 종속되지 않는 "파일럿 4개를 가로지르는" 화면이라
   독립 페이지(HJ-원료역추적.html)로 만들었다 — 자세한 설계 판단은 프로젝트 문서 참고.
   각 파일럿의 로컬 Lot 이력(공정·이동 상세)은 이미 각 파일럿의 "재고관리" 탭에
   있으므로 이 화면에서 다시 그리지 않고, "이 Lot의 출처 태깅"과 "파일럿을 넘는
   체인 조회" 두 가지에만 집중한다.

   사용법:
     <script src="./js/lotSourceTrace.js"></script>
     LotSourceTrace.init({ sb, username: myUsername, pw: myPw, isAdmin });
     탭 전환 시: el.innerHTML = '<div id="lstRoot"></div>'; LotSourceTrace.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const MODULES = [['HC', '유통'], ['HD', '보세창고'], ['HE', '무역'], ['HF', '식품제조']];
    const PREFIX = { HC: 'p3', HD: 'p4', HE: 'p5', HF: 'p6' };
    const ALL_MODULES = ['HA', 'HB', 'HC', 'HD', 'HE', 'HF', 'HG', 'HH'];
    const MODULE_LABEL = { HA: 'HA 기준정보', HB: 'HB 회계', HC: 'HC 유통', HD: 'HD 보세창고', HE: 'HE 무역', HF: 'HF 식품제조', HG: 'HG 콜드체인', HH: 'HH 차량GPS' };

    const S = {
        cfg: null, module: 'HC', searchQuery: '', searchResults: [], lotId: '', trace: null, msg: null,
        f: { srcModule: 'HE', srcDocType: '', srcDocId: '', srcNote: '' },
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function root() { return document.getElementById('lstRoot'); }
    function setMsg(text, ok) { S.msg = text ? { text, ok: !!ok } : null; }
    function v(id) { const e = document.getElementById(id); return e ? e.value : ''; }
    function prefix() { return PREFIX[S.module]; }

    async function call(fn, args) {
        const c = S.cfg;
        if (!c.sb) throw new Error('Supabase 연결이 설정되지 않았습니다');
        const { data, error } = await c.sb.rpc(fn, args || {});
        if (error) throw new Error(error.message || String(error));
        return data;
    }
    async function adminCall(fn, args) {
        const c = S.cfg;
        if (!c.sb) throw new Error('Supabase 연결이 설정되지 않았습니다');
        const { data, error } = await c.sb.rpc(fn, Object.assign({ p_admin_username: c.username, p_admin_password: c.pw }, args || {}));
        if (error) throw new Error(error.message || String(error));
        return data;
    }

    async function doSearch() {
        S.searchResults = S.searchQuery ? (await call(`${prefix()}_search_lots`, { p_query: S.searchQuery }) || []) : [];
    }
    async function loadTrace() {
        S.trace = S.lotId ? await call('int_get_cross_pilot_lot_trace', { p_username: S.cfg.username, p_password: S.cfg.pw, p_module: S.module, p_lot_id: S.lotId }) : null;
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">오류: ${esc(e.message)}</div></div>`;
        }
    }

    function moduleTabsHTML() {
        return `<div class="so-subtabs">${MODULES.map(([k, l]) => `<button type="button" class="so-subtab ${S.module === k ? 'active' : ''}" data-act="pick-module" data-k="${k}">${k} ${l}</button>`).join('')}</div>`;
    }
    function searchHTML() {
        const rows = S.searchResults.length ? S.searchResults.map(r => `<tr class="${r.id === S.lotId ? 'so-open' : ''}">
            <td>${esc(r.lot_no)}</td><td>${esc(r.item_name || '-')}</td>
            <td class="row-actions"><button type="button" class="btn btn-secondary btn-small" data-act="select-lot" data-id="${esc(r.id)}">선택</button></td>
        </tr>`).join('') : '<tr><td colspan="3" class="empty-state">검색 결과가 없습니다(Lot 번호로 검색)</td></tr>';
        return `<div class="card">
            <div class="card-title">${MODULE_LABEL[S.module]} — Lot 검색</div>
            <div style="display:flex;gap:8px;">
                <input id="lstQuery" class="form-input" style="width:auto;flex:1;" placeholder="Lot 번호로 검색" value="${esc(S.searchQuery)}">
                <button type="button" class="btn btn-primary" data-act="search">검색</button>
            </div>
            <div class="table-responsive" style="margin-top:12px;"><table>
                <thead><tr><th>Lot 번호</th><th>품목</th><th>동작</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
        </div>`;
    }
    function traceHTML() {
        if (!S.lotId) return '';
        if (!S.trace) return '<div class="card"><div class="empty-state">이 Lot의 역추적 정보를 불러오지 못했습니다.</div></div>';
        const t = S.trace;
        const src = t.source_ref || {};
        const chain = t.cross_pilot_chain || [];
        const chainRows = chain.length ? chain.map(c => `<tr>
            <td class="num">${c.depth}</td><td>${esc(c.direction)}</td><td>${MODULE_LABEL[c.module] || esc(c.module)}</td>
            <td>${esc(c.doc_type)}</td><td>${esc(c.doc_id)}</td><td>${esc(c.link_type)}</td><td>${esc(c.note || '-')}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty-state">연결된 체인이 없습니다(이 Lot에 출처 태깅이 없거나, 이 Lot을 출처로 참조하는 다른 파일럿 태깅도 없음)</td></tr>';
        return `
            <div class="card">
                <div class="card-title">이 Lot의 출처(source_ref)</div>
                ${src.source_ref_module ? `<p class="so-help">현재 태깅: <b>${MODULE_LABEL[src.source_ref_module] || esc(src.source_ref_module)}</b> · ${esc(src.source_ref_doc_type)} · ${esc(src.source_ref_doc_id)}</p>` : '<p class="so-help">아직 출처가 태깅되지 않았습니다.</p>'}
                <div class="form-grid">
                    <div><label class="form-label">출처 모듈</label><select id="lstSrcModule" class="form-select">
                        ${ALL_MODULES.map(m => `<option value="${m}" ${S.f.srcModule === m ? 'selected' : ''}>${MODULE_LABEL[m]}</option>`).join('')}
                    </select></div>
                    <div><label class="form-label">출처 전표 종류</label><input id="lstSrcDocType" class="form-input" value="${esc(S.f.srcDocType)}" placeholder="예: import_doc, sales_doc"></div>
                    <div><label class="form-label">출처 전표번호</label><input id="lstSrcDocId" class="form-input" value="${esc(S.f.srcDocId)}" placeholder="전표번호 또는 ID"></div>
                    <div class="full"><label class="form-label">비고</label><input id="lstSrcNote" class="form-input" value="${esc(S.f.srcNote)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="tag-source">출처 태깅 저장</button></div>
            </div>
            <div class="card">
                <div class="card-title">파일럿 경계를 넘는 전체 체인 (int_trace_doc, 양방향)</div>
                <div class="table-responsive"><table>
                    <thead><tr><th>깊이</th><th>방향</th><th>모듈</th><th>전표유형</th><th>전표번호</th><th>연결유형</th><th>비고</th></tr></thead>
                    <tbody>${chainRows}</tbody>
                </table></div>
                <p class="so-help">이 Lot 자체의 상세 이력(공정·이동)은 각 파일럿의 "재고관리" 탭에서 확인하세요 — 이 화면은 파일럿을 넘는 연결만 보여줍니다.</p>
            </div>`;
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        el.innerHTML = `<div class="note-card">HC/HD/HE/HF 4개 파일럿의 Lot에 "이 Lot은 다른 파일럿의 어떤 전표에서 비롯됐다"를 태깅하고, 태깅된 출처 + 파일럿 경계를 넘는 전체 체인을 조회합니다. 실제로 어느 Lot에 태깅할지는 재호의 실제 물류 흐름을 확인한 뒤 결정하는 커스터마이징 영역입니다.</div>${moduleTabsHTML()}${msgHtml}${searchHTML()}${traceHTML()}`;
    }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        const act = b.dataset.act, id = b.dataset.id;

        if (act === 'pick-module') { S.module = b.dataset.k; S.searchResults = []; S.searchQuery = ''; S.lotId = ''; S.trace = null; setMsg(null); draw(); return; }
        if (act === 'search') {
            S.searchQuery = v('lstQuery');
            try { await doSearch(); } catch (e) { setMsg('검색 오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'select-lot') {
            S.lotId = id;
            try { await loadTrace(); } catch (e) { setMsg('조회 오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'tag-source') {
            const srcModule = v('lstSrcModule'), srcDocType = v('lstSrcDocType'), srcDocId = v('lstSrcDocId'), note = v('lstSrcNote');
            if (!srcDocType || !srcDocId) { setMsg('출처 전표 종류·번호를 입력하세요', false); draw(); return; }
            try {
                const r = await adminCall(`${prefix()}_admin_set_lot_source_ref`, { p_lot_id: S.lotId, p_source_module: srcModule, p_source_doc_type: srcDocType, p_source_doc_id: srcDocId, p_note: note || null });
                if (r && r.success === false) { setMsg(r.message || '태깅 실패', false); }
                else { setMsg('출처를 태깅했습니다', true); S.f.srcDocType = ''; S.f.srcDocId = ''; S.f.srcNote = ''; await loadTrace(); }
            } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
    }

    const CSS = `
        #lstRoot .so-subtabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
        #lstRoot .so-subtab{border:1px solid var(--border);background:#fff;color:var(--text-secondary);border-radius:18px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
        #lstRoot .so-subtab.active{background:var(--primary);border-color:var(--primary);color:#fff}
        #lstRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:6px 0 4px}
        #lstRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #lstRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #lstRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}
        #lstRoot .so-open{background:var(--info-soft)}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('lstStyle')) {
            const st = document.createElement('style'); st.id = 'lstStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) { document.addEventListener('click', onClick); S._bound = true; }
    }

    global.LotSourceTrace = { init, render };
})(window);
