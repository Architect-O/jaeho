/* ══════════════════════════════════════════════════════════════════════════
   haccp.js — HF(식품제조) "품질관리·스마트HACCP" 탭 (2026-09-27, 대형 로드맵 라운드5)
   식약처 HACCP 인증신청 서류 수준: 제품설명서·제조공정도·위해요소분석표·CCP결정표·
   CCP관리기준서·CCP모니터링/개선조치·검증기록·선행요건관리기준서(PRP) 8개영역+점검기록.
   서버 쪽은 inthub/hf_haccp_migration.sql. 근거: claude/모듈_품질관리_스마트HACCP.md

   서브탭 7개: 제품설명서(plan) / 제조공정도·위해요소(process) / CCP관리기준서(ccp) /
   모니터링·개선조치(monitoring) / 검증기록(verification) / 선행요건관리 PRP(prp) /
   인증서류 조립본(document)

   plan/process/ccp/monitoring/verification/document 6개 서브탭은 "완제품 선택 →
   Plan(버전) 선택"에 종속된다(상단 공통 선택바). prp만 완제품과 무관하게 독립.

   사용법:
     <script src="./js/haccp.js"></script>
     HACCP.init({ sb, username: myUsername, pw: myPw, isAdmin, onChange: loadAll });
     탭 전환 시: el.innerHTML = '<div id="haccpRoot"></div>'; HACCP.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const SUBS = [
        ['plan', '📋 제품설명서'],
        ['process', '🔀 제조공정도·위해요소'],
        ['ccp', '🎯 CCP 관리기준서'],
        ['monitoring', '📟 모니터링·개선조치'],
        ['verification', '✅ 검증기록'],
        ['prp', '🧹 선행요건관리(PRP)'],
        ['document', '📄 인증서류 조립본'],
    ];

    const HAZARD_LABEL = { biological: '생물학적', chemical: '화학적', physical: '물리적' };
    const RESULT_LABEL = { pass: '적합', fail: '부적합', conditional: '조건부' };
    const DISPOSITION_LABEL = { release: '출하', hold: '보류', discard: '폐기' };
    const PRP_CATEGORIES = [
        ['facility', '영업장관리'], ['hygiene', '위생관리'], ['equipment', '시설설비관리'],
        ['cold_chain', '냉장냉동관리'], ['water', '용수관리'],
        ['receiving_storage_transport', '입고보관운송관리'], ['inspection', '검사관리'], ['recall', '회수관리'],
    ];
    const PRP_LABEL = Object.fromEntries(PRP_CATEGORIES);

    const S = {
        cfg: null, sub: 'plan', msg: null,
        items: [], fgItemId: '',
        plans: [], planId: '', planDetail: null,
        expandedStepId: '', expandedHazardCcp: '',
        monCcpId: '', monLogs: [], monDeviations: [],
        prpCategory: '', prpStandards: [], prpSelectedId: '', prpChecks: [],
        document: null,
        f: {
            planName: '', planType: '', planIngredients: '', planAllergens: '', planPackaging: '',
            planShelfLife: '', planStorage: '', planDistribution: '', planIntendedUse: '', planTargetConsumer: '',
            planLabelingNote: '', planNote: '',
            stepNo: '', stepName: '', stepDesc: '',
            hazType: 'biological', hazDesc: '', hazSeverity: '2', hazLikelihood: '2', hazSignificant: false, hazControl: '',
            ccpName: '', ccpLimit: '', ccpMonMethod: '', ccpMonFreq: '', ccpMonResp: '', ccpCorrective: '',
            ccpVerMethod: '', ccpVerFreq: '', ccpRecordKeeping: '',
            monValue: '', monUnit: '', monWithin: 'true', monBy: '', monNote: '',
            devDesc: '', devAction: '', devDisposition: 'hold', devBy: '',
            verType: '', verDate: '', verifier: '', verResult: 'pass', verFindings: '', verNext: '',
            prpNewCategory: 'hygiene', prpNewName: '', prpNewContent: '', prpNewNote: '',
            checkChecker: '', checkResult: 'pass', checkDate: '', checkFindings: '', checkAction: '', checkColdRef: '',
        },
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function num(n) { if (n == null || n === '') return '-'; const v = Number(n); return isNaN(v) ? '-' : v.toLocaleString('ko-KR'); }
    function dt(iso) {
        if (!iso) return '-';
        const d = new Date(iso); if (isNaN(d)) return esc(iso);
        const p = x => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    function root() { return document.getElementById('haccpRoot'); }
    function setMsg(text, ok) { S.msg = text ? { text, ok: !!ok } : null; }
    function v(id) { const e = document.getElementById(id); return e ? e.value : ''; }
    function chk(id) { const e = document.getElementById(id); return e ? !!e.checked : false; }

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

    function fgItems() { return S.items.filter(i => (i.item_kind || 'finished') === 'finished'); }
    function activePlan() { return S.plans.find(p => p.is_active) || null; }
    function allHazards() {
        if (!S.planDetail) return [];
        const out = [];
        (S.planDetail.process_steps || []).forEach(s => (s.hazards || []).forEach(h => out.push(Object.assign({ step_no: s.step_no, step_name: s.step_name }, h))));
        return out;
    }
    function allCcps() { return allHazards().filter(h => h.ccp).map(h => Object.assign({ hazard_description: h.hazard_description, step_name: h.step_name }, h.ccp)); }

    async function loadFgItemsOnce() {
        if (!S.items.length) S.items = await call('p6_get_items') || [];
    }

    async function loadPlansFor(fgItemId) {
        S.fgItemId = fgItemId;
        S.plans = fgItemId ? (await call('hf_haccp_get_plans', { p_fg_item_id: fgItemId }) || []) : [];
        const active = activePlan();
        S.planId = active ? active.id : (S.plans[0] ? S.plans[0].id : '');
        await loadPlanDetail();
    }
    async function loadPlanDetail() {
        S.planDetail = S.planId ? await call('hf_haccp_get_plan_detail', { p_plan_id: S.planId }) : null;
        S.monCcpId = ''; S.monLogs = []; S.monDeviations = [];
        S.document = null;
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            await loadFgItemsOnce();
            if (S.sub === 'prp' && !S.prpStandards.length && !S.prpCategory) S.prpStandards = await call('hf_haccp_get_prp_standards') || [];
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">HACCP 데이터를 불러오지 못했습니다: ${esc(e.message)}<br><span style="font-size:11.5px">Supabase SQL Editor에서 <code>hf_haccp_migration.sql</code>을 먼저 실행했는지 확인하세요.</span></div></div>`;
        }
    }

    // ── 상단 공통 선택바(완제품 → Plan) — prp 서브탭 제외 ────────────────────
    function planPickerHTML() {
        const opts = ['<option value="">완제품을 선택하세요</option>'].concat(
            fgItems().map(i => `<option value="${esc(i.id)}" ${S.fgItemId === i.id ? 'selected' : ''}>${esc(i.item_code)} · ${esc(i.item_name)}</option>`)
        ).join('');
        const planOpts = S.plans.length ? S.plans.map(p => `<option value="${esc(p.id)}" ${S.planId === p.id ? 'selected' : ''}>v${p.version}${p.is_active ? ' (활성)' : ''} · ${esc(p.product_name)}</option>`).join('') : '<option value="">등록된 Plan 없음</option>';
        return `
            <div class="card">
                <div class="card-title">완제품 · HACCP Plan 선택</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <select id="hcFg" class="form-select" style="width:auto;min-width:220px;" data-act="pick-fg">${opts}</select>
                    <select id="hcPlan" class="form-select" style="width:auto;min-width:220px;" data-act="pick-plan" ${!S.plans.length ? 'disabled' : ''}>${planOpts}</select>
                    ${(S.planId && S.plans.find(p => p.id === S.planId && !p.is_active)) ? `<button type="button" class="btn btn-secondary btn-small" data-act="activate-plan">이 버전을 활성화</button>` : ''}
                </div>
                ${!S.fgItemId ? '<p class="so-help">완제품을 선택하면 이 완제품의 HACCP Plan(제품설명서) 버전들을 볼 수 있습니다.</p>' : ''}
            </div>`;
    }

    // ── 1) 제품설명서(plan) ───────────────────────────────────────────────
    function planHTML() {
        if (!S.fgItemId) return '<div class="empty-state">완제품을 먼저 선택하세요.</div>';
        const p = S.planDetail ? S.planDetail.plan : null;
        const viewCard = p ? `
            <div class="card">
                <div class="card-title">현재 보는 버전: v${p.version} ${p.is_active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-dim">과거본</span>'}</div>
                <div class="table-responsive"><table>
                    <tbody>
                        <tr><th>제품명</th><td>${esc(p.product_name)}</td><th>유형</th><td>${esc(p.product_type || '-')}</td></tr>
                        <tr><th>원재료</th><td colspan="3">${esc(p.ingredients || '-')}</td></tr>
                        <tr><th>알레르기 유발물질</th><td colspan="3">${esc(p.allergens || '-')}</td></tr>
                        <tr><th>포장재질</th><td>${esc(p.packaging_material || '-')}</td><th>유통기한</th><td>${esc(p.shelf_life_desc || '-')}</td></tr>
                        <tr><th>보관방법</th><td>${esc(p.storage_method || '-')}</td><th>유통방법</th><td>${esc(p.distribution_method || '-')}</td></tr>
                        <tr><th>용도</th><td>${esc(p.intended_use || '-')}</td><th>소비대상</th><td>${esc(p.target_consumer || '-')}</td></tr>
                        <tr><th>표시사항 비고</th><td colspan="3">${esc(p.labeling_note || '-')}</td></tr>
                    </tbody>
                </table></div>
            </div>` : '<div class="empty-state">아직 등록된 Plan(제품설명서)이 없습니다 — 아래에서 새로 작성하세요.</div>';
        const versionsCard = S.plans.length ? `
            <div class="card">
                <div class="card-title">버전 이력 (${S.plans.length}개)</div>
                <div class="table-responsive"><table>
                    <thead><tr><th>버전</th><th>제품명</th><th>상태</th><th>작성</th><th>동작</th></tr></thead>
                    <tbody>${S.plans.map(x => `<tr class="${x.id === S.planId ? 'so-open' : ''}">
                        <td>v${x.version}</td><td>${esc(x.product_name)}</td>
                        <td>${x.is_active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-dim">과거본</span>'}</td>
                        <td>${esc(x.created_by || '-')} · ${dt(x.created_at)}</td>
                        <td><button type="button" class="btn btn-secondary btn-small" data-act="view-plan" data-id="${esc(x.id)}">보기</button></td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>` : '';
        return `${viewCard}${versionsCard}
            <div class="card">
                <div class="card-title">새 버전으로 저장 ${p ? '(수정 시 새 버전이 생성되고 자동으로 활성화됩니다)' : ''}</div>
                <div class="form-grid">
                    <div><label class="form-label">제품명 *</label><input id="hcPlanName" class="form-input" value="${esc(S.f.planName)}"></div>
                    <div><label class="form-label">제품유형</label><input id="hcPlanType" class="form-input" value="${esc(S.f.planType)}"></div>
                    <div class="full"><label class="form-label">원재료</label><textarea id="hcPlanIngredients" class="form-textarea" rows="2">${esc(S.f.planIngredients)}</textarea></div>
                    <div class="full"><label class="form-label">알레르기 유발물질</label><input id="hcPlanAllergens" class="form-input" value="${esc(S.f.planAllergens)}"></div>
                    <div><label class="form-label">포장재질</label><input id="hcPlanPackaging" class="form-input" value="${esc(S.f.planPackaging)}"></div>
                    <div><label class="form-label">유통기한</label><input id="hcPlanShelfLife" class="form-input" value="${esc(S.f.planShelfLife)}"></div>
                    <div><label class="form-label">보관방법</label><input id="hcPlanStorage" class="form-input" value="${esc(S.f.planStorage)}"></div>
                    <div><label class="form-label">유통방법</label><input id="hcPlanDistribution" class="form-input" value="${esc(S.f.planDistribution)}"></div>
                    <div><label class="form-label">용도</label><input id="hcPlanIntendedUse" class="form-input" value="${esc(S.f.planIntendedUse)}"></div>
                    <div><label class="form-label">소비대상</label><input id="hcPlanTargetConsumer" class="form-input" value="${esc(S.f.planTargetConsumer)}"></div>
                    <div class="full"><label class="form-label">표시사항 비고</label><input id="hcPlanLabelingNote" class="form-input" value="${esc(S.f.planLabelingNote)}"></div>
                    <div class="full"><label class="form-label">비고</label><input id="hcPlanNote" class="form-input" value="${esc(S.f.planNote)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-plan">새 버전 저장</button></div>
            </div>`;
    }

    // ── 2) 제조공정도·위해요소분석(process) ─────────────────────────────
    function hazardRowHTML(h) {
        const ccpBadge = h.ccp ? '<span class="badge badge-ok">CCP 지정됨</span>' : (h.is_significant ? '<span class="badge badge-warn">CCP 미지정</span>' : '');
        return `<tr>
            <td>${HAZARD_LABEL[h.hazard_type] || h.hazard_type}</td>
            <td>${esc(h.hazard_description)}</td>
            <td class="num">${h.severity} × ${h.likelihood} = ${h.risk_score}</td>
            <td>${h.is_significant ? '<span class="badge badge-danger">유의미</span>' : '<span class="badge badge-dim">일반</span>'} ${ccpBadge}</td>
            <td>${esc(h.control_measure || '-')}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-small" data-act="delete-hazard" data-id="${esc(h.id)}">삭제</button>
            </td>
        </tr>`;
    }
    function stepBlockHTML(s) {
        const open = S.expandedStepId === s.id;
        const hazRows = (s.hazards || []).length ? (s.hazards || []).map(hazardRowHTML).join('') : '<tr><td colspan="6" class="empty-state">등록된 위해요소가 없습니다</td></tr>';
        return `
            <div class="card" style="margin-bottom:10px;">
                <div class="card-title">
                    <span>공정 ${s.step_no}. ${esc(s.step_name)}${s.step_description ? ' — ' + esc(s.step_description) : ''}</span>
                    <span class="row-actions">
                        <button type="button" class="btn btn-secondary btn-small" data-act="toggle-step" data-id="${esc(s.id)}">${open ? '접기' : '위해요소 보기·등록'}</button>
                        <button type="button" class="btn btn-secondary btn-small" data-act="delete-step" data-id="${esc(s.id)}">공정 삭제</button>
                    </span>
                </div>
                ${open ? `
                    <div class="table-responsive"><table>
                        <thead><tr><th>유형</th><th>위해요소</th><th>위험도(심각×발생)</th><th>구분</th><th>관리수단</th><th>동작</th></tr></thead>
                        <tbody>${hazRows}</tbody>
                    </table></div>
                    <div class="form-panel open" style="margin-top:12px;">
                        <div class="form-grid">
                            <div><label class="form-label">유형</label><select id="hcHazType" class="form-select">
                                <option value="biological" ${S.f.hazType === 'biological' ? 'selected' : ''}>생물학적</option>
                                <option value="chemical" ${S.f.hazType === 'chemical' ? 'selected' : ''}>화학적</option>
                                <option value="physical" ${S.f.hazType === 'physical' ? 'selected' : ''}>물리적</option>
                            </select></div>
                            <div><label class="form-label">심각성(1~3)</label><input id="hcHazSeverity" type="number" min="1" max="3" class="form-input" value="${esc(S.f.hazSeverity)}"></div>
                            <div><label class="form-label">발생가능성(1~3)</label><input id="hcHazLikelihood" type="number" min="1" max="3" class="form-input" value="${esc(S.f.hazLikelihood)}"></div>
                            <div class="full"><label class="form-label">위해요소 설명 *</label><input id="hcHazDesc" class="form-input" value="${esc(S.f.hazDesc)}"></div>
                            <div class="full"><label class="form-label">관리수단</label><input id="hcHazControl" class="form-input" value="${esc(S.f.hazControl)}"></div>
                            <div class="full"><label class="so-check" style="font-weight:500;"><input type="checkbox" id="hcHazSignificant" ${S.f.hazSignificant ? 'checked' : ''}> 유의미 위해요소로 표시(체크해야 CCP 지정 가능)</label></div>
                        </div>
                        <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-hazard" data-id="${esc(s.id)}">위해요소 등록</button></div>
                    </div>` : ''}
            </div>`;
    }
    function processHTML() {
        if (!S.planId) return '<div class="empty-state">완제품과 Plan을 먼저 선택하세요.</div>';
        const steps = (S.planDetail && S.planDetail.process_steps) || [];
        const stepsHtml = steps.length ? steps.map(stepBlockHTML).join('') : '<div class="card"><div class="empty-state">등록된 공정 단계가 없습니다.</div></div>';
        return `${stepsHtml}
            <div class="card">
                <div class="card-title">새 공정 단계 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">순번 *</label><input id="hcStepNo" type="number" min="1" class="form-input" value="${esc(S.f.stepNo)}"></div>
                    <div><label class="form-label">공정명 *</label><input id="hcStepName" class="form-input" value="${esc(S.f.stepName)}"></div>
                    <div class="full"><label class="form-label">공정 설명</label><input id="hcStepDesc" class="form-input" value="${esc(S.f.stepDesc)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-step">공정 단계 등록</button></div>
            </div>`;
    }

    // ── 3) CCP 관리기준서(ccp) ────────────────────────────────────────────
    function ccpFormHTML(h) {
        const c = h.ccp;
        return `
            <div class="form-panel open" style="margin-top:10px;">
                <div class="form-grid">
                    <div><label class="form-label">CCP명 *</label><input id="hcCcpName" class="form-input" value="${esc(c ? c.ccp_name : S.f.ccpName)}"></div>
                    <div><label class="form-label">한계기준(Critical Limit) *</label><input id="hcCcpLimit" class="form-input" value="${esc(c ? c.critical_limit : S.f.ccpLimit)}"></div>
                    <div><label class="form-label">모니터링 방법</label><input id="hcCcpMonMethod" class="form-input" value="${esc(c ? c.monitoring_method : S.f.ccpMonMethod)}"></div>
                    <div><label class="form-label">모니터링 주기</label><input id="hcCcpMonFreq" class="form-input" value="${esc(c ? c.monitoring_frequency : S.f.ccpMonFreq)}"></div>
                    <div><label class="form-label">모니터링 담당자</label><input id="hcCcpMonResp" class="form-input" value="${esc(c ? c.monitoring_responsible : S.f.ccpMonResp)}"></div>
                    <div><label class="form-label">개선조치</label><input id="hcCcpCorrective" class="form-input" value="${esc(c ? c.corrective_action : S.f.ccpCorrective)}"></div>
                    <div><label class="form-label">검증 방법</label><input id="hcCcpVerMethod" class="form-input" value="${esc(c ? c.verification_method : S.f.ccpVerMethod)}"></div>
                    <div><label class="form-label">검증 주기</label><input id="hcCcpVerFreq" class="form-input" value="${esc(c ? c.verification_frequency : S.f.ccpVerFreq)}"></div>
                    <div class="full"><label class="form-label">기록유지 방법</label><input id="hcCcpRecordKeeping" class="form-input" value="${esc(c ? c.record_keeping_method : S.f.ccpRecordKeeping)}"></div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-primary" data-act="save-ccp" data-id="${esc(h.id)}">${c ? '수정 저장' : 'CCP 지정'}</button>
                    ${c ? `<button type="button" class="btn btn-secondary" data-act="delete-ccp" data-id="${esc(c.id)}">CCP 삭제</button>` : ''}
                </div>
            </div>`;
    }
    function ccpHTML() {
        if (!S.planId) return '<div class="empty-state">완제품과 Plan을 먼저 선택하세요.</div>';
        const sig = allHazards().filter(h => h.is_significant);
        if (!sig.length) return '<div class="empty-state">유의미(is_significant) 위해요소가 없습니다 — "제조공정도·위해요소" 탭에서 먼저 위해요소를 등록하고 유의미로 표시하세요.</div>';
        return sig.map(h => `
            <div class="card">
                <div class="card-title">
                    <span>공정 ${h.step_no}. ${esc(h.step_name)} — ${HAZARD_LABEL[h.hazard_type]}: ${esc(h.hazard_description)}</span>
                    <span class="row-actions">
                        <button type="button" class="btn btn-secondary btn-small" data-act="toggle-ccp-form" data-id="${esc(h.id)}">${S.expandedHazardCcp === h.id ? '접기' : (h.ccp ? '관리기준서 보기·수정' : 'CCP 지정')}</button>
                    </span>
                </div>
                ${h.ccp ? `<div class="table-responsive"><table>
                    <tbody>
                        <tr><th>CCP No.</th><td>${h.ccp.ccp_no}</td><th>CCP명</th><td>${esc(h.ccp.ccp_name)}</td></tr>
                        <tr><th>한계기준</th><td colspan="3">${esc(h.ccp.critical_limit)}</td></tr>
                        <tr><th>모니터링</th><td colspan="3">${esc(h.ccp.monitoring_method || '-')} · ${esc(h.ccp.monitoring_frequency || '-')} · ${esc(h.ccp.monitoring_responsible || '-')}</td></tr>
                        <tr><th>개선조치</th><td colspan="3">${esc(h.ccp.corrective_action || '-')}</td></tr>
                        <tr><th>검증</th><td colspan="3">${esc(h.ccp.verification_method || '-')} · ${esc(h.ccp.verification_frequency || '-')}</td></tr>
                        <tr><th>기록유지</th><td colspan="3">${esc(h.ccp.record_keeping_method || '-')}</td></tr>
                    </tbody>
                </table></div>` : '<p class="so-help">아직 CCP가 지정되지 않았습니다.</p>'}
                ${S.expandedHazardCcp === h.id ? ccpFormHTML(h) : ''}
            </div>`).join('');
    }

    // ── 4) 모니터링·개선조치(monitoring) ────────────────────────────────
    function monitoringHTML() {
        if (!S.planId) return '<div class="empty-state">완제품과 Plan을 먼저 선택하세요.</div>';
        const ccps = allCcps();
        if (!ccps.length) return '<div class="empty-state">지정된 CCP가 없습니다 — "CCP 관리기준서" 탭에서 먼저 CCP를 지정하세요.</div>';
        const opts = ['<option value="">CCP를 선택하세요</option>'].concat(
            ccps.map(c => `<option value="${esc(c.id)}" ${S.monCcpId === c.id ? 'selected' : ''}>CCP${c.ccp_no} · ${esc(c.ccp_name)}</option>`)
        ).join('');
        let body = '';
        if (S.monCcpId) {
            const devByLog = new Map(S.monDeviations.map(d => [d.monitoring_log_id, d]));
            const logRows = S.monLogs.length ? S.monLogs.map(l => `<tr class="${l.is_within_limit ? '' : 'so-open'}">
                <td>${dt(l.measured_at)}</td>
                <td class="num">${l.measured_value == null ? '-' : num(l.measured_value)} ${esc(l.measured_unit || '')}</td>
                <td>${l.is_within_limit ? '<span class="badge badge-ok">한계기준 이내</span>' : '<span class="badge badge-danger">이탈</span>'}</td>
                <td>${esc(l.measured_by || '-')}</td>
                <td>${esc(l.note || '-')}</td>
                <td>${!l.is_within_limit ? (devByLog.has(l.id) ? '<span class="badge badge-ok">개선조치 기록됨</span>' : `<button type="button" class="btn btn-danger btn-small" data-act="pick-deviation-log" data-id="${esc(l.id)}">개선조치 등록</button>`) : '-'}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="empty-state">모니터링 기록이 없습니다</td></tr>';
            const devRows = S.monDeviations.length ? S.monDeviations.map(d => `<tr>
                <td>${dt(d.actioned_at)}</td><td>${esc(d.deviation_description)}</td><td>${esc(d.corrective_action_taken)}</td>
                <td>${DISPOSITION_LABEL[d.disposition] || d.disposition}</td><td>${esc(d.affected_lot_no || '-')}</td><td>${esc(d.actioned_by || '-')}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="empty-state">개선조치 기록이 없습니다</td></tr>';
            const pendingLog = S.f._devLogId ? S.monLogs.find(l => l.id === S.f._devLogId) : null;
            body = `
                <div class="card">
                    <div class="card-title">CCP 모니터링 기록 등록</div>
                    <div class="form-grid">
                        <div><label class="form-label">측정값</label><input id="hcMonValue" type="number" step="any" class="form-input" value="${esc(S.f.monValue)}"></div>
                        <div><label class="form-label">단위</label><input id="hcMonUnit" class="form-input" value="${esc(S.f.monUnit)}"></div>
                        <div><label class="form-label">한계기준 이내 여부</label><select id="hcMonWithin" class="form-select">
                            <option value="true" ${S.f.monWithin === 'true' ? 'selected' : ''}>이내(정상)</option>
                            <option value="false" ${S.f.monWithin === 'false' ? 'selected' : ''}>이탈</option>
                        </select></div>
                        <div><label class="form-label">측정자</label><input id="hcMonBy" class="form-input" value="${esc(S.f.monBy)}"></div>
                        <div class="full"><label class="form-label">비고</label><input id="hcMonNote" class="form-input" value="${esc(S.f.monNote)}"></div>
                    </div>
                    <p class="so-help">참고: 이 데모에서는 작업지시(work order) 연결은 생략했습니다 — 필요하면 배포 후 실제 작업지시 선택 UI를 추가할 수 있습니다.</p>
                    <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-monitoring">모니터링 기록 등록</button></div>
                </div>
                <div class="card">
                    <div class="card-title">모니터링 이력</div>
                    <div class="table-responsive"><table>
                        <thead><tr><th>측정일시</th><th>측정값</th><th>판정</th><th>측정자</th><th>비고</th><th>개선조치</th></tr></thead>
                        <tbody>${logRows}</tbody>
                    </table></div>
                </div>
                ${pendingLog ? `
                <div class="card">
                    <div class="card-title">개선조치 등록 — ${dt(pendingLog.measured_at)} 이탈 건</div>
                    <div class="form-grid">
                        <div class="full"><label class="form-label">이탈 내용 *</label><input id="hcDevDesc" class="form-input" value="${esc(S.f.devDesc)}"></div>
                        <div class="full"><label class="form-label">조치한 개선조치 *</label><input id="hcDevAction" class="form-input" value="${esc(S.f.devAction)}"></div>
                        <div><label class="form-label">처리결과</label><select id="hcDevDisposition" class="form-select">
                            <option value="release" ${S.f.devDisposition === 'release' ? 'selected' : ''}>출하(release)</option>
                            <option value="hold" ${S.f.devDisposition === 'hold' ? 'selected' : ''}>보류(hold)</option>
                            <option value="discard" ${S.f.devDisposition === 'discard' ? 'selected' : ''}>폐기(discard)</option>
                        </select></div>
                        <div><label class="form-label">조치자</label><input id="hcDevBy" class="form-input" value="${esc(S.f.devBy)}"></div>
                    </div>
                    <p class="so-help">Lot 연결은 이 데모에서 생략했습니다 — 실제 Lot 보류/폐기 실행은 재고관리 탭에서 별도로 처리하세요.</p>
                    <div class="form-actions">
                        <button type="button" class="btn btn-primary" data-act="save-deviation">개선조치 저장</button>
                        <button type="button" class="btn btn-secondary" data-act="cancel-deviation">취소</button>
                    </div>
                </div>` : ''}
                <div class="card">
                    <div class="card-title">개선조치 이력</div>
                    <div class="table-responsive"><table>
                        <thead><tr><th>일시</th><th>이탈내용</th><th>개선조치</th><th>처리결과</th><th>대상Lot</th><th>조치자</th></tr></thead>
                        <tbody>${devRows}</tbody>
                    </table></div>
                </div>`;
        }
        return `<div class="card"><div class="card-title">CCP 선택</div><select id="hcMonCcp" class="form-select" style="width:auto;min-width:260px;" data-act="pick-ccp">${opts}</select></div>${body}`;
    }

    // ── 5) 검증기록(verification) ────────────────────────────────────────
    function verificationHTML() {
        if (!S.planId) return '<div class="empty-state">완제품과 Plan을 먼저 선택하세요.</div>';
        const rows = (S.planDetail && S.planDetail.verifications) || [];
        const table = rows.length ? `<div class="table-responsive"><table>
            <thead><tr><th>검증일자</th><th>종류</th><th>검증자</th><th>결과</th><th>소견</th><th>다음 검증일</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.verification_date)}</td><td>${esc(r.verification_type)}</td><td>${esc(r.verifier)}</td>
                <td>${r.result === 'pass' ? '<span class="badge badge-ok">' : r.result === 'fail' ? '<span class="badge badge-danger">' : '<span class="badge badge-warn">'}${RESULT_LABEL[r.result]}</span></td>
                <td>${esc(r.findings || '-')}</td><td>${esc(r.next_verification_date || '-')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty-state">검증 기록이 없습니다.</div>';
        return `<div class="card"><div class="card-title">검증계획 및 실시보고서</div>${table}</div>
            <div class="card">
                <div class="card-title">검증 실시 기록 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">검증 종류 *</label><input id="hcVerType" class="form-input" value="${esc(S.f.verType)}" placeholder="예: 일일점검표 검토, CCP 기록 검증"></div>
                    <div><label class="form-label">검증일자 *</label><input id="hcVerDate" type="date" class="form-input" value="${esc(S.f.verDate)}"></div>
                    <div><label class="form-label">검증자 *</label><input id="hcVerifier" class="form-input" value="${esc(S.f.verifier)}"></div>
                    <div><label class="form-label">결과</label><select id="hcVerResult" class="form-select">
                        <option value="pass" ${S.f.verResult === 'pass' ? 'selected' : ''}>적합</option>
                        <option value="fail" ${S.f.verResult === 'fail' ? 'selected' : ''}>부적합</option>
                        <option value="conditional" ${S.f.verResult === 'conditional' ? 'selected' : ''}>조건부</option>
                    </select></div>
                    <div><label class="form-label">다음 검증 예정일</label><input id="hcVerNext" type="date" class="form-input" value="${esc(S.f.verNext)}"></div>
                    <div class="full"><label class="form-label">소견</label><input id="hcVerFindings" class="form-input" value="${esc(S.f.verFindings)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-verification">검증 기록 등록</button></div>
            </div>`;
    }

    // ── 6) 선행요건관리(PRP) — 완제품/Plan과 무관 ───────────────────────
    function prpHTML() {
        const catOpts = ['<option value="">전체 영역</option>'].concat(
            PRP_CATEGORIES.map(([k, l]) => `<option value="${k}" ${S.prpCategory === k ? 'selected' : ''}>${l}</option>`)
        ).join('');
        const list = S.prpStandards.length ? S.prpStandards.map(s => `<tr class="${s.id === S.prpSelectedId ? 'so-open' : ''}">
            <td>${PRP_LABEL[s.category] || s.category}</td><td>${esc(s.standard_name)}</td><td>v${s.version}</td>
            <td>${s.is_active ? '<span class="badge badge-ok">사용</span>' : '<span class="badge badge-dim">비활성</span>'}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-small" data-act="pick-prp" data-id="${esc(s.id)}">${s.id === S.prpSelectedId ? '닫기' : '점검기록'}</button>
                <button type="button" class="btn btn-secondary btn-small" data-act="toggle-prp-active" data-id="${esc(s.id)}" data-active="${s.is_active ? '0' : '1'}">${s.is_active ? '비활성화' : '활성화'}</button>
            </td>
        </tr>`).join('') : '<tr><td colspan="5" class="empty-state">등록된 기준서가 없습니다</td></tr>';

        let checksBlock = '';
        if (S.prpSelectedId) {
            const std = S.prpStandards.find(x => x.id === S.prpSelectedId);
            const checkRows = S.prpChecks.length ? S.prpChecks.map(c => `<tr>
                <td>${esc(c.check_date)}</td><td>${esc(c.checker)}</td>
                <td>${c.result === 'pass' ? '<span class="badge badge-ok">적합</span>' : '<span class="badge badge-danger">부적합</span>'}</td>
                <td>${esc(c.findings || '-')}</td><td>${esc(c.corrective_action || '-')}</td><td>${esc(c.cold_chain_ref || '-')}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="empty-state">점검기록이 없습니다</td></tr>';
            checksBlock = `
                <div class="card">
                    <div class="card-title">${std ? esc(std.standard_name) + ' — 점검기록' : '점검기록'}</div>
                    <div class="table-responsive"><table>
                        <thead><tr><th>점검일</th><th>점검자</th><th>결과</th><th>소견</th><th>개선조치</th><th>콜드체인 참조</th></tr></thead>
                        <tbody>${checkRows}</tbody>
                    </table></div>
                    <div class="form-grid" style="margin-top:12px;">
                        <div><label class="form-label">점검자 *</label><input id="hcCheckChecker" class="form-input" value="${esc(S.f.checkChecker)}"></div>
                        <div><label class="form-label">점검일</label><input id="hcCheckDate" type="date" class="form-input" value="${esc(S.f.checkDate)}"></div>
                        <div><label class="form-label">결과</label><select id="hcCheckResult" class="form-select">
                            <option value="pass" ${S.f.checkResult === 'pass' ? 'selected' : ''}>적합</option>
                            <option value="fail" ${S.f.checkResult === 'fail' ? 'selected' : ''}>부적합</option>
                        </select></div>
                        <div><label class="form-label">콜드체인 참조(선택)</label><input id="hcCheckColdRef" class="form-input" value="${esc(S.f.checkColdRef)}" placeholder="HG 콜드체인 알림/기록 번호"></div>
                        <div class="full"><label class="form-label">소견</label><input id="hcCheckFindings" class="form-input" value="${esc(S.f.checkFindings)}"></div>
                        <div class="full"><label class="form-label">개선조치</label><input id="hcCheckAction" class="form-input" value="${esc(S.f.checkAction)}"></div>
                    </div>
                    <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-prp-check" data-id="${esc(S.prpSelectedId)}">점검기록 등록</button></div>
                </div>`;
        }

        return `
            <div class="card">
                <div class="card-title">선행요건관리기준서(PRP) — 8개 영역 <select id="hcPrpCat" class="form-select" style="width:auto;display:inline-block;margin-left:8px;" data-act="filter-prp">${catOpts}</select></div>
                <div class="table-responsive"><table>
                    <thead><tr><th>영역</th><th>기준서명</th><th>버전</th><th>상태</th><th>동작</th></tr></thead>
                    <tbody>${list}</tbody>
                </table></div>
            </div>
            ${checksBlock}
            <div class="card">
                <div class="card-title">새 기준서(또는 새 버전) 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">영역 *</label><select id="hcPrpNewCategory" class="form-select">
                        ${PRP_CATEGORIES.map(([k, l]) => `<option value="${k}" ${S.f.prpNewCategory === k ? 'selected' : ''}>${l}</option>`).join('')}
                    </select></div>
                    <div><label class="form-label">기준서명 *</label><input id="hcPrpNewName" class="form-input" value="${esc(S.f.prpNewName)}"></div>
                    <div class="full"><label class="form-label">기준서 내용 *</label><textarea id="hcPrpNewContent" class="form-textarea" rows="3">${esc(S.f.prpNewContent)}</textarea></div>
                    <div class="full"><label class="form-label">비고</label><input id="hcPrpNewNote" class="form-input" value="${esc(S.f.prpNewNote)}"></div>
                </div>
                <p class="so-help">같은 영역+같은 기준서명으로 다시 등록하면 새 버전이 생성되고 자동으로 활성화됩니다(제품설명서와 같은 버전관리 방식).</p>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-prp-standard">기준서 저장</button></div>
            </div>`;
    }

    // ── 7) 인증서류 조립본(document) ─────────────────────────────────────
    function documentHTML() {
        if (!S.planId) return '<div class="empty-state">완제품과 Plan을 먼저 선택하세요.</div>';
        if (!S.document) {
            return `<div class="card"><div class="card-title">HACCP 인증신청 서류 조립본</div>
                <p class="so-help">제품설명서·제조공정도·위해요소분석표·CCP결정표·CCP관리기준서·검증기록·선행요건관리기준서(활성본)를 한 번에 모아 보여줍니다. 실제 PDF/HWP 파일 출력은 범위 밖입니다 — 서류 작성에 필요한 데이터를 구조화된 형태로 확인하는 용도입니다.</p>
                <div class="form-actions"><button type="button" class="btn btn-primary" data-act="build-document">서류 조립본 생성</button></div>
            </div>`;
        }
        const d = S.document;
        const pd = d.product_description || {};
        return `
            <div class="card"><div class="card-title">1. 제품설명서</div>
                <div class="table-responsive"><table><tbody>
                    <tr><th>제품명</th><td>${esc(pd.product_name)}</td><th>품목코드</th><td>${esc(pd.fg_item_code)}</td></tr>
                    <tr><th>원재료</th><td colspan="3">${esc(pd.ingredients || '-')}</td></tr>
                    <tr><th>알레르기유발물질</th><td colspan="3">${esc(pd.allergens || '-')}</td></tr>
                    <tr><th>보관/유통</th><td colspan="3">${esc(pd.storage_method || '-')} / ${esc(pd.distribution_method || '-')}</td></tr>
                </tbody></table></div>
            </div>
            <div class="card"><div class="card-title">2. 제조공정도</div>
                <div class="table-responsive"><table><thead><tr><th>순번</th><th>공정명</th><th>설명</th></tr></thead>
                <tbody>${(d.process_flow_diagram || []).map(s => `<tr><td>${s.step_no}</td><td>${esc(s.step_name)}</td><td>${esc(s.step_description || '-')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <div class="card"><div class="card-title">3. 위해요소분석표</div>
                <div class="table-responsive"><table><thead><tr><th>공정</th><th>유형</th><th>위해요소</th><th>위험도</th><th>유의미</th><th>관리수단</th></tr></thead>
                <tbody>${(d.hazard_analysis_table || []).map(h => `<tr><td>${h.step_no}.${esc(h.step_name)}</td><td>${HAZARD_LABEL[h.hazard_type]}</td><td>${esc(h.hazard_description)}</td><td class="num">${h.risk_score}</td><td>${h.is_significant ? '유의미' : '-'}</td><td>${esc(h.control_measure || '-')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <div class="card"><div class="card-title">4. CCP 결정표</div>
                <div class="table-responsive"><table><thead><tr><th>CCP No.</th><th>공정</th><th>위해요소</th><th>CCP명</th></tr></thead>
                <tbody>${(d.ccp_decision_table || []).map(c => `<tr><td>CCP${c.ccp_no}</td><td>${esc(c.step_name)}</td><td>${esc(c.hazard_description)}</td><td>${esc(c.ccp_name)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <div class="card"><div class="card-title">5. CCP 관리기준서</div>
                <div class="table-responsive"><table><thead><tr><th>No.</th><th>CCP명</th><th>한계기준</th><th>모니터링</th><th>개선조치</th><th>검증</th><th>기록유지</th></tr></thead>
                <tbody>${(d.ccp_management_standards || []).map(c => `<tr><td>CCP${c.ccp_no}</td><td>${esc(c.ccp_name)}</td><td>${esc(c.critical_limit)}</td><td>${esc(c.monitoring_method || '-')}/${esc(c.monitoring_frequency || '-')}/${esc(c.monitoring_responsible || '-')}</td><td>${esc(c.corrective_action || '-')}</td><td>${esc(c.verification_method || '-')}/${esc(c.verification_frequency || '-')}</td><td>${esc(c.record_keeping_method || '-')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <div class="card"><div class="card-title">6. 검증계획 및 실시보고서</div>
                <div class="table-responsive"><table><thead><tr><th>일자</th><th>종류</th><th>검증자</th><th>결과</th><th>소견</th></tr></thead>
                <tbody>${(d.verification_records || []).map(r => `<tr><td>${esc(r.verification_date)}</td><td>${esc(r.verification_type)}</td><td>${esc(r.verifier)}</td><td>${RESULT_LABEL[r.result]}</td><td>${esc(r.findings || '-')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <div class="card"><div class="card-title">7. 선행요건관리기준서(활성본, 전체 영역)</div>
                <div class="table-responsive"><table><thead><tr><th>영역</th><th>기준서명</th><th>버전</th><th>내용</th></tr></thead>
                <tbody>${(d.prp_standards || []).map(s => `<tr><td>${PRP_LABEL[s.category] || s.category}</td><td>${esc(s.standard_name)}</td><td>v${s.version}</td><td>${esc((s.standard_content || '').slice(0, 80))}${(s.standard_content || '').length > 80 ? '…' : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">데이터 없음</td></tr>'}</tbody></table></div>
            </div>
            <p class="so-help">생성 시각: ${dt(d.generated_at)}</p>
            <div class="form-actions"><button type="button" class="btn btn-secondary" data-act="build-document">다시 생성</button></div>`;
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        const subsBar = `<div class="so-subtabs">${SUBS.map(([k, l]) => `<button type="button" class="so-subtab ${S.sub === k ? 'active' : ''}" data-act="sub" data-k="${k}">${l}</button>`).join('')}</div>`;
        const picker = S.sub === 'prp' ? '' : planPickerHTML();
        let body = '';
        if (S.sub === 'plan') body = planHTML();
        else if (S.sub === 'process') body = processHTML();
        else if (S.sub === 'ccp') body = ccpHTML();
        else if (S.sub === 'monitoring') body = monitoringHTML();
        else if (S.sub === 'verification') body = verificationHTML();
        else if (S.sub === 'prp') body = prpHTML();
        else if (S.sub === 'document') body = documentHTML();
        el.innerHTML = subsBar + msgHtml + picker + body;
    }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        const act = b.dataset.act, id = b.dataset.id;

        if (act === 'sub') { S.sub = b.dataset.k; setMsg(null); draw(); return; }

        if (act === 'activate-plan') {
            await adminAction('hf_haccp_admin_activate_plan', { p_plan_id: S.planId }, () => '이 버전을 활성화했습니다');
            await loadPlansFor(S.fgItemId); draw(); return;
        }
        if (act === 'view-plan') { S.planId = id; await loadPlanDetail(); draw(); return; }

        if (act === 'save-plan') {
            if (!v('hcPlanName')) { setMsg('제품명을 입력하세요', false); draw(); return; }
            if (!S.fgItemId) { setMsg('완제품을 먼저 선택하세요', false); draw(); return; }
            const r = await adminAction('hf_haccp_admin_save_plan', {
                p_fg_item_id: S.fgItemId, p_product_name: v('hcPlanName'), p_product_type: v('hcPlanType') || null,
                p_ingredients: v('hcPlanIngredients') || null, p_allergens: v('hcPlanAllergens') || null,
                p_packaging_material: v('hcPlanPackaging') || null, p_shelf_life_desc: v('hcPlanShelfLife') || null,
                p_storage_method: v('hcPlanStorage') || null, p_distribution_method: v('hcPlanDistribution') || null,
                p_intended_use: v('hcPlanIntendedUse') || null, p_target_consumer: v('hcPlanTargetConsumer') || null,
                p_labeling_note: v('hcPlanLabelingNote') || null, p_note: v('hcPlanNote') || null,
            }, r => `Plan v${r.version} 저장·활성화되었습니다`);
            if (r && r.success) { S.f.planName = S.f.planType = S.f.planIngredients = S.f.planAllergens = S.f.planPackaging = S.f.planShelfLife = S.f.planStorage = S.f.planDistribution = S.f.planIntendedUse = S.f.planTargetConsumer = S.f.planLabelingNote = S.f.planNote = ''; }
            await loadPlansFor(S.fgItemId); draw(); return;
        }

        if (act === 'save-step') {
            if (!v('hcStepNo') || !v('hcStepName')) { setMsg('순번·공정명을 입력하세요', false); draw(); return; }
            await adminAction('hf_haccp_admin_upsert_process_step', { p_id: null, p_plan_id: S.planId, p_step_no: Number(v('hcStepNo')), p_step_name: v('hcStepName'), p_step_description: v('hcStepDesc') || null }, () => '공정 단계를 등록했습니다');
            S.f.stepNo = ''; S.f.stepName = ''; S.f.stepDesc = '';
            await loadPlanDetail(); draw(); return;
        }
        if (act === 'delete-step') {
            if (!confirm('이 공정 단계를 삭제할까요? 위해요소가 등록돼 있으면 삭제되지 않습니다.')) return;
            await adminAction('hf_haccp_admin_delete_process_step', { p_id: id }, () => '삭제했습니다');
            await loadPlanDetail(); draw(); return;
        }
        if (act === 'toggle-step') { S.expandedStepId = S.expandedStepId === id ? '' : id; draw(); return; }

        if (act === 'save-hazard') {
            if (!v('hcHazDesc')) { setMsg('위해요소 설명을 입력하세요', false); draw(); return; }
            await adminAction('hf_haccp_admin_upsert_hazard', {
                p_id: null, p_step_id: id, p_hazard_type: v('hcHazType'), p_hazard_description: v('hcHazDesc'),
                p_severity: Number(v('hcHazSeverity') || 0), p_likelihood: Number(v('hcHazLikelihood') || 0),
                p_is_significant: chk('hcHazSignificant'), p_control_measure: v('hcHazControl') || null,
            }, () => '위해요소를 등록했습니다');
            S.f.hazDesc = ''; S.f.hazControl = ''; S.f.hazSignificant = false;
            await loadPlanDetail(); draw(); return;
        }
        if (act === 'delete-hazard') {
            if (!confirm('이 위해요소를 삭제할까요? CCP가 지정돼 있으면 삭제되지 않습니다.')) return;
            await adminAction('hf_haccp_admin_delete_hazard', { p_id: id }, () => '삭제했습니다');
            await loadPlanDetail(); draw(); return;
        }

        if (act === 'toggle-ccp-form') { S.expandedHazardCcp = S.expandedHazardCcp === id ? '' : id; draw(); return; }
        if (act === 'save-ccp') {
            if (!v('hcCcpName') || !v('hcCcpLimit')) { setMsg('CCP명과 한계기준은 필수입니다', false); draw(); return; }
            await adminAction('hf_haccp_admin_upsert_ccp', {
                p_id: null, p_hazard_id: id, p_ccp_name: v('hcCcpName'), p_critical_limit: v('hcCcpLimit'),
                p_monitoring_method: v('hcCcpMonMethod') || null, p_monitoring_frequency: v('hcCcpMonFreq') || null,
                p_monitoring_responsible: v('hcCcpMonResp') || null, p_corrective_action: v('hcCcpCorrective') || null,
                p_verification_method: v('hcCcpVerMethod') || null, p_verification_frequency: v('hcCcpVerFreq') || null,
                p_record_keeping_method: v('hcCcpRecordKeeping') || null,
            }, () => 'CCP를 저장했습니다');
            await loadPlanDetail(); S.expandedHazardCcp = ''; draw(); return;
        }
        if (act === 'delete-ccp') {
            if (!confirm('이 CCP를 삭제할까요? 모니터링 기록이 있으면 삭제되지 않습니다.')) return;
            await adminAction('hf_haccp_admin_delete_ccp', { p_id: id }, () => '삭제했습니다');
            await loadPlanDetail(); draw(); return;
        }

        if (act === 'save-monitoring') {
            if (!S.monCcpId) return;
            await adminAction('hf_haccp_admin_log_monitoring', {
                p_ccp_id: S.monCcpId, p_is_within_limit: v('hcMonWithin') === 'true',
                p_measured_value: v('hcMonValue') === '' ? null : Number(v('hcMonValue')), p_measured_unit: v('hcMonUnit') || null,
                p_measured_by: v('hcMonBy') || null, p_note: v('hcMonNote') || null,
            }, () => '모니터링 기록을 등록했습니다');
            S.f.monValue = ''; S.f.monUnit = ''; S.f.monBy = ''; S.f.monNote = '';
            S.monLogs = await call('hf_haccp_get_monitoring_logs', { p_ccp_id: S.monCcpId }) || [];
            S.monDeviations = await call('hf_haccp_get_deviations', { p_ccp_id: S.monCcpId }) || [];
            draw(); return;
        }
        if (act === 'pick-deviation-log') { S.f._devLogId = id; draw(); return; }
        if (act === 'cancel-deviation') { S.f._devLogId = ''; draw(); return; }
        if (act === 'save-deviation') {
            if (!v('hcDevDesc') || !v('hcDevAction')) { setMsg('이탈 내용·개선조치를 입력하세요', false); draw(); return; }
            await adminAction('hf_haccp_admin_log_deviation', {
                p_monitoring_log_id: S.f._devLogId, p_deviation_description: v('hcDevDesc'), p_corrective_action_taken: v('hcDevAction'),
                p_disposition: v('hcDevDisposition'), p_actioned_by: v('hcDevBy') || null,
            }, () => '개선조치를 등록했습니다');
            S.f._devLogId = ''; S.f.devDesc = ''; S.f.devAction = ''; S.f.devBy = '';
            S.monLogs = await call('hf_haccp_get_monitoring_logs', { p_ccp_id: S.monCcpId }) || [];
            S.monDeviations = await call('hf_haccp_get_deviations', { p_ccp_id: S.monCcpId }) || [];
            draw(); return;
        }

        if (act === 'save-verification') {
            if (!v('hcVerType') || !v('hcVerDate') || !v('hcVerifier')) { setMsg('검증 종류·일자·검증자는 필수입니다', false); draw(); return; }
            await adminAction('hf_haccp_admin_log_verification', {
                p_plan_id: S.planId, p_verification_type: v('hcVerType'), p_verification_date: v('hcVerDate'), p_verifier: v('hcVerifier'),
                p_result: v('hcVerResult'), p_findings: v('hcVerFindings') || null, p_next_verification_date: v('hcVerNext') || null,
            }, () => '검증 기록을 등록했습니다');
            S.f.verType = ''; S.f.verDate = ''; S.f.verifier = ''; S.f.verFindings = ''; S.f.verNext = '';
            await loadPlanDetail(); draw(); return;
        }

        if (act === 'pick-prp') {
            S.prpSelectedId = S.prpSelectedId === id ? '' : id;
            S.prpChecks = S.prpSelectedId ? (await call('hf_haccp_get_prp_checks', { p_prp_id: S.prpSelectedId }) || []) : [];
            draw(); return;
        }
        if (act === 'toggle-prp-active') {
            await adminAction('hf_haccp_admin_set_prp_standard_active', { p_id: id, p_is_active: b.dataset.active === '1' }, () => '상태를 변경했습니다');
            S.prpStandards = await call('hf_haccp_get_prp_standards', { p_category: S.prpCategory || null }) || [];
            draw(); return;
        }
        if (act === 'save-prp-standard') {
            if (!v('hcPrpNewName') || !v('hcPrpNewContent')) { setMsg('기준서명·내용을 입력하세요', false); draw(); return; }
            await adminAction('hf_haccp_admin_upsert_prp_standard', {
                p_category: v('hcPrpNewCategory'), p_standard_name: v('hcPrpNewName'), p_standard_content: v('hcPrpNewContent'), p_note: v('hcPrpNewNote') || null,
            }, r => `저장했습니다(v${r.version})`);
            S.f.prpNewName = ''; S.f.prpNewContent = ''; S.f.prpNewNote = '';
            S.prpStandards = await call('hf_haccp_get_prp_standards', { p_category: S.prpCategory || null }) || [];
            draw(); return;
        }
        if (act === 'save-prp-check') {
            if (!v('hcCheckChecker')) { setMsg('점검자를 입력하세요', false); draw(); return; }
            await adminAction('hf_haccp_admin_log_prp_check', {
                p_prp_id: id, p_checker: v('hcCheckChecker'), p_result: v('hcCheckResult'),
                p_check_date: v('hcCheckDate') || new Date().toISOString().slice(0, 10),
                p_findings: v('hcCheckFindings') || null, p_corrective_action: v('hcCheckAction') || null, p_cold_chain_ref: v('hcCheckColdRef') || null,
            }, () => '점검기록을 등록했습니다');
            S.f.checkChecker = ''; S.f.checkFindings = ''; S.f.checkAction = ''; S.f.checkColdRef = '';
            S.prpChecks = await call('hf_haccp_get_prp_checks', { p_prp_id: id }) || [];
            draw(); return;
        }

        if (act === 'build-document') {
            try { S.document = await call('hf_get_haccp_plan_document', { p_plan_id: S.planId }); }
            catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
    }

    async function onChangeEv(ev) {
        const t = ev.target; if (!root() || !root().contains(t)) return;
        if (t.dataset && t.dataset.act === 'pick-fg') { await loadPlansFor(t.value); S.expandedStepId = ''; S.expandedHazardCcp = ''; draw(); return; }
        if (t.dataset && t.dataset.act === 'pick-plan') { S.planId = t.value; await loadPlanDetail(); S.expandedStepId = ''; S.expandedHazardCcp = ''; draw(); return; }
        if (t.dataset && t.dataset.act === 'pick-ccp') {
            S.monCcpId = t.value; S.f._devLogId = '';
            S.monLogs = S.monCcpId ? (await call('hf_haccp_get_monitoring_logs', { p_ccp_id: S.monCcpId }) || []) : [];
            S.monDeviations = S.monCcpId ? (await call('hf_haccp_get_deviations', { p_ccp_id: S.monCcpId }) || []) : [];
            draw(); return;
        }
        if (t.dataset && t.dataset.act === 'filter-prp') {
            S.prpCategory = t.value; S.prpSelectedId = ''; S.prpChecks = [];
            S.prpStandards = await call('hf_haccp_get_prp_standards', { p_category: S.prpCategory || null }) || [];
            draw(); return;
        }
    }

    const CSS = `
        #haccpRoot .so-subtabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
        #haccpRoot .so-subtab{border:1px solid var(--border);background:#fff;color:var(--text-secondary);border-radius:18px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
        #haccpRoot .so-subtab.active{background:var(--primary);border-color:var(--primary);color:#fff}
        #haccpRoot .so-check{font-size:13px;font-weight:500;color:var(--text-secondary);display:flex;gap:8px;align-items:center;margin-top:6px}
        #haccpRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:6px 0 4px}
        #haccpRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #haccpRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #haccpRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}
        #haccpRoot .so-open{background:var(--info-soft)}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('haccpStyle')) {
            const st = document.createElement('style'); st.id = 'haccpStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) {
            document.addEventListener('click', onClick);
            document.addEventListener('change', onChangeEv);
            S._bound = true;
        }
    }

    global.HACCP = { init, render };
})(window);
