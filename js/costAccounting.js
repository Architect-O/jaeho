/* ══════════════════════════════════════════════════════════════════════════
   costAccounting.js — HB(회계) "원가·회계심화" 탭 (2026-09-26, 대형 로드맵 라운드3)
   6개 서브탭: 코스트센터·배부 / 결산처리 / 자금관리 / 고정자산 / 부가세 / 예산
   서버 쪽은 inthub/acc_cost_center_migration.sql, inthub/acc_advanced_migration.sql.
   근거: claude/모듈_원가관리_회계심화.md

   사용법:
     <script src="./js/costAccounting.js"></script>
     CostAccounting.init({ sb, username: myUsername, pw: myPw, isAdmin, onChange: loadAll });
     탭 전환 시: el.innerHTML = '<div id="costAcctRoot"></div>'; CostAccounting.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const SUBS = [
        ['costcenter', '💰 코스트센터·배부'],
        ['closing', '📅 결산처리'],
        ['cash', '💵 자금관리'],
        ['assets', '🏢 고정자산'],
        ['vat', '🧾 부가세'],
        ['budget', '📊 예산'],
    ];

    const S = {
        cfg: null, sub: 'costcenter', msg: null,
        centers: [], rules: [], allocResults: [], centerSummary: [],
        periods: [], cashPlans: [], cashPosition: [],
        assets: [], assetSchedule: null, assetScheduleFor: '',
        vatTx: [], vatSummary: null,
        budgets: [], accounts: [],
        // 폼 상태
        f: {
            ccCode: '', ccName: '', ccType: 'cost',
            ruleName: '', ruleAccount: '', ruleDriver: '',
            basisCenter: '', basisPeriod: '', basisDriver: '', basisValue: '',
            allocRule: '', allocPeriod: '', summaryPeriod: '',
            closePeriod: '',
            cashDate: '', cashDir: 'in', cashAmount: '', cashCounterparty: '', cashMemo: '',
            posFrom: '', posTo: '',
            assetCode: '', assetName: '', assetDate: '', assetCost: '', assetLife: '', assetSalvage: '',
            deprPeriod: '',
            vatDir: 'sales', vatDate: '', vatSupply: '', vatVat: '', vatPartner: '', vatInvoice: '', vatMemo: '',
            vatFrom: '', vatTo: '',
            budgetPeriod: '', budgetAccount: '', budgetCenter: '', budgetAmount: '', budgetMemo: '',
            budgetViewPeriod: '', budgetViewCenter: '',
        },
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function num(n) { if (n == null || n === '') return '-'; const v = Number(n); return isNaN(v) ? '-' : v.toLocaleString('ko-KR'); }
    function root() { return document.getElementById('costAcctRoot'); }
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

    async function loadSub() {
        S.accounts = S.accounts.length ? S.accounts : (await call('acc_get_accounts') || []);
        if (S.sub === 'costcenter') {
            S.centers = await call('acc_get_cost_centers') || [];
            S.rules = await call('acc_get_allocation_rules') || [];
        } else if (S.sub === 'closing') {
            S.periods = await call('acc_get_periods') || [];
        } else if (S.sub === 'cash') {
            S.cashPlans = await call('acc_get_cash_plans', {}) || [];
        } else if (S.sub === 'assets') {
            S.assets = await call('acc_get_fixed_assets') || [];
        } else if (S.sub === 'vat') {
            S.vatTx = await call('acc_get_vat_transactions', {}) || [];
        } else if (S.sub === 'budget') {
            S.centers = S.centers.length ? S.centers : (await call('acc_get_cost_centers') || []);
        }
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            await loadSub();
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">데이터를 불러오지 못했습니다: ${esc(e.message)}<br><span style="font-size:11.5px">Supabase SQL Editor에서 <code>acc_cost_center_migration.sql</code>·<code>acc_advanced_migration.sql</code>을 먼저 실행했는지 확인하세요.</span></div></div>`;
        }
    }

    function accOptions(sel) {
        return '<option value="">계정 선택</option>' + S.accounts.map(a =>
            `<option value="${esc(a.account_code)}" ${a.account_code === sel ? 'selected' : ''}>${esc(a.account_code)} ${esc(a.account_name)}</option>`).join('');
    }
    function centerOptions(sel, withEmpty) {
        return (withEmpty ? '<option value="">(공통, 코스트센터 미지정)</option>' : '<option value="">코스트센터 선택</option>') +
            S.centers.map(c => `<option value="${esc(c.center_code)}" ${c.center_code === sel ? 'selected' : ''}>${esc(c.center_code)} ${esc(c.center_name)}</option>`).join('');
    }

    /* ── 1) 코스트센터·배부 ── */
    function costcenterHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">코스트센터 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">코드</label><input id="ccCode" class="form-input" value="${esc(S.f.ccCode)}"></div>
                    <div><label class="form-label">이름</label><input id="ccName" class="form-input" value="${esc(S.f.ccName)}"></div>
                    <div><label class="form-label">유형</label><select id="ccType" class="form-select"><option value="cost" ${S.f.ccType === 'cost' ? 'selected' : ''}>원가센터</option><option value="profit" ${S.f.ccType === 'profit' ? 'selected' : ''}>손익센터</option></select></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-center">저장</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">코스트센터 목록</div>
                <div class="table-responsive"><table><thead><tr><th>코드</th><th>이름</th><th>유형</th></tr></thead>
                    <tbody>${S.centers.length ? S.centers.map(c2 => `<tr><td>${esc(c2.center_code)}</td><td>${esc(c2.center_name)}</td><td>${c2.center_type === 'profit' ? '손익센터' : '원가센터'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-state">등록된 코스트센터가 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">배부기준(driver) 입력</div>
                <p class="so-help">예: 특정 기간에 코스트센터별 매출비율·인원수 등의 값을 입력해두면, 아래 배부규칙 실행 시 그 비중대로 나눕니다.</p>
                <div class="form-grid">
                    <div><label class="form-label">코스트센터</label><select id="basisCenter" class="form-select">${centerOptions(S.f.basisCenter)}</select></div>
                    <div><label class="form-label">기간(YYYY-MM)</label><input id="basisPeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.basisPeriod)}"></div>
                    <div><label class="form-label">배부기준명</label><input id="basisDriver" class="form-input" placeholder="예: 매출비율" value="${esc(S.f.basisDriver)}"></div>
                    <div><label class="form-label">값</label><input id="basisValue" class="form-input" type="number" step="0.01" value="${esc(S.f.basisValue)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-basis">배부기준 저장</button></div>
            </div>
            <div class="card">
                <div class="card-title">배부규칙 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">규칙명</label><input id="ruleName" class="form-input" value="${esc(S.f.ruleName)}"></div>
                    <div><label class="form-label">배부 대상 계정</label><select id="ruleAccount" class="form-select">${accOptions(S.f.ruleAccount)}</select></div>
                    <div><label class="form-label">배부기준명(위 항목과 동일 표기)</label><input id="ruleDriver" class="form-input" placeholder="예: 매출비율" value="${esc(S.f.ruleDriver)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-rule">규칙 저장</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">배부규칙 목록</div>
                <div class="table-responsive"><table><thead><tr><th>규칙명</th><th>대상계정</th><th>배부기준</th><th>상태</th><th>동작</th></tr></thead>
                    <tbody>${S.rules.length ? S.rules.map(r => `
                        <tr><td>${esc(r.rule_name)}</td><td>${esc(r.source_account_code)}</td><td>${esc(r.driver_name)}</td>
                            <td>${r.active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-dim">비활성</span>'}</td>
                            <td>${c.isAdmin ? `<button type="button" class="btn btn-secondary btn-small" data-act="pick-run-rule" data-id="${esc(r.id)}">배부 실행에 선택</button>` : '-'}</td>
                        </tr>`).join('') : '<tr><td colspan="5" class="empty-state">등록된 배부규칙이 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">배부 실행</div>
                <div class="form-grid">
                    <div><label class="form-label">배부규칙</label><select id="allocRule" class="form-select">${S.rules.map(r => `<option value="${esc(r.id)}" ${r.id === S.f.allocRule ? 'selected' : ''}>${esc(r.rule_name)}</option>`).join('') || '<option value="">(등록된 규칙 없음)</option>'}</select></div>
                    <div><label class="form-label">기간(YYYY-MM)</label><input id="allocPeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.allocPeriod)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="run-alloc">배부 실행</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">코스트센터 요약(직접태깅+배부분) <input id="summaryPeriod" class="form-input" style="width:120px;display:inline-block;margin-left:8px;" placeholder="2026-09" value="${esc(S.f.summaryPeriod)}"><button type="button" class="btn btn-secondary btn-small" data-act="load-summary" style="margin-left:6px;">조회</button></div>
                <div class="table-responsive"><table><thead><tr><th>코드</th><th>이름</th><th>직접태깅액</th><th>배부액</th><th>합계</th></tr></thead>
                    <tbody>${S.centerSummary.length ? S.centerSummary.map(r => `<tr><td>${esc(r.center_code)}</td><td>${esc(r.center_name)}</td><td class="num">${num(r.direct_amount)}</td><td class="num">${num(r.allocated_amount)}</td><td class="num">${num(r.total_amount)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">기간을 입력하고 조회하세요</td></tr>'}</tbody>
                </table></div>
            </div>
            ${S.allocResults.length ? `
            <div class="card">
                <div class="card-title">최근 배부 실행 결과</div>
                <div class="table-responsive"><table><thead><tr><th>규칙</th><th>기간</th><th>코스트센터</th><th>대상금액</th><th>비중</th><th>배부액</th></tr></thead>
                    <tbody>${S.allocResults.map(r => `<tr><td>${esc(r.rule_name)}</td><td>${esc(r.period)}</td><td>${esc(r.center_code)} ${esc(r.center_name)}</td><td class="num">${num(r.source_amount)}</td><td class="num">${(Number(r.driver_share) * 100).toFixed(1)}%</td><td class="num">${num(r.allocated_amount)}</td></tr>`).join('')}</tbody>
                </table></div>
            </div>` : ''}`;
    }

    /* ── 2) 결산처리 ── */
    function closingHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">기간 마감·재오픈</div>
                <p class="so-help">마감하면 손익계정 잔액이 이익잉여금(3100)으로 자동 대체되고, 그 기간에는 더 이상(자동분개 포함) 분개가 들어가지 않습니다.</p>
                <div class="form-grid">
                    <div><label class="form-label">기간(YYYY-MM)</label><input id="closePeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.closePeriod)}"></div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-primary btn-small" data-act="run-closing">결산 마감</button>
                    <button type="button" class="btn btn-secondary btn-small" data-act="reopen-period">재오픈</button>
                </div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">회계기간 현황</div>
                <div class="table-responsive"><table><thead><tr><th>기간</th><th>상태</th><th>마감일시</th><th>마감자</th></tr></thead>
                    <tbody>${S.periods.length ? S.periods.map(p => `<tr><td>${esc(p.period)}</td><td>${p.status === 'closed' ? '<span class="badge badge-dim">마감</span>' : '<span class="badge badge-ok">오픈</span>'}</td><td>${esc(p.closed_at || '-')}</td><td>${esc(p.closed_by || '-')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">아직 마감 이력이 없습니다(모든 기간이 오픈 상태)</td></tr>'}</tbody>
                </table></div>
            </div>`;
    }

    /* ── 3) 자금관리 ── */
    function cashHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">자금계획 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">일자</label><input id="cashDate" type="date" class="form-input" value="${esc(S.f.cashDate)}"></div>
                    <div><label class="form-label">구분</label><select id="cashDir" class="form-select"><option value="in" ${S.f.cashDir === 'in' ? 'selected' : ''}>입금</option><option value="out" ${S.f.cashDir === 'out' ? 'selected' : ''}>출금</option></select></div>
                    <div><label class="form-label">금액</label><input id="cashAmount" type="number" class="form-input" value="${esc(S.f.cashAmount)}"></div>
                    <div><label class="form-label">거래처(선택)</label><input id="cashCounterparty" class="form-input" value="${esc(S.f.cashCounterparty)}"></div>
                    <div class="full"><label class="form-label">메모</label><input id="cashMemo" class="form-input" value="${esc(S.f.cashMemo)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-cashplan">등록</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">자금계획 목록</div>
                <div class="table-responsive"><table><thead><tr><th>일자</th><th>구분</th><th>금액</th><th>거래처</th><th>상태</th><th>동작</th></tr></thead>
                    <tbody>${S.cashPlans.length ? S.cashPlans.map(p => `
                        <tr><td>${esc(p.plan_date)}</td><td>${p.direction === 'in' ? '입금' : '출금'}</td><td class="num">${num(p.amount)}</td><td>${esc(p.counterparty || '-')}</td>
                            <td>${p.status === 'realized' ? '<span class="badge badge-ok">실현</span>' : p.status === 'canceled' ? '<span class="badge badge-dim">취소</span>' : '<span class="badge badge-warn">예정</span>'}</td>
                            <td class="row-actions">${(c.isAdmin && p.status === 'planned') ? `<button type="button" class="btn btn-secondary btn-small" data-act="cash-realize" data-id="${esc(p.id)}">실현처리</button><button type="button" class="btn btn-danger btn-small" data-act="cash-cancel" data-id="${esc(p.id)}">취소</button>` : '-'}</td>
                        </tr>`).join('') : '<tr><td colspan="6" class="empty-state">등록된 자금계획이 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>
            <div class="card">
                <div class="card-title">실제 자금현황(현금성 계정 기준)</div>
                <div class="form-grid">
                    <div><label class="form-label">시작일</label><input id="posFrom" type="date" class="form-input" value="${esc(S.f.posFrom)}"></div>
                    <div><label class="form-label">종료일</label><input id="posTo" type="date" class="form-input" value="${esc(S.f.posTo)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-secondary btn-small" data-act="load-position">조회</button></div>
                <div class="table-responsive"><table><thead><tr><th>일자</th><th>입금</th><th>출금</th><th>순증감</th><th>누적잔액</th></tr></thead>
                    <tbody>${S.cashPosition.length ? S.cashPosition.map(r => `<tr><td>${esc(r.entry_date)}</td><td class="num">${num(r.cash_in)}</td><td class="num">${num(r.cash_out)}</td><td class="num">${num(r.net_change)}</td><td class="num">${num(r.running_balance)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">기간을 입력하고 조회하세요</td></tr>'}</tbody>
                </table></div>
            </div>`;
    }

    /* ── 4) 고정자산 ── */
    function assetsHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">고정자산 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">자산코드</label><input id="assetCode" class="form-input" value="${esc(S.f.assetCode)}"></div>
                    <div><label class="form-label">자산명</label><input id="assetName" class="form-input" value="${esc(S.f.assetName)}"></div>
                    <div><label class="form-label">취득일</label><input id="assetDate" type="date" class="form-input" value="${esc(S.f.assetDate)}"></div>
                    <div><label class="form-label">취득원가</label><input id="assetCost" type="number" class="form-input" value="${esc(S.f.assetCost)}"></div>
                    <div><label class="form-label">내용연수(개월)</label><input id="assetLife" type="number" class="form-input" value="${esc(S.f.assetLife)}"></div>
                    <div><label class="form-label">잔존가치(선택)</label><input id="assetSalvage" type="number" class="form-input" value="${esc(S.f.assetSalvage)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-asset">등록</button></div>
            </div>
            <div class="card">
                <div class="card-title">월 감가상각 실행</div>
                <div class="form-grid"><div><label class="form-label">기간(YYYY-MM)</label><input id="deprPeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.deprPeriod)}"></div></div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="run-depr">이번 기간 감가상각 일괄 실행</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">고정자산 목록</div>
                <div class="table-responsive"><table><thead><tr><th>코드</th><th>이름</th><th>취득원가</th><th>감가상각누계</th><th>장부가액</th><th>상태</th><th>동작</th></tr></thead>
                    <tbody>${S.assets.length ? S.assets.map(a => `
                        <tr><td>${esc(a.asset_code)}</td><td>${esc(a.asset_name)}</td><td class="num">${num(a.acquisition_cost)}</td><td class="num">${num(a.accumulated_depreciation)}</td><td class="num">${num(a.book_value)}</td>
                            <td>${a.status === 'disposed' ? '<span class="badge badge-dim">처분됨</span>' : '<span class="badge badge-ok">사용중</span>'}</td>
                            <td class="row-actions">
                                <button type="button" class="btn btn-secondary btn-small" data-act="view-schedule" data-id="${esc(a.id)}">상각일정</button>
                                ${(c.isAdmin && a.status !== 'disposed') ? `<button type="button" class="btn btn-danger btn-small" data-act="dispose-asset" data-id="${esc(a.id)}">처분</button>` : ''}
                            </td>
                        </tr>`).join('') : '<tr><td colspan="7" class="empty-state">등록된 고정자산이 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>
            ${S.assetSchedule ? `
            <div class="card">
                <div class="card-title">${esc(S.assetScheduleFor)} 감가상각 일정</div>
                <div class="table-responsive"><table><thead><tr><th>기간</th><th>당기상각액</th><th>누계</th><th>장부가액</th></tr></thead>
                    <tbody>${S.assetSchedule.length ? S.assetSchedule.map(r => `<tr><td>${esc(r.period)}</td><td class="num">${num(r.depreciation_amount)}</td><td class="num">${num(r.accumulated_depreciation)}</td><td class="num">${num(r.book_value)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">아직 상각 이력이 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>` : ''}`;
    }

    /* ── 5) 부가세 ── */
    function vatHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">세금계산서 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">구분</label><select id="vatDir" class="form-select"><option value="sales" ${S.f.vatDir === 'sales' ? 'selected' : ''}>매출</option><option value="purchase" ${S.f.vatDir === 'purchase' ? 'selected' : ''}>매입</option></select></div>
                    <div><label class="form-label">일자</label><input id="vatDate" type="date" class="form-input" value="${esc(S.f.vatDate)}"></div>
                    <div><label class="form-label">공급가액</label><input id="vatSupply" type="number" class="form-input" value="${esc(S.f.vatSupply)}"></div>
                    <div><label class="form-label">세액</label><input id="vatVat" type="number" class="form-input" value="${esc(S.f.vatVat)}"></div>
                    <div><label class="form-label">거래처(선택)</label><input id="vatPartner" class="form-input" value="${esc(S.f.vatPartner)}"></div>
                    <div><label class="form-label">세금계산서번호(선택)</label><input id="vatInvoice" class="form-input" value="${esc(S.f.vatInvoice)}"></div>
                    <div class="full"><label class="form-label">메모</label><input id="vatMemo" class="form-input" value="${esc(S.f.vatMemo)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-vat">등록</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">기간별 부가세 요약</div>
                <div class="form-grid">
                    <div><label class="form-label">시작일</label><input id="vatFrom" type="date" class="form-input" value="${esc(S.f.vatFrom)}"></div>
                    <div><label class="form-label">종료일</label><input id="vatTo" type="date" class="form-input" value="${esc(S.f.vatTo)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-secondary btn-small" data-act="load-vat-summary">조회</button></div>
                ${S.vatSummary ? `
                <div class="summary-row" style="margin-top:12px;">
                    <div class="summary-card"><div class="summary-label">매출세액</div><div class="summary-value">${num(S.vatSummary.output_vat)}원</div></div>
                    <div class="summary-card"><div class="summary-label">매입세액</div><div class="summary-value">${num(S.vatSummary.input_vat)}원</div></div>
                    <div class="summary-card"><div class="summary-label">납부(환급)세액</div><div class="summary-value">${num(S.vatSummary.payable_vat)}원</div></div>
                </div>` : ''}
            </div>
            <div class="card">
                <div class="card-title">세금계산서 목록</div>
                <div class="table-responsive"><table><thead><tr><th>구분</th><th>일자</th><th>거래처</th><th>공급가액</th><th>세액</th><th>계산서번호</th></tr></thead>
                    <tbody>${S.vatTx.length ? S.vatTx.map(v => `<tr><td>${v.direction === 'sales' ? '매출' : '매입'}</td><td>${esc(v.entry_date)}</td><td>${esc(v.partner_ref || '-')}</td><td class="num">${num(v.supply_amount)}</td><td class="num">${num(v.vat_amount)}</td><td>${esc(v.tax_invoice_no || '-')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">등록된 세금계산서가 없습니다</td></tr>'}</tbody>
                </table></div>
            </div>`;
    }

    /* ── 6) 예산 ── */
    function budgetHTML() {
        const c = S.cfg;
        return `
            ${c.isAdmin ? `
            <div class="card">
                <div class="card-title">예산 등록</div>
                <div class="form-grid">
                    <div><label class="form-label">기간(YYYY-MM)</label><input id="budgetPeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.budgetPeriod)}"></div>
                    <div><label class="form-label">계정</label><select id="budgetAccount" class="form-select">${accOptions(S.f.budgetAccount)}</select></div>
                    <div><label class="form-label">코스트센터(선택)</label><select id="budgetCenter" class="form-select">${centerOptions(S.f.budgetCenter, true)}</select></div>
                    <div><label class="form-label">예산금액</label><input id="budgetAmount" type="number" class="form-input" value="${esc(S.f.budgetAmount)}"></div>
                    <div class="full"><label class="form-label">메모</label><input id="budgetMemo" class="form-input" value="${esc(S.f.budgetMemo)}"></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-primary btn-small" data-act="save-budget">저장</button></div>
            </div>` : ''}
            <div class="card">
                <div class="card-title">예산 대비 실적</div>
                <div class="form-grid">
                    <div><label class="form-label">기간(YYYY-MM)</label><input id="budgetViewPeriod" class="form-input" placeholder="2026-09" value="${esc(S.f.budgetViewPeriod)}"></div>
                    <div><label class="form-label">코스트센터(선택)</label><select id="budgetViewCenter" class="form-select">${centerOptions(S.f.budgetViewCenter, true)}</select></div>
                </div>
                <div class="form-actions"><button type="button" class="btn btn-secondary btn-small" data-act="load-budget-actual">조회</button></div>
                <div class="table-responsive"><table><thead><tr><th>계정</th><th>예산</th><th>실적</th><th>차이</th></tr></thead>
                    <tbody>${S.budgets.length ? S.budgets.map(b => `<tr><td>${esc(b.account_code)} ${esc(b.account_name)}</td><td class="num">${num(b.budget_amount)}</td><td class="num">${num(b.actual_amount)}</td><td class="num ${Number(b.variance) > 0 ? 'so-neg' : ''}">${num(b.variance)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">기간을 입력하고 조회하세요</td></tr>'}</tbody>
                </table></div>
            </div>`;
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        const subsBar = `<div class="so-subtabs">${SUBS.map(([k, l]) => `<button type="button" class="so-subtab ${S.sub === k ? 'active' : ''}" data-act="sub" data-k="${k}">${l}</button>`).join('')}</div>`;
        let body = '';
        if (S.sub === 'costcenter') body = costcenterHTML();
        else if (S.sub === 'closing') body = closingHTML();
        else if (S.sub === 'cash') body = cashHTML();
        else if (S.sub === 'assets') body = assetsHTML();
        else if (S.sub === 'vat') body = vatHTML();
        else if (S.sub === 'budget') body = budgetHTML();
        el.innerHTML = subsBar + msgHtml + body;
    }

    function v(id) { const e = document.getElementById(id); return e ? e.value : ''; }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        const act = b.dataset.act, id = b.dataset.id;

        if (act === 'sub') { S.sub = b.dataset.k; setMsg(null); await render(); return; }

        if (act === 'save-center') {
            if (!v('ccCode') || !v('ccName')) { setMsg('코드·이름을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_upsert_cost_center', { p_center_code: v('ccCode'), p_center_name: v('ccName'), p_center_type: v('ccType') }, () => `코스트센터 ${v('ccCode')} 저장됨`);
            await render(); return;
        }
        if (act === 'save-basis') {
            if (!v('basisCenter') || !v('basisPeriod') || !v('basisDriver') || v('basisValue') === '') { setMsg('모든 항목을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_set_allocation_basis', { p_center_code: v('basisCenter'), p_period: v('basisPeriod'), p_driver_name: v('basisDriver'), p_driver_value: Number(v('basisValue')) }, () => '배부기준을 저장했습니다');
            await render(); return;
        }
        if (act === 'save-rule') {
            if (!v('ruleName') || !v('ruleAccount') || !v('ruleDriver')) { setMsg('모든 항목을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_upsert_allocation_rule', { p_rule_name: v('ruleName'), p_source_account_code: v('ruleAccount'), p_driver_name: v('ruleDriver'), p_active: true }, () => '배부규칙을 저장했습니다');
            await render(); return;
        }
        if (act === 'pick-run-rule') { S.f.allocRule = id; draw(); return; }
        if (act === 'run-alloc') {
            if (!v('allocRule') && !S.f.allocRule) { setMsg('배부규칙을 선택하세요', false); draw(); return; }
            const period = v('allocPeriod');
            if (!period) { setMsg('기간을 입력하세요', false); draw(); return; }
            const r = await adminAction('acc_admin_run_cost_allocation', { p_rule_id: v('allocRule') || S.f.allocRule, p_period: period }, r => `배부 실행 완료 — 대상금액 ${num(r.source_amount)}원, ${r.center_count}개 코스트센터`);
            if (r && r.success) { S.allocResults = await call('acc_get_cost_allocation_results', { p_period: period }) || []; }
            draw(); return;
        }
        if (act === 'load-summary') {
            const p = v('summaryPeriod'); if (!p) { setMsg('기간을 입력하세요', false); draw(); return; }
            S.f.summaryPeriod = p;
            try { S.centerSummary = await call('acc_get_cost_center_summary', { p_period: p }) || []; } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'run-closing') {
            const p = v('closePeriod'); if (!p) { setMsg('기간을 입력하세요', false); draw(); return; }
            if (!confirm(`${p} 기간을 마감할까요? 마감 후에는 그 기간에 분개를 추가할 수 없습니다.`)) return;
            await adminAction('acc_admin_run_period_closing', { p_period: p }, r => `${p} 마감 완료 — 순이익 ${num(r.net_income)}원`);
            await render(); return;
        }
        if (act === 'reopen-period') {
            const p = v('closePeriod'); if (!p) { setMsg('기간을 입력하세요', false); draw(); return; }
            if (!confirm(`${p} 기간을 재오픈할까요?`)) return;
            await adminAction('acc_admin_reopen_period', { p_period: p }, () => `${p}을(를) 재오픈했습니다`);
            await render(); return;
        }
        if (act === 'save-cashplan') {
            if (!v('cashDate') || v('cashAmount') === '') { setMsg('일자·금액을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_create_cash_plan', { p_plan_date: v('cashDate'), p_direction: v('cashDir'), p_amount: Number(v('cashAmount')), p_counterparty: v('cashCounterparty') || null, p_memo: v('cashMemo') || null }, () => '자금계획을 등록했습니다');
            await render(); return;
        }
        if (act === 'cash-realize') { await adminAction('acc_admin_update_cash_plan_status', { p_plan_id: id, p_status: 'realized' }, () => '실현 처리했습니다'); await render(); return; }
        if (act === 'cash-cancel') { if (!confirm('취소할까요?')) return; await adminAction('acc_admin_update_cash_plan_status', { p_plan_id: id, p_status: 'canceled' }, () => '취소했습니다'); await render(); return; }
        if (act === 'load-position') {
            const f = v('posFrom'), t = v('posTo');
            if (!f || !t) { setMsg('시작일·종료일을 입력하세요', false); draw(); return; }
            try { S.cashPosition = await call('acc_get_cash_position', { p_date_from: f, p_date_to: t }) || []; } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'save-asset') {
            if (!v('assetCode') || !v('assetName') || !v('assetDate') || v('assetCost') === '' || !v('assetLife')) { setMsg('필수 항목을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_register_fixed_asset', { p_asset_code: v('assetCode'), p_asset_name: v('assetName'), p_acquisition_date: v('assetDate'), p_acquisition_cost: Number(v('assetCost')), p_useful_life_months: Number(v('assetLife')), p_salvage_value: Number(v('assetSalvage') || 0) }, () => `자산 ${v('assetCode')} 등록됨`);
            await render(); return;
        }
        if (act === 'run-depr') {
            const p = v('deprPeriod'); if (!p) { setMsg('기간을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_run_monthly_depreciation', { p_period: p }, r => `${p} 감가상각 실행 — ${r.asset_count}개 자산, 합계 ${num(r.total_depreciation)}원`);
            await render(); return;
        }
        if (act === 'view-schedule') {
            const a = S.assets.find(x => x.id === id);
            S.assetScheduleFor = a ? `${a.asset_code} ${a.asset_name}` : '';
            try { S.assetSchedule = await call('acc_get_asset_depreciation_schedule', { p_asset_id: id }) || []; } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'dispose-asset') {
            const amt = prompt('처분금액을 입력하세요(숫자):', '0');
            if (amt === null) return;
            if (!confirm('자산을 처분 처리할까요? 되돌릴 수 없습니다.')) return;
            await adminAction('acc_admin_dispose_fixed_asset', { p_asset_id: id, p_dispose_date: new Date().toISOString().slice(0, 10), p_disposal_amount: Number(amt) || 0 }, r => `처분 완료 — 처분손익 ${num(r.gain_loss)}원`);
            await render(); return;
        }
        if (act === 'save-vat') {
            if (!v('vatDate') || v('vatSupply') === '' || v('vatVat') === '') { setMsg('일자·공급가액·세액을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_register_vat_transaction', { p_direction: v('vatDir'), p_entry_date: v('vatDate'), p_supply_amount: Number(v('vatSupply')), p_vat_amount: Number(v('vatVat')), p_partner_ref: v('vatPartner') || null, p_tax_invoice_no: v('vatInvoice') || null, p_memo: v('vatMemo') || null }, () => '세금계산서를 등록했습니다');
            await render(); return;
        }
        if (act === 'load-vat-summary') {
            const f = v('vatFrom'), t = v('vatTo');
            if (!f || !t) { setMsg('시작일·종료일을 입력하세요', false); draw(); return; }
            try { S.vatSummary = await call('acc_get_vat_summary', { p_date_from: f, p_date_to: t }); } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
        if (act === 'save-budget') {
            if (!v('budgetPeriod') || !v('budgetAccount') || v('budgetAmount') === '') { setMsg('기간·계정·예산금액을 입력하세요', false); draw(); return; }
            await adminAction('acc_admin_upsert_budget', { p_period: v('budgetPeriod'), p_account_code: v('budgetAccount'), p_budget_amount: Number(v('budgetAmount')), p_center_code: v('budgetCenter') || null, p_memo: v('budgetMemo') || null }, () => '예산을 저장했습니다');
            await render(); return;
        }
        if (act === 'load-budget-actual') {
            const p = v('budgetViewPeriod'); if (!p) { setMsg('기간을 입력하세요', false); draw(); return; }
            try { S.budgets = await call('acc_get_budget_vs_actual', { p_period: p, p_center_code: v('budgetViewCenter') || null }) || []; } catch (e) { setMsg('오류: ' + e.message, false); }
            draw(); return;
        }
    }

    const CSS = `
        #costAcctRoot .so-subtabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
        #costAcctRoot .so-subtab{border:1px solid var(--border);background:#fff;color:var(--text-secondary);border-radius:18px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
        #costAcctRoot .so-subtab.active{background:var(--primary);border-color:var(--primary);color:#fff}
        #costAcctRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #costAcctRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #costAcctRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}
        #costAcctRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0 0 10px}
        #costAcctRoot .so-neg{color:var(--danger);font-weight:700}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('costAcctStyle')) {
            const st = document.createElement('style'); st.id = 'costAcctStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) { document.addEventListener('click', onClick); S._bound = true; }
    }

    global.CostAccounting = { init, render };
})(window);
