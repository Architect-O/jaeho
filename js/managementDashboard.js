/* ══════════════════════════════════════════════════════════════════════════
   managementDashboard.js — 경영분석(BI) 통합 대시보드 (2026-09-27, 대형 로드맵 라운드4)
   단일 RPC(biz_get_management_dashboard)로 8개 하위 리포트를 한 번에 받아 그린다.
   "결론 먼저, 과정은 접어서" 원칙(claude/ERP_Dashboard_메뉴_통합분리_기준.md 0-1절)을 따라,
   최상단에 핵심 결론(요약 카드)을 두고 세부 근거는 <details>(기본 접힘)에 넣는다.
   서버 쪽은 inthub/biz_dashboard_migration.sql. 근거: claude/모듈_경영분석_BI리포트.md

   읽기 전용 리포트라 관리자 자격증명이 필요 없다(등록/실행 액션 없음).

   사용법:
     <script src="./js/managementDashboard.js"></script>
     ManagementDashboard.init({ sb });
     탭/컨테이너 전환 시: el.innerHTML = '<div id="mgmtDashRoot"></div>'; ManagementDashboard.render();
══════════════════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    const PILOT_LABEL = { p3: 'HC 유통', p4: 'HD 보세창고', p5: 'HE 무역', p6: 'HF 식품제조' };

    function firstDayOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
    function isoDate(d) { return d.toISOString().slice(0, 10); }
    const today = new Date();

    const S = {
        cfg: null,
        dateFrom: isoDate(firstDayOfMonth(today)),
        dateTo: isoDate(today),
        data: null,
        msg: null,
    };

    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function num(n) { if (n == null || n === '') return '-'; const v = Number(n); return isNaN(v) ? '-' : v.toLocaleString('ko-KR'); }
    function signed(n) {
        const v = Number(n) || 0;
        const s = Math.abs(v).toLocaleString('ko-KR');
        return v < 0 ? `<span class="so-neg">-${s}</span>` : (v > 0 ? `+${s}` : '0');
    }
    function root() { return document.getElementById('mgmtDashRoot'); }
    function setMsg(text, ok) { S.msg = text ? { text, ok: !!ok } : null; }

    async function call(fn, args) {
        const c = S.cfg;
        if (!c.sb) throw new Error('Supabase 연결이 설정되지 않았습니다');
        const { data, error } = await c.sb.rpc(fn, args || {});
        if (error) throw new Error(error.message || String(error));
        return data;
    }

    let _renderToken = 0;
    async function render() {
        const my = ++_renderToken;
        const el = root(); if (!el) return;
        if (!el.innerHTML.trim()) el.innerHTML = '<div class="empty-state">불러오는 중...</div>';
        try {
            S.data = await call('biz_get_management_dashboard', { p_date_from: S.dateFrom, p_date_to: S.dateTo, p_period: null }) || {};
            if (my !== _renderToken) return;
            draw();
        } catch (e) {
            el.innerHTML = `<div class="card"><div class="empty-state">경영분석 데이터를 불러오지 못했습니다: ${esc(e.message)}<br><span style="font-size:11.5px">Supabase SQL Editor에서 <code>biz_dashboard_migration.sql</code>을 먼저 실행했는지 확인하세요(라운드3의 <code>acc_cost_center_migration.sql</code>·<code>acc_advanced_migration.sql</code>도 선행 필요).</span></div></div>`;
        }
    }

    function filterBarHTML() {
        return `
            <div class="card">
                <div class="card-title">📅 조회 기간</div>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <label class="so-help" style="margin:0;">시작일 <input type="date" id="mdFrom" class="form-input" value="${esc(S.dateFrom)}" style="width:auto;display:inline-block;"></label>
                    <label class="so-help" style="margin:0;">종료일 <input type="date" id="mdTo" class="form-input" value="${esc(S.dateTo)}" style="width:auto;display:inline-block;"></label>
                    <button type="button" class="btn btn-primary btn-small" data-act="reload">조회</button>
                </div>
            </div>`;
    }

    // ── 결론(요약) — 최상단 ──────────────────────────────────────────────
    function summaryHTML() {
        const d = S.data || {};
        const sp = d.sales_profit_by_pilot || [];
        const revenue = sp.reduce((s, r) => s + Number(r.revenue || 0), 0);
        const cogs = sp.reduce((s, r) => s + Number(r.cogs || 0), 0);
        const margin = revenue - cogs;
        const marginPct = revenue === 0 ? 0 : Math.round((margin / revenue) * 10000) / 100;
        const arTotal = (d.ar_aging || []).reduce((s, r) => s + Number(r.total_outstanding || 0), 0);
        const apTotal = (d.ap_aging || []).reduce((s, r) => s + Number(r.total_outstanding || 0), 0);
        const cf = d.cash_forecast || [];
        const cashNet = cf.reduce((s, r) => s + Number(r.combined_net || 0), 0);
        const cashEnd = cf.length ? cf[cf.length - 1].running_balance : 0;

        return `
            <div class="summary-row" style="grid-template-columns:repeat(3,1fr);">
                <div class="summary-card"><div class="summary-label">매출 (판매이익분석 합계)</div><div class="summary-value">${num(revenue)}</div></div>
                <div class="summary-card"><div class="summary-label">매출총이익 (마진율)</div><div class="summary-value">${num(margin)} <span style="font-size:13px;color:var(--text-secondary);">(${marginPct}%)</span></div></div>
                <div class="summary-card"><div class="summary-label">매출원가</div><div class="summary-value">${num(cogs)}</div></div>
                <div class="summary-card"><div class="summary-label">거래처 미수(AR) 총액</div><div class="summary-value ${arTotal > 0 ? 'warn' : ''}">${num(arTotal)}</div></div>
                <div class="summary-card"><div class="summary-label">거래처 미지급(AP) 총액</div><div class="summary-value">${num(apTotal)}</div></div>
                <div class="summary-card"><div class="summary-label">자금 순증감 (기간중, 계획포함)</div><div class="summary-value">${signed(cashNet)} <span style="font-size:12px;color:var(--text-secondary);">종료잔액 ${num(cashEnd)}</span></div></div>
            </div>
            <div class="note-card">📌 기간: <b>${esc(S.dateFrom)} ~ ${esc(S.dateTo)}</b> · 이 요약은 아래 상세 리포트(접어둠)를 합산한 결론입니다. 근거가 궁금하면 아래 섹션을 펼쳐서 확인하세요. AR/AP는 실제 분개에 거래처(<code>partner_ref</code>)가 입력된 경우에만 의미 있는 값입니다.</div>`;
    }

    // ── 상세(근거) — 기본 접힘 ───────────────────────────────────────────
    function salesProfitHTML() {
        const rows = (S.data.sales_profit_by_pilot || []);
        if (!rows.length) return '<div class="empty-state">데이터 없음</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>파일럿</th><th>매출</th><th>매출원가</th><th>매출총이익</th><th>마진율</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(PILOT_LABEL[r.pilot_code] || r.pilot_code)}</td>
                <td class="num">${num(r.revenue)}</td><td class="num">${num(r.cogs)}</td>
                <td class="num">${num(r.margin)}</td><td class="num">${esc(r.margin_pct)}%</td>
            </tr>`).join('')}</tbody></table></div>
            <p class="so-help">HD(보세창고)는 3자물류 업태라 "판매" 개념이 맞지 않아 제외, HF(식품제조)는 출하전표에 판매단가가 없어 제외했습니다.</p>`;
    }

    function agingHTML(rows, label) {
        if (!rows || !rows.length) return `<div class="empty-state">${esc(label)} 잔액이 있는 거래처가 없습니다.</div>`;
        return `<div class="table-responsive"><table>
            <thead><tr><th>거래처(partner_ref)</th><th>0-30일</th><th>31-60일</th><th>61-90일</th><th>90일 초과</th><th>합계</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.partner_ref)}</td>
                <td class="num">${num(r.bucket_0_30)}</td><td class="num">${num(r.bucket_31_60)}</td>
                <td class="num">${num(r.bucket_61_90)}</td>
                <td class="num ${Number(r.bucket_90_plus) > 0 ? 'so-neg' : ''}">${num(r.bucket_90_plus)}</td>
                <td class="num">${num(r.total_outstanding)}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    function cashForecastHTML() {
        const rows = S.data.cash_forecast || [];
        if (!rows.length) return '<div class="empty-state">데이터 없음</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>일자</th><th>실적 순증감</th><th>계획 순증감</th><th>합계</th><th>누적잔액</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.cash_date)}</td>
                <td class="num">${signed(r.actual_net)}</td><td class="num">${signed(r.planned_net)}</td>
                <td class="num">${signed(r.combined_net)}</td><td class="num">${num(r.running_balance)}</td>
            </tr>`).join('')}</tbody></table></div>
            <p class="so-help">계획(planned) 상태의 자금계획만 반영합니다 — 이미 실현(realized) 처리된 계획은 실적에 반영됐을 것으로 보아 전망 합산에서 제외해 중복 계상을 막습니다.</p>`;
    }

    function costCenterHTML() {
        const rows = S.data.cost_center_summary || [];
        if (!rows.length) return '<div class="empty-state">데이터 없음 — 라운드3(원가·회계심화) 탭에서 코스트센터·배부를 먼저 등록하세요.</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>코스트센터</th><th>직접 태깅분</th><th>배부분</th><th>합계</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.center_name || r.center_code || '-')}</td>
                <td class="num">${num(r.direct_amount)}</td><td class="num">${num(r.allocated_amount)}</td>
                <td class="num">${num(r.total_amount)}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    function budgetHTML() {
        const rows = S.data.budget_vs_actual || [];
        if (!rows.length) return '<div class="empty-state">데이터 없음 — 라운드3(원가·회계심화) 탭에서 예산을 먼저 등록하세요.</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>계정과목</th><th>코스트센터</th><th>예산</th><th>실제</th><th>차이</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.account_name || r.account_code || '-')}</td><td>${esc(r.center_code || '(전사)')}</td>
                <td class="num">${num(r.budget_amount)}</td><td class="num">${num(r.actual_amount)}</td>
                <td class="num">${signed(r.variance)}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    function segmentPnlHTML() {
        const rows = S.data.segment_pnl || [];
        if (!rows.length) return '<div class="empty-state">데이터 없음</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>사업군(segment)</th><th>수익</th><th>비용</th><th>순손익</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.segment)}</td><td class="num">${num(r.revenue_total)}</td>
                <td class="num">${num(r.expense_total)}</td><td class="num">${signed(r.net_income)}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    function consolidatedHTML() {
        const rows = S.data.consolidated_financial_summary || [];
        if (!rows.length) return '<div class="empty-state">데이터 없음</div>';
        return `<div class="table-responsive"><table>
            <thead><tr><th>법인</th><th>계정코드</th><th>계정명</th><th>유형</th><th>차변</th><th>대변</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
                <td>${esc(r.company_code)}</td><td>${esc(r.account_code)}</td><td>${esc(r.account_name)}</td>
                <td>${esc(r.account_type)}</td><td class="num">${num(r.debit_total)}</td><td class="num">${num(r.credit_total)}</td>
            </tr>`).join('')}</tbody></table></div>
            <p class="so-help">법인 코드(company_code)를 채워 넣지 않았다면 전부 "(법인 미구분)"으로 합산됩니다. 법인 간 거래 상계는 하지 않습니다(알려진 한계).</p>`;
    }

    function detailsHTML() {
        const sections = [
            ['💰 판매이익분석 (파일럿별)', salesProfitHTML()],
            ['📈 거래처 연령분석 — 매출채권(AR)', agingHTML(S.data.ar_aging, 'AR')],
            ['📉 거래처 연령분석 — 매입채무(AP)', agingHTML(S.data.ap_aging, 'AP')],
            ['💵 자금현황 전망 (실적+계획)', cashForecastHTML()],
            ['🏷️ 코스트센터 요약 (라운드3 재사용)', costCenterHTML()],
            ['📊 예산 대비 실적 (라운드3 재사용)', budgetHTML()],
            ['🧩 사업군별 손익 (segment PnL)', segmentPnlHTML()],
            ['🏢 연결재무 요약 (법인별)', consolidatedHTML()],
        ];
        return sections.map(([label, body]) => `
            <details class="card mgmt-details">
                <summary class="card-title" style="cursor:pointer;">${label}</summary>
                <div style="margin-top:12px;">${body}</div>
            </details>`).join('');
    }

    function draw() {
        const el = root(); if (!el) return;
        const msgHtml = S.msg ? `<div class="so-msg ${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</div>` : '';
        el.innerHTML = `${msgHtml}${filterBarHTML()}${summaryHTML()}${detailsHTML()}`;
    }

    async function onClick(ev) {
        const b = ev.target.closest('[data-act]');
        if (!b || !root() || !root().contains(b)) return;
        if (b.dataset.act === 'reload') {
            const f = root().querySelector('#mdFrom'), t = root().querySelector('#mdTo');
            if (f && f.value) S.dateFrom = f.value;
            if (t && t.value) S.dateTo = t.value;
            if (S.dateFrom > S.dateTo) { setMsg('시작일이 종료일보다 늦을 수 없습니다', false); draw(); return; }
            setMsg(null); await render();
        }
    }

    const CSS = `
        #mgmtDashRoot .so-help{font-size:12px;color:var(--text-secondary);line-height:1.6;margin:6px 0 0}
        #mgmtDashRoot .so-msg{padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
        #mgmtDashRoot .so-msg.ok{background:var(--success-soft);color:var(--success)}
        #mgmtDashRoot .so-msg.err{background:var(--danger-soft);color:var(--danger)}
        #mgmtDashRoot .so-neg{color:var(--danger);font-weight:700}
        #mgmtDashRoot .mgmt-details summary{list-style:none;}
        #mgmtDashRoot .mgmt-details summary::-webkit-details-marker{display:none;}
        #mgmtDashRoot .mgmt-details summary::before{content:'▶ ';font-size:11px;color:var(--text-tertiary);}
        #mgmtDashRoot .mgmt-details[open] summary::before{content:'▼ ';}`;

    function init(cfg) {
        S.cfg = cfg;
        if (!document.getElementById('mgmtDashStyle')) {
            const st = document.createElement('style'); st.id = 'mgmtDashStyle'; st.textContent = CSS; document.head.appendChild(st);
        }
        if (!S._bound) { document.addEventListener('click', onClick); S._bound = true; }
    }

    global.ManagementDashboard = { init, render };
})(window);
